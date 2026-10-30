import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { emailInput } from "@narada/core/model";
import { putWithEvent } from "@narada/core/event-outbox";
let runtime: Awaited<ReturnType<typeof initialize>>;
let app: ReturnType<typeof createApp>;
let cookie = "";
const origin = "http://localhost:5173";
const prefix =
  process.env.NARADA_TEST_PREFIX ??
  `narada-lifecycle-${randomUUID().slice(0, 8)}`;
const credentials = `.local/${prefix}-owner.json`;
afterAll(async () => {
  // Explicit prefixes may be shared by a broader test run; only remove this suite's fixtures.
  if (!process.env.NARADA_TEST_PREFIX && runtime) {
    for (const TableName of [
      runtime.config.APP_TABLE,
      runtime.config.AUTH_TABLE,
    ])
      await runtime.store.client.send(new DeleteTableCommand({ TableName }));
    await rm(credentials, { force: true });
  }
});
function call(
  path: string,
  method = "GET",
  body?: unknown,
  session = cookie,
  source = origin,
) {
  return app.request(`${origin}/api/admin/${path}`, {
    method,
    headers: {
      cookie: session,
      origin: source,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeAll(async () => {
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(credentials);
  app = createApp(runtime);
  const owner = JSON.parse(await readFile(credentials, "utf8"));
  const response = await app.request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(owner),
  });
  expect(response.status).toBe(200);
  cookie = response.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
});
it("requires authentication, exact confirmation, and revocation before permanent key deletion", async () => {
  const key = await runtime.service.createKey(`Remove ${randomUUID()}`);
  const path = `keys/${key.id}`;
  expect(
    (await call(path, "DELETE", { confirmation: key.name }, "")).status,
  ).toBe(401);
  expect(
    (
      await call(
        path,
        "DELETE",
        { confirmation: key.name },
        cookie,
        "https://foreign.example",
      )
    ).status,
  ).toBe(403);
  expect((await call(path, "DELETE", { confirmation: "wrong" })).status).toBe(
    400,
  );
  expect((await call(path, "DELETE", { confirmation: key.name })).status).toBe(
    409,
  );
  expect(
    (await call(`${path}/revoke`, "POST", { confirmation: "wrong" })).status,
  ).toBe(400);
  expect(
    (await call(`${path}/revoke`, "POST", { confirmation: key.name })).status,
  ).toBe(200);
  await expect(runtime.service.authenticate(key.token)).rejects.toMatchObject({
    status: 401,
  });
  expect((await call(path, "DELETE", { confirmation: key.name })).status).toBe(
    200,
  );
  await expect(runtime.service.authenticate(key.token)).rejects.toMatchObject({
    status: 401,
  });
});
it("removes domains safely, rejects stale verification, fails queued sends and allows deliberate re-addition", async () => {
  const name = `remove-${randomUUID()}.example.com`,
    path = `domains/${name}`;
  const response = await call("domains", "POST", { name });
  expect(response.status).toBe(201);
  const original = await response.json();
  const input = emailInput.parse({
    from: `hello@${name}`,
    to: `${randomUUID()}@example.com`,
    subject: "Queued",
    text: "Before removal",
  });
  const message = await runtime.service.accept(input, "default");
  const delayed = await runtime.service.accept(input, "default");
  expect((await call(path, "DELETE", { confirmation: "wrong" })).status).toBe(
    400,
  );
  expect((await runtime.store.get(`DOMAIN#${name}`))?.verified).toBe(true);
  expect((await call(path, "DELETE", { confirmation: name })).status).toBe(200);
  expect(
    (await (await call("domains")).json()).some(
      (d: { name: string }) => d.name === name,
    ),
  ).toBe(false);
  expect((await call(`${path}/verify`, "POST", {})).status).toBe(404);
  await expect(
    putWithEvent(
      runtime.store,
      original,
      "domain.updated",
      { name },
      { activeDomain: true },
    ),
  ).rejects.toThrow();
  await expect(runtime.service.accept(input, "default")).rejects.toMatchObject({
    status: 422,
  });
  await expect(
    runtime.service.createKey("Blocked", "sending", name),
  ).rejects.toMatchObject({ status: 422 });
  const send = vi.spyOn(runtime.service.transport, "send");
  await runtime.service.send(message.id);
  expect(send).not.toHaveBeenCalled();
  expect((await runtime.store.get(`MSG#${message.id}`))?.status).toBe("failed");
  expect((await call("domains", "POST", { name })).status).toBe(201);
  expect(
    (await runtime.store.get(`DOMAIN#${name}`))?.removedAt,
  ).toBeUndefined();
  expect((await runtime.store.get(`MSG#${message.id}`))?.status).toBe("failed");
  await runtime.service.send(delayed.id);
  expect((await runtime.store.get(`MSG#${delayed.id}`))?.status).toBe("failed");
  expect(send).not.toHaveBeenCalled();
  send.mockRestore();
});

it("saves local authentication previews, validates configuration and queues a domain test", async () => {
  const name = `auth-${randomUUID()}.example.com`,
    path = `domains/${name}`;
  const created = await (await call("domains", "POST", { name })).json();
  expect(created.authentication.dmarc.status).toBe("local");
  expect(
    (
      await call(`${path}/mail-from`, "PUT", {
        domain: "bounce.other.com",
        behavior: "REJECT_MESSAGE",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        `${path}/mail-from`,
        "PUT",
        { domain: `bounce.${name}`, behavior: "REJECT_MESSAGE" },
        "",
      )
    ).status,
  ).toBe(401);
  const configured = await call(`${path}/mail-from`, "PUT", {
    domain: `bounce.${name}`,
    behavior: "REJECT_MESSAGE",
  });
  expect(configured.status).toBe(200);
  expect((await configured.json()).authentication.mailFrom).toMatchObject({
    domain: `bounce.${name}`,
    status: "LOCAL",
    behavior: "REJECT_MESSAGE",
  });
  const checked = await (await call(`${path}/verify`, "POST", {})).json();
  expect(checked.authentication.mailFrom.domain).toBe(`bounce.${name}`);
  expect(checked).not.toHaveProperty("registrationId");
  expect((await runtime.store.get(`DOMAIN#${name}`))?.registrationId).toBe(
    created.registrationId,
  );
  expect((await call(`${path}/dkim`, "POST", {})).status).toBe(200);
  const sent = await call(`${path}/test`, "POST", {
    to: `${randomUUID()}@example.com`,
    localPart: "notifications",
  });
  expect(sent.status).toBe(202);
  const { id } = await sent.json();
  expect((await runtime.store.get(`MSG#${id}`))?.input).toMatchObject({
    from: `Narada <notifications@${name}>`,
  });
  const reset = await call(`${path}/mail-from`, "PUT", {
    domain: null,
    behavior: "USE_DEFAULT_VALUE",
  });
  expect((await reset.json()).authentication.mailFrom.domain).toBeNull();
  await call(path, "DELETE", { confirmation: name });
  expect(
    (
      await call(`${path}/mail-from`, "PUT", {
        domain: `bounce.${name}`,
        behavior: "USE_DEFAULT_VALUE",
      })
    ).status,
  ).toBe(404);
  expect(
    (await call(`${path}/test`, "POST", { to: "owner@example.com" })).status,
  ).toBe(404);
});
