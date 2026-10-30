import { z } from "zod";

// Editor JSON is retained for editing; delivery uses the HTML/text exported at save time.
export const editorDocument = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.json()).max(1000),
    attrs: z.record(z.string(), z.json()).optional(),
  })
  .refine(
    (doc) => Buffer.byteLength(JSON.stringify(doc)) <= 100000,
    "Editor document exceeds 100 KB",
  );
// Shared storage contract; delivery envelopes and recipient data belong to callers.
export const messageContentFields = {
  text: z.string().max(30000).default(""),
  html: z.string().max(50000).default(""),
  document: editorDocument.optional(),
};
export const messageContentInput = z.object(messageContentFields).strict();
export type MessageContent = z.infer<typeof messageContentInput>;

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
