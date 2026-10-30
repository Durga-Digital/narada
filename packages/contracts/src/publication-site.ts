import { z } from "zod";
import type { PublicationSiteInput, PublicationAboutInput } from "./types.js";
const label = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\r\n\x00-\x1f]+$/);
export const siteRevision = z.number().int().nonnegative();
const identifier = z.string().min(1).max(100);
export const collectionIdsInput = z
  .array(identifier)
  .max(5)
  .refine((v) => new Set(v).size === v.length, "Choose each collection once");
export const collectionInput = z
  .object({
    name: label,
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .meta({ examples: ["deep-dives"] }),
    description: z.string().trim().max(500),
  })
  .strict();
export const collectionUpdateInput = collectionInput
  .omit({ slug: true })
  .extend({ revision: siteRevision });
const external = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !/[\x00-\x20\x7f]/.test(v)
      );
    } catch {
      return false;
    }
  }, "Use a complete HTTPS URL without credentials or whitespace");
export const navigationInput = z
  .array(
    z.union([
      z
        .object({
          type: z.enum(["home", "archive", "about", "subscribe"]),
          label,
        })
        .strict(),
      z
        .object({
          type: z.literal("collection"),
          label,
          collectionId: identifier,
        })
        .strict(),
      z.object({ type: z.literal("external"), label, url: external }).strict(),
    ]),
  )
  .max(8)
  .refine((items) => {
    const keys = items
      .filter((i) => i.type !== "external")
      .map((i) =>
        i.type === "collection" ? `collection:${i.collectionId}` : i.type,
      );
    return new Set(keys).size === keys.length;
  }, "Choose each internal destination once");
export const siteInput = z
  .object({
    navigation: navigationInput,
    featuredIssueId: identifier.nullable(),
    collectionIds: collectionIdsInput.max(3),
  })
  .strict();
export const aboutInput = z
  .object({
    title: label,
    document: z
      .object({
        type: z.literal("doc"),
        content: z.array(z.unknown()).max(1000),
        attrs: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export const defaultSite: PublicationSiteInput = {
  navigation: [
    { type: "home", label: "Home" },
    { type: "archive", label: "Archive" },
  ],
  featuredIssueId: null,
  collectionIds: [],
};
export const defaultAbout: PublicationAboutInput = {
  title: "About",
  document: { type: "doc", content: [{ type: "paragraph" }] },
};
