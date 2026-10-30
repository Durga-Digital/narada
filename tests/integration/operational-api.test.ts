import * as transport from "@narada/core/transport";
import { removeDomain } from "@narada/core/resource-lifecycle";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { z } from "zod";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { Narada } from "../../packages/sdk/src/index.js";
import { scopes, type Scope } from "@narada/contracts/scopes";
import { operations, matchHttpOperation } from "@narada/contracts/operations";
import { operationSchemas } from "@narada/contracts/discovery";
import { isOperationalOperation } from "@narada/core/operational-operations";
import { lifecycleJobs } from "@narada/core/event-outbox";
import type { ResourceRestrictions } from "@narada/contracts/delegation";
const prefix = `narada-operational-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`,
  origin = "http://localhost:5173";
let r: Awaited<ReturnType<typeof initialize>>,
  app: ReturnType<typeof createApp>,
  api: Narada,
  token: string,
  cookie: string;
const hook = {
  url: "http://localhost:3001/api/dev/webhook-receiver",
  events: ["broadcast.completed" as const],
};
const covered = new Set<string>();
function client(key: string, lostPath?: string) {
  let lost = false;
  return new Narada({
    apiKey: key,
    baseUrl: origin,
    fetch: async (input, init) => {
      const req = new Request(input, init),
        res = await app.request(req),
        op = matchHttpOperation(req.method, new URL(req.url).pathname);
      if (res.ok && op && isOperationalOperation(op.id)) {
        z.fromJSONSchema(operationSchemas[op.id].output).parse(
          await res.clone().json(),
        );
        covered.add(op.id);
      }
      if (
        !lost &&
        lostPath &&
        res.ok &&
        req.method !== "GET" &&
        new URL(req.url).pathname.endsWith(lostPath)
      ) {
        lost = true;
        throw new Error("Lost response after commit");
      }
      return res;
    },
  });
}
async function key(
  selected: readonly Scope[],
  resources: ResourceRestrictions = {},
) {
  return (
    await r.service.createKey(
      "Operational fixture",
      "operations",
      undefined,
      undefined,
      undefined,
      { scopes: [...selected], resources },
    )
  ).token;
}
const call = (
  path: string,
  method = "GET",
  body?: unknown,
  credential = token,
  receipt?: string,
) =>
  app.request(origin + "/api/v1" + path, {
    method,
    headers: {
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
      ...(receipt ? { "idempotency-key": receipt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
beforeAll(async () => {
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  r = await initialize(credentials);
  app = createApp(r);
  token = await key(scopes);
  api = client(token);
  const login = await app.request(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: await readFile(credentials, "utf8"),
  });
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
});
afterAll(async () => {
  if (r)
    for (const TableName of [r.config.APP_TABLE, r.config.AUTH_TABLE])
      await r.store.client.send(new DeleteTableCommand({ TableName }));
  await rm(credentials, { force: true });
});
it("covers sending state, revision conflicts, local SES diagnostics, and bounded domain reads/refresh", async () => {
  const current = await api.sending.get(),
    retryKey = { idempotencyKey: randomUUID() },
    input = { paused: true, revision: current.revision };
  const paused = await api.sending.update(input, retryKey);
  expect(paused.paused).toBe(true);
  expect(await api.sending.update(input, retryKey)).toEqual(paused);
  await expect(
    api.sending.update(input, { idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
  await api.sending.update({ paused: false, revision: paused.revision });
  expect(await api.sending.diagnostics()).toMatchObject({
    mode: "local",
    account: null,
    delivery: null,
  });
  const domain = await api.domains.get("narada.test");
  expect(domain.verified).toBe(true);
  expect(domain).not.toHaveProperty("registrationId");
  expect(
    (await api.domains.list()).data.some((d) => d.name === "narada.test"),
  ).toBe(true);
  expect(
    (await api.domains.refresh("narada.test", { idempotencyKey: randomUUID() }))
      .verified,
  ).toBe(true);
  await expect(api.domains.get("missing.test")).rejects.toMatchObject({
    status: 404,
  });
  expect((await call("/metrics?days=91")).status).toBe(400);
});
it("filters domain lists and metrics without leaking other domains, and fails unsupported restriction dimensions closed", async () => {
  const row = await r.store.get("DOMAIN#narada.test");
  await r.store.put({
    ...row!,
    pk: "DOMAIN#other.test",
    sort: "other.test",
    name: "other.test",
  });
  const day = new Date().toISOString().slice(0, 10);
  await r.store.put({
    pk: `METRICS#${day}`,
    sk: "DOMAIN#narada.test",
    domain: "narada.test",
    day,
    accepted: 2,
  });
  await r.store.put({
    pk: `METRICS#${day}`,
    sk: "DOMAIN#other.test",
    domain: "other.test",
    day,
    accepted: 100,
  });
  const restricted = client(
    await key(scopes, { senderDomains: ["narada.test"] }),
  );
  expect((await restricted.domains.list()).data.map((d) => d.name)).toEqual([
    "narada.test",
  ]);
  expect(
    (await restricted.metrics.get({ days: 1, domain: "narada.test" })).totals
      .accepted,
  ).toBe(2);
  await expect(restricted.metrics.get({ days: 1 })).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    restricted.metrics.get({ domain: "other.test" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(restricted.domains.get("other.test")).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    restricted.domains.refresh("other.test", { idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ status: 403 });
  for (const action of [
    () => restricted.sending.get(),
    () => restricted.sending.diagnostics(),
    () => restricted.suppressions.list(),
    () => restricted.webhooks.list(),
    () => restricted.webhooks.create(hook),
  ])
    await expect(action()).rejects.toMatchObject({ status: 403 });
  const publication = await r.publications.create({
    name: "Restricted",
    slug: `restricted-${randomUUID()}`,
    from: "hello@narada.test",
  });
  for (const resources of [
    { formIds: [publication.formId] },
    { publicationIds: [publication.id] },
  ]) {
    const restricted = client(await key(scopes, resources));
    await expect(restricted.domains.list()).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      restricted.metrics.get({ domain: "narada.test" }),
    ).rejects.toMatchObject({ status: 403 });
  }
  const global = await api.metrics.get({ days: 1 });
  expect(global.totals.accepted).toBe(102);
  expect(global).not.toHaveProperty("cloudWatchUrl");
});
it("provides explicit suppression permissions, filtering and safe no-ops without resubscribing", async () => {
  const email = `${randomUUID()}@example.com`,
    receipt = { idempotencyKey: randomUUID() };
  expect(await api.suppressions.create({ email }, receipt)).toEqual({
    email,
    reason: "manual",
  });
  expect(await api.suppressions.get(email)).toEqual({
    email,
    reason: "manual",
  });
  expect(
    (await api.suppressions.list({ email })).data.map((s) => s.email),
  ).toEqual([email]);
  expect((await api.suppressions.list()).data.length).toBeGreaterThan(0);
  await r.store.patch(`SUPPRESS#${email}`, { reason: "complaint" });
  expect((await api.suppressions.create({ email })).reason).toBe("complaint");
  const read = client(await key(["narada:suppressions:read"]));
  await expect(read.suppressions.create({ email })).rejects.toMatchObject({
    status: 403,
  });
  await expect(read.suppressions.delete(email)).rejects.toMatchObject({
    status: 403,
  });
  const add = client(await key(["narada:suppressions:add"]));
  await expect(add.suppressions.delete(email)).rejects.toMatchObject({
    status: 403,
  });
  await r.store.put({
    pk: `CONTACT#${email}`,
    sk: "META",
    email,
    unsubscribedAll: true,
  });
  await api.suppressions.delete(email, { idempotencyKey: randomUUID() });
  await api.suppressions.delete(email);
  expect((await r.store.get(`CONTACT#${email}`))!.unsubscribedAll).toBe(true);
  await expect(api.suppressions.get(email)).rejects.toMatchObject({
    status: 404,
  });
});
it("supports webhook catalog/configuration, secret-safe reads, delivery history and atomic retry receipts", async () => {
  expect(
    (await api.webhooks.events()).data.some(
      (e) => e.type === "broadcast.completed",
    ),
  ).toBe(true);
  const created = await api.webhooks.create(hook, {
    idempotencyKey: randomUUID(),
  });
  expect(created.secret).toMatch(/^whsec_/);
  expect(await api.webhooks.get(created.id)).not.toHaveProperty("secret");
  expect(JSON.stringify(await api.webhooks.list())).not.toContain(
    created.secret,
  );
  const updated = await api.webhooks.update(
    created.id,
    { ...hook, revision: 0, events: ["issue.published"] },
    { idempotencyKey: randomUUID() },
  );
  expect(updated.revision).toBe(1);
  await expect(
    api.webhooks.update(created.id, { ...hook, revision: 0 }),
  ).rejects.toMatchObject({ status: 409 });
  const jobs = await lifecycleJobs(r.store, "issue.published", randomUUID(), {
    issue_id: randomUUID(),
  });
  await r.store.transaction(jobs);
  const id = String(jobs[0]!.Put.Item.id);
  await r.store.patch(`HOOKJOB#${id}`, { state: "failed", attempts: 6 });
  expect(
    (await api.webhooks.deliveries.list()).data.some((row) => row.id === id),
  ).toBe(true);
  const detail = await api.webhooks.deliveries.get(id);
  expect(detail.delivery.state).toBe("failed");
  expect(detail.delivery.payload).not.toHaveProperty("data");
  const retryKey = { idempotencyKey: randomUUID() };
  await api.webhooks.deliveries.retry(id, retryKey);
  await r.store.patch(`HOOKJOB#${id}`, { state: "failed", attempts: 12 });
  await api.webhooks.deliveries.retry(id, retryKey);
  expect((await r.store.get(`HOOKJOB#${id}`))!.state).toBe("failed");
  const read = client(await key(["narada:webhooks:read"]));
  await expect(read.webhooks.deliveries.retry(id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(read.webhooks.delete(created.id)).rejects.toMatchObject({
    status: 403,
  });
  await api.webhooks.delete(created.id, { idempotencyKey: randomUUID() });
  await expect(api.webhooks.deliveries.retry(id)).rejects.toMatchObject({
    status: 409,
  });
});
it("recovers a lost create response once, keeps secrets out of activity, and rejects replay after deletion or revocation", async () => {
  const selected = await key(scopes),
    retryKey = { idempotencyKey: randomUUID() },
    lost = client(selected, "/webhooks");
  await expect(lost.webhooks.create(hook, retryKey)).rejects.toThrow(
    "Lost response after commit",
  );
  const sdk = client(selected),
    created = await sdk.webhooks.create(hook, retryKey);
  const activity = await sdk.operations.lookup({
    operation: "webhooks.create",
    idempotencyKey: retryKey.idempotencyKey,
  });
  expect(activity.status).toBe("succeeded");
  expect(activity.targets).toContainEqual({ kind: "webhook", id: created.id });
  const stored = await r.store.get(`ACTIVITY#${activity.id}`);
  expect(JSON.stringify(stored)).not.toContain(created.secret);
  expect(JSON.stringify(stored)).not.toContain(hook.url);
  expect(
    (await api.webhooks.list()).data.filter((row) => row.id === created.id),
  ).toHaveLength(1);
  await sdk.webhooks.delete(created.id);
  await expect(sdk.webhooks.create(hook, retryKey)).rejects.toMatchObject({
    status: 404,
  });
  const keyRecord = await r.service.authenticate(selected);
  await r.store.patch(keyRecord.pk, { revoked: true });
  await expect(sdk.webhooks.create(hook, retryKey)).rejects.toMatchObject({
    status: 401,
  });
});
it("does not expand legacy keys or accept malformed inputs or unsupported operations", async () => {
  const legacy = (await r.service.createKey("Legacy", "full")).token;
  for (const op of operations.filter((op) => isOperationalOperation(op.id))) {
    if (!("http" in op)) continue;
    const path = op.http.path
      .replace("/api/v1", "")
      .replace(":name", "narada.test")
      .replace(":email", "test%40example.com")
      .replace(":id", randomUUID());
    expect(
      (await call(path, op.http.method, undefined, legacy)).status,
      op.id,
    ).toBe(403);
  }
  expect(
    (await call("/sending", "PUT", { paused: true, revision: -1 })).status,
  ).toBe(400);
  expect(
    (await call("/webhooks", "POST", { ...hook, events: ["invented"] })).status,
  ).toBe(400);
  expect(
    (
      await call("/webhooks", "POST", {
        ...hook,
        url: "http://127.0.0.1/private",
      })
    ).status,
  ).toBe(400);
  expect(
    (await call("/domains", "POST", { name: "example.com" }, legacy)).status,
  ).toBe(403);
});
it("shares dashboard services, preserves owner-only credentials, and fences the endpoint limit across concurrent creates", async () => {
  const refreshed = await app.request(
    origin + "/api/admin/domains/NARADA.TEST/verify",
    { method: "POST", headers: { cookie, origin } },
  );
  expect(refreshed.status).toBe(200);
  expect((await refreshed.json()).name).toBe("narada.test");
  const response = await app.request(origin + "/api/admin/webhooks", {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify(hook),
  });
  expect(response.status).toBe(201);
  const ownerHook = await response.json();
  expect((await api.webhooks.get(ownerHook.id)).revision).toBe(0);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      api.webhooks.create(hook, { idempotencyKey: randomUUID() }),
    ),
  );
  expect(
    results.filter((v) => v.status === "fulfilled").length,
  ).toBeLessThanOrEqual(4);
  while ((await api.webhooks.list()).data.length < 5)
    await api.webhooks.create(hook);
  await expect(api.webhooks.create(hook)).rejects.toMatchObject({
    status: 422,
  });
  const registry = await r.store.get("WEBHOOKREGISTRY");
  expect(new Set(registry!.ids as string[]).size).toBe(5);
  for (const item of (await api.webhooks.list()).data)
    await api.webhooks.delete(item.id);
  const readOnly = await key(["narada:webhooks:read"]);
  expect(
    (
      await app.request(origin + "/api/admin/webhooks", {
        headers: { authorization: `Bearer ${readOnly}` },
      })
    ).status,
  ).toBe(401);
});

it("sets up a project through SDK/REST with revision checks and recovery after a lost response", async () => {
  const name = "migration.example.test",
    receipt = { idempotencyKey: randomUUID() };
  const sdk = client(token, "/domains");
  await expect(sdk.domains.create({ name }, receipt)).rejects.toThrow(
    "Lost response",
  );
  const created = await sdk.domains.create({ name }, receipt);
  expect(created).toMatchObject({ name, revision: 0 });
  expect(await api.domains.create({ name })).toEqual(created);
  expect(
    (
      await api.operations.lookup({
        operation: "domains.create",
        idempotencyKey: receipt.idempotencyKey,
      })
    ).status,
  ).toBe("succeeded");
  const body = {
    domain: `bounce.${name}`,
    behavior: "REJECT_MESSAGE" as const,
    revision: created.revision,
  };
  const configKey = { idempotencyKey: randomUUID() };
  const configured = await api.domains.updateMailFrom(name, body, configKey);
  expect(configured.revision).toBe(1);
  expect(configured.authentication!.mailFrom.records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "MX",
        name: `bounce.${name}`,
        value: expect.stringContaining("feedback-smtp."),
      }),
      expect.objectContaining({
        type: "TXT",
        name: `bounce.${name}`,
        value: "v=spf1 include:amazonses.com ~all",
      }),
    ]),
  );
  expect(await api.domains.updateMailFrom(name, body, configKey)).toEqual(
    configured,
  );
  await expect(api.domains.updateMailFrom(name, body)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    api.domains.updateMailFrom(name, { ...body, domain: name, revision: 1 }),
  ).rejects.toMatchObject({ status: 400 });
  const dkim = await api.domains.enableDkim(name, { revision: 1 });
  expect(dkim.revision).toBe(2);
  expect((await api.domains.refresh(name)).revision).toBe(2);
  expect((await api.integration.guide()).markdown).toContain(
    "MCP cannot create, retrieve or approve credentials",
  );
  expect(
    (await api.resources.search({ kind: "domains", text: "migration" })).data,
  ).toEqual([
    expect.objectContaining({ kind: "domains", id: name, name, revision: 2 }),
  ]);
  const selected = client(
    await key(
      [
        "narada:domains:read",
        "narada:domains:create",
        "narada:domains:configure",
      ],
      { senderDomains: [name] },
    ),
  );
  await expect(
    selected.domains.create({ name: "outside.test" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    selected.domains.enableDkim("narada.test", { revision: 0 }),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (await selected.resources.search({ kind: "domains", text: "narada" })).data,
  ).toEqual([]);
  await expect(
    selected.resources.search({ kind: "contacts", text: "test" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api.resources.search({ kind: "domains", text: "  " }),
  ).rejects.toMatchObject({ status: 400 });
  const page = await api.resources.search({
    kind: "domains",
    text: "test",
    limit: 1,
  });
  expect(page.nextCursor).toBeTruthy();
  await expect(
    api.resources.search({
      kind: "domains",
      text: "different",
      cursor: page.nextCursor!,
    }),
  ).rejects.toMatchObject({ status: 400 });
});

it("covers every operational contract through the SDK", () => {
  expect([...covered].sort()).toEqual(
    operations
      .filter((op) => isOperationalOperation(op.id))
      .map((op) => op.id)
      .sort(),
  );
});

it("serializes competing domain registrations and fences a completion after owner removal", async () => {
  const original = transport.verifyDomain;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const name = "concurrent.example.test";
  const verify = vi
    .spyOn(transport, "verifyDomain")
    .mockImplementation(async (...args) => {
      if (args[1] === name) {
        started();
        await gate;
      }
      const row = await original(...args);
      return {
        ...row,
        records: ["one", "two", "three"].map((selector) => ({
          type: "CNAME",
          name: `${selector}._domainkey.${args[1]}`,
          value: `${selector}.dkim.amazonses.com`,
        })),
      };
    });
  try {
    const first = api.domains.create(
      { name },
      { idempotencyKey: randomUUID() },
    );
    await entered;
    await expect(
      api.domains.create({ name }, { idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    release();
    const created = await first;
    expect(created.records).toEqual(
      ["one", "two", "three"].map((selector) => ({
        type: "CNAME",
        name: `${selector}._domainkey.${name}`,
        value: `${selector}.dkim.amazonses.com`,
      })),
    );
    expect(verify).toHaveBeenCalledTimes(1);
    expect(await api.domains.create({ name })).toEqual(created);
    expect(verify).toHaveBeenCalledTimes(1);
  } finally {
    release();
    verify.mockRestore();
  }

  let finish!: () => void, reading!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const checking = new Promise<void>((resolve) => {
    reading = resolve;
  });
  const refresh = vi
    .spyOn(transport, "verifyDomain")
    .mockImplementation(async (...args) => {
      const row = await original(...args);
      reading();
      await pending;
      return row;
    });
  try {
    const outcome = api.domains
      .refresh(name, { idempotencyKey: randomUUID() })
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await checking;
    await removeDomain(r.store, name, name);
    finish();
    expect(await outcome).toHaveProperty("error");
    const removed = await r.store.get(`DOMAIN#${name}`);
    expect(removed?.removedAt).toBeTruthy();
    expect(removed?.verified).toBe(false);
    await expect(api.domains.get(name)).rejects.toMatchObject({ status: 404 });
  } finally {
    finish();
    refresh.mockRestore();
  }
});

it("searches public resource references and keeps form/publication restrictions on filtered pages", async () => {
  const text = "Find-me",
    formInput = {
      name: text,
      kind: "feedback" as const,
      from: "hello@narada.test",
      questions: [{ id: "note", label: "Note", type: "text" as const }],
    };
  const form = await api.forms.create(formInput),
    hidden = await api.forms.create(formInput);
  const publication = await api.publications.create({
    name: text,
    slug: "find-me",
    from: "hello@narada.test",
    organization: "Test",
    postalAddress: "1 Test Street",
  });
  const contact = await api.contacts.create({ email: "find-me@example.test" });
  const topic = await api.topics.create({ name: text });
  const segment = await api.segments.create({ name: text, kind: "manual" });
  const template = await api.templates.create({
    name: text,
    alias: "find-me",
    kind: "transactional",
    subject: "Subject",
    text: "Private template",
    variables: [],
  });
  const broadcast = await api.broadcasts.create({ name: text });
  for (const [kind, id] of [
    ["forms", form.id],
    ["publications", publication.id],
    ["contacts", contact.email],
    ["topics", topic.id],
    ["segments", segment.id],
    ["templates", template.id],
    ["broadcasts", broadcast.id],
  ] as const) {
    const matches = await api.resources.search({ kind, text });
    z.fromJSONSchema(operationSchemas["resources.search"].output).parse(
      matches,
    );
    expect(matches.data).toContainEqual(expect.objectContaining({ kind, id }));
    expect(JSON.stringify(matches)).not.toContain("Private template");
  }
  expect(
    (await api.resources.search({ kind: "contacts", text })).data[0]?.name,
  ).toBe(contact.email);
  const restricted = client(
    await key(
      ["narada:forms:read", "narada:publications:read", "narada:domains:read"],
      { formIds: [form.id] },
    ),
  );
  expect(
    (await restricted.resources.search({ kind: "forms", text })).data.map(
      (r) => r.id,
    ),
  ).toEqual([form.id]);
  await expect(
    restricted.resources.search({ kind: "publications", text }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    restricted.resources.search({ kind: "domains", text }),
  ).rejects.toMatchObject({ status: 403 });
  const publicationOnly = client(
    await key(["narada:publications:read"], {
      publicationIds: [publication.id],
    }),
  );
  expect(
    (
      await publicationOnly.resources.search({ kind: "publications", text })
    ).data.map((r) => r.id),
  ).toEqual([publication.id]);
  let cursor: string | undefined;
  const ids: string[] = [];
  do {
    const page = await api.resources.search({
      kind: "forms",
      text,
      limit: 1,
      cursor,
    });
    ids.push(...page.data.map((r) => r.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids.sort()).toEqual([form.id, hidden.id, publication.formId].sort());
});
