import { beforeAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { EmailService } from "@narada/core/service";
import { createRateLimitStorage } from "@narada/core/rate-limit";
import {
  emailInput,
  type Message,
  type DeliveryEvent,
} from "@narada/core/model";
import type { Runtime } from "@narada/core/runtime";
let r: Runtime;
const send = vi.fn(async () => ({ id: "provider-id", captured: true }));
let service: EmailService;
const input = () =>
  emailInput.parse({
    from: "hello@narada.test",
    to: `${randomUUID()}@example.com`,
    subject: "Integration",
    text: "Hello",
  });
beforeAll(async () => {
  process.env.APP_TABLE = `${process.env.NARADA_TEST_PREFIX}-app`;
  process.env.AUTH_TABLE = `${process.env.NARADA_TEST_PREFIX}-auth`;
  r = await initialize(`.local/${process.env.NARADA_TEST_PREFIX}-owner.json`);
  service = new EmailService(r.config, r.store, r.queues, { send });
});
describe("DynamoDB-backed delivery guarantees", () => {
  it("atomically limits concurrent requests without a table scan", async () => {
    const limiter = createRateLimitStorage(r.store);
    const key = randomUUID();
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.consume(key, { window: 60, max: 3 }),
      ),
    );
    expect(outcomes.filter((r) => r.allowed)).toHaveLength(3);
    expect(
      outcomes.filter((r) => !r.allowed).every((r) => Number(r.retryAfter) > 0),
    ).toBe(true);
  });
  it("concurrent idempotency accepts exactly one durable message", async () => {
    const body = input(),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.accept(body, "default", key)),
    );
    expect(new Set(results.map((x) => x.id)).size).toBe(1);
    await expect(
      service.accept({ ...body, subject: "Different" }, "default", key),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("concurrent worker claims submit once", async () => {
    send.mockClear();
    const msg = await service.accept(input(), "default");
    await Promise.all(Array.from({ length: 8 }, () => service.send(msg.id)));
    expect(send).toHaveBeenCalledTimes(1);
    expect((await r.store.get<Message>(`MSG#${msg.id}`))?.status).toBe(
      "captured",
    );
  });
  it("does not retry uncertain provider acceptance", async () => {
    const msg = await service.accept(input(), "default");
    const uncertain = vi.fn(async () => {
      throw new Error("socket closed after upload");
    });
    const svc = new EmailService(r.config, r.store, r.queues, {
      send: uncertain,
    });
    await svc.send(msg.id);
    await svc.send(msg.id);
    expect(uncertain).toHaveBeenCalledTimes(1);
    expect((await r.store.get<Message>(`MSG#${msg.id}`))?.status).toBe(
      "unknown",
    );
  });
  it("retries explicit throttling but expires stale messages", async () => {
    const msg = await service.accept(input(), "default");
    const svc = new EmailService(r.config, r.store, r.queues, {
      send: async () => {
        throw Object.assign(new Error("throttled"), {
          name: "TooManyRequestsException",
        });
      },
    });
    await svc.send(msg.id);
    expect((await r.store.get<Message>(`MSG#${msg.id}`))?.status).toBe(
      "queued",
    );
    await r.store.patch(`MSG#${msg.id}`, { expiresAt: Date.now() - 1 });
    await service.send(msg.id);
    expect((await r.store.get<Message>(`MSG#${msg.id}`))?.status).toBe(
      "expired",
    );
  });
  it("deduplicates feedback, preserves terminal status, suppresses hard bounces", async () => {
    const body = input(),
      msg = await service.accept(body, "default");
    const event: DeliveryEvent = {
      id: randomUUID(),
      type: "bounced",
      permanent: true,
      at: new Date().toISOString(),
      recipients: body.to,
    };
    await Promise.all([
      service.event(msg.id, event),
      service.event(msg.id, event),
    ]);
    await service.event(msg.id, {
      ...event,
      id: randomUUID(),
      type: "delivered",
    });
    const saved = await r.store.get<Message>(`MSG#${msg.id}`);
    expect(saved?.events).toHaveLength(2);
    expect(saved?.status).toBe("bounced");
    await expect(service.accept(body, "default")).rejects.toMatchObject({
      status: 422,
    });
  });
  it("rechecks suppression after enqueue and before provider submission", async () => {
    const body = input(),
      msg = await service.accept(body, "default");
    await r.store.put({ pk: `SUPPRESS#${body.to[0]}`, sk: "META" });
    send.mockClear();
    await service.send(msg.id);
    expect(send).not.toHaveBeenCalled();
    expect((await r.store.get<Message>(`MSG#${msg.id}`))?.status).toBe(
      "failed",
    );
  });
  it("rejects revoked keys", async () => {
    const key = await service.createKey("Integration");
    const saved = await service.authenticate(key.token);
    await r.store.patch(saved.pk, { revoked: true });
    await expect(service.authenticate(key.token)).rejects.toMatchObject({
      status: 401,
    });
  });
});
