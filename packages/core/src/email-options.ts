import { z } from "zod";

// Application metadata stays in Narada; it is not copied into recipient headers.
const tagRecord = z
  .record(
    z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
      .refine(
        (key) => !["constructor", "prototype"].includes(key),
        "Reserved tag key",
      ),
    z
      .string()
      .min(1)
      .max(256)
      .refine(
        (value) => !/[\x00-\x1f\x7f]/.test(value),
        "Tag values cannot contain control characters",
      ),
  )
  .refine((tags) => Object.keys(tags).length <= 20, "Use at most 20 tags")
  // Stable ordering makes retries independent of object insertion order.
  .transform((tags) =>
    Object.fromEntries(
      Object.entries(tags).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  );

// Zod records skip __proto__; reject it before parsing instead of silently dropping it.
export const messageTags = z
  .unknown()
  .refine(
    (value) =>
      !value || typeof value !== "object" || !Object.hasOwn(value, "__proto__"),
    "Reserved tag key",
  )
  .pipe(tagRecord);

export const emailOptions = {
  tags: messageTags.optional(),
  priority: z.enum(["normal", "high"]).optional(),
};

export function priorityHeaders(
  priority?: "normal" | "high",
): Record<string, string> {
  return priority === "high"
    ? {
        "X-Priority": "1 (Highest)",
        "X-MSMail-Priority": "High",
        Importance: "High",
      }
    : {};
}
