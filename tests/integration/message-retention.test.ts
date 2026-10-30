import { beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { EmailService } from "@narada/core/service";
import { emailInput, type Message } from "@narada/core/model";
import { purgeCompletedMessageContent } from "@narada/core/message-retention";
import type { Transport } from "@narada/core/transport";

let r: Awaited<ReturnType<typeof initialize>>;
beforeAll(async () => {
  process.env.APP_TABLE = `${process.env.NARADA_TEST_PREFIX}-app`;
  process.env.AUTH_TABLE = `${process.env.NARADA_TEST_PREFIX}-auth`;
  r = await initialize(`.local/${process.env.NARADA_TEST_PREFIX}-owner.json`);
});
const body = () =>
  emailInput.parse({
    from: "hello@narada.test",
    to: `${randomUUID()}@example.com`,
    subject: "Sign in",
    text: "Secret code 123456",
    html: '<a href="https://example.com/?token=secret">Sign in</a>',
  });
const service = (send: Transport["send"]) =>
  new EmailService(r.config, r.store, r.queues, { send });
async function saved(id: string) {
  return (await r.store.get<Message>(`MSG#${id}`))!;
}
function expectPurged(msg: Message) {
  expect(msg.input).not.toHaveProperty("html");
  expect(msg.input).not.toHaveProperty("text");
  expect(msg.contentPurgedAt).toEqual(expect.any(String));
  expect(msg.input.subject).toBe("Sign in");
}

it.each([false, true])(
  "purges accepted content (local capture: %s), retaining metadata and idempotency",
  async (captured) => {
    const send = vi.fn(async () => ({ id: "provider", captured }));
    const svc = service(send),
      input = body(),
      key = randomUUID();
    const { id } = await svc.accept(input, "default", key);
    await svc.send(id);
    const msg = await saved(id);
    expectPurged(msg);
    expect(msg.status).toBe(captured ? "captured" : "sent");
    expect(msg.providerId).toBe("provider");
    expect(msg.input.to).toEqual(input.to);
    expect((await svc.accept(input, "default", key)).id).toBe(id);
    await svc.send(id);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]).toEqual([input, id, undefined]);
  },
);

it.each(["MessageRejected", "Error"])(
  "purges non-retryable outcomes: %s",
  async (name) => {
    const svc = service(async () => {
      throw Object.assign(new Error("private diagnostic"), { name });
    });
    const { id } = await svc.accept(body(), "default");
    await svc.send(id);
    expectPurged(await saved(id));
    expect((await saved(id)).status).toBe(
      name === "Error" ? "unknown" : "failed",
    );
  },
);

it("keeps throttled bodies for retry, then purges after acceptance or exhausted retries", async () => {
  const send = vi
    .fn<Transport["send"]>()
    .mockRejectedValueOnce(
      Object.assign(new Error("throttled"), {
        name: "TooManyRequestsException",
      }),
    )
    .mockResolvedValue({ id: "provider", captured: false });
  const svc = service(send),
    input = body();
  const { id } = await svc.accept(input, "default");
  await svc.send(id);
  expect((await saved(id)).input).toEqual(input);
  expect((await saved(id)).status).toBe("queued");
  await svc.send(id);
  expectPurged(await saved(id));
  expect(send.mock.calls[1]?.[0]).toEqual(input);
  const exhausted = await svc.accept(body(), "default");
  await r.store.patch(`MSG#${exhausted.id}`, { attempts: 5 });
  send.mockRejectedValueOnce(
    Object.assign(new Error("throttled"), { name: "TooManyRequestsException" }),
  );
  await svc.send(exhausted.id);
  expectPurged(await saved(exhausted.id));
});

it("purges expired messages even while sending is paused", async () => {
  const send = vi.fn(async () => ({ id: "provider", captured: false })),
    svc = service(send);
  const { id } = await svc.accept(body(), "default");
  await r.store.patch(`MSG#${id}`, { expiresAt: Date.now() - 1 });
  const settings = await r.store.get("SETTINGS");
  await r.store.put({ ...settings, pk: "SETTINGS", sk: "META", paused: true });
  try {
    await svc.send(id);
    expectPurged(await saved(id));
    expect((await saved(id)).status).toBe("expired");
    expect(send).not.toHaveBeenCalled();
  } finally {
    if (settings) await r.store.put(settings);
    else await r.store.remove("SETTINGS");
  }
});

it("purges abandoned worker submissions during dispatcher recovery", async () => {
  const svc = service(async () => ({ id: "provider", captured: false }));
  const { id } = await svc.accept(body(), "default");
  await r.store.patch(`MSG#${id}`, {
    status: "submitting",
    state: "submitting",
    due: 0,
  });
  await svc.dispatch();
  expectPurged(await saved(id));
  expect((await saved(id)).status).toBe("unknown");
});

it("early and subsequent feedback cannot restore content or unsubscribe tokens", async () => {
  const input = body();
  const svc = service(async (_input, id) => {
    // Simulate an attached per-recipient unsubscribe token and feedback racing submission.
    await r.store.patch(`MSG#${id}`, {
      broadcast: {
        broadcastId: "campaign",
        unsubscribeUrl: "https://example.com/?secret=token",
      },
    });
    await svc.event(id, {
      id: randomUUID(),
      type: "delivered",
      at: new Date().toISOString(),
      recipients: input.to,
    });
    expectPurged(await saved(id));
    return { id: "provider", captured: false };
  });
  const { id } = await svc.accept(input, "default");
  await svc.send(id);
  await svc.event(id, {
    id: randomUUID(),
    type: "delayed",
    at: new Date().toISOString(),
    recipients: input.to,
  });
  const msg = await saved(id);
  expectPurged(msg);
  expect(msg.status).toBe("delivered");
  expect(msg.broadcast).toEqual({ broadcastId: "campaign" });
  expect(msg.events).toHaveLength(2);
});

it("feedback does not restore a stale body when cleanup wins the race", async () => {
  const svc = service(async () => ({ id: "provider", captured: false }));
  const project = randomUUID(),
    input = body();
  const { id } = await svc.accept(input, project);
  // Historical sent record whose body has not yet been migrated.
  await r.store.patch(`MSG#${id}`, { status: "sent", state: "complete" });
  const transaction = r.store.transaction.bind(r.store);
  const spy = vi
    .spyOn(r.store, "transaction")
    .mockImplementationOnce(async (writes) => {
      // event() has already read the full old record at this point.
      expect(
        await purgeCompletedMessageContent(
          r.store.client,
          r.config.APP_TABLE,
          project,
          true,
        ),
      ).toMatchObject({ purged: 1 });
      return transaction(writes);
    });
  try {
    await svc.event(id, {
      id: randomUUID(),
      type: "delivered",
      at: new Date().toISOString(),
      recipients: input.to,
    });
    expectPurged(await saved(id));
    expect((await saved(id)).events).toHaveLength(1);
    expect((await saved(id)).status).toBe("delivered");
  } finally {
    spy.mockRestore();
  }
});

it("cleanup paginates, defaults to dry run, preserves active messages, and is repeatable", async () => {
  const project = randomUUID(),
    input = body();
  const base = {
    sk: "META",
    scope: `messages#${project}`,
    input,
    events: [],
    attempts: 1,
  };
  await r.store.putMany(
    Array.from({ length: 103 }, (_, i) => ({
      ...base,
      pk: `MSG#${randomUUID()}`,
      sort: String(i).padStart(4, "0"),
      status: i === 0 ? "queued" : i === 1 ? "submitting" : "sent",
      // Legacy map: cleanup must not require a broadcastId to remove the token.
      ...(i === 2
        ? {
            broadcast: { unsubscribeUrl: "https://example.com/?token=private" },
          }
        : {}),
    })),
  );
  expect(
    await purgeCompletedMessageContent(
      r.store.client,
      r.config.APP_TABLE,
      project,
    ),
  ).toMatchObject({ eligible: 101, purged: 0 });
  expect(
    await purgeCompletedMessageContent(
      r.store.client,
      r.config.APP_TABLE,
      project,
      true,
    ),
  ).toMatchObject({ eligible: 101, purged: 101 });
  expect(
    await purgeCompletedMessageContent(
      r.store.client,
      r.config.APP_TABLE,
      project,
      true,
    ),
  ).toMatchObject({ eligible: 0, purged: 0 });
  const messages = await r.store.list<Message>(`messages#${project}`, 200);
  for (const msg of messages) {
    if (msg.status === "sent") {
      expectPurged(msg);
      expect(msg.broadcast ?? {}).not.toHaveProperty("unsubscribeUrl");
    } else expect(msg.input).toEqual(input);
  }
});
