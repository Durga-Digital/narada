import { z } from "zod";
export const domainRevisionInput = z
  .object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const domainConfigureInput = domainRevisionInput
  .extend({
    hostname: z
      .string()
      .min(3)
      .max(253)
      .meta({ examples: ["news.example.com"] }),
  })
  .strict();
