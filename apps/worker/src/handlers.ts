import { z } from "zod";
import { hash, type DeliveryEvent } from "@narada/core/model";
import { sendWebhook } from "@narada/core/webhooks";
import type { Runtime } from "@narada/core/runtime";
const work = z.object({
  kind: z.enum([
    "send",
    "webhook",
    "broadcast",
    "form",
    "publication",
    "publication-domain",
  ]),
  id: z.string(),
});
const fixture = z.object({
  messageId: z.string(),
  event: z.object({
    id: z.string(),
    type: z.enum(["delivered", "delayed", "bounced", "complained", "failed"]),
    at: z.iso.datetime(),
    recipients: z.array(z.email()),
    permanent: z.boolean().optional(),
    bounceType: z.enum(["Permanent", "Transient", "Undetermined"]).optional(),
    reason: z.string().optional(),
  }),
});
export async function workHandler(runtime: Runtime, body: string) {
  const job = work.parse(JSON.parse(body));
  if (job.kind === "send") await runtime.service.send(job.id);
  else if (job.kind === "publication-domain")
    await runtime.publicationDomains.run(job.id);
  else if (job.kind === "publication") await runtime.issues.run(job.id);
  else if (job.kind === "form") await runtime.forms.run(job.id);
  else if (job.kind === "broadcast") await runtime.broadcasts.run(job.id);
  else
    await sendWebhook(
      runtime.store,
      job.id,
      runtime.config.NARADA_MODE === "local",
    );
}
export async function eventHandler(runtime: Runtime, body: string) {
  const raw = JSON.parse(body);
  if (runtime.config.NARADA_MODE === "local" && raw.messageId) {
    const e = fixture.parse(raw);
    await runtime.service.event(e.messageId, e.event);
    return;
  }
  const envelope = raw.Message ? JSON.parse(raw.Message) : raw;
  const input = z
    .object({
      eventType: z.string(),
      mail: z.object({
        messageId: z.string(),
        timestamp: z.string(),
        destination: z.array(z.string()),
        tags: z
          .object({ narada_id: z.array(z.string()).optional() })
          .optional(),
      }),
      bounce: z
        .object({
          bounceType: z.enum(["Permanent", "Transient", "Undetermined"]),
          timestamp: z.iso.datetime().optional(),
          bouncedRecipients: z.array(z.object({ emailAddress: z.string() })),
        })
        .optional(),
      complaint: z
        .object({
          timestamp: z.iso.datetime().optional(),
          complainedRecipients: z.array(z.object({ emailAddress: z.string() })),
        })
        .optional(),
      delivery: z
        .object({
          recipients: z.array(z.string()),
          timestamp: z.iso.datetime().optional(),
        })
        .optional(),
      deliveryDelay: z
        .object({ timestamp: z.iso.datetime().optional() })
        .optional(),
      reject: z.object({ reason: z.string().optional() }).optional(),
      failure: z
        .object({
          timestamp: z.iso.datetime().optional(),
          errorMessage: z.string().optional(),
        })
        .optional(),
    })
    .passthrough()
    .parse(envelope);
  const type = (
    {
      Delivery: "delivered",
      Bounce: "bounced",
      Complaint: "complained",
      DeliveryDelay: "delayed",
      Reject: "failed",
      RenderingFailure: "failed",
      "Rendering Failure": "failed",
    } as const
  )[input.eventType as "Delivery"];
  if (!type) return;
  const messageId = input.mail.tags?.narada_id?.[0];
  if (!messageId) return; // Untagged console/system sends are not Narada message records.
  const event: DeliveryEvent = {
    id: hash(JSON.stringify(envelope)),
    type,
    at:
      input.bounce?.timestamp ??
      input.complaint?.timestamp ??
      input.delivery?.timestamp ??
      input.deliveryDelay?.timestamp ??
      input.failure?.timestamp ??
      input.mail.timestamp,
    recipients:
      input.bounce?.bouncedRecipients.map((x) => x.emailAddress) ??
      input.complaint?.complainedRecipients.map((x) => x.emailAddress) ??
      input.delivery?.recipients ??
      input.mail.destination,
    permanent: input.bounce?.bounceType !== "Transient",
    bounceType: input.bounce?.bounceType,
    reason: input.reject?.reason ?? input.failure?.errorMessage,
  };
  await runtime.service.event(messageId, event);
}
