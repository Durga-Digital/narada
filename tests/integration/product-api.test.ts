import { approvedOperation } from "../helpers/approved-operation.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { z } from "zod";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import type { Runtime } from "@narada/core/runtime";
import { hash } from "@narada/core/model";
import { ProductOperations } from "@narada/core/product-operations";
import { oauthCaller, ownerCaller } from "@narada/core/authorization";
import { scopes, type Scope } from "@narada/contracts/scopes";
import { operations, type OperationId } from "@narada/contracts/operations";
import { operationSchemas } from "@narada/contracts/discovery";
import type { ResourceRestrictions } from "@narada/contracts/delegation";
import {
  Narada,
  type FormInput,
  type IssueInput,
  type Page,
} from "../../packages/sdk/src/index.js";

const prefix = `narada-product-api-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`,
  origin = "http://localhost:5173";
let r: Runtime,
  app: ReturnType<typeof createApp>,
  cookie: string,
  api: Narada,
  token: string;
const settings = () => ({
  name: "Studio notes",
  slug: `studio-${randomUUID().slice(0, 8)}`,
  from: "hello@narada.test",
  author: "Studio",
  organization: "Narada",
  postalAddress: "1 Test Street",
});
const feedback = (): FormInput => ({
  name: "Feedback",
  kind: "feedback",
  from: "hello@narada.test",
  questions: [
    { id: "note", label: "Your feedback", type: "text", required: true },
  ],
});
const draft = (): IssueInput => ({
  title: "First issue",
  slug: `issue-${randomUUID().slice(0, 8)}`,
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
function request(
  key: string,
  path: string,
  method = "GET",
  body?: unknown,
  receipt?: string,
) {
  return app.request(origin + "/api/v1" + path, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(receipt ? { "idempotency-key": receipt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function client(key: string) {
  return new Narada({
    baseUrl: origin,
    apiKey: key,
    fetch: async (input, init) => {
      const response = await app.request(new Request(input, init));
      // Every successful SDK response must match the canonical wire contract,
      // including the atomic receipt path. Extra storage fields are rejected.
      const url = new URL(String(input));
      const op = operations.find(
        (op) =>
          "http" in op &&
          op.http.method === (init?.method ?? "GET") &&
          new RegExp(`^${op.http.path.replace(/:[a-zA-Z]+/g, "[^/]+")}$`).test(
            url.pathname,
          ),
      );
      if (response.ok && op) {
        const result = z
          .fromJSONSchema(operationSchemas[op.id].output)
          .safeParse(await response.clone().json());
        expect(result.success, `${op.id}: ${result.error?.message}`).toBe(true);
      }
      return response;
    },
  });
}
async function key(
  allowed: readonly Scope[] = scopes,
  resources: ResourceRestrictions = {},
) {
  const k = await r.service.createKey(
    "Product API test",
    "operations",
    undefined,
    undefined,
    undefined,
    { scopes: [...allowed], resources },
  );
  return { ...k, api: client(k.token) };
}
async function all<T>(
  load: (options: { limit: number; cursor?: string }) => Promise<Page<T>>,
) {
  const rows: T[] = [];
  let cursor: string | null | undefined;
  for (let n = 0; n < 100; n++) {
    const page = await load({ limit: 1, ...(cursor ? { cursor } : {}) });
    rows.push(...page.data);
    cursor = page.nextCursor;
    if (!cursor) return rows;
  }
  throw new Error("Pagination did not terminate");
}
async function active() {
  const p = await api.publications.create(settings(), {
    idempotencyKey: randomUUID(),
  });
  return api.publications.activate(
    p.id,
    { revision: p.revision },
    { idempotencyKey: randomUUID() },
  );
}
async function subscriber(pub: { id: string; formId: string }) {
  const form = await r.forms.get(pub.formId),
    submissionId = randomUUID();
  await r.forms.submit(form.id, {
    submissionId,
    version: form.version,
    answers: {
      email: `${randomUUID()}@example.com`,
      name: "Reader",
      consent: true,
    },
  });
  const row = await r.forms.response(hash(`${form.id}:${submissionId}`));
  await r.forms.confirm(r.forms.token(row));
  await r.forms.sync(
    await r.forms.response(row.id),
    (await r.forms.version(form.id, row.version)).content,
  );
}
beforeAll(async () => {
  vi.stubEnv("APP_TABLE", `${prefix}-app`);
  vi.stubEnv("AUTH_TABLE", `${prefix}-auth`);
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
  const created = await app.request(origin + "/api/admin/keys", {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Product operations",
      permission: "operations",
      operationAccess: { scopes, resources: {} },
    }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  token = (await created.json()).token;
  api = client(token);
});
afterAll(async () => {
  try {
    if (r)
      for (const TableName of [r.config.APP_TABLE, r.config.AUTH_TABLE])
        await r.store.client.send(new DeleteTableCommand({ TableName }));
  } finally {
    await rm(credentials, { force: true });
    vi.unstubAllEnvs();
  }
});

it("requires explicit grants, validates owner provisioning and leaves every legacy key's ceiling unchanged", async () => {
  const legacy = await r.service.createKey("Old full key", "full");
  for (const op of operations.filter((op) =>
    /^(forms|publications|issues)\./.test(op.id),
  )) {
    if (!("http" in op)) continue;
    const res = await request(
      legacy.token,
      op.http.path.replace("/api/v1", "").replace(/:[a-zA-Z]+/g, randomUUID()),
      op.http.method,
    );
    expect(res.status, op.id).toBe(403);
  }
  for (const body of [
    { permission: "operations" },
    { permission: "full", operationAccess: { scopes: [] } },
    { permission: "operations", operationAccess: { scopes: ["narada:root"] } },
    {
      permission: "operations",
      operationAccess: { scopes, resources: { formIds: [randomUUID()] } },
    },
  ]) {
    const result = await app.request(origin + "/api/admin/keys", {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Invalid", ...body }),
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  }
  expect((await api.capabilities()).permissionModel).toBe("operation-key-v1");
  const web = await key(["narada:capabilities:read", "narada:issues:publish"]);
  const doc = await (await request(web.token, "/openapi.json")).json();
  expect(
    doc.paths["/api/v1/publications/{id}/issues/{issueId}/publish"].post[
      "x-narada-channel-scopes"
    ].both,
  ).toEqual(["narada:issues:publish", "narada:issues:send"]);
});

it("supports form lifecycle and safe receipts, and keeps responses, exports and retries separately authorized", async () => {
  const receipt = randomUUID(),
    input = feedback();
  let f = await api.forms.create(input, { idempotencyKey: receipt });
  expect(await api.forms.create(input, { idempotencyKey: receipt })).toEqual(f);
  expect(await api.forms.get(f.id)).toEqual(f);
  f = await api.forms.update(
    f.id,
    { draft: { ...f.draft, name: "Updated feedback" }, revision: f.revision },
    { idempotencyKey: randomUUID() },
  );
  const published = await api.forms.publish(
    f.id,
    { revision: f.revision },
    { idempotencyKey: randomUUID() },
  );
  expect((await api.forms.preview(f.id)).accepting).toBe(true);
  const submissionId = randomUUID();
  await r.forms.submit(f.id, {
    submissionId,
    version: published.version,
    answers: { note: "=HYPERLINK(unsafe)" },
  });
  const responseId = hash(`${f.id}:${submissionId}`);
  const read = await key(["narada:forms:read"], { formIds: [f.id] });
  await expect(read.api.forms.responses(f.id)).rejects.toMatchObject({
    status: 403,
  });
  const answers = await key(["narada:form-responses:read"], {
    formIds: [f.id],
  });
  expect((await answers.api.forms.responses(f.id)).data[0]).not.toHaveProperty(
    "answers",
  );
  expect(
    (await answers.api.forms.response(f.id, responseId)).response.answers.note,
  ).toBe("=HYPERLINK(unsafe)");
  await expect(answers.api.forms.exportResponses(f.id)).rejects.toMatchObject({
    status: 403,
  });
  expect((await api.forms.exportResponses(f.id)).csv).toContain("'=HYPERLINK");
  const other = await api.forms.create(feedback());
  await expect(api.forms.response(other.id, responseId)).rejects.toMatchObject({
    status: 404,
  });
  await r.store.patch(`FORMRESPONSE#${responseId}`, { status: "failed" });
  const retry = await key(["narada:form-responses:retry"], { formIds: [f.id] });
  expect(
    (
      await retry.api.forms.retryResponse(f.id, responseId, {
        idempotencyKey: randomUUID(),
      })
    ).status,
  ).toBe("pending");
  const invitation = await api.forms.createBroadcast(f.id, {
    idempotencyKey: randomUUID(),
  });
  expect(invitation.draft.html).toContain(`/forms/${f.id}`);
  const constrained = await key(scopes, { formIds: [f.id] });
  await expect(
    constrained.api.forms.createBroadcast(f.id),
  ).rejects.toMatchObject({ status: 403 });
  const closed = await api.forms.close(
    f.id,
    { revision: published.revision },
    { idempotencyKey: randomUUID() },
  );
  expect(closed.accepting).toBe(false);
  await expect(
    api.forms.update(f.id, { draft: f.draft, revision: 0 }),
  ).rejects.toMatchObject({ status: 409 });
});

it("filters collection pages before disclosure, binds cursors to collections, and enforces form/publication intersections", async () => {
  const first = await api.forms.create(feedback()),
    second = await api.forms.create(feedback()),
    excluded = await api.forms.create(feedback());
  const limited = await key(scopes, { formIds: [first.id, second.id] });
  expect(
    (await all((o) => limited.api.forms.list(o))).map((f) => f.id).sort(),
  ).toEqual([first.id, second.id].sort());
  await expect(limited.api.forms.get(excluded.id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    limited.api.forms.publish(excluded.id, { revision: 0 }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(limited.api.forms.create(feedback())).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    limited.api.forms.list({ cursor: "forged" }),
  ).rejects.toMatchObject({ status: 400 });
  const page = await limited.api.forms.list({ limit: 1 });
  expect(page.nextCursor).toBeTruthy();
  expect(Buffer.from(page.nextCursor!, "base64url").toString()).not.toContain(
    "FORM#",
  );
  await expect(
    api.publications.list({ cursor: page.nextCursor! }),
  ).rejects.toMatchObject({ status: 400 });
  const p = await active(),
    other = await active();
  const selected = await key(scopes, { publicationIds: [p.id] });
  expect(
    (await all((o) => selected.api.publications.list(o))).map((p) => p.id),
  ).toEqual([p.id]);
  expect(
    (await all((o) => selected.api.forms.list(o))).map((f) => f.id),
  ).toEqual([p.formId]);
  await expect(selected.api.publications.get(other.id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(selected.api.forms.get(first.id)).rejects.toMatchObject({
    status: 403,
  });
  expect((await selected.api.forms.get(p.formId)).publicationId).toBe(p.id);
  const intersected = await key(scopes, {
    publicationIds: [p.id],
    formIds: [other.formId],
  });
  expect(await all((o) => intersected.api.forms.list(o))).toEqual([]);
  await expect(intersected.api.forms.get(p.formId)).rejects.toMatchObject({
    status: 403,
  });
  for (const path of ["/contacts", "/topics", "/segments", "/broadcasts"])
    expect((await request(selected.token, path)).status).toBe(403);
  const model = await r.publications.get(p.id);
  for (const path of [
    `/topics/${model.topicId}`,
    `/segments/${model.audienceId}`,
  ])
    expect((await request(selected.token, path)).status).toBe(403);
  await expect(
    selected.api.forms.update(p.formId, {
      draft: (await selected.api.forms.get(p.formId)).draft,
      revision: 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
});

it("enforces old and proposed sender domains plus historical response versions, including filtered exports", async () => {
  let f = await api.forms.create({ ...feedback(), from: "hello@other.test" });
  f = await api.forms.publish(f.id, { revision: f.revision });
  const submissionId = randomUUID();
  await r.forms.submit(f.id, {
    submissionId,
    version: f.version,
    answers: { note: "Old private answer" },
  });
  const rowId = hash(`${f.id}:${submissionId}`);
  const domain = await key(scopes, { senderDomains: ["narada.test"] });
  await expect(domain.api.forms.get(f.id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    domain.api.forms.update(f.id, {
      draft: { ...f.draft, from: "hello@narada.test" },
      revision: f.revision,
    }),
  ).rejects.toMatchObject({ status: 403 });
  f = await api.forms.update(f.id, {
    draft: { ...f.draft, from: "hello@narada.test" },
    revision: f.revision,
  });
  expect((await domain.api.forms.get(f.id)).id).toBe(f.id);
  await expect(
    domain.api.forms.update(f.id, {
      draft: { ...f.draft, from: "hello@other.test" },
      revision: f.revision,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(domain.api.forms.response(f.id, rowId)).rejects.toMatchObject({
    status: 403,
  });
  expect(await all((o) => domain.api.forms.responses(f.id, o))).toEqual([]);
  expect((await domain.api.forms.exportResponses(f.id)).csv).not.toContain(
    "Old private answer",
  );
  const p = await api.publications.create({
    ...settings(),
    from: "hello@other.test",
  });
  expect(
    (await all((o) => domain.api.publications.list(o))).some(
      (row) => row.id === p.id,
    ),
  ).toBe(false);
  await expect(domain.api.publications.get(p.id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    domain.api.publications.update(p.id, {
      settings: { ...p.settings, from: "hello@narada.test" },
      revision: p.revision,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    domain.api.publications.create({ ...settings(), from: "hello@other.test" }),
  ).rejects.toMatchObject({ status: 403 });
});

it("supports publication and issue lifecycle through the SDK, separates publishing channels, and exposes bounded delivery data", async () => {
  let p = await active();
  await subscriber(p);
  await subscriber(p);
  expect(await all((o) => api.publications.subscribers(p.id, o))).toHaveLength(
    2,
  );
  const read = await key(["narada:publications:read", "narada:issues:read"], {
    publicationIds: [p.id],
  });
  await expect(read.api.publications.subscribers(p.id)).rejects.toMatchObject({
    status: 403,
  });
  expect((await api.publications.preview(p.id)).html).toContain(
    p.settings.name,
  );
  p = await api.publications.update(
    p.id,
    {
      settings: { ...p.settings, description: "Updated newsletter" },
      revision: p.revision,
    },
    { idempotencyKey: randomUUID() },
  );
  let i = await api.issues.create(p.id, draft(), {
    idempotencyKey: randomUUID(),
  });
  expect((await api.issues.list(p.id)).data.map((i) => i.id)).toContain(i.id);
  expect(await api.issues.get(p.id, i.id)).toEqual(i);
  i = await api.issues.update(
    p.id,
    i.id,
    { draft: { ...i.draft, title: "Updated issue" }, revision: i.revision },
    { idempotencyKey: randomUUID() },
  );
  expect((await api.issues.preview(p.id, i.id)).eligible).toBe(2);
  expect(
    (
      await approvedOperation(
        r,
        api,
        {
          operation: "issues.test",
          input: {
            params: { id: p.id, issueId: i.id },
            body: { to: "test@example.com", revision: i.revision },
          },
        },
        { idempotencyKey: randomUUID() },
      )
    ).id,
  ).toBeTruthy();
  const web = await key(["narada:issues:publish", "narada:approvals:request"], {
    publicationIds: [p.id],
  });
  const email = await key(["narada:issues:send", "narada:approvals:request"], {
    publicationIds: [p.id],
  });
  const input = {
    revision: i.revision,
    channels: "both" as const,
    confirmed: true as const,
  };
  await expect(
    approvedOperation(r, web.api, {
      operation: "issues.publish",
      input: { params: { id: p.id, issueId: i.id }, body: input },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    approvedOperation(r, email.api, {
      operation: "issues.publish",
      input: { params: { id: p.id, issueId: i.id }, body: input },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    approvedOperation(r, email.api, {
      operation: "issues.publish",
      input: {
        params: { id: p.id, issueId: i.id },
        body: { ...input, channels: "web" },
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect((await r.issues.get(p.id, i.id)).revision).toBe(i.revision);
  i = await approvedOperation(
    r,
    web.api,
    {
      operation: "issues.publish",
      input: {
        params: { id: p.id, issueId: i.id },
        body: { ...input, channels: "web" },
      },
    },
    { idempotencyKey: randomUUID() },
  );
  const stored = await r.issues.get(p.id, i.id);
  await r.issues.run(stored.operationId!);
  i = await api.issues.get(p.id, i.id);
  expect(i.webPublished).toBe(true);
  i = await api.issues.withdraw(
    p.id,
    i.id,
    { revision: i.revision },
    { idempotencyKey: randomUUID() },
  );
  expect(i.webPublished).toBe(false);
  const copy = await api.issues.duplicate(p.id, i.id, {
    idempotencyKey: randomUUID(),
  });
  let scheduled = await approvedOperation(
    r,
    email.api,
    {
      operation: "issues.publish",
      input: {
        params: { id: p.id, issueId: copy.id },
        body: {
          revision: copy.revision,
          channels: "email",
          confirmed: true,
          scheduledAt: Date.now() + 60000,
        },
      },
    },
    { idempotencyKey: randomUUID() },
  );
  expect((await api.issues.delivery(p.id, copy.id)).status).toBeTruthy();
  expect((await api.issues.recipients(p.id, copy.id)).data).toBeDefined();
  await expect(read.api.issues.delivery(p.id, copy.id)).rejects.toMatchObject({
    status: 403,
  });
  scheduled = await api.issues.cancel(
    p.id,
    copy.id,
    { revision: scheduled.revision },
    { idempotencyKey: randomUUID() },
  );
  expect(scheduled.scheduledAt).toBeUndefined();
  const other = await active();
  await expect(api.issues.get(other.id, i.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    approvedOperation(r, web.api, {
      operation: "issues.publish",
      input: {
        params: { id: other.id, issueId: i.id },
        body: {
          revision: i.revision,
          channels: "web",
          confirmed: true,
        },
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  p = await api.publications.archive(
    p.id,
    { revision: p.revision },
    { idempotencyKey: randomUUID() },
  );
  expect(p.status).toBe("archived");
});

it("reauthorizes resource and channel grants before receipt replay and rejects parent changes between authorization and mutation", async () => {
  const p = await active(),
    other = await active(),
    limited = await key(scopes, { publicationIds: [p.id] });
  const body = draft(),
    receipt = randomUUID(),
    path = `/publications/${p.id}/issues`;
  const created = await request(limited.token, path, "POST", body, receipt);
  expect(created.status).toBe(201);
  const replay = await request(limited.token, path, "POST", body, receipt);
  expect(replay.headers.get("idempotency-replayed")).toBe("true");
  expect(await replay.json()).toEqual(await created.json());
  await r.store.patch(`KEY#${hash(limited.token)}`, {
    operationAccess: { scopes, resources: { publicationIds: [other.id] } },
  });
  const denied = await request(limited.token, path, "POST", body, receipt);
  expect(denied.status).toBe(403);
  expect(denied.headers.get("idempotency-replayed")).toBeNull();
  const product = new ProductOperations(r),
    prepared = await product.prepare(ownerCaller("owner"), "issues.create", {
      params: { id: p.id },
      body: draft(),
    });
  await r.publications.update(
    p.id,
    { ...p.settings, description: "Changed after authorization" },
    p.revision,
  );
  await expect(prepared.run()).rejects.toMatchObject({ status: 409 });
});

it("uses the same resource filters for a verified OAuth caller and rejects caller fields in operation input", async () => {
  const p = await active(),
    other = await active();
  const caller = oauthCaller({
    subject: "owner",
    clientId: "client",
    resource: "https://narada.test/mcp",
    tokenGrantId: "grant",
    tokenScopes: scopes,
    grant: {
      id: "grant",
      userId: "owner",
      clientId: "client",
      resource: "https://narada.test/mcp",
      active: true,
      scopes,
      resources: { publicationIds: [p.id] },
    },
    consent: { userId: "owner", clientId: "client", scopes },
  });
  const handlers = new ProductOperations(r);
  const result = (await (
    await handlers.prepare(caller, "publications.list", {})
  ).run()) as Page<{ id: string }>;
  expect(result.data.map((p) => p.id)).toEqual([p.id]);
  await expect(
    handlers.prepare(caller, "publications.get", { params: { id: other.id } }),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (
      await request(token, `/publications/${p.id}/issues`, "POST", {
        ...draft(),
        caller: { scopes },
      })
    ).status,
  ).toBe(400);
});

it("requires integration permissions when a form can write contacts or send mail", async () => {
  const writer = await key(["narada:forms:write"]),
    full = await key();
  const input: FormInput = {
    ...feedback(),
    syncContacts: true,
    questions: [
      { id: "email", label: "Email", type: "email", required: true },
      { id: "consent", label: "Subscribe", type: "consent" },
    ],
  };
  await expect(writer.api.forms.create(input)).rejects.toMatchObject({
    status: 403,
  });
  let f = await full.api.forms.create(input);
  f = await full.api.forms.publish(f.id, { revision: f.revision });
  const submissionId = randomUUID();
  await r.forms.submit(f.id, {
    submissionId,
    version: f.version,
    answers: { email: "sync@example.com", consent: true },
  });
  const responseId = hash(`${f.id}:${submissionId}`);
  await r.store.patch(`FORMRESPONSE#${responseId}`, { status: "failed" });
  const retry = await key(["narada:form-responses:retry"], { formIds: [f.id] });
  await expect(
    retry.api.forms.retryResponse(f.id, responseId),
  ).rejects.toMatchObject({ status: 403 });
  expect((await r.forms.response(responseId)).status).toBe("failed");
});

it("requires membership permission for audience routing across create, update, publish and retry", async () => {
  const limited = await key(
    scopes.filter((scope) => scope !== "narada:segments:members:write"),
  );
  const audience = await r.contacts.createSegment({
    name: "Launch audience",
    kind: "manual",
  });
  const input: FormInput = {
    name: "Launch signup",
    kind: "signup",
    syncContacts: true,
    audienceId: audience.id,
    from: "hello@narada.test",
    questions: [
      { id: "email", label: "Email", type: "email", required: true },
      { id: "consent", label: "Send launch announcements", type: "consent" },
    ],
  };
  await expect(limited.api.forms.create(input)).rejects.toMatchObject({
    status: 403,
  });
  let form = await api.forms.create(input);
  expect(form.draft.audienceId).toBe(audience.id);
  expect((await api.forms.get(form.id)).draft.audienceId).toBe(audience.id);
  await expect(
    limited.api.forms.update(form.id, {
      draft: input,
      revision: form.revision,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    limited.api.forms.publish(form.id, { revision: form.revision }),
  ).rejects.toMatchObject({ status: 403 });
  form = await api.forms.publish(form.id, { revision: form.revision });
  const submissionId = randomUUID();
  await r.forms.submit(form.id, {
    submissionId,
    version: form.version,
    answers: { email: `${randomUUID()}@example.com`, consent: true },
  });
  const responseId = hash(`${form.id}:${submissionId}`);
  await r.store.patch(`FORMRESPONSE#${responseId}`, { status: "failed" });
  await expect(
    limited.api.forms.retryResponse(form.id, responseId),
  ).rejects.toMatchObject({ status: 403 });
  expect((await r.forms.response(responseId)).status).toBe("failed");
});

it("reauthorizes historical receipt senders and publishing channels after owner key edits", async () => {
  const k = await key(),
    input = { ...feedback(), from: "hello@other.test" },
    receipt = randomUUID();
  let f = await k.api.forms.create(input);
  const originalRevision = f.revision;
  f = await k.api.forms.publish(
    f.id,
    { revision: f.revision },
    { idempotencyKey: receipt },
  );
  f = await k.api.forms.update(f.id, {
    draft: { ...f.draft, from: "hello@narada.test" },
    revision: f.revision,
  });
  const update = await app.request(origin + `/api/admin/keys/${k.id}`, {
    method: "PUT",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Restricted sender",
      permission: "operations",
      revision: 0,
      operationAccess: {
        scopes,
        resources: { senderDomains: ["narada.test"] },
      },
    }),
  });
  expect(update.status, await update.clone().text()).toBe(200);
  await expect(
    k.api.forms.publish(
      f.id,
      { revision: originalRevision },
      { idempotencyKey: receipt },
    ),
  ).rejects.toMatchObject({ status: 403 });
  const full = await key();
  let p = await full.api.publications.create(settings());
  p = await full.api.publications.activate(p.id, { revision: p.revision });
  const i = await full.api.issues.create(p.id, draft()),
    publishReceipt = randomUUID(),
    body = {
      revision: i.revision,
      channels: "web" as const,
      confirmed: true as const,
    };
  const initial = await approvedOperation(
    r,
    full.api,
    {
      operation: "issues.publish",
      input: { params: { id: p.id, issueId: i.id }, body: body },
    },
    {
      idempotencyKey: publishReceipt,
    },
  );
  expect(
    await approvedOperation(
      r,
      full.api,
      {
        operation: "issues.publish",
        input: { params: { id: p.id, issueId: i.id }, body: body },
      },
      {
        idempotencyKey: publishReceipt,
      },
    ),
  ).toEqual(initial);
  await r.service.updateKey(full.id, {
    name: "Email only",
    permission: "operations",
    revision: 0,
    operationAccess: {
      scopes: ["narada:issues:send"],
      resources: { publicationIds: [p.id] },
    },
  });
  await expect(
    approvedOperation(
      r,
      full.api,
      {
        operation: "issues.publish",
        input: { params: { id: p.id, issueId: i.id }, body: body },
      },
      {
        idempotencyKey: publishReceipt,
      },
    ),
  ).rejects.toMatchObject({ status: 403 });
});

it("does not expose linked issue deliveries from a historical sender outside the grant", async () => {
  const full = await key();
  const domain = await r.store.get("DOMAIN#narada.test");
  await r.store.put({
    ...domain!,
    pk: "DOMAIN#other.test",
    name: "other.test",
  });
  let p = await full.api.publications.create({
    ...settings(),
    from: "hello@other.test",
  });
  p = await full.api.publications.activate(p.id, { revision: p.revision });
  await subscriber(p);
  let i = await full.api.issues.create(p.id, draft());
  i = await approvedOperation(r, full.api, {
    operation: "issues.publish",
    input: {
      params: { id: p.id, issueId: i.id },
      body: {
        revision: i.revision,
        channels: "email",
        confirmed: true,
        scheduledAt: Date.now() + 60000,
      },
    },
  });
  p = await full.api.publications.update(p.id, {
    settings: { ...p.settings, from: "hello@narada.test" },
    revision: p.revision,
  });
  const limited = await key(scopes, {
    publicationIds: [p.id],
    senderDomains: ["narada.test"],
  });
  expect((await limited.api.publications.get(p.id)).id).toBe(p.id);
  expect((await limited.api.issues.list(p.id)).data).toEqual([]);
  for (const suffix of ["", "/preview", "/delivery", "/recipients"])
    expect(
      (
        await request(
          limited.token,
          `/publications/${p.id}/issues/${i.id}${suffix}`,
        )
      ).status,
    ).toBe(403);
  await expect(limited.api.issues.duplicate(p.id, i.id)).rejects.toMatchObject({
    status: 403,
  });
  const internal = await r.issues.get(p.id, i.id);
  expect(
    (await request(limited.token, `/broadcasts/${internal.broadcastId}`))
      .status,
  ).toBe(403);
});
