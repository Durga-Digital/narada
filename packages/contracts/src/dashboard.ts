/** Owner-session DTOs. These do not grant public REST/SDK/MCP access. */
export type MessageStatus =
  | "queued"
  | "submitting"
  | "captured"
  | "sent"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "failed"
  | "expired"
  | "unknown";
export interface DeliveryMetadata {
  id: string;
  type: "delivered" | "delayed" | "bounced" | "complained" | "failed";
  at: string;
  recipients: string[];
  permanent?: boolean;
  bounceType?: "Permanent" | "Transient" | "Undetermined";
}
export interface MessageMetadata {
  id: string;
  status: MessageStatus;
  createdAt: string;
  providerId?: string;
  attempts: number;
  input: {
    from: string;
    to: string[];
    subject: string;
    reply_to?: string;
    tags?: Record<string, string>;
    priority: "normal" | "high";
  };
  error?: string;
  events: DeliveryMetadata[];
}
export interface OwnerDomain {
  pk: string;
  sk: string;
  scope?: string;
  sort?: string;
  state?: string;
  due?: number;
  ttl?: number;
  [key: string]: unknown;
  revision?: number;
  authentication?: import("./types.js").DomainAuthentication;
  registrationId?: string;
  removedAt?: string;
  createdAt?: string;
  checkedAt?: string;
  region?: string;
  name: string;
  verified: boolean;
  records: { type: string; name: string; value: string }[];
  local: boolean;
}
export interface IssueListItem {
  id: string;
  publicationId: string;
  revision: number;
  draft: { title: string; slug: string };
  publicVersionId?: string;
  scheduledAt?: number;
  emailReleased?: boolean;
  updatedAt: string;
  status: import("./types.js").IssueStatus;
  canDelete: boolean;
}
export interface OwnerIssuePreview {
  web: { html: string; text: string };
  email: { html: string; text: string };
  eligible: number;
  excluded: number;
  subject: string;
  from: string;
  url: string;
}
