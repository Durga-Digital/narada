import { SendApprovals } from "@narada/core/send-approvals";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { Narada } from "../../packages/sdk/src/index.js";
import { scopes } from "@narada/contracts/scopes";
import { activityContext, Activity } from "@narada/core/activity";
import { MutationReceipt, markMutation } from "@narada/core/idempotency";
import { apiKeyCaller, ownerCaller } from "@narada/core/authorization";
import { hash } from "@narada/core/model";
import type { ActivityRecord } from "@narada/core/activity-records";
import type { ApiKey } from "@narada/core/model";
const prefix = `narada-activity-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`,
  origin = "http://localhost:5173";
let runtime: Awaited<ReturnType<typeof initialize>>,
  app: ReturnType<typeof createApp>,
  token: string,
  keyId: string,
  sdk: Narada,
  cookie: string;
function client(key = token, lose = false) {
  return new Narada({
    baseUrl: origin,
    apiKey: key,
    fetch: async (input, init) => {
      const response = await app.request(new Request(input, init));
      if (
        lose &&
        response.ok &&
        init?.method === "POST" &&
        String(input).endsWith("/publications")
      ) {
        lose = false;
        await response.arrayBuffer();
        throw new Error("Lost HTTP response after commit");
      }
      return response;
    },
  });
}
const settings = () => ({
  name: "Private content must not enter the ledger",
  slug: `activity-${randomUUID().slice(0, 8)}`,
  from: "hello@narada.test",
});
const call = (path: string, body?: unknown, key = token) =>
  app.request(origin + "/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
beforeAll(async () => {
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(credentials);
  app = createApp(runtime);
  const key = await runtime.service.createKey(
    "Activity test",
    "operations",
    undefined,
    undefined,
    undefined,
    { scopes: [...scopes], resources: {} },
  );
  token = key.token;
  keyId = key.id;
  sdk = client();
  const owner = JSON.parse(await readFile(credentials, "utf8"));
  const login = await app.request(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(owner),
  });
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});
afterAll(async () => {
  if (runtime)
    for (const TableName of [
      runtime.config.APP_TABLE,
      runtime.config.AUTH_TABLE,
    ])
      await runtime.store.client.send(new DeleteTableCommand({ TableName }));
  await rm(credentials, { force: true });
});
it("recovers a lost HTTP response by key, returns one original result and records one content-free activity", async () => {
  const body = settings(),
    key = randomUUID(),
    create = vi.spyOn(runtime.publications, "create");
  try {
    await expect(
      client(token, true).publications.create(body, { idempotencyKey: key }),
    ).rejects.toThrow("Lost HTTP response");
    const status = await sdk.operations.lookup({
      operation: "publications.create",
      idempotencyKey: key,
    });
    expect(status).toMatchObject({
      status: "succeeded",
      recovery: "replay_available",
      actor: { kind: "api-key", keyId },
    });
    const recovered = await sdk.publications.create(body, {
      idempotencyKey: key,
    });
    expect(status.targets).toContainEqual({
      kind: "publication",
      id: recovered.id,
    });
    expect(create).toHaveBeenCalledTimes(1);
    const stored = await runtime.store.get<ActivityRecord>(
      `ACTIVITY#${status.id}`,
    );
    expect(JSON.stringify(stored)).not.toContain(body.name);
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(JSON.stringify(stored)).not.toContain("hello@");
    expect(stored?.ttl).toBeGreaterThan(Date.now() / 1000 + 89 * 86400);
    const response = await app.request(origin + "/api/v1/publications", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
    expect(response.headers.get("x-operation-id")).toBe(status.id);
    expect(response.headers.get("operation-location")).toBe(status.statusUrl);
    await expect(
      sdk.publications.create(
        { ...body, name: "Different" },
        { idempotencyKey: key },
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  } finally {
    create.mockRestore();
  }
});
it("isolates principals, requires new permission and rechecks historical and current resource access", async () => {
  const key = randomUUID(),
    pub = await sdk.publications.create(settings(), { idempotencyKey: key }),
    status = await sdk.operations.lookup({
      operation: "publications.create",
      idempotencyKey: key,
    });
  const other = await runtime.service.createKey(
    "Other",
    "operations",
    undefined,
    undefined,
    undefined,
    { scopes: [...scopes], resources: {} },
  );
  await expect(
    client(other.token).operations.get(status.id),
  ).rejects.toMatchObject({ status: 404 });
  const legacy = await runtime.service.createKey("Legacy", "full");
  await expect(
    client(legacy.token).operations.get(status.id),
  ).rejects.toMatchObject({ status: 403 });
  const record = (await runtime.store.get<ApiKey>(`KEY#${hash(token)}`))!;
  try {
    await runtime.store.patch(record.pk, {
      operationAccess: { scopes: ["narada:operations:read"], resources: {} },
    });
    await expect(sdk.operations.get(status.id)).rejects.toMatchObject({
      status: 403,
    });
    await runtime.store.patch(record.pk, {
      operationAccess: {
        scopes: [...scopes],
        resources: { senderDomains: ["elsewhere.test"] },
      },
    });
    await expect(sdk.operations.get(status.id)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (await sdk.operations.list()).data.some((x) => x.id === status.id),
    ).toBe(false);
    await runtime.store.patch(record.pk, {
      operationAccess: {
        scopes: [...scopes],
        resources: { senderDomains: ["narada.test"] },
      },
    });
    const p = await runtime.publications.get(pub.id);
    await runtime.store.patch(p.pk, {
      settings: { ...p.settings, from: "hello@elsewhere.test" },
    });
    await expect(sdk.operations.get(status.id)).rejects.toMatchObject({
      status: 403,
    });
  } finally {
    await runtime.store.patch(record.pk, {
      operationAccess: record.operationAccess,
    });
  }
});
it("keeps uncertain outcomes owned, exposes reconciliation and never retries work automatically", async () => {
  const record = (await runtime.store.get<ApiKey>(`KEY#${hash(token)}`))!,
    caller = apiKeyCaller(record),
    key = randomUUID();
  const acquired = await MutationReceipt.acquire(
    runtime.store,
    `key:${keyId}`,
    "POST /api/v1/publications",
    key,
    {},
    activityContext(caller, origin, "publications.create", randomUUID()),
  );
  if (!("receipt" in acquired)) throw new Error("Expected fresh receipt");
  const receipt = acquired.receipt;
  await receipt.run(async () => {
    markMutation();
  });
  await receipt.failed();
  const status = await sdk.operations.lookup({
    operation: "publications.create",
    idempotencyKey: key,
  });
  expect(status).toMatchObject({ status: "unknown", recovery: "reconcile" });
  expect(
    (await runtime.store.get<ActivityRecord>(`ACTIVITY#${status.id}`))?.ttl,
  ).toBeUndefined();
  await expect(
    MutationReceipt.acquire(
      runtime.store,
      `key:${keyId}`,
      "POST /api/v1/publications",
      key,
      {},
    ),
  ).rejects.toMatchObject({
    code: "idempotency_unknown",
    operationId: status.id,
  });
});
it("records safe failures, permits same-key retry and presents expired replay windows accurately", async () => {
  const record = (await runtime.store.get<ApiKey>(`KEY#${hash(token)}`))!,
    caller = apiKeyCaller(record),
    key = randomUUID();
  const input = {};
  const acquired = await MutationReceipt.acquire(
    runtime.store,
    `key:${keyId}`,
    "POST /api/v1/publications",
    key,
    input,
    activityContext(caller, origin, "publications.create", randomUUID()),
  );
  if (!("receipt" in acquired)) throw new Error("Expected fresh receipt");
  await acquired.receipt.failed();
  expect(
    (await sdk.operations.get(acquired.receipt!.record.operationId)).status,
  ).toBe("failed");
  const retried = await MutationReceipt.acquire(
    runtime.store,
    `key:${keyId}`,
    "POST /api/v1/publications",
    key,
    input,
    activityContext(caller, origin, "publications.create", randomUUID()),
  );
  if (!("receipt" in retried)) throw new Error("Expected fresh receipt");
  expect(retried.receipt.record.operationId).not.toBe(
    acquired.receipt!.record.operationId,
  );
  await retried.receipt!.commit([], {
    body: "{}",
    status: 200,
    contentType: "application/json",
  });
  const id = retried.receipt!.record.operationId;
  await runtime.store.patch(`ACTIVITY#${id}`, {
    replayExpiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  expect((await sdk.operations.get(id)).recovery).toBe("expired");
  await runtime.store.patch(`ACTIVITY#${id}`, { ttl: 1 });
  await expect(sdk.operations.get(id)).rejects.toMatchObject({ status: 404 });
});
it("projects accepted email work without changing its receipt or duplicating messages", async () => {
  const key = randomUUID();
  const body = {
    from: "hello@narada.test",
    to: ["activity@narada.test"],
    subject: "Private subject",
    text: "Private body",
  };
  const proposal = await sdk.approvals.request(
    { operation: "emails.send", input: { body } },
    { idempotencyKey: key },
  );
  const owner = ownerCaller("fixture-owner"),
    approvals = new SendApprovals(runtime);
  const review = await approvals.review(owner, proposal.id);
  const accepted = await approvals.decide(
    owner,
    proposal.id,
    { digest: review.digest },
    true,
  );
  const status = await sdk.operations.get(accepted.operationId!);
  expect(status.operation).toBe("emails.send");
  expect(status.work).toEqual([{ kind: "message", status: "queued" }]);
  await runtime.store.patch(`MSG#${accepted.messageId}`, {
    status: "captured",
  });
  expect((await sdk.operations.get(status.id)).work).toEqual([
    { kind: "message", status: "captured" },
  ]);
  expect(
    JSON.stringify(await runtime.store.get(`ACTIVITY#${status.id}`)),
  ).not.toContain("Private");
  expect(
    (
      await sdk.approvals.request(
        { operation: "emails.send", input: { body } },
        { idempotencyKey: key },
      )
    ).id,
  ).toBe(proposal.id);
  expect(
    await approvals.decide(owner, proposal.id, { digest: review.digest }, true),
  ).toEqual(accepted);
  expect((await sdk.approvals.get(proposal.id)).operationId).toBe(status.id);
});
it("provides bounded owner history, rejects cursor reuse by other principals and excludes expired entries", async () => {
  const a = new Activity(runtime),
    caller = ownerCaller("owner-test");
  const first = await a.list(caller, { limit: 1 });
  expect(first.data).toHaveLength(1);
  expect(first.nextCursor).toBeTruthy();
  const next = await a.list(caller, { limit: 1, cursor: first.nextCursor });
  expect(next.data[0]?.id).not.toBe(first.data[0]?.id);
  await expect(
    sdk.operations.list({ limit: 1, cursor: first.nextCursor! }),
  ).rejects.toMatchObject({ status: 400 });
  const r = await app.request(origin + "/api/admin/operations?limit=1", {
    headers: { cookie },
  });
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect((await r.json()).data).toHaveLength(1);
  expect((await app.request(origin + "/api/admin/operations")).status).toBe(
    401,
  );
});
it("filters activity by selected resources on both lists and direct lookup", async () => {
  const allowed = await sdk.publications.create(settings()),
    excluded = await sdk.publications.create(settings());
  const allowedKey = randomUUID(),
    excludedKey = randomUUID();
  await sdk.publications.update(
    allowed.id,
    { revision: allowed.revision, settings: allowed.settings },
    { idempotencyKey: allowedKey },
  );
  await sdk.publications.update(
    excluded.id,
    { revision: excluded.revision, settings: excluded.settings },
    { idempotencyKey: excludedKey },
  );
  const a = await sdk.operations.lookup({
    operation: "publications.update",
    params: { id: allowed.id },
    idempotencyKey: allowedKey,
  });
  const b = await sdk.operations.lookup({
    operation: "publications.update",
    params: { id: excluded.id },
    idempotencyKey: excludedKey,
  });
  const record = (await runtime.store.get<ApiKey>(`KEY#${hash(token)}`))!;
  try {
    await runtime.store.patch(record.pk, {
      operationAccess: {
        scopes: [...scopes],
        resources: { publicationIds: [allowed.id] },
      },
    });
    expect((await sdk.operations.get(a.id)).id).toBe(a.id);
    await expect(sdk.operations.get(b.id)).rejects.toMatchObject({
      status: 403,
    });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await sdk.operations.list({ limit: 1, cursor });
      ids.push(...page.data.map((x) => x.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  } finally {
    await runtime.store.patch(record.pk, {
      operationAccess: record.operationAccess,
    });
  }
});
it("keeps scheduled publication acceptance separate from later cancellation", async () => {
  let pub = await sdk.publications.create({
    ...settings(),
    organization: "Test",
    postalAddress: "1 Test Street",
  });
  pub = await sdk.publications.activate(pub.id, { revision: pub.revision });
  const issue = await sdk.issues.create(pub.id, {
    title: "Status test",
    slug: `status-${randomUUID().slice(0, 8)}`,
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Private draft" }],
        },
      ],
    },
  });
  const key = randomUUID();
  const proposal = await sdk.approvals.request(
    {
      operation: "issues.publish",
      input: {
        params: { id: pub.id, issueId: issue.id },
        body: {
          revision: issue.revision,
          channels: "web",
          confirmed: true,
          scheduledAt: Date.now() + 60000,
        },
      },
    },
    { idempotencyKey: key },
  );
  const approvals = new SendApprovals(runtime),
    owner = ownerCaller("fixture-owner"),
    review = await approvals.review(owner, proposal.id);
  const accepted = await approvals.decide(
    owner,
    proposal.id,
    { digest: review.digest },
    true,
  );
  const scheduled = await sdk.issues.get(pub.id, issue.id);
  const status = await sdk.operations.get(accepted.operationId!);
  expect(status.status).toBe("succeeded");
  expect(status.work).toEqual([{ kind: "publication", status: "pending" }]);
  await sdk.issues.cancel(pub.id, issue.id, { revision: scheduled.revision });
  const canceled = await sdk.operations.get(status.id);
  expect(canceled.status).toBe("succeeded");
  expect(canceled.work).toEqual([{ kind: "publication", status: "cancelled" }]);
  expect(canceled.targets).toContainEqual({ kind: "issue", id: issue.id });
});
