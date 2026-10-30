import { approvedOperation } from "../helpers/approved-operation.js";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { Narada } from "../../packages/sdk/src/index.js";
import { MutationReceipt, canonicalJson } from "@narada/core/idempotency";
import { hash } from "@narada/core/model";
let runtime: Awaited<ReturnType<typeof initialize>>,
  app: ReturnType<typeof createApp>,
  sdk: Narada,
  token: string,
  keyId: string,
  cookie: string;
const prefix = `narada-idempotency-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`,
  origin = "http://localhost:5173";
const headers = (key: string, admin = false) => ({
  "content-type": "application/json",
  "idempotency-key": key,
  ...(admin ? { cookie, origin } : { authorization: `Bearer ${token}` }),
});
const post = (path: string, key: string, body?: unknown, admin = false) =>
  app.request(`${origin}/api/${admin ? "admin" : "v1"}/${path}`, {
    method: "POST",
    headers: headers(key, admin),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const receiptKey = (path: string, key: string) =>
  `MUTATION#${hash(canonicalJson([`key:${keyId}`, `POST /api/v1/${path}`, key]))}`;
beforeAll(async () => {
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(credentials);
  app = createApp(runtime);
  const created = await runtime.service.createKey("Idempotency tests", "full");
  token = created.token;
  keyId = created.id;
  sdk = new Narada({
    apiKey: token,
    baseUrl: origin,
    fetch: async (input, init) => app.request(new Request(input, init)),
  });
  const owner = JSON.parse(await readFile(credentials, "utf8"));
  const signedIn = await app.request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(owner),
  });
  expect(signedIn.status).toBe(200);
  cookie = signedIn.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
});
afterAll(async () => {
  if (runtime)
    for (const TableName of [
      runtime.config.APP_TABLE,
      runtime.config.AUTH_TABLE,
    ])
      await runtime.store.client.send(new DeleteTableCommand({ TableName }));
  await unlink(credentials).catch(() => {});
});
it("creates exactly one segment, canonically matches JSON and scopes keys by operation", async () => {
  const key = randomUUID(),
    body = { name: "Customers", kind: "manual" };
  const first = await post("segments", key, body),
    segment = await first.json();
  expect(first.status).toBe(201);
  const replay = await post("segments", key, {
    kind: "manual",
    name: "Customers",
  });
  expect(replay.status).toBe(201);
  expect(replay.headers.get("idempotency-replayed")).toBe("true");
  expect(await replay.json()).toEqual(segment);
  expect((await post("segments", key, { ...body, name: "Other" })).status).toBe(
    409,
  );
  expect((await post("topics", key, { name: "News" })).status).toBe(201);
  expect(
    (await runtime.store.list("audiences", 100)).filter(
      (row) => row.name === body.name,
    ),
  ).toHaveLength(1);
});
it("serializes concurrent requests and does not permit a second mutation while one is running", async () => {
  const key = randomUUID(),
    original = runtime.broadcasts.directory.createSegment.bind(
      runtime.broadcasts.directory,
    );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi
    .spyOn(runtime.broadcasts.directory, "createSegment")
    .mockImplementationOnce(async (...args) => {
      await gate;
      return original(...args);
    });
  const first = post("segments", key, {
    name: "Concurrent",
    kind: "manual" as const,
  });
  try {
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const conflict = await post("segments", key, {
      name: "Concurrent",
      kind: "manual" as const,
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe("idempotency_in_progress");
    expect(conflict.headers.get("retry-after")).toBe("1");
    release();
    const saved = await (await first).json();
    expect(
      await (
        await post("segments", key, {
          name: "Concurrent",
          kind: "manual" as const,
        })
      ).json(),
    ).toEqual(saved);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await first;
    spy.mockRestore();
  }
});
it("recovers the original result after the atomic commit succeeds but the caller loses its acknowledgement", async () => {
  const key = randomUUID(),
    original = runtime.store.transaction.bind(runtime.store);
  let lost = false;
  const spy = vi
    .spyOn(runtime.store, "transaction")
    .mockImplementation(async (items) => {
      const result = await original(items);
      if (
        !lost &&
        items.some((item) => String(item.Put?.Item?.pk).startsWith("AUDIENCE#"))
      ) {
        lost = true;
        throw new Error("Injected transport loss after commit");
      }
      return result;
    });
  try {
    const first = await post("segments", key, {
      name: "Lost acknowledgement",
      kind: "manual" as const,
    });
    expect(first.status).toBe(201);
    expect(first.headers.get("idempotency-replayed")).toBe("true");
    const receipt = await runtime.store.get(receiptKey("segments", key));
    expect(receipt?.outcome).toBe("complete");
    const retry = await post("segments", key, {
      name: "Lost acknowledgement",
      kind: "manual" as const,
    });
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotency-replayed")).toBe("true");
    expect(
      (await runtime.store.list("audiences", 100)).filter(
        (r) => r.name === "Lost acknowledgement",
      ),
    ).toHaveLength(1);
  } finally {
    spy.mockRestore();
  }
});
it("replays contacts/properties/topics without producing another webhook event", async () => {
  const suffix = randomUUID().slice(0, 8);
  await runtime.store.put({
    pk: `WEBHOOK#${suffix}`,
    sk: "META",
    scope: "webhooks",
    sort: suffix,
    id: suffix,
    events: ["contact.created", "topic.created"],
  });
  for (const [path, body] of [
    ["contacts", { email: `${suffix}@example.com` }],
    ["properties", { key: `p_${suffix}`, type: "string" }],
    ["topics", { name: suffix }],
  ] as const) {
    const key = randomUUID();
    const first = await post(path, key, body);
    expect(first.status).toBe(201);
    const count = (await runtime.store.list("webhookAttempts", 100)).length;
    expect(await (await post(path, key, body)).json()).toEqual(
      await first.json(),
    );
    expect((await runtime.store.list("webhookAttempts", 100)).length).toBe(
      count,
    );
  }
});
it("SDK retries reuse template versions, test message IDs and duplicated resources", async () => {
  const template = await sdk.templates.create(
    {
      alias: `test-${randomUUID()}`,
      name: "Welcome",
      kind: "transactional",
      subject: "Hello",
      text: "Hello",
      variables: [],
    },
    { idempotencyKey: randomUUID() },
  );
  const opts = { idempotencyKey: randomUUID() };
  const published = await sdk.templates.publish(
    template.id,
    { revision: template.revision },
    opts,
  );
  expect(
    await sdk.templates.publish(
      template.id,
      { revision: template.revision },
      opts,
    ),
  ).toEqual(published);
  expect(published.publishedVersion).toBe(1);
  const testKey = { idempotencyKey: randomUUID() },
    test = { from: "hello@narada.test", to: "test@example.com" };
  const accepted = await approvedOperation(
    runtime,
    sdk,
    {
      operation: "templates.test",
      input: { params: { id: template.id }, body: test },
    },
    testKey,
  );
  expect(
    await approvedOperation(
      runtime,
      sdk,
      {
        operation: "templates.test",
        input: { params: { id: template.id }, body: test },
      },
      testKey,
    ),
  ).toEqual(accepted);
  const duplicateKey = { idempotencyKey: randomUUID() },
    alias = { alias: `copy-${randomUUID()}` };
  const duplicate = await sdk.templates.duplicate(
    template.id,
    alias,
    duplicateKey,
  );
  expect(
    await sdk.templates.duplicate(template.id, alias, duplicateKey),
  ).toEqual(duplicate);
  const createKey = { idempotencyKey: randomUUID() },
    draft = { name: "News" };
  const broadcast = await sdk.broadcasts.create(draft, createKey);
  expect(await sdk.broadcasts.create(draft, createKey)).toEqual(broadcast);
  const dupKey = { idempotencyKey: randomUUID() };
  const copy = await sdk.broadcasts.duplicate(broadcast.id, dupKey);
  expect(await sdk.broadcasts.duplicate(broadcast.id, dupKey)).toEqual(copy);
});
it("replays admin key/webhook/form creation, encrypting secret-bearing receipts", async () => {
  const createdKey = randomUUID();
  const first = await post(
    "keys",
    createdKey,
    { name: "One credential", permission: "sending" },
    true,
  );
  expect(first.status).toBe(201);
  const data = await first.json();
  expect(
    await (
      await post(
        "keys",
        createdKey,
        { permission: "sending", name: "One credential" },
        true,
      )
    ).json(),
  ).toEqual(data);
  const session = await runtime.auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  const pk = `MUTATION#${hash(canonicalJson([`user:${session!.user.id}`, "POST /api/admin/keys", createdKey]))}`;
  const record = await runtime.store.get(pk);
  expect(record?.outcome).toBe("complete");
  expect(JSON.stringify(record)).not.toContain(data.token);
  expect(record).not.toHaveProperty("body");
  const hookKey = randomUUID(),
    hook = { url: "http://localhost:3001/api/dev/webhook-receiver" };
  const endpoint = await post("webhooks", hookKey, hook, true);
  expect(endpoint.status).toBe(201);
  expect(await (await post("webhooks", hookKey, hook, true)).json()).toEqual(
    await endpoint.json(),
  );
  const formKey = randomUUID(),
    form = {
      name: "Survey",
      kind: "feedback",
      questions: [{ id: "rating", type: "rating", label: "Rating" }],
    };
  const created = await post("forms", formKey, form, true);
  expect(created.status).toBe(201);
  expect(await (await post("forms", formKey, form, true)).json()).toEqual(
    await created.json(),
  );
});
it("authenticates and authorizes before replay, and separates API principals", async () => {
  const key = randomUUID(),
    body = { name: "Scoped", kind: "manual" as const };
  const created = await (await post("segments", key, body)).json();
  const other = await runtime.service.createKey("Other", "full");
  const separate = new Narada({
    apiKey: other.token,
    baseUrl: origin,
    fetch: async (input, init) => app.request(new Request(input, init)),
  });
  expect(
    (await separate.segments.create(body, { idempotencyKey: key })).id,
  ).not.toBe(created.id);
  const row = await runtime.service.authenticate(other.token);
  await runtime.store.patch(row.pk, { revoked: true });
  await expect(
    separate.segments.create(body, { idempotencyKey: key }),
  ).rejects.toMatchObject({ status: 401 });
  expect(
    (
      await app.request(`${origin}/api/v1/segments`, {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify(body),
      })
    ).status,
  ).toBe(401);
});
it("releases validation-only failures, expires successful receipts and never expires unresolved work", async () => {
  const key = randomUUID();
  expect((await post("segments", key, { name: "" })).status).toBe(400);
  expect(await runtime.store.get(receiptKey("segments", key))).toBeUndefined();
  const saved = await (
    await post("segments", key, { name: "Valid", kind: "manual" as const })
  ).json();
  await runtime.store.patch(receiptKey("segments", key), {
    ttl: Math.floor(Date.now() / 1000) - 1,
  });
  const afterExpiry = await (
    await post("segments", key, { name: "Valid", kind: "manual" as const })
  ).json();
  expect(afterExpiry.id).not.toBe(saved.id);
  const pendingKey = randomUUID();
  const acquired = await MutationReceipt.acquire(
    runtime.store,
    `key:${keyId}`,
    "POST /api/v1/segments",
    pendingKey,
    { body: { name: "Unknown", kind: "manual" as const }, query: "" },
  );
  expect("receipt" in acquired).toBe(true);
  await runtime.store.patch(receiptKey("segments", pendingKey), {
    busyUntil: 0,
  });
  const unknown = await post("segments", pendingKey, {
    name: "Unknown",
    kind: "manual" as const,
  });
  expect(unknown.status).toBe(409);
  expect((await unknown.json()).code).toBe("idempotency_unknown");
  expect(
    await runtime.store.get(receiptKey("segments", pendingKey)),
  ).not.toHaveProperty("ttl");
});
it("does not rerun partially completed multi-step imports", async () => {
  const segment = await sdk.segments.create({
    name: "Import",
    kind: "manual" as const,
  });
  const key = randomUUID(),
    payload = {
      csv: "email\npartial@example.com",
      consentSource: "Tests",
      consentConfirmed: true,
    };
  const spy = vi
    .spyOn(runtime.broadcasts.directory, "import")
    .mockImplementationOnce(async () => {
      await runtime.store.put({ pk: "PARTIAL#test", sk: "META" });
      throw new Error("Injected interruption");
    });
  try {
    const first = await post(`segments/${segment.id}/import`, key, payload);
    expect(first.status).toBe(409);
    expect((await first.json()).code).toBe("idempotency_unknown");
    expect(
      (await post(`segments/${segment.id}/import`, key, payload)).status,
    ).toBe(409);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});
it("replays scheduled launch, cancellation, updates and membership changes without repeating them", async () => {
  const segment = await sdk.segments.create({ name: "Launch", kind: "manual" });
  const email = `${randomUUID()}@example.com`;
  await sdk.contacts.create({ email });
  const membership = {},
    memberKey = { idempotencyKey: randomUUID() };
  const member = await sdk.segments.addContact(
    segment.id,
    email,
    membership,
    memberKey,
  );
  expect(
    await sdk.segments.addContact(segment.id, email, membership, memberKey),
  ).toEqual(member);
  await sdk.segments.import(segment.id, {
    csv: `email
${email}`,
    consentSource: "Test signup",
    consentConfirmed: true,
  });
  const broadcast = await sdk.broadcasts.create({
    name: "Launch once",
    audienceId: segment.id,
    from: "hello@narada.test",
    subject: "News",
    text: "News",
    organization: "Example",
    postalAddress: "123 Example Street",
  });
  const sendKey = { idempotencyKey: randomUUID() },
    input = {
      revision: broadcast.revision,
      confirmed: true as const,
      scheduledAt: Date.now() + 60000,
    };
  const launched = await approvedOperation(
    runtime,
    sdk,
    {
      operation: "broadcasts.send",
      input: { params: { id: broadcast.id }, body: input },
    },
    sendKey,
  );
  expect(
    await approvedOperation(
      runtime,
      sdk,
      {
        operation: "broadcasts.send",
        input: { params: { id: broadcast.id }, body: input },
      },
      sendKey,
    ),
  ).toEqual(launched);
  expect(await runtime.store.get(`SNAPSHOT#${broadcast.id}`)).toBeDefined();
  const cancelKey = { idempotencyKey: randomUUID() };
  const cancelled = await sdk.broadcasts.cancel(broadcast.id, cancelKey);
  expect(await sdk.broadcasts.cancel(broadcast.id, cancelKey)).toEqual(
    cancelled,
  );
  const updateKey = { idempotencyKey: randomUUID() },
    current = await sdk.segments.get(segment.id),
    update = {
      segment: { name: "Renamed", kind: "manual" as const },
      revision: current.revision,
    };
  const updated = await sdk.segments.update(segment.id, update, updateKey);
  expect(await sdk.segments.update(segment.id, update, updateKey)).toEqual(
    updated,
  );
  const removeKey = { idempotencyKey: randomUUID() };
  await sdk.segments.removeContact(segment.id, email, removeKey);
  const removed = await sdk.segments.get(segment.id);
  await sdk.segments.removeContact(segment.id, email, removeKey);
  expect((await sdk.segments.get(segment.id)).revision).toBe(removed.revision);
});
it("keeps domain records/events and manual webhook retries stable", async () => {
  const name = `${randomUUID()}.example.com`,
    key = randomUUID();
  const created = await post("domains", key, { name }, true);
  expect(created.status).toBe(201);
  expect(await (await post("domains", key, { name }, true)).json()).toEqual(
    await created.json(),
  );
  const id = randomUUID(),
    pk = `HOOKJOB#${id}`;
  const endpointId = randomUUID();
  await runtime.store.put({
    pk: `WEBHOOK#${endpointId}`,
    sk: "META",
    id: endpointId,
  });
  await runtime.store.put({
    pk,
    sk: "META",
    endpointId,
    state: "failed",
    attempts: 5,
  });
  const retryKey = randomUUID(),
    url = `webhooks/attempts/${id}/retry`;
  expect((await post(url, retryKey, {}, true)).status).toBe(200);
  expect((await runtime.store.get(pk))?.attempts).toBe(5);
  await runtime.store.patch(pk, { state: "failed", attempts: 11 });
  expect((await post(url, retryKey, {}, true)).status).toBe(200);
  expect((await runtime.store.get(pk))?.state).toBe("failed");
});
it("does not reserve keys for definitively rejected transactions or re-create deleted resources on replay", async () => {
  const alias = `unique-${randomUUID()}`,
    body = {
      alias,
      name: "One",
      kind: "transactional" as const,
      subject: "Hello",
      text: "Hello",
    };
  await sdk.templates.create(body);
  const key = randomUUID(),
    failed = await post("templates", key, body);
  expect(failed.status).toBe(409);
  expect((await failed.json()).code).toBe("conflict");
  expect(await runtime.store.get(receiptKey("templates", key))).toBeUndefined();
  const segmentKey = randomUUID(),
    input = { name: "Removed later", kind: "manual" as const };
  const segment = await sdk.segments.create(input, {
    idempotencyKey: segmentKey,
  });
  await runtime.store.remove(`AUDIENCE#${segment.id}`);
  expect(
    await sdk.segments.create(input, { idempotencyKey: segmentKey }),
  ).toEqual(segment);
  expect(await runtime.store.get(`AUDIENCE#${segment.id}`)).toBeUndefined();
});
