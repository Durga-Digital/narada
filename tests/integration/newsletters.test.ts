import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import type { Runtime } from "@narada/core/runtime";
import { hash } from "@narada/core/model";
import { contactKey, topicPreferenceKey } from "@narada/core/audience-model";
import type { Publication } from "@narada/core/newsletter-model";
import { broadcastMessageId } from "@narada/core/broadcast-model";
import { workHandler } from "../../apps/worker/src/handlers.js";
let r: Runtime, app: ReturnType<typeof createApp>, cookie: string;
const prefix = `narada-newsletters-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`,
  origin = "http://localhost:5173";
const issueDraft = (slug = `issue-${randomUUID().slice(0, 8)}`) => ({
  title: "First issue",
  slug,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "A note to our readers." }],
      },
    ],
  },
});
const settings = () => ({
  name: "Studio notes",
  slug: `studio-${randomUUID().slice(0, 8)}`,
  from: "hello@narada.test",
  author: "Studio",
  organization: "Narada",
  postalAddress: "1 Test Street",
});
async function publication(active = true) {
  const p = await r.publications.create(settings());
  return active ? r.publications.update(p.id, p.settings, 0, "active") : p;
}
async function subscriber(pub: Publication) {
  const email = `${randomUUID()}@example.com`,
    submissionId = randomUUID(),
    form = await r.forms.get(pub.formId);
  await r.forms.submit(pub.formId, {
    submissionId,
    version: form.version,
    answers: { email, name: "Reader", consent: true },
  });
  const row = await r.forms.response(hash(`${pub.formId}:${submissionId}`)),
    token = r.forms.token(row);
  await r.forms.confirm(token);
  await r.forms.sync(
    await r.forms.response(row.id),
    (await r.forms.version(pub.formId, row.version)).content,
  );
  return { email, row, token };
}
function publicPost(path: string, data: Record<string, string>) {
  return app.request(origin + path, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data),
  });
}
async function due(pub: Publication, issueId: string) {
  const issue = await r.issues.get(pub.id, issueId),
    op = await r.store.get(`PUBLICATIONOP#${issue.operationId}`);
  await r.store.patch(op!.pk, {
    scheduledAt: Date.now() - 1000,
    due: Date.now() - 1000,
  });
  if (issue.broadcastId)
    await r.store.patch(`BROADCAST#${issue.broadcastId}`, {
      scheduledAt: Date.now() - 1000,
    });
  return issue.operationId!;
}
beforeAll(async () => {
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  r = await initialize(credentials);
  app = createApp(r);
  const login = await app.request(origin + "/api/auth/sign-in/email", {
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
  if (r)
    for (const TableName of [r.config.APP_TABLE, r.config.AUTH_TABLE])
      await r.store.client.send(new DeleteTableCommand({ TableName }));
  await rm(credentials, { force: true });
});
it("creates publication resources atomically, reserves slugs, and guards their generic editors", async () => {
  const pub = await publication(false);
  expect((await app.request(origin + `/n/${pub.settings.slug}`)).status).toBe(
    404,
  );
  expect((await app.request(origin + "/api/admin/publications")).status).toBe(
    401,
  );
  await expect(r.publications.create(pub.settings)).rejects.toMatchObject({
    status: 409,
  });
  expect(
    (await r.publications.list()).filter(
      (p) => p.settings.slug === pub.settings.slug,
    ),
  ).toHaveLength(1);
  expect((await r.contacts.topic(pub.topicId)).active).toBe(false);
  const form = await r.forms.get(pub.formId);
  await expect(
    r.forms.update(form.id, form.draft, form.revision),
  ).rejects.toMatchObject({ status: 409 });
  await expect(r.forms.publish(form.id, form.revision)).rejects.toMatchObject({
    status: 409,
  });
  await expect(r.forms.close(form.id, form.revision)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    r.contacts.saveTopic({ name: "Changed" }, pub.topicId, 0),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    r.contacts.updateSegment(
      pub.audienceId,
      {
        name: "Changed",
        kind: "dynamic",
        rules: [{ property: "email", operator: "is_set" }],
      },
      0,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const active = await r.publications.update(
    pub.id,
    pub.settings,
    pub.revision,
    "active",
  );
  expect((await r.contacts.topic(pub.topicId)).active).toBe(true);
  expect((await r.forms.get(pub.formId)).accepting).toBe(true);
  await expect(
    r.publications.update(
      pub.id,
      { ...pub.settings, slug: "changed" },
      active.revision,
    ),
  ).rejects.toMatchObject({ status: 422 });
});
it("uses explicit confirmation, preserves GET safety, and makes a signup eligible only for its publication", async () => {
  const pub = await publication(),
    other = await publication(),
    email = `${randomUUID()}@example.com`,
    submissionId = randomUUID();
  const path = `/n/${pub.settings.slug}`;
  const response = await publicPost(path + "/subscribe", {
    email,
    name: "Reader",
    submissionId,
    version: "1",
  });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.text()).toContain("Check your email");
  expect(await r.store.get(contactKey(email))).toBeUndefined();
  let row = await r.forms.response(hash(`${pub.formId}:${submissionId}`));
  await r.forms.run(row.id);
  row = await r.forms.response(row.id);
  const message = await r.store.get(`MSG#${row.verificationMessageId}`);
  expect(JSON.stringify(message?.input)).toContain(`${path}/confirm?token=`);
  const token = r.forms.token(row),
    page = await app.request(origin + path + `/confirm?token=${token}`);
  expect(page.headers.get("cache-control")).toBe("no-store");
  expect(await r.store.get(contactKey(email))).toBeUndefined();
  expect(
    (await publicPost(`/n/${other.settings.slug}/confirm`, { token })).status,
  ).toBe(400);
  expect((await publicPost(path + "/confirm", { token })).status).toBe(200);
  expect((await r.publications.subscribers(pub.id)).eligible).toBe(1);
  expect((await r.publications.subscribers(other.id)).eligible).toBe(0);
  expect((await publicPost(path + "/confirm", { token })).status).toBe(200);
  expect((await r.publications.subscribers(pub.id)).confirmed).toBe(1);
  expect(
    (
      await app.request(origin + path + "/subscribe", {
        method: "POST",
        body: new URLSearchParams({ email }),
      })
    ).status,
  ).toBe(403);
});
it("preserves previous opt-outs and refuses expired managed confirmation links", async () => {
  const pub = await publication(),
    reader = await subscriber(pub);
  await r.subscriptions.unsubscribeAll(reader.email);
  await r.subscriptions.subscribe(
    reader.email,
    pub.topicId,
    false,
    "Reader opt-out",
  );
  const response = await publicPost(`/n/${pub.settings.slug}/confirm`, {
    token: reader.token,
  });
  expect(await response.text()).toContain(
    "previous email preferences have been preserved",
  );
  expect((await r.publications.subscribers(pub.id)).eligible).toBe(0);
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 86400000);
  try {
    expect(
      (
        await publicPost(`/n/${pub.settings.slug}/confirm`, {
          token: reader.token,
        })
      ).status,
    ).toBe(410);
  } finally {
    now.mockRestore();
  }
});
it("publishes web and email once under concurrent requests and corrects the web without resending", async () => {
  const pub = await publication(),
    reader = await subscriber(pub),
    issue = await r.issues.create(pub.id, issueDraft());
  const attempts = await Promise.allSettled([
    r.issues.publish(pub.id, issue.id, 0, "both"),
    r.issues.publish(pub.id, issue.id, 0, "both"),
  ]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  const published = await r.issues.get(pub.id, issue.id),
    firstVersion = published.publicVersionId;
  expect((await r.broadcasts.get(published.broadcastId!)).total).toBe(1);
  await r.broadcasts.run(published.broadcastId!);
  await r.subscriptions.unsubscribeAll(reader.email);
  const transport = vi.spyOn(r.transport, "send");
  try {
    await r.service.send(
      broadcastMessageId(published.broadcastId!, reader.email),
    );
    expect(transport).not.toHaveBeenCalled();
  } finally {
    transport.mockRestore();
  }
  const edited = await r.issues.update(
    pub.id,
    issue.id,
    { ...published.draft, title: "Corrected title" },
    published.revision,
  );
  expect((await r.issues.publicIssue(pub, issue.draft.slug)).title).toBe(
    "First issue",
  );
  const corrected = await r.issues.publish(
    pub.id,
    issue.id,
    edited.revision,
    "web",
  );
  expect(corrected.broadcastId).toBe(published.broadcastId);
  expect((await r.issues.version(firstVersion!)).draft.title).toBe(
    "First issue",
  );
  expect((await r.issues.publicIssue(pub, issue.draft.slug)).title).toBe(
    "Corrected title",
  );
  await expect(
    r.issues.publish(pub.id, issue.id, corrected.revision, "email"),
  ).rejects.toMatchObject({ status: 409 });
  await r.issues.withdraw(pub.id, issue.id, corrected.revision);
  expect(
    (
      await app.request(
        origin + `/n/${pub.settings.slug}/p/${issue.draft.slug}`,
      )
    ).status,
  ).toBe(404);
});
it("keeps all public content private when email preflight fails, including zero recipients and removed senders", async () => {
  const pub = await publication(),
    issue = await r.issues.create(pub.id, issueDraft());
  await expect(
    r.issues.publish(pub.id, issue.id, 0, "both"),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    (await r.issues.get(pub.id, issue.id)).publicVersionId,
  ).toBeUndefined();
  await subscriber(pub);
  const missing = await r.publications
    .update(
      pub.id,
      { ...pub.settings, from: "hello@missing.test" },
      pub.revision,
    )
    .catch((e) => e);
  expect(missing.status).toBe(422);
  expect((await r.issues.get(pub.id, issue.id)).revision).toBe(0);
  const published = await r.issues.publish(pub.id, issue.id, 0, "web");
  expect(published.broadcastId).toBeUndefined();
});
it("releases scheduled content atomically, honors pause, and ignores duplicate jobs", async () => {
  const pub = await publication();
  await subscriber(pub);
  const issue = await r.issues.create(pub.id, issueDraft());
  const scheduled = await r.issues.publish(
    pub.id,
    issue.id,
    0,
    "both",
    Date.now() + 60000,
  );
  expect((await r.broadcasts.get(scheduled.broadcastId!)).state).toBe(
    "publication-held",
  );
  await r.broadcasts.run(scheduled.broadcastId!);
  expect(
    (await r.broadcasts.results(scheduled.broadcastId!)).counts.pending,
  ).toBe(1);
  expect(
    (
      await app.request(
        origin + `/n/${pub.settings.slug}/p/${issue.draft.slug}`,
      )
    ).status,
  ).toBe(404);
  const op = await due(pub, issue.id);
  await r.store.put({ pk: "SETTINGS", sk: "META", paused: true });
  try {
    await Promise.all([
      workHandler(r, JSON.stringify({ kind: "publication", id: op })),
      r.issues.run(op),
    ]);
    const live = await r.issues.get(pub.id, issue.id);
    expect(live.publicVersionId).toBeTruthy();
    expect(live.emailReleased).toBe(true);
    expect((await r.broadcasts.get(scheduled.broadcastId!)).state).toBe(
      "broadcast",
    );
    await r.broadcasts.run(scheduled.broadcastId!);
    expect(
      (await r.broadcasts.results(scheduled.broadcastId!)).counts.pending,
    ).toBe(1);
    await expect(
      r.issues.cancel(pub.id, issue.id, live.revision),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    await r.store.remove("SETTINGS");
  }
});
it("cancels held work permanently and allows a new explicit schedule", async () => {
  const pub = await publication();
  await subscriber(pub);
  const issue = await r.issues.create(pub.id, issueDraft());
  const scheduled = await r.issues.publish(
      pub.id,
      issue.id,
      0,
      "both",
      Date.now() + 60000,
    ),
    oldOp = await due(pub, issue.id);
  const cancelled = await r.issues.cancel(pub.id, issue.id, scheduled.revision);
  await r.issues.run(oldOp);
  expect(
    (await r.issues.get(pub.id, issue.id)).publicVersionId,
  ).toBeUndefined();
  expect((await r.broadcasts.get(scheduled.broadcastId!)).status).toBe(
    "cancelled",
  );
  const next = await r.issues.publish(
    pub.id,
    issue.id,
    cancelled.revision,
    "both",
  );
  expect(next.broadcastId).not.toBe(scheduled.broadcastId);
});
it("archives publications without removing articles and blocks queued and scheduled email", async () => {
  let pub = await publication();
  const reader = await subscriber(pub);
  const issue = await r.issues.create(pub.id, issueDraft()),
    live = await r.issues.publish(pub.id, issue.id, 0, "both");
  await r.broadcasts.run(live.broadcastId!);
  const second = await r.issues.create(pub.id, issueDraft()),
    scheduled = await r.issues.publish(
      pub.id,
      second.id,
      0,
      "both",
      Date.now() + 60000,
    ),
    op = await due(pub, second.id);
  pub = await r.publications.update(
    pub.id,
    pub.settings,
    pub.revision,
    "archived",
  );
  await workHandler(r, JSON.stringify({ kind: "publication", id: pub.id }));
  await r.issues.run(op);
  expect((await r.broadcasts.get(scheduled.broadcastId!)).status).toBe(
    "cancelled",
  );
  expect(
    (await app.request(origin + `/n/${pub.settings.slug}/subscribe`)).status,
  ).toBe(410);
  const page = await app.request(
    origin + `/n/${pub.settings.slug}/p/${issue.draft.slug}`,
  );
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("Archived publication");
  const transport = vi.spyOn(r.transport, "send");
  try {
    await r.service.send(broadcastMessageId(live.broadcastId!, reader.email));
    expect(transport).not.toHaveBeenCalled();
  } finally {
    transport.mockRestore();
  }
});
it("keeps email-only issues private and permits one later email distribution of a web-only issue", async () => {
  const pub = await publication();
  await subscriber(pub);
  const issue = await r.issues.create(pub.id, issueDraft()),
    sent = await r.issues.publish(pub.id, issue.id, 0, "email");
  expect(sent.publicVersionId).toBeUndefined();
  expect((await r.issues.archive(pub)).data).toHaveLength(0);
  const second = await r.issues.create(pub.id, issueDraft()),
    web = await r.issues.publish(pub.id, second.id, 0, "web");
  const emailed = await r.issues.publish(
    pub.id,
    second.id,
    web.revision,
    "email",
  );
  expect(emailed.publicVersionId).toBe(web.publicVersionId);
  expect(emailed.emailReleased).toBe(true);
  const page = await app.request(
      origin + `/n/${pub.settings.slug}/p/${second.draft.slug}`,
    ),
    html = await page.text();
  expect(html).toContain('property="og:title"');
  expect(html).toContain('<link rel="canonical"');
  expect(html).not.toMatch(/SNAPSHOT#|recipient|unsubscribe\/|publicVersionId/);
});
it("atomically records HTTP publication receipts and rejects stale revisions even with a new request key", async () => {
  const pub = await publication();
  await subscriber(pub);
  const issue = await r.issues.create(pub.id, issueDraft());
  const url = `${origin}/api/admin/publications/${pub.id}/issues/${issue.id}/publish`,
    key = randomUUID();
  const send = (idempotencyKey: string) =>
    app.request(url, {
      method: "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({ revision: 0, channels: "both", confirmed: true }),
    });
  const first = await send(key);
  expect(first.status, await first.clone().text()).toBe(202);
  const replay = await send(key);
  expect(replay.status).toBe(202);
  expect(await replay.json()).toEqual(await first.json());
  expect((await send(randomUUID())).status).toBe(409);
});

it("applies the recipient limit after publication consent, never to the shared directory", async () => {
  const pub = await publication(),
    now = new Date().toISOString();
  const profiles = Array.from({ length: 1001 }, (_, i) => {
    const email = `limit-${pub.id}-${i}@example.com`;
    return {
      pk: contactKey(email),
      sk: "META",
      scope: "contacts",
      sort: now + email,
      email,
      name: "",
      first_name: "",
      last_name: "",
      properties: {},
      addedAt: now,
      revision: 0,
    };
  });
  await r.store.putMany(profiles);
  await r.subscriptions.subscribe(
    profiles[0]!.email,
    pub.topicId,
    true,
    "Explicit test consent",
  );
  const issue = await r.issues.create(pub.id, issueDraft());
  expect((await r.issues.preview(pub.id, issue.id)).eligible).toBe(1);
  await r.store.putMany(
    profiles.slice(1).map((p) => ({
      pk: topicPreferenceKey(pub.topicId, p.email),
      sk: "META",
      subscribed: true,
      source: "Explicit test consent",
      updatedAt: now,
    })),
  );
  await expect(
    r.issues.publish(pub.id, issue.id, 0, "both"),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    (await r.issues.get(pub.id, issue.id)).publicVersionId,
  ).toBeUndefined();
});

it("retries safely after a lost publication commit response and a worker acknowledgement failure", async () => {
  const pub = await publication();
  await subscriber(pub);
  const issue = await r.issues.create(pub.id, issueDraft());
  const tx = r.store.transaction.bind(r.store);
  const mock = vi
    .spyOn(r.store, "transaction")
    .mockImplementationOnce(async (writes) => {
      await tx(writes);
      throw new Error("Lost commit response");
    });
  try {
    await expect(
      r.issues.publish(pub.id, issue.id, 0, "both", Date.now() + 60000),
    ).rejects.toThrow("Lost commit response");
  } finally {
    mock.mockRestore();
  }
  const saved = await r.issues.get(pub.id, issue.id);
  await expect(
    r.issues.publish(pub.id, issue.id, 0, "both"),
  ).rejects.toMatchObject({ status: 409 });
  const op = await due(pub, issue.id);
  const worker = vi
    .spyOn(r.store, "transaction")
    .mockImplementationOnce(async (writes) => {
      await tx(writes);
      throw new Error("Lost worker acknowledgement");
    });
  try {
    await expect(r.issues.run(op)).rejects.toThrow(
      "Lost worker acknowledgement",
    );
  } finally {
    worker.mockRestore();
  }
  await r.issues.run(op);
  expect((await r.issues.get(pub.id, issue.id)).broadcastId).toBe(
    saved.broadcastId,
  );
  expect((await r.issues.get(pub.id, issue.id)).revision).toBe(
    saved.revision + 1,
  );
});

it("keeps public archives paginated and independent of message content retention", async () => {
  const pub = await publication();
  for (let i = 0; i < 22; i++) {
    const issue = await r.issues.create(pub.id, issueDraft(`article-${i}`));
    await r.issues.publish(pub.id, issue.id, 0, "web");
  }
  const privateIssue = await r.issues.create(pub.id, issueDraft("private"));
  await r.issues.publish(pub.id, privateIssue.id, 0, "web", Date.now() + 60000);
  const first = await r.issues.archive(pub),
    second = await r.issues.archive(pub, first.cursor);
  expect(first.data).toHaveLength(20);
  expect(second.data).toHaveLength(2);
  expect(new Set([...first.data, ...second.data].map((i) => i.slug)).size).toBe(
    22,
  );
  expect(
    [...first.data, ...second.data].some((i) => i.slug === "private"),
  ).toBe(false);
  const library = await r.issues.list(pub.id);
  expect(library.data).toHaveLength(20);
  expect(library.data[0]!.draft).not.toHaveProperty("document");
  expect((await r.issues.list(pub.id, library.cursor)).data).toHaveLength(3);
  const retained = await r.issues.publicIssue(pub, "article-0");
  expect(retained.html).toContain("A note to our readers.");
});

it("accepts private native form navigation only with same-origin fetch metadata", async () => {
  const pub = await publication(),
    url = origin + `/n/${pub.settings.slug}/subscribe`;
  const submit = (site: string) =>
    app.request(url, {
      method: "POST",
      headers: {
        origin: "null",
        "sec-fetch-site": site,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email: `${randomUUID()}@example.com`,
        version: "1",
        submissionId: randomUUID(),
      }),
    });
  expect((await submit("cross-site")).status).toBe(403);
  expect((await submit("same-origin")).status).toBe(200);
});
