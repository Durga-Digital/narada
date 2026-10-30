import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { Narada } from "../../packages/sdk/src/index.js";
import { scopes } from "@narada/contracts/scopes";
import { operationSchemas } from "@narada/contracts/discovery";
import { z } from "zod";
import { emailInput, type Message } from "@narada/core/model";
const prefix = `narada-send-approvals-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`,
  origin = "http://localhost:5173";
let r: Awaited<ReturnType<typeof initialize>>,
  app: ReturnType<typeof createApp>,
  cookie: string,
  sdk: Narada,
  token: string;
const admin = (id: string, action = "", body?: unknown) =>
  app.request(
    `${origin}/api/admin/approvals/${id}${action ? `/${action}` : ""}`,
    {
      method: body ? "POST" : "GET",
      headers: { cookie, origin, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
const client = (key: string, lose = false) =>
  new Narada({
    apiKey: key,
    baseUrl: origin,
    fetch: async (input, init) => {
      const response = await app.request(new Request(input, init));
      if (
        lose &&
        response.ok &&
        init?.method === "POST" &&
        String(input).endsWith("/approvals")
      ) {
        lose = false;
        await response.arrayBuffer();
        throw new Error("Lost review response");
      }
      return response;
    },
  });
beforeAll(async () => {
  vi.stubEnv("APP_TABLE", `${prefix}-app`);
  vi.stubEnv("AUTH_TABLE", `${prefix}-auth`);
  vi.stubEnv("BETTER_AUTH_URL", origin);
  r = await initialize(credentials);
  app = createApp(r);
  token = (
    await r.service.createKey(
      "Approval SDK fixture",
      "operations",
      undefined,
      undefined,
      undefined,
      { scopes, resources: {} },
    )
  ).token;
  sdk = client(token);
  const login = await app.request(`${origin}/api/auth/sign-in/email`, {
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
  vi.unstubAllEnvs();
});
async function fixture() {
  const template = await sdk.templates.create({
    alias: `review-${randomUUID().slice(0, 8)}`,
    name: "SDK review",
    kind: "transactional",
    subject: "SDK review subject",
    text: "Sensitive owner preview",
    variables: [],
  });
  return {
    operation: "templates.test" as const,
    input: {
      params: { id: template.id },
      body: { from: "hello@narada.test", to: `${randomUUID()}@example.com` },
    },
  };
}
it("recovers SDK approval creation after a lost response, exposes metadata only, and accepts once", async () => {
  const input = await fixture(),
    options = { idempotencyKey: randomUUID() },
    lost = client(token, true);
  await expect(lost.approvals.request(input, options)).rejects.toThrow(
    "Lost review response",
  );
  const approval = await lost.approvals.request(input, options);
  z.fromJSONSchema(operationSchemas["approvals.request"].output).parse(
    approval,
  );
  expect(await sdk.approvals.request(input, options)).toEqual(approval);
  expect(await sdk.approvals.get(approval.id)).toEqual(approval);
  expect((await sdk.approvals.list()).data.map((a) => a.id)).toContain(
    approval.id,
  );
  const review = await (await admin(approval.id)).json();
  expect(review.text).toBe("Sensitive owner preview");
  expect(JSON.stringify(approval)).not.toContain(review.text);
  const response = await admin(approval.id, "approve", {
    digest: review.digest,
  });
  const completed = await response.json();
  expect(response.status, JSON.stringify(completed)).toBe(200);
  expect(completed.status).toBe("succeeded");
  expect((await sdk.approvals.get(approval.id)).operationId).toBeTruthy();
  expect(
    await (
      await admin(approval.id, "approve", { digest: review.digest })
    ).json(),
  ).toEqual(completed);
});
it("checks target permissions and current key revocation, without permitting public approval", async () => {
  const input = await fixture();
  const limited = client(
    (
      await r.service.createKey(
        "Review metadata only",
        "operations",
        undefined,
        undefined,
        undefined,
        {
          scopes: ["narada:approvals:request", "narada:approvals:read"],
          resources: {},
        },
      )
    ).token,
  );
  await expect(limited.approvals.request(input)).rejects.toMatchObject({
    status: 403,
  });
  const key = await r.service.createKey(
      "Revoked review",
      "operations",
      undefined,
      undefined,
      undefined,
      { scopes, resources: {} },
    ),
    scoped = client(key.token);
  const approval = await scoped.approvals.request(input),
    review = await (await admin(approval.id)).json();
  const publicDecision = await app.request(
    `${origin}/api/v1/approvals/${approval.id}/approve`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ digest: review.digest }),
    },
  );
  expect(publicDecision.ok).toBe(false);
  const record = await r.service.authenticate(key.token);
  await r.store.patch(record.pk, { revoked: true });
  expect(
    (await admin(approval.id, "approve", { digest: review.digest })).status,
  ).toBe(401);
});
it("retains single-use protection beyond the result receipt replay window", async () => {
  const approval = await sdk.approvals.request(await fixture()),
    review = await (await admin(approval.id)).json();
  expect(
    (await admin(approval.id, "approve", { digest: review.digest })).status,
  ).toBe(200);
  const { mutationReceiptKey } = await import("@narada/core/idempotency");
  await r.store.remove(
    mutationReceiptKey(
      `send-approval:${approval.id}`,
      approval.operation,
      approval.id,
    ),
  );
  const accept = vi.spyOn(r.service, "accept");
  try {
    const response = await admin(approval.id, "approve", {
      digest: review.digest,
    });
    expect((await response.json()).status).toBe("succeeded");
    expect(accept).not.toHaveBeenCalled();
  } finally {
    accept.mockRestore();
  }
});
it("recovers an approval transaction whose database acknowledgement was lost", async () => {
  const approval = await sdk.approvals.request(await fixture()),
    review = await (await admin(approval.id)).json(),
    original = r.store.transaction.bind(r.store);
  let lost = false;
  const transaction = vi
    .spyOn(r.store, "transaction")
    .mockImplementation(async (items) => {
      const result = await original(items);
      if (
        !lost &&
        items.some(
          (item) =>
            item.Put?.Item?.pk === `SENDAPPROVAL#${approval.id}` &&
            item.Put.Item.status === "succeeded",
        )
      ) {
        lost = true;
        throw new Error("Lost database acknowledgement");
      }
      return result;
    });
  try {
    const response = await admin(approval.id, "approve", {
      digest: review.digest,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("succeeded");
    expect((await sdk.approvals.get(approval.id)).status).toBe("succeeded");
  } finally {
    transaction.mockRestore();
  }
});

it("fences an interrupted approval with an uncertain outcome against re-execution", async () => {
  const approval = await sdk.approvals.request(await fixture());
  const review = await (await admin(approval.id)).json();
  const { MutationReceipt, mutationReceiptKey } =
    await import("@narada/core/idempotency");
  await MutationReceipt.acquire(
    r.store,
    `send-approval:${approval.id}`,
    approval.operation,
    approval.id,
    { digest: review.digest },
  );
  await r.store.patch(
    mutationReceiptKey(
      `send-approval:${approval.id}`,
      approval.operation,
      approval.id,
    ),
    { busyUntil: 0 },
  );
  const accept = vi.spyOn(r.service, "accept");
  try {
    expect((await sdk.approvals.get(approval.id)).status).toBe("unknown");
    const response = await admin(approval.id, "approve", {
      digest: review.digest,
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("uncertain");
    expect(accept).not.toHaveBeenCalled();
  } finally {
    accept.mockRestore();
  }
});

it("sends automatically with every API key type, retains optional reviews and preserves sender restrictions", async () => {
  const keys = [
    await r.service.createKey("Default sending"),
    await r.service.createKey("Full", "full"),
    await r.service.createKey("Scoped", "scoped", undefined, ["emails:send"]),
    await r.service.createKey("Domain sending", "sending", "narada.test"),
    await r.service.createKey(
      "Operations",
      "operations",
      undefined,
      undefined,
      undefined,
      { scopes, resources: {} },
    ),
  ];
  for (const key of keys) {
    const api = client(key.token),
      body = {
        from: "hello@narada.test",
        to: `${randomUUID()}@example.com`,
        subject: "Human decision required",
        text: "Private exact content",
        priority: "high" as const,
        tags: { source: "agent" },
        expires_in: 600,
      };
    const options = { idempotencyKey: randomUUID() };
    const sent = await api.emails.send(body, options);
    expect(sent).toMatchObject({ id: expect.any(String), replayed: false });
    expect(await api.emails.send(body, options)).toEqual({
      ...sent,
      replayed: true,
    });
    await expect(
      api.emails.send({ ...body, subject: "Different" }, options),
    ).rejects.toMatchObject({ status: 409 });
    const pending = await api.approvals.request({
      operation: "emails.send",
      input: { body },
    });
    const review = await (await admin(pending.id)).json();
    expect(review).toMatchObject({
      recipients: [body.to],
      priority: "high",
      tags: body.tags,
      expiresInSeconds: 600,
      text: body.text,
    });
    const forged = await app.request(
      `${origin}/api/admin/approvals/${pending.id}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.token}`,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ digest: review.digest }),
      },
    );
    expect(forged.status).toBe(401);
    const accepted = await (
      await admin(pending.id, "approve", { digest: review.digest })
    ).json();
    expect(accepted.status).toBe("succeeded");
    expect(accepted.messageId).toBeTruthy();
    expect(await api.approvals.get(pending.id)).toEqual(accepted);
    expect(await api.emails.get(accepted.messageId)).toMatchObject({
      status: "queued",
      tags: body.tags,
      priority: "high",
    });
    expect(
      await (
        await admin(pending.id, "approve", { digest: review.digest })
      ).json(),
    ).toEqual(accepted);
    await r.store.patch((await r.service.authenticate(key.token)).pk, {
      revoked: true,
    });
    await expect(api.emails.send(body, options)).rejects.toMatchObject({
      status: 401,
    });
  }
  await expect(
    client(
      (await r.service.createKey("Restricted active", "sending", "narada.test"))
        .token,
    ).approvals.request({
      operation: "emails.send",
      input: {
        body: {
          from: "hello@other.test",
          to: "reader@example.com",
          subject: "Denied",
          text: "Denied",
        },
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  const readOnly = await r.service.createKey(
    "Contacts only",
    "scoped",
    undefined,
    ["contacts:read"],
  );
  await expect(
    client(readOnly.token).approvals.request({
      operation: "emails.send",
      input: {
        body: {
          from: "hello@narada.test",
          to: "reader@example.com",
          subject: "Denied",
          text: "Denied",
        },
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
});

it("allows direct SDK test sends and still binds voluntary reviews to exact template output", async () => {
  const key = await r.service.createKey("Full agent", "full"),
    api = client(key.token);
  const template = await api.templates.create({
    alias: `tx-${randomUUID()}`,
    name: "Transactional",
    kind: "transactional",
    subject: "Version one",
    text: "Exact first version",
    variables: [],
  });
  const published = await api.templates.publish(template.id, {
    revision: template.revision,
  });
  await expect(
    api.templates.test(template.id, {
      from: "hello@narada.test",
      to: "reader@example.com",
    }),
  ).resolves.toMatchObject({ id: expect.any(String) });
  const request = {
    operation: "emails.send" as const,
    input: {
      body: {
        from: "hello@narada.test",
        to: "reader@example.com",
        template: { id: template.id },
      },
    },
  };
  const pending = await api.approvals.request(request),
    review = await (await admin(pending.id)).json();
  const changed = await api.templates.update(template.id, {
    revision: published.revision,
    draft: { ...published.draft, subject: "Version two" },
  });
  await api.templates.publish(template.id, { revision: changed.revision });
  expect(
    (await admin(pending.id, "approve", { digest: review.digest })).status,
  ).toBe(409);
  expect((await api.approvals.get(pending.id)).status).toBe("pending");
});

it("recovers existing project email receipts and a lost API response without approval or duplicate acceptance", async () => {
  const key = await r.service.createKey(
    "Existing application",
    "sending",
    "narada.test",
  );
  const storedKey = await r.service.authenticate(key.token);
  const { permission, ...legacyKey } = storedKey;
  await r.store.put(legacyKey); // Pre-permission-schema keys remain supported.
  const body = {
    from: "hello@narada.test",
    to: `${randomUUID()}@example.com`,
    subject: "Sign in",
    text: "https://app.example/auth/callback?token_hash=synthetic-test-token",
    expires_in: 120,
  };
  const retryKey = randomUUID();
  const old = await r.service.accept(
    emailInput.parse(body),
    "default",
    retryKey,
  );
  expect(
    await client(key.token).emails.send(body, { idempotencyKey: retryKey }),
  ).toEqual({ ...old, replayed: true });
  let dropped = false;
  const recovering = new Narada({
    apiKey: key.token,
    baseUrl: origin,
    fetch: async (url, init) => {
      const response = await app.request(new Request(url, init));
      if (!dropped && response.ok) {
        dropped = true;
        await response.arrayBuffer();
        throw new TypeError("Lost send response");
      }
      return response;
    },
  });
  const options = { idempotencyKey: randomUUID() };
  await expect(recovering.emails.send(body, options)).rejects.toThrow(
    "Lost send response",
  );
  const retries = await Promise.all([
    recovering.emails.send(body, options),
    recovering.emails.send(body, options),
  ]);
  expect(retries[0]).toEqual(retries[1]);
  expect(retries[0]).toMatchObject({ id: expect.any(String), replayed: true });
  const messages = (
    await r.store.list<Message>("messages#default", 1000)
  ).filter((row) => row.input.to.includes(body.to));
  expect(messages.map((row) => row.id).sort()).toEqual(
    [old.id, retries[0]!.id].sort(),
  );
  await r.store.patch(storedKey.pk, { revoked: true });
  await expect(recovering.emails.send(body, options)).rejects.toMatchObject({
    status: 401,
  });
});
