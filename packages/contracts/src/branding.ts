import { z } from "zod";
import type { PublicationBranding, PublicationLogoInput } from "./types.js";

export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_MAX_ENCODED = Math.ceil(LOGO_MAX_BYTES / 3) * 4;
export const publicationThemes = [
  {
    id: "classic",
    name: "Classic",
    description: "Warm paper and gentle serif headings.",
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "White pages and bold editorial typography.",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Quiet neutrals and clean sans-serif type.",
  },
] as const;
export const defaultBranding: PublicationBranding = {
  theme: "classic",
  logoAssetId: null,
  logoAlt: "",
  welcomeText: "",
};
export const brandingInput: z.ZodType<PublicationBranding> = z
  .object({
    theme: z.enum(["classic", "editorial", "minimal"]),
    logoAssetId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .meta({ examples: ["a".repeat(64)] })
      .nullable(),
    logoAlt: z.string().trim().max(160),
    welcomeText: z.string().trim().max(1000),
    layout: z.enum(["letter", "feature", "grid"]).optional(),
    wordmarkAssetId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .meta({ examples: ["a".repeat(64)] })
      .nullable()
      .optional(),
    wordmarkAlt: z.string().trim().max(160).optional(),
    coverAssetId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .meta({ examples: ["a".repeat(64)] })
      .nullable()
      .optional(),
    coverAlt: z.string().trim().max(160).optional(),
    signupHeading: z.string().trim().max(100).optional(),
    signupDescription: z.string().trim().max(300).optional(),
    signupButton: z.string().trim().max(40).optional(),
    signupName: z.boolean().optional(),
  })
  .strict();
export const logoInput: z.ZodType<PublicationLogoInput> = z
  .object({
    fileName: z.string().trim().min(1).max(160),
    contentBase64: z
      .string()
      .min(4)
      .max(LOGO_MAX_ENCODED)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
      .meta({ examples: ["AQID"] }),
  })
  .strict();
