import { expect, it, vi } from "vitest";
import { eventMetric, metricWrite } from "@narada/core/metrics";
import { webhookJobs } from "@narada/core/event-outbox";
import { eventHandler } from "../../apps/worker/src/handlers.js";
import type { Message } from "@narada/core/model";
import type { Store } from "@narada/core/store";
import type { Runtime } from "@narada/core/runtime";
it("counts each intended recipient only once per message and outcome", () => {
  const msg = {
    input: { to: ["a@example.com", "b@example.com"] },
    metricOutcomes: { delivered: ["a@example.com"] },
  } as unknown as Message;
  const result = eventMetric(msg, {
    id: "new-event",
    type: "delivered",
    at: new Date().toISOString(),
    recipients: [
      "A@example.com",
      "B@example.com",
      "b@example.com",
      "outsider@example.com",
    ],
  });
  expect(result.increments).toEqual({ delivered: 1 });
  expect(result.outcomes.delivered).toEqual(["a@example.com", "b@example.com"]);
  expect(metricWrite({} as Store, msg, { delivered: 1 })).toEqual([]);
});
it("routes only selected events and keeps legacy email subscriptions", async () => {
  const store = { create: (item: unknown) => item } as Store;
  const endpoints = [
    { pk: "a", sk: "META", id: "legacy" },
    { pk: "b", sk: "META", id: "contacts", events: ["contact.created"] },
    { pk: "c", sk: "META", id: "bounces", events: ["email.bounced"] },
  ];
  const event = {
    id: "one",
    type: "contact.created" as const,
    created_at: "2026-01-01T00:00:00Z",
    data: { email: "a@example.com" },
  };
  expect(await webhookJobs(store, event, endpoints)).toEqual([
    expect.objectContaining({ endpointId: "contacts", payload: event }),
  ]);
  expect(
    await webhookJobs(store, { ...event, type: "email.bounced" }, endpoints),
  ).toEqual([
    expect.objectContaining({ endpointId: "legacy" }),
    expect.objectContaining({ endpointId: "bounces" }),
  ]);
});
it("preserves SES event time and bounce category instead of using the send timestamp", async () => {
  const event = vi.fn();
  await eventHandler(
    {
      config: { NARADA_MODE: "aws" },
      service: { event },
    } as unknown as Runtime,
    JSON.stringify({
      eventType: "Bounce",
      mail: {
        messageId: "ses",
        timestamp: "2026-01-01T00:00:00Z",
        destination: ["a@example.com"],
        tags: { narada_id: ["message"] },
      },
      bounce: {
        timestamp: "2026-01-02T03:00:00Z",
        bounceType: "Transient",
        bouncedRecipients: [{ emailAddress: "a@example.com" }],
      },
    }),
  );
  expect(event).toHaveBeenCalledWith(
    "message",
    expect.objectContaining({
      at: "2026-01-02T03:00:00Z",
      bounceType: "Transient",
      permanent: false,
    }),
  );
});
