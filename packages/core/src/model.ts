import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { emailOptions } from "./email-options.js";

export const mailbox = z
  .string()
  .max(320)
  .refine((value) => {
    if (/[\r\n]/.test(value)) return false;
    const match = /^[^<>]*<([^<>]+)>$/.exec(value);
    return z.email().safeParse(match ? match[1] : value).success;
  }, "Invalid email address");
export const emailInput = z
  .object({
    ...emailOptions,
    from: mailbox,
    to: z
      .union([z.email(), z.array(z.email()).min(1).max(10)])
      .transform((v) => [
        ...new Set((Array.isArray(v) ? v : [v]).map((x) => x.toLowerCase())),
      ]),
    subject: z
      .string()
      .min(1)
      .max(998)
      .refine((v) => !/[\r\n]/.test(v), "Subject contains a newline"),
    html: z.string().max(100_000).optional(),
    text: z.string().max(100_000).optional(),
    reply_to: z.email().optional(),
    expires_in: z.number().int().min(30).max(86400).default(3600),
  })
  .strict()
  .refine((v) => v.html || v.text, "Supply html or text");
export type EmailInput = z.output<typeof emailInput>;
import type {
  MessageStatus as Status,
  OwnerDomain as Domain,
} from "@narada/contracts/dashboard";
export type {
  MessageStatus as Status,
  OwnerDomain as Domain,
} from "@narada/contracts/dashboard";
export interface Entity {
  pk: string;
  sk: string;
  scope?: string;
  sort?: string;
  state?: string;
  due?: number;
  ttl?: number;
  [key: string]: unknown;
}
export interface Message extends Entity {
  senderDomainRegistration?: string;
  id: string;
  project: string;
  input: EmailInput;
  status: Status;
  createdAt: string;
  expiresAt: number;
  providerId?: string;
  error?: string;
  events: DeliveryEvent[];
  attempts: number;
}
export interface DeliveryEvent {
  id: string;
  type: "delivered" | "delayed" | "bounced" | "complained" | "failed";
  at: string;
  recipients: string[];
  reason?: string;
  permanent?: boolean;
  bounceType?: "Permanent" | "Transient" | "Undetermined";
}
export type ApiKeyPermission = "sending" | "scoped" | "full" | "operations";
export interface ApiKey extends Entity {
  operationAccess?: import("@narada/contracts/delegation").OperationAccess;
  revision?: number;
  scopes?: import("./api-permissions.js").ApiScope[];
  domain?: string;
  lastUsedAt?: string;
  usageTrackingSince?: string;
  permission?: ApiKeyPermission;
  id: string;
  name: string;
  prefix: string;
  hash: string;
  project: string;
  createdAt: string;
  revoked: boolean;
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const secret = (prefix: string) =>
  `${prefix}${randomBytes(32).toString("base64url")}`;
export const domainOf = (from: string) =>
  from.replace(/.*</, "").replace(/>$/, "").split("@")[1]!.toLowerCase();
export function nextStatus(current: Status, event: DeliveryEvent): Status {
  if (current === "complained" || event.type === "complained")
    return "complained";
  if (current === "bounced") return "bounced";
  if (event.type === "bounced")
    return event.permanent === false
      ? current === "delivered"
        ? current
        : "delayed"
      : "bounced";
  if (current === "delivered") return current;
  return event.type;
}
