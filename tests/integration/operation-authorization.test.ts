import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { approvedOperation } from "../helpers/approved-operation.js";
import { Narada } from "../../packages/sdk/src/index.js";
import { rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { z } from "zod";
import type { Context } from "hono";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { operationSchemas } from "@narada/contracts/discovery";
import type { Runtime } from "@narada/core/runtime";
import { hash } from "@narada/core/model";

const id = randomUUID(),
  appTable = `narada-authorization-${id}`,
  authTable = `narada-authorization-auth-${id}`,
  credentials = `.local/authorization-${id}.json`;
let runtime: Runtime, app: ReturnType<typeof createApp>;
const unregistered = vi.fn((c: Context) => c.json({ unexpected: true }));
beforeAll(async () => {
  vi.stubEnv("APP_TABLE", appTable);
  vi.stubEnv("AUTH_TABLE", authTable);
  runtime = await initialize(credentials);
  app = createApp(runtime);
  app.post("/api/v1/future-operation", unregistered);
});
afterAll(async () => {
  try {
    if (runtime)
      await Promise.all(
        [appTable, authTable].map((TableName) =>
          runtime.store.client.send(new DeleteTableCommand({ TableName })),
        ),
      );
  } finally {
    await rm(credentials, { force: true });
    vi.unstubAllEnvs();
  }
});
function request(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
) {
  return app.request(`http://localhost:5173/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

it("authenticates discovery and returns only currently authorized operations and schemas", async () => {
  const key = await runtime.service.createKey("Sending");
  expect((await request("", "/capabilities")).status).toBe(401);
  expect((await request("", "/openapi.json")).status).toBe(401);
  const response = await request(key.token, "/capabilities");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const capabilities = await response.json();
  expect(
    z
      .fromJSONSchema(operationSchemas["capabilities.read"].output)
      .safeParse(capabilities).success,
  ).toBe(true);
  expect(
    capabilities.operations.map((op: { id: string }) => op.id).sort(),
  ).toEqual([
    "approvals.get",
    "approvals.list",
    "approvals.request",
    "capabilities.read",
    "contracts.read",
    "emails.get",
    "emails.send",
  ]);
  const openapi = await (await request(key.token, "/openapi.json")).json();
  expect(openapi.paths["/api/v1/contacts"]).toBeUndefined();
  expect(openapi.paths["/api/v1/emails"].post.operationId).toBe("emails.send");
  expect(openapi.paths["/api/v1/emails/{id}"].get.operationId).toBe(
    "emails.get",
  );
});

it("preserves create-only keys, rejects caller injection and prevents resource lookup on denied requests", async () => {
  const key = await runtime.service.createKey(
    "Create contacts",
    "scoped",
    undefined,
    ["contacts:create"],
  );
  const body = { email: `${randomUUID()}@example.com`, name: "A contact" };
  const created = await request(key.token, "/contacts", "POST", body);
  expect(created.status).toBe(201);
  expect(
    z
      .fromJSONSchema(operationSchemas["contacts.create"].output)
      .safeParse(await created.json()).success,
  ).toBe(true);
  expect((await request(key.token, "/contacts")).status).toBe(403);
  const lookup = vi.spyOn(runtime.contacts, "details");
  expect((await request(key.token, `/contacts/${body.email}`)).status).toBe(
    403,
  );
  expect(lookup).not.toHaveBeenCalled();
  lookup.mockRestore();
  const sending = await runtime.service.createKey("No contact access");
  expect(
    (
      await request(sending.token, "/contacts", "POST", {
        ...body,
        caller: {
          kind: "session",
          userId: "owner",
          scopes: ["contacts:create"],
        },
      })
    ).status,
  ).toBe(403);
});

it("checks current permissions before replaying a completed mutation receipt", async () => {
  const key = await runtime.service.createKey(
    "Mutable permission",
    "scoped",
    undefined,
    ["contacts:create"],
  );
  const body = { email: `${randomUUID()}@example.com` },
    receipt = randomUUID();
  const first = await request(key.token, "/contacts", "POST", body, receipt);
  expect(first.status).toBe(201);
  const replay = await request(key.token, "/contacts", "POST", body, receipt);
  expect(replay.status).toBe(201);
  expect(replay.headers.get("idempotency-replayed")).toBe("true");
  await runtime.store.patch(`KEY#${hash(key.token)}`, {
    scopes: ["contacts:read"],
  });
  const denied = await request(key.token, "/contacts", "POST", body, receipt);
  expect(denied.status).toBe(403);
  expect(denied.headers.get("idempotency-replayed")).toBeNull();
  await runtime.store.patch(`KEY#${hash(key.token)}`, { revoked: true });
  expect((await request(key.token, "/capabilities")).status).toBe(401);
});

it("enforces sender restrictions on writes and stored-message reads before disclosure", async () => {
  const key = await runtime.service.createKey(
    "Domain",
    "sending",
    "narada.test",
  );
  const body = {
    from: "hello@narada.test",
    to: "recipient@example.com",
    subject: "Authorization",
    text: "Test",
  };
  const response = await request(key.token, "/emails", "POST", body);
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({
    id: expect.any(String),
    replayed: false,
  });
  const client = new Narada({
    apiKey: key.token,
    baseUrl: "http://localhost:5173",
    fetch: async (url, init) => app.request(new Request(url, init)),
  });
  const accepted = await approvedOperation(runtime, client, {
    operation: "emails.send",
    input: { body },
  });
  expect((await request(key.token, `/emails/${accepted.id}`)).status).toBe(200);
  expect(
    (
      await request(key.token, "/emails", "POST", {
        ...body,
        from: "hello@other.test",
      })
    ).status,
  ).toBe(403);
  const stored = await runtime.store.get(`MSG#${accepted.id}`);
  await runtime.store.put({
    ...stored!,
    pk: "MSG#other",
    id: "other",
    input: { ...body, from: "hello@other.test", to: [body.to] },
  });
  const denied = await request(key.token, "/emails/other");
  expect(denied.status).toBe(403);
  expect(await denied.text()).not.toContain(body.subject);
});

it("requires both legacy source and destination permissions and denies unknown operations even for full keys", async () => {
  const read = await runtime.service.createKey(
    "Templates",
    "scoped",
    undefined,
    ["templates:read"],
  );
  const both = await runtime.service.createKey(
    "Templates and drafts",
    "scoped",
    undefined,
    ["templates:read", "broadcasts:write"],
  );
  expect(
    (await request(read.token, "/templates/missing/broadcasts", "POST", {}))
      .status,
  ).toBe(403);
  expect(
    (await request(both.token, "/templates/missing/broadcasts", "POST", {}))
      .status,
  ).toBe(404);
  const full = await runtime.service.createKey("Legacy full", "full");
  expect(
    (await request(full.token, "/future-operation", "POST", {})).status,
  ).toBe(404);
  expect(unregistered).not.toHaveBeenCalled();
  expect((await request(full.token, "/contacts")).status).toBe(200);
});
