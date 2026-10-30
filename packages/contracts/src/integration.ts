import { z } from "zod";

// Structural bounds shared by discovery and runtime; DNS validity is checked in core.
export const senderRegistrationInput = z
  .object({ name: z.string().min(3).max(253) })
  .strict();
export const senderRevisionInput = z
  .object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const senderMailFromInput = senderRevisionInput
  .extend({
    domain: z.string().min(3).max(253).nullable(),
    behavior: z.enum(["USE_DEFAULT_VALUE", "REJECT_MESSAGE"]),
  })
  .strict();
export const resourceSearchInput = z
  .object({
    kind: z.enum([
      "domains",
      "forms",
      "publications",
      "contacts",
      "templates",
      "broadcasts",
      "segments",
      "topics",
    ]),
    text: z.string().min(1).max(120),
    limit: z.number().int().min(1).max(20).optional(),
    cursor: z.string().max(4000).optional(),
  })
  .strict();
