import { beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { EmailService } from "@narada/core/service";
import { emailInput, type EmailInput, type Message } from "@narada/core/model";

let runtime: Awaited<ReturnType<typeof initialize>>;
let app: ReturnType<typeof createApp>;
let cookie: string;
const origin = "http://localhost:5173";
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

it("keeps old and queued email content out of delivery-log APIs while preserving worker delivery", async () => {
  const credential = `private-auth-${randomUUID()}`;
  const body = emailInput.parse({
    from: "Narada <hello@narada.test>",
    to: `${randomUUID()}@example.com`,
    subject: "Sign in",
    reply_to: "support@narada.test",
    text: `Sign in: https://example.com/auth?token=${credential}. Code: 123456`,
    html: `<a href="https://example.com/auth?token=${credential}">Sign in</a>`,
  });
  const send = vi.fn(async (_input: EmailInput) => ({
    id: "provider-private-test",
    captured: true,
  }));
  const service = new EmailService(
    runtime.config,
    runtime.store,
    runtime.queues,
    { send },
  );
  const { id } = await service.accept(body, "default");
  const path = `/api/admin/messages/${id}`;
  expect((await app.request(`${origin}${path}`)).status).toBe(401);
  // Model a historical record with secrets in additional internal and diagnostic fields.
  await runtime.store.patch(`MSG#${id}`, {
    internalPayload: { token: credential },
    broadcast: { unsubscribeUrl: `https://example.com/${credential}` },
    error: `provider echoed ${credential}`,
    events: [
      {
        id: "feedback",
        type: "delivered",
        at: new Date().toISOString(),
        recipients: body.to,
        reason: credential,
        raw: { body: credential },
      },
    ],
  });
  // Remove the synthetic broadcast before sending, since this is a transactional email.
  const stored = (await runtime.store.get<Message>(`MSG#${id}`))!;
  const key = await service.createKey("Privacy test", "sending", "narada.test");
  for (const url of [path, "/api/admin/overview", `/api/v1/emails/${id}`]) {
    const response = await app.request(`${origin}${url}`, {
      headers: { cookie, authorization: `Bearer ${key.token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(credential);
    expect(text).not.toContain("123456");
    const result = JSON.parse(text);
    if (url === path) {
      expect(result.input).toEqual({
        from: body.from,
        to: body.to,
        subject: body.subject,
        reply_to: body.reply_to,
        priority: "normal",
      });
      expect(result).not.toHaveProperty("pk");
      expect(result).not.toHaveProperty("broadcast");
      expect(result).not.toHaveProperty("internalPayload");
      expect(result.events[0]).not.toHaveProperty("reason");
      expect(result.events[0]).not.toHaveProperty("raw");
    }
  }
  delete stored.broadcast;
  stored.events = [];
  await runtime.store.put(stored);
  await service.send(id);
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[0]).toEqual(body);
  const response = await app.request(`${origin}${path}`, {
    headers: { cookie },
  });
  const log = await response.json();
  expect(log).toMatchObject({
    status: "captured",
    attempts: 1,
    providerId: "provider-private-test",
  });
  expect(JSON.stringify(log)).not.toContain(credential);
  expect(log.input).not.toHaveProperty("text");
  expect(log.input).not.toHaveProperty("html");
  // A known error code remains useful without returning arbitrary diagnostic text.
  await runtime.store.patch(`MSG#${id}`, { error: "MessageRejected" });
  expect(
    await (
      await app.request(`${origin}${path}`, { headers: { cookie } })
    ).json(),
  ).toMatchObject({ error: "MessageRejected" });
});
