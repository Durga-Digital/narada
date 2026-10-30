import { it, expect, vi } from "vitest";
import { eventHandler } from "../../apps/worker/src/handlers.js";
import type { Runtime } from "@narada/core/runtime";
it.each([
  ["Bounce", "bounced"],
  ["Complaint", "complained"],
  ["Delivery", "delivered"],
  ["DeliveryDelay", "delayed"],
  ["Rendering Failure", "failed"],
  ["Reject", "failed"],
])("normalizes SES %s events", async (eventType, expected) => {
  const event = vi.fn();
  const runtime = {
    config: { NARADA_MODE: "aws" },
    service: { event },
  } as unknown as Runtime;
  const payload = {
    eventType,
    mail: {
      messageId: "ses-123",
      timestamp: "2026-01-01T00:00:00Z",
      destination: ["a@example.com"],
      tags: { narada_id: ["app-123"] },
    },
    ...(eventType === "Bounce"
      ? {
          bounce: {
            bounceType: "Transient",
            bouncedRecipients: [{ emailAddress: "a@example.com" }],
          },
        }
      : {}),
  };
  await eventHandler(
    runtime,
    JSON.stringify({ Message: JSON.stringify(payload) }),
  );
  expect(event).toHaveBeenCalledWith(
    "app-123",
    expect.objectContaining({
      type: expected,
      recipients: ["a@example.com"],
      ...(eventType === "Bounce" ? { permanent: false } : {}),
    }),
  );
});
