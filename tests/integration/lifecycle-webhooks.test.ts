// Keep production destination validation unchanged; route only the test receiver
// socket to an ephemeral port so a running development API cannot collide.
const receiver = vi.hoisted(() => ({ port: 0 }));
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return {
    ...actual,
    request: (...args: Parameters<typeof actual.request>) => {
      if (
        args[0] instanceof URL &&
        args[0].origin === "http://localhost:3001"
      ) {
        const url = new URL(args[0]);
        url.port = String(receiver.port);
        args[0] = url;
      }
      return actual.request(...args);
    },
  };
});
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import {
  webhookEvents,
  type WebhookPayload,
} from "@narada/core/webhook-events";
import { lifecycleJobs } from "@narada/core/event-outbox";
import {
  deliveryHistory,
  listDeliveries,
  recoverWebhook,
  retryWebhook,
  sendWebhook,
  signWebhook,
} from "@narada/core/webhooks";
import { formStarters } from "@narada/core/form-content";
import { hash, type Entity } from "@narada/core/model";
import { EmailService } from "@narada/core/service";
import { BroadcastService } from "@narada/core/broadcasts";
import type { Queues } from "@narada/core/queue";
let r: Awaited<ReturnType<typeof initialize>>,
  cookie = "";
const prefix = `narada-lifecycle-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`;
const endpointId = randomUUID(),
  signingSecret = "fixture-signing-secret";
const received: {
  body: string;
  id: string;
  signature: string;
  timestamp: string;
}[] = [];
let responseStatus = 200,
  hold = false,
  held: ServerResponse | undefined;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  received.push({
    body: Buffer.concat(chunks).toString(),
    id: String(req.headers["webhook-id"]),
    signature: String(req.headers["webhook-signature"]),
    timestamp: String(req.headers["webhook-timestamp"]),
  });
  if (hold) {
    held = res;
    hold = false;
    return;
  }
  res.writeHead(responseStatus).end();
});
beforeAll(async () => {
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  r = await initialize(credentials);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  receiver.port = (server.address() as import("node:net").AddressInfo).port;
  await r.store.put({
    pk: `WEBHOOK#${endpointId}`,
    sk: "META",
    id: endpointId,
    scope: "webhooks",
    sort: endpointId,
    url: "http://localhost:3001/api/dev/webhook-receiver",
    secret: signingSecret,
    events: webhookEvents
      .filter((e) => ["Forms", "Publications", "Broadcasts"].includes(e.group))
      .map((e) => e.type),
  });
  await vi.waitFor(async () =>
    expect((await r.store.list("webhooks")).length).toBe(1),
  );
  const app = createApp(r),
    origin = "http://localhost:5173";
  const login = await app.request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: await readFile(credentials, "utf8"),
  });
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});
afterAll(async () => {
  held?.end();
  server.closeAllConnections();
  if (server.listening)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (r)
    for (const TableName of [r.config.APP_TABLE, r.config.AUTH_TABLE])
      await r.store.client.send(new DeleteTableCommand({ TableName }));
  await rm(credentials, { force: true });
});
async function jobs(type: string, resource: string) {
  return (await r.store.list<Entity>("webhookAttempts", 1000)).filter((j) => {
    const p = j.payload as WebhookPayload;
    return p.type === type && Object.values(p.data).includes(resource);
  });
}
async function job() {
  const writes = await lifecycleJobs(
    r.store,
    "broadcast.completed",
    randomUUID(),
    { broadcast_id: randomUUID(), total: 1, counts: { captured: 1 } },
  );
  await r.store.transaction(writes);
  return writes[0]!.Put.Item as Entity;
}
it("atomically emits received/completed once for concurrent form submissions without answers or email", async () => {
  const form = await r.forms.create(formStarters.feedback);
  await r.forms.publish(form.id, 0);
  const input = {
    submissionId: randomUUID(),
    version: 1,
    answers: { rating: 5, feedback: "PRIVATE ANSWER" },
  };
  await Promise.all([
    r.forms.submit(form.id, input),
    r.forms.submit(form.id, input),
  ]);
  const id = hash(`${form.id}:${input.submissionId}`);
  for (const type of ["form.response.received", "form.response.completed"]) {
    const deliveries = await jobs(type, id);
    expect(deliveries).toHaveLength(1);
    expect((deliveries[0]!.payload as WebhookPayload).data).toEqual({
      form_id: form.id,
      response_id: id,
      version: 1,
      revision: 0,
      status: "complete",
    });
    expect(JSON.stringify(deliveries)).not.toContain("PRIVATE ANSWER");
  }
  await expect(
    r.forms.submit(form.id, { ...input, answers: { rating: 4 } }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await jobs("form.response.received", id)).toHaveLength(1);
  const transaction = vi
    .spyOn(r.store, "transaction")
    .mockRejectedValueOnce(new Error("storage failure"));
  const aborted = randomUUID();
  await expect(
    r.forms.submit(form.id, { ...input, submissionId: aborted }),
  ).rejects.toThrow("storage failure");
  transaction.mockRestore();
  expect(
    await jobs("form.response.received", hash(`${form.id}:${aborted}`)),
  ).toHaveLength(0);
});
it("emits processing failure and later completion without treating verification as completion", async () => {
  const pub = await r.publications.create({
    name: "Lifecycle",
    slug: `life-${randomUUID()}`,
    from: "hello@narada.test",
    organization: "Test",
    postalAddress: "1 Test Street",
  });
  await r.publications.update(pub.id, pub.settings, 0, "active");
  const form = await r.forms.get(pub.formId),
    submissionId = randomUUID();
  await r.forms.submit(form.id, {
    submissionId,
    version: form.version,
    answers: {
      email: `${randomUUID()}@example.com`,
      name: "Private name",
      consent: true,
    },
  });
  const id = hash(`${form.id}:${submissionId}`);
  await r.forms.run(id);
  expect((await r.forms.response(id)).status).toBe("awaiting_verification");
  expect(await jobs("form.response.completed", id)).toHaveLength(0);
  await r.forms.confirm(r.forms.token(await r.forms.response(id)));
  await r.store.patch(`FORMRESPONSE#${id}`, { attempts: 5 });
  const sync = vi
    .spyOn(r.forms, "sync")
    .mockRejectedValueOnce(new Error("temporary failure"));
  await r.forms.run(id);
  sync.mockRestore();
  expect(await jobs("form.response.failed", id)).toHaveLength(1);
  await r.forms.retry(id);
  await Promise.all([r.forms.run(id), r.forms.run(id)]);
  expect((await r.forms.response(id)).status).toBe("complete");
  expect(await jobs("form.response.completed", id)).toHaveLength(1);
  expect(JSON.stringify(await jobs("form.response.failed", id))).not.toContain(
    "Private name",
  );
});
const draft = () => ({
  title: "Private title",
  slug: `issue-${randomUUID()}`,
  document: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Private body" }] },
    ],
  },
});
async function issue() {
  const pub = await r.publications.create({
    name: "Lifecycle",
    slug: `publication-${randomUUID()}`,
    from: "hello@narada.test",
    organization: "Test",
    postalAddress: "1 Test Street",
  });
  await r.publications.update(pub.id, pub.settings, 0, "active");
  return { pub, issue: await r.issues.create(pub.id, draft()) };
}
it("emits issue publication on immediate release, each web correction, and scheduled release only once", async () => {
  const f = await issue();
  const published = await r.issues.publish(f.pub.id, f.issue.id, 0, "web");
  expect(await jobs("issue.published", f.issue.id)).toHaveLength(1);
  const corrected = await r.issues.update(
    f.pub.id,
    f.issue.id,
    { ...f.issue.draft, title: "Correction" },
    published.revision,
  );
  await r.issues.publish(f.pub.id, f.issue.id, corrected.revision, "web");
  expect(await jobs("issue.published", f.issue.id)).toHaveLength(2);
  const g = await issue(),
    scheduled = await r.issues.publish(
      g.pub.id,
      g.issue.id,
      0,
      "web",
      Date.now() + 60000,
    );
  await r.issues.run(scheduled.operationId!);
  expect(await jobs("issue.published", g.issue.id)).toHaveLength(0);
  await r.store.patch(`PUBLICATIONOP#${scheduled.operationId}`, {
    scheduledAt: Date.now() - 1,
  });
  await Promise.all([
    r.issues.run(scheduled.operationId!),
    r.issues.run(scheduled.operationId!),
  ]);
  const deliveries = await jobs("issue.published", g.issue.id);
  expect(deliveries).toHaveLength(1);
  expect(JSON.stringify(deliveries)).not.toMatch(/Private body|Private title/);
  expect((deliveries[0]!.payload as WebhookPayload).data).toMatchObject({
    channels: "web",
    release_id: scheduled.operationId,
  });
  const h = await issue(),
    cancelled = await r.issues.publish(
      h.pub.id,
      h.issue.id,
      0,
      "web",
      Date.now() + 60000,
    );
  await r.issues.cancel(h.pub.id, h.issue.id, cancelled.revision);
  await r.issues.run(cancelled.operationId!);
  expect(await jobs("issue.published", h.issue.id)).toHaveLength(0);
});
it("emits broadcast completion once after dispatch settles with counts but no recipients", async () => {
  const emails = new EmailService(
    r.config,
    r.store,
    { send: vi.fn() } as unknown as Queues,
    { send: async () => ({ id: randomUUID(), captured: true }) },
  );
  const broadcasts = new BroadcastService(r.config, r.store, emails);
  const audience = await broadcasts.createAudience(`Lifecycle ${randomUUID()}`),
    email = `${randomUUID()}@example.com`;
  await broadcasts.importAudience(audience.id, email, "Explicit signup");
  const b = await broadcasts.create({
    name: "Lifecycle",
    audienceId: audience.id,
    from: "hello@narada.test",
    subject: "Private subject",
    text: "Private content",
    organization: "Test",
    postalAddress: "Test",
  });
  await broadcasts.start(b.id, 0);
  await broadcasts.run(b.id);
  expect(await jobs("broadcast.completed", b.id)).toHaveLength(0);
  for (const recipient of (await broadcasts.results(b.id)).recipients)
    await emails.send(recipient.messageId);
  await Promise.all([broadcasts.run(b.id), broadcasts.run(b.id)]);
  await broadcasts.run(b.id);
  const deliveries = await jobs("broadcast.completed", b.id);
  expect(deliveries).toHaveLength(1);
  expect((deliveries[0]!.payload as WebhookPayload).data).toEqual({
    broadcast_id: b.id,
    total: 1,
    counts: { captured: 1 },
  });
  expect(JSON.stringify(deliveries)).not.toContain(email);
});
it("signs the exact bytes and claims concurrent deliveries once", async () => {
  const j = await job(),
    before = received.length;
  responseStatus = 204;
  await Promise.all([
    sendWebhook(r.store, String(j.id), true),
    sendWebhook(r.store, String(j.id), true),
  ]);
  expect(received).toHaveLength(before + 1);
  const actual = received.at(-1)!;
  expect(actual.signature).toBe(
    `v1=${signWebhook(signingSecret, actual.id, actual.timestamp, actual.body)}`,
  );
  expect(actual.id).toBe((j.payload as WebhookPayload).id);
  const history = await deliveryHistory(r.store, String(j.id), {});
  expect(history.delivery).toMatchObject({
    state: "complete",
    attempts: 1,
    lastStatus: 204,
  });
  expect(history.data).toMatchObject([
    { attempt: 1, outcome: "succeeded", status: 204 },
  ]);
  expect(JSON.stringify(history)).not.toMatch(
    /HOOKJOB|HOOKATTEMPT|runToken|whsec_|counts/,
  );
});
it("backs off, exhausts six attempts, and keeps history and event identity on a manual retry", async () => {
  const j = await job();
  responseStatus = 503;
  for (let i = 1; i <= 6; i++) {
    await sendWebhook(r.store, String(j.id), true);
    const current = await r.store.get(j.pk);
    expect(current!.attempts).toBe(i);
    expect(current!.state).toBe(i === 6 ? "failed" : "webhook");
    const before = received.length;
    await sendWebhook(r.store, String(j.id), true);
    expect(received).toHaveLength(before);
    if (i < 6) await r.store.patch(j.pk, { availableAt: 0 });
  }
  const retried = await Promise.allSettled([
    retryWebhook(r.store, String(j.id)),
    retryWebhook(r.store, String(j.id)),
  ]);
  expect(retried.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  responseStatus = 200;
  await sendWebhook(r.store, String(j.id), true);
  const history = await deliveryHistory(r.store, String(j.id), {});
  expect(history.delivery).toMatchObject({
    attempts: 7,
    cycleAttempts: 1,
    state: "complete",
    error: "",
  });
  expect(history.data).toHaveLength(7);
  expect(history.data[0]).toMatchObject({ attempt: 7, outcome: "succeeded" });
  const attempts = received.filter(
    (a) => a.id === (j.payload as WebhookPayload).id,
  );
  expect(new Set(attempts.map((a) => a.body)).size).toBe(1);
  expect(attempts).toHaveLength(7);
});
it("fences a stale worker after lease recovery and records uncertain receiver acceptance", async () => {
  const j = await job();
  hold = true;
  held = undefined;
  const first = sendWebhook(r.store, String(j.id), true);
  await expect.poll(() => !!held).toBe(true);
  await r.store.patch(j.pk, {
    leaseExpiresAt: Date.now() - 1,
    due: Date.now() - 1,
  });
  await recoverWebhook(r.store, String(j.id));
  responseStatus = 200;
  await sendWebhook(r.store, String(j.id), true);
  held!.writeHead(500).end();
  await first;
  const history = await deliveryHistory(r.store, String(j.id), {});
  expect(history.delivery).toMatchObject({
    state: "complete",
    attempts: 2,
    lastStatus: 200,
  });
  expect(history.data.map((a) => a.outcome)).toEqual(["succeeded", "unknown"]);
});
it("recovers lost database acknowledgments without overwriting a committed HTTP success", async () => {
  const j = await job(),
    original = r.store.transaction.bind(r.store),
    before = received.length;
  const tx = vi
    .spyOn(r.store, "transaction")
    .mockImplementation(async (writes) => {
      const result = await original(writes);
      if (
        writes.some(
          (w) =>
            w.Update?.ExpressionAttributeValues?.[":outcome"] === "succeeded",
        )
      )
        throw new Error("Lost commit acknowledgment");
      return result;
    });
  await expect(sendWebhook(r.store, String(j.id), true)).rejects.toThrow(
    "Lost commit acknowledgment",
  );
  tx.mockRestore();
  await sendWebhook(r.store, String(j.id), true);
  expect(received).toHaveLength(before + 1);
  expect(
    (await deliveryHistory(r.store, String(j.id), {})).delivery.state,
  ).toBe("complete");
});
it("paginates owner-only history, rejects tampered cursors and hides expired records", async () => {
  const app = createApp(r);
  expect((await app.request("/api/admin/webhooks/deliveries")).status).toBe(
    401,
  );
  const response = await app.request("/api/admin/webhooks/deliveries?limit=2", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  const page = await response.json();
  expect(page.data).toHaveLength(2);
  expect(page.nextCursor).toBeTruthy();
  const next = await listDeliveries(r.store, {
    limit: 2,
    cursor: page.nextCursor,
  });
  expect(next.data[0]!.id).not.toBe(page.data[0].id);
  await expect(
    listDeliveries(r.store, { cursor: "tampered" }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    deliveryHistory(r.store, String(page.data[0].id), {
      cursor: page.nextCursor,
    }),
  ).rejects.toMatchObject({ status: 400 });
  const j = await job();
  await r.store.patch(j.pk, { ttl: Math.floor(Date.now() / 1000) - 1 });
  await expect(
    deliveryHistory(r.store, String(j.id), {}),
  ).rejects.toMatchObject({ status: 404 });
  await expect(retryWebhook(r.store, String(j.id))).rejects.toMatchObject({
    status: 404,
  });
  const before = received.length;
  await sendWebhook(r.store, String(j.id), true);
  expect(received).toHaveLength(before);
});
it("handles legacy leases and removed endpoints without erasing delivery history", async () => {
  const j = await job();
  await r.store.patch(j.pk, {
    state: "webhook-running",
    attempts: 6,
    due: Date.now() - 1,
  });
  await recoverWebhook(r.store, String(j.id));
  expect((await r.store.get(j.pk))!.state).toBe("failed");
  const pending = await job();
  await r.store.remove(`WEBHOOK#${endpointId}`);
  await expect(retryWebhook(r.store, String(j.id))).rejects.toMatchObject({
    status: 409,
  });
  await sendWebhook(r.store, String(pending.id), true);
  expect(
    (await deliveryHistory(r.store, String(pending.id), {})).delivery,
  ).toMatchObject({ state: "cancelled", error: "Endpoint removed" });
});
