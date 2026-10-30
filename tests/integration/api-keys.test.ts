import { readFile } from "node:fs/promises";
import { beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import type { ApiKey } from "@narada/core/model";
import { emailInput } from "@narada/core/model";
import { approvedOperation } from "../helpers/approved-operation.js";
import { Narada } from "../../packages/sdk/src/index.js";
let runtime: Awaited<ReturnType<typeof initialize>>;
let app: ReturnType<typeof createApp>;
let cookie = "";
const origin = "http://localhost:5173";
function admin(id: string, body: unknown, session = cookie, source = origin) {
  return app.request(`${origin}/api/admin/keys/${id}`, {
    method: "PUT",
    headers: {
      cookie: session,
      origin: source,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
beforeAll(async () => {
  const prefix = process.env.NARADA_TEST_PREFIX ?? "narada-integration";
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(
    process.env.NARADA_TEST_PREFIX
      ? `.local/${prefix}-owner.json`
      : ".local/test-owner.json",
  );
  app = createApp(runtime);
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_PREFIX
        ? `.local/${prefix}-owner.json`
        : ".local/test-owner.json",
      "utf8",
    ),
  );
  const login = await app.request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(owner),
  });
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
});
function call(token: string, path: string, data?: unknown) {
  return app.request(`http://localhost:5173/api/v1${path}`, {
    method: data ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(data ? { "content-type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
}
it("enforces exact-domain sending/read access, full-access rules, and revocation", async () => {
  const domain = `scope-${randomUUID()}.example.com`,
    other = `other-${randomUUID()}.example.com`;
  for (const name of [domain, other])
    await runtime.store.put({
      pk: `DOMAIN#${name}`,
      sk: "META",
      name,
      verified: true,
    });
  const key = await runtime.service.createKey(
    " Scoped app ",
    "sending",
    domain,
  );
  expect(key.name).toBe("Scoped app");
  const body = {
    from: `Team <hello@${domain}>`,
    to: `${randomUUID()}@example.com`,
    subject: "Scoped",
    text: "Test",
  };
  const allowed = await call(key.token, "/emails", body);
  expect(allowed.status).toBe(202);
  expect(await allowed.json()).toMatchObject({
    id: expect.any(String),
    replayed: false,
  });
  const client = new Narada({
    apiKey: key.token,
    baseUrl: origin,
    fetch: async (url, init) => app.request(new Request(url, init)),
  });
  const message = await approvedOperation(runtime, client, {
    operation: "emails.send",
    input: { body },
  });
  expect((await call(key.token, `/emails/${message.id}`)).status).toBe(200);
  expect(
    (await call(key.token, "/emails", { ...body, from: `hello@${other}` }))
      .status,
  ).toBe(403);
  expect(
    (
      await call(key.token, "/emails", {
        ...body,
        from: `hello@child.${domain}`,
      })
    ).status,
  ).toBe(403);
  const foreign = await runtime.service.accept(
    emailInput.parse({ ...body, from: `hello@${other}` }),
    "default",
  );
  expect((await call(key.token, `/emails/${foreign.id}`)).status).toBe(403);
  expect((await call(key.token, "/contacts")).status).toBe(403);
  await expect(
    runtime.service.createKey("Invalid", "full", domain),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    runtime.service.createKey("Unknown", "sending", "not-added.example"),
  ).rejects.toMatchObject({ status: 422 });
  const full = await runtime.service.createKey("All domains", "full");
  expect((await call(full.token, `/emails/${foreign.id}`)).status).toBe(200);
  const record = await runtime.service.authenticate(key.token);
  await runtime.store.patch(record.pk, { revoked: true });
  expect((await call(key.token, `/emails/${message.id}`)).status).toBe(401);
});
it("records real usage with coalesced updates and does not resurrect revoked keys", async () => {
  const key = await runtime.service.createKey("Usage tracking");
  const before = await runtime.service.authenticate(key.token);
  expect(before.lastUsedAt).toBeUndefined();
  expect(before.usageTrackingSince).toEqual(expect.any(String));
  // An authenticated request counts as use even when the requested resource does not exist.
  expect((await call(key.token, "/emails/not-found")).status).toBe(404);
  const used = (await runtime.store.get<ApiKey>(before.pk))!;
  expect(used.lastUsedAt).toEqual(expect.any(String));
  await call(key.token, "/emails/not-found");
  expect((await runtime.store.get<ApiKey>(before.pk))!.lastUsedAt).toBe(
    used.lastUsedAt,
  );
  await runtime.store.patch(before.pk, {
    lastUsedAt: "2000-01-01T00:00:00.000Z",
  });
  await call(key.token, "/emails/not-found");
  expect((await runtime.store.get<ApiKey>(before.pk))!.lastUsedAt).not.toBe(
    "2000-01-01T00:00:00.000Z",
  );
  await runtime.store.patch(before.pk, {
    revoked: true,
    lastUsedAt: "2000-01-01T00:00:00.000Z",
  });
  await runtime.service.recordKeyUse(before);
  expect(await runtime.store.get(before.pk)).toMatchObject({
    revoked: true,
    lastUsedAt: "2000-01-01T00:00:00.000Z",
  });
});

it("edits an existing token, supports signup-only access, and immediately removes old grants", async () => {
  const key = await runtime.service.createKey("Signup app");
  const contact = { email: `${randomUUID()}@example.com`, name: "Signup User" };
  expect((await call(key.token, "/contacts", contact)).status).toBe(403);
  const settings = {
    name: "Signup contacts",
    permission: "scoped",
    scopes: ["contacts:create"],
    revision: 0,
  };
  expect((await admin(key.id, settings, "")).status).toBe(401);
  expect(
    (await admin(key.id, settings, cookie, "https://foreign.example")).status,
  ).toBe(403);
  const response = await admin(key.id, settings);
  expect(response.status).toBe(200);
  const edited = await response.json();
  expect(edited).toMatchObject({
    id: key.id,
    prefix: key.prefix,
    name: settings.name,
    revision: 1,
  });
  for (const secret of ["token", "hash", "pk", "sk"])
    expect(edited).not.toHaveProperty(secret);
  expect((await call(key.token, "/contacts", contact)).status).toBe(201);
  expect((await call(key.token, "/contacts")).status).toBe(403);
  expect(
    (await call(key.token, `/contacts/${encodeURIComponent(contact.email)}`))
      .status,
  ).toBe(403);
  expect((await call(key.token, "/emails/not-found")).status).toBe(403);
  expect((await admin(key.id, settings)).status).toBe(409);
  expect(
    (
      await admin(key.id, {
        ...settings,
        revision: 1,
        scopes: ["contacts:read"],
      })
    ).status,
  ).toBe(200);
  expect(
    (await call(key.token, `/contacts/${encodeURIComponent(contact.email)}`))
      .status,
  ).toBe(200);
  expect(
    (
      await call(key.token, "/contacts", {
        ...contact,
        email: `${randomUUID()}@example.com`,
      })
    ).status,
  ).toBe(403);
  const selfEdit = await app.request(`${origin}/api/admin/keys/${key.id}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${key.token}`,
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...settings, permission: "full", revision: 2 }),
  });
  expect(selfEdit.status).toBe(401);
});
it("validates edits, preserves domain limits, clears removed settings, and upgrades legacy keys", async () => {
  const domain = `edit-${randomUUID()}.example.com`;
  await runtime.store.put({
    pk: `DOMAIN#${domain}`,
    sk: "META",
    name: domain,
    verified: true,
  });
  const key = await runtime.service.createKey("Legacy", "sending", domain);
  const record = await runtime.service.authenticate(key.token);
  await runtime.store.patch(record.pk, { name: "Legacy" }, undefined, [
    ["revision"],
  ]);
  const settings = {
    name: "Updated",
    permission: "scoped",
    scopes: ["emails:send", "contacts:create"],
    domain,
    revision: 0,
  };
  for (const bad of [
    { ...settings, scopes: [] },
    { ...settings, scopes: ["unknown"] },
    { ...settings, permission: "full" },
    { ...settings, scopes: ["contacts:create"] },
    { ...settings, revision: -1 },
    { ...settings, revision: undefined },
    { ...settings, permission: undefined },
  ]) {
    expect((await admin(key.id, bad)).status).toBe(400);
  }
  expect(
    (await admin(key.id, { ...settings, domain: "missing.example.com" }))
      .status,
  ).toBe(422);
  expect((await admin(key.id, settings)).status).toBe(200);
  expect((await runtime.service.authenticate(key.token)).domain).toBe(domain);
  expect(
    (
      await call(key.token, "/emails", {
        from: "hello@other.example.com",
        to: "test@example.com",
        subject: "Test",
        text: "Test",
      })
    ).status,
  ).toBe(403);
  expect(
    (await admin(key.id, { name: "Full", permission: "full", revision: 1 }))
      .status,
  ).toBe(200);
  const full = await runtime.service.authenticate(key.token);
  expect(full).not.toHaveProperty("domain");
  expect(full).not.toHaveProperty("scopes");
  expect(
    (
      await admin(key.id, {
        name: "Sending",
        permission: "sending",
        revision: 2,
      })
    ).status,
  ).toBe(200);
  expect((await call(key.token, "/contacts")).status).toBe(403);
});
it("cannot edit or resurrect a key revoked during an edit", async () => {
  const key = await runtime.service.createKey("Race");
  const record = await runtime.service.authenticate(key.token);
  const original = runtime.store.transaction.bind(runtime.store);
  const spy = vi
    .spyOn(runtime.store, "transaction")
    .mockImplementationOnce(async (items) => {
      await runtime.store.patch(record.pk, { revoked: true });
      return original(items);
    });
  try {
    expect(
      (await admin(key.id, { name: "Race", permission: "full", revision: 0 }))
        .status,
    ).toBe(409);
  } finally {
    spy.mockRestore();
  }
  expect(
    (await admin(key.id, { name: "Race", permission: "full", revision: 0 }))
      .status,
  ).toBe(409);
  expect((await call(key.token, "/contacts")).status).toBe(401);
  expect(await runtime.store.get(record.pk)).toMatchObject({
    revoked: true,
    permission: "sending",
    revision: 0,
  });
});
