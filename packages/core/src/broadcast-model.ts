export {
  unsubscribeKey,
  unsubscribeToken,
  readUnsubscribeToken,
} from "./subscription-links.js";
import { messageContentFields, escapeHtml } from "./message-content.js";
// Compatibility exports for existing consumers.
export { editorDocument, escapeHtml } from "./message-content.js";
import type { SegmentRule } from "./audience-model.js";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { AppError, hash, type Entity } from "./model.js";
export const MAX_CONTACTS = 1000;
export const draftInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    audienceId: z.string().max(36).default(""),
    topicId: z.union([z.literal(""), z.uuid()]).optional(),
    from: z.string().max(320).default(""),
    subject: z
      .string()
      .max(200)
      .refine((v) => !/[\r\n]/.test(v), "Subject cannot contain newlines")
      .default(""),
    ...messageContentFields,
    organization: z.string().max(120).default(""),
    postalAddress: z.string().max(500).default(""),
    replyTo: z.union([z.literal(""), z.email()]).optional(),
  })
  .strict()
  .refine(
    (draft) => Buffer.byteLength(JSON.stringify(draft)) <= 300000,
    "Draft exceeds the 300 KB storage limit",
  );
export type DraftInput = z.infer<typeof draftInput>;
export interface Contact {
  email: string;
  name: string;
  addedAt?: string;
  /** Historical consent fields, read only when migrating pre-v3 lists. */
  consentedAt?: string;
  consentSource?: string;
}
export const memberAddedAt = (contact: Contact) =>
  contact.addedAt ?? contact.consentedAt ?? "";

export interface Audience extends Entity {
  schemaVersion?: number;
  kind?: "manual" | "dynamic";
  rules?: SegmentRule[];
  match?: "all" | "any";
  total?: number;
  id: string;
  name: string;
  contacts: Contact[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export type BroadcastStatus =
  "draft" | "scheduled" | "sending" | "completed" | "cancelled";
export interface Broadcast extends Entity {
  id: string;
  draft: DraftInput;
  status: BroadcastStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  scheduledAt?: number;
  cursor: number;
  total: number;
  runToken?: string;
  counts?: Record<string, number>;
}
export interface Snapshot extends Entity {
  renderToken?: string;
  contacts: Pick<Contact, "email" | "name">[];
  audienceId: string;
}
export interface BroadcastDelivery {
  topicId?: string;
  broadcastId: string;
  audienceId: string;
  unsubscribeUrl: string;
  messageId: string;
}
export function broadcastMessageId(broadcastId: string, email: string) {
  const h = hash(`${broadcastId}:${email}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function importContacts(csv: string, source: string): Contact[] {
  let rows: unknown;
  try {
    rows = parse(csv, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: 2000,
    });
  } catch {
    throw new AppError(400, "Invalid CSV. Use email,name columns.");
  }
  const records = z
    .array(z.array(z.string()))
    .min(1)
    .max(MAX_CONTACTS + 1)
    .parse(rows);
  if (records[0]?.[0]?.toLowerCase() === "email") records.shift();
  const result = new Map<string, Contact>();
  for (const row of records) {
    if (row.length > 2) throw new AppError(400, "Use only email,name columns");
    const email = z.email().max(254).parse(row[0]).toLowerCase();
    result.set(email, {
      email,
      name: z
        .string()
        .max(80)
        .parse(row[1] ?? ""),
      consentedAt: new Date().toISOString(),
      consentSource: source,
    });
  }
  if (!result.size) throw new AppError(400, "Add at least one email address");
  return [...result.values()];
}
export function renderBroadcast(
  draft: DraftInput,
  url: string,
  preferencesUrl?: string,
) {
  const footer = `${draft.organization}\n${draft.postalAddress}\nUnsubscribe: ${url}${preferencesUrl ? `\nManage preferences: ${preferencesUrl}` : ""}`;
  const htmlFooter = `<hr><footer style="font:12px/1.6 sans-serif;color:#666"><p>${escapeHtml(draft.organization)}<br>${escapeHtml(draft.postalAddress).replace(/\n/g, "<br>")}</p><a href="${escapeHtml(url)}">${draft.topicId ? "Unsubscribe from this topic" : "Unsubscribe from this audience"}</a>${preferencesUrl ? ` · <a href="${escapeHtml(preferencesUrl)}">Manage preferences</a>` : ""}</footer>`;
  const html = draft.html.trim()
    ? draft.html
    : `<div style="font:16px/1.6 sans-serif;white-space:pre-wrap">${escapeHtml(draft.text)}</div>`;
  const insertion = /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, `${htmlFooter}</body>`)
    : html + htmlFooter;
  return {
    text: draft.text.trim() ? `${draft.text}\n\n---\n${footer}` : undefined,
    html: insertion,
  };
}
