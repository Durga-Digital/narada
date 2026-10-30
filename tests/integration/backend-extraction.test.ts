import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Application, apiKeyCaller } from "@narada/core";
import { SharedOperations } from "@narada/core/shared-operations";
import { activityContext } from "@narada/core/activity";
import { MutationReceipt } from "@narada/core/idempotency";
import { createPublicApi } from "@narada/http-api";
import { initialize } from "../../scripts/local.js";
import { Narada } from "../../packages/sdk/src/index.js";
import { operationSchemas } from "@narada/contracts/discovery";
import { z } from "zod";
let runtime: Awaited<ReturnType<typeof initialize>>,
  server: ServerType,
  url: string,
  token: string;
const prefix = process.env.NARADA_TEST_PREFIX!;
beforeAll(async () => {
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(`.local/${prefix}-owner.json`);
  token = (
    await runtime.service.createKey(
      "Standalone client",
      "operations",
      undefined,
      undefined,
      undefined,
      {
        scopes: [
          "narada:contacts:create",
          "narada:contacts:read",
          "narada:operations:read",
        ],
        resources: {},
      },
    )
  ).token;
  // Fail immediately if constructing or serving REST touches owner/OAuth auth.
  Object.defineProperty(runtime, "auth", {
    get() {
      throw new Error("REST initialized session authentication");
    },
  });
  server = serve({
    fetch: createPublicApi(runtime).fetch,
    port: 0,
    hostname: "127.0.0.1",
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});
const sdk = () => new Narada({ apiKey: token, baseUrl: url });
it("serves the SDK over HTTP without owner endpoints or session authentication", async () => {
  const created = await sdk().contacts.create(
    { email: `${randomUUID()}@example.com` },
    { idempotencyKey: randomUUID() },
  );
  expect(
    z
      .fromJSONSchema(operationSchemas["contacts.create"].output)
      .safeParse(created).success,
  ).toBe(true);
  expect((await sdk().contacts.get(created.email)).contact).toEqual(created);
  expect((await fetch(`${url}/api/health`)).status).toBe(200);
  for (const path of [
    "/api/admin/keys",
    "/api/auth/get-session",
    "/api/mcp",
    "/oauth/consent",
    "/n/private",
  ])
    expect((await fetch(url + path)).status).toBe(404);
  expect((await fetch(`${url}/api/v1/contacts`)).status).toBe(401);
});
it("shares typed in-process and REST receipts without performing a second mutation", async () => {
  const caller = apiKeyCaller(await runtime.service.authenticate(token));
  const application = new Application(runtime);
  const input = { email: `${randomUUID()}@example.com`, name: "Shared result" };
  const idempotencyKey = randomUUID();
  const first = await application.execute(
    caller,
    "contacts.create",
    { body: input },
    { idempotencyKey },
  );
  const replay = await sdk().contacts.create(input, { idempotencyKey });
  expect(replay).toEqual(first.value);
  const status = await sdk().operations.lookup({
    operation: "contacts.create",
    idempotencyKey,
  });
  expect(status.id).toBe(first.operationId);
  const again = await application.execute(
    caller,
    "contacts.create",
    { body: input },
    { idempotencyKey },
  );
  expect(again.replayed).toBe(true);
  await expect(
    sdk().contacts.create({ ...input, name: "Changed" }, { idempotencyKey }),
  ).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
});
it("replays receipts written before extraction and rechecks current permissions", async () => {
  const record = await runtime.service.authenticate(token);
  const caller = apiKeyCaller(record);
  const input = { email: `${randomUUID()}@example.com` };
  const key = randomUUID();
  const prepared = await new SharedOperations(runtime).prepare(
    caller,
    "contacts.create",
    { body: input },
  );
  const acquired = await MutationReceipt.acquire(
    runtime.store,
    `key:${record.id}`,
    "POST /api/v1/contacts",
    key,
    { body: input, query: "" },
    activityContext(
      caller,
      runtime.config.BETTER_AUTH_URL,
      "contacts.create",
      randomUUID(),
      prepared.activity,
    ),
  );
  if (!("receipt" in acquired)) throw new Error("Expected new legacy receipt");
  const receipt = acquired.receipt;
  const saved = await receipt.run(() =>
    prepared.run(async (writes, value) => {
      await receipt.commit(writes, {
        body: JSON.stringify(value),
        status: 201,
        contentType: "application/json",
      });
      return value;
    }),
  );
  const create = vi.spyOn(runtime.contacts, "createContact");
  try {
    expect(await sdk().contacts.create(input, { idempotencyKey: key })).toEqual(
      saved,
    );
    expect(create).not.toHaveBeenCalled();
    await runtime.store.patch(record.pk, {
      operationAccess: { scopes: ["narada:contacts:read"], resources: {} },
    });
    await expect(
      sdk().contacts.create(input, { idempotencyKey: key }),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    create.mockRestore();
    await runtime.store.patch(record.pk, {
      operationAccess: record.operationAccess,
    });
  }
});
