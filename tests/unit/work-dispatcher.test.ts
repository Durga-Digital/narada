import { afterEach, expect, it, vi } from "vitest";
import { recoverWebhook } from "@narada/core/webhooks";
vi.mock("@narada/core/webhooks", () => ({
  recoverWebhook: vi.fn(),
}));
import { WorkDispatcher } from "@narada/core/work-dispatcher";
import type { Store } from "@narada/core/store";
import type { Queues } from "@narada/core/queue";
import type { Entity } from "@narada/core/model";

afterEach(() => vi.useRealTimers());
function fixture(states: Record<string, Entity[]>) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const store = {
    due: vi.fn(async (state: string) => states[state] ?? []),
    patch: vi.fn(async (..._args: unknown[]) => {}),
  };
  const queues = { send: vi.fn(async (..._args: unknown[]) => {}) };
  return {
    store,
    queues,
    dispatcher: new WorkDispatcher(
      store as unknown as Store,
      queues as unknown as Queues,
    ),
  };
}
it("enqueues every work kind before deferring its next dispatch", async () => {
  const kinds = ["send", "broadcast", "form", "webhook", "publication"];
  const f = fixture(
    Object.fromEntries(
      kinds.map((kind) => [kind, [{ pk: kind, sk: "META", id: kind }]]),
    ),
  );
  await f.dispatcher.dispatch();
  for (const kind of kinds) {
    expect(f.queues.send).toHaveBeenCalledWith("work", { kind, id: kind });
    expect(f.store.patch).toHaveBeenCalledWith(
      kind,
      { due: Date.now() + 30000 },
      { field: "state", value: kind },
    );
  }
  f.queues.send.mock.invocationCallOrder.forEach((order, i) =>
    expect(order).toBeLessThan(f.store.patch.mock.invocationCallOrder[i]!),
  );
});
it("leaves work due when queue publication fails", async () => {
  const f = fixture({ send: [{ pk: "MSG#id", sk: "META", id: "id" }] });
  f.queues.send.mockRejectedValueOnce(new Error("Queue unavailable"));
  await expect(f.dispatcher.dispatch()).rejects.toThrow("Queue unavailable");
  expect(f.store.patch).not.toHaveBeenCalled();
});
it("recovers expired leases and never requeues an uncertain email submission", async () => {
  const f = fixture({
    "broadcast-running": [{ pk: "broadcast", sk: "META", runToken: "old" }],
    "webhook-running": [
      { pk: "retry", sk: "META", id: "retry", attempts: 2 },
      { pk: "exhausted", sk: "META", id: "exhausted", attempts: 6 },
    ],
    submitting: [
      {
        pk: "message",
        sk: "META",
        input: { text: "secret", html: "secret" },
        broadcast: { unsubscribeUrl: "secret" },
      },
    ],
  });
  await f.dispatcher.dispatch();
  expect(f.store.patch).toHaveBeenCalledWith(
    "broadcast",
    expect.objectContaining({
      state: "broadcast",
      runToken: expect.any(String),
    }),
    { field: "state", value: "broadcast-running" },
  );
  expect(f.store.patch.mock.calls[0]?.[1]).not.toMatchObject({
    runToken: "old",
  });
  expect(recoverWebhook).toHaveBeenCalledWith(f.store, "retry");
  expect(recoverWebhook).toHaveBeenCalledWith(f.store, "exhausted");
  expect(f.store.patch).toHaveBeenCalledWith(
    "message",
    expect.objectContaining({
      status: "unknown",
      state: "complete",
      contentPurgedAt: expect.any(String),
    }),
    { field: "status", value: "submitting" },
    [
      ["input", "html"],
      ["input", "text"],
      ["broadcast", "unsubscribeUrl"],
    ],
  );
  expect(f.queues.send).not.toHaveBeenCalled();
});
it("tolerates conditional races but surfaces unexpected storage failures", async () => {
  const f = fixture({ send: [{ pk: "message", sk: "META", id: "id" }] });
  f.store.patch.mockRejectedValueOnce(
    Object.assign(new Error("race"), {
      name: "ConditionalCheckFailedException",
    }),
  );
  await expect(f.dispatcher.dispatch()).resolves.toBeUndefined();
  f.store.patch.mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(f.dispatcher.dispatch()).rejects.toThrow("Storage unavailable");
});
