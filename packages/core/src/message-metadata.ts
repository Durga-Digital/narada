import type { DeliveryEvent, Message } from "./model.js";

import type {
  DeliveryMetadata,
  MessageMetadata,
} from "@narada/contracts/dashboard";
export type {
  DeliveryMetadata,
  MessageMetadata,
} from "@narada/contracts/dashboard";

const safeErrors = new Set([
  "TooManyRequestsException",
  "LimitExceededException",
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "BadRequestException",
  "AccountSuspendedException",
  "Submission outcome uncertain; no automatic retry",
  "Worker stopped during submission. Inspect feedback before replay.",
  "Sender domain removed or no longer verified before submission",
  "Broadcast cancelled before submission",
  "Recipient unsubscribed before submission",
  "Message expired before submission",
  "Recipient suppressed before submission",
]);

// Allowlist every level: stored messages contain bodies and may gain other secret fields.
// Never spread a message, its input, or a provider event into a delivery-log response.
export function deliveryMetadata(event: DeliveryEvent): DeliveryMetadata {
  return {
    id: event.id,
    type: event.type,
    at: event.at,
    recipients: event.recipients,
    permanent: event.permanent,
    bounceType: event.bounceType,
  };
}

export function messageMetadata(message: Message): MessageMetadata {
  return {
    id: message.id,
    status: message.status,
    createdAt: message.createdAt,
    providerId: message.providerId,
    attempts: message.attempts,
    input: {
      from: message.input.from,
      to: message.input.to,
      subject: message.input.subject,
      reply_to: message.input.reply_to,
      tags: message.input.tags,
      priority: message.input.priority ?? "normal",
    },
    error: message.error
      ? safeErrors.has(message.error)
        ? message.error
        : "Delivery encountered an error. Check your sending configuration."
      : undefined,
    events: message.events.map(deliveryMetadata),
  };
}
