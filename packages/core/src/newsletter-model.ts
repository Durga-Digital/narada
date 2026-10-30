import { z } from "zod";
import type { Entity } from "./model.js";
import { editorDocument } from "./message-content.js";
export const slugInput = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\r\n]/.test(v), "Use one line");
export const publicationInput = z
  .object({
    name: line(100).refine(Boolean, "Name is required"),
    slug: slugInput,
    description: z.string().max(300).default(""),
    author: line(80).default(""),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#345d37"),
    from: line(320).default(""),
    replyTo: z.email().or(z.literal("")).default(""),
    organization: line(120).default(""),
    postalAddress: z.string().max(500).default(""),
    privacyUrl: z
      .url()
      .refine((v) => v.startsWith("https://"))
      .or(z.literal(""))
      .default(""),
  })
  .strict();
export type PublicationSettings = z.infer<typeof publicationInput>;
export interface Publication extends Entity {
  branding?: import("@narada/contracts/types").PublicationBranding;
  id: string;
  settings: PublicationSettings;
  status: "draft" | "active" | "archived";
  topicId: string;
  audienceId: string;
  formId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export const issueInput = z
  .object({
    coverAssetId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .optional(),
    coverAlt: z.string().trim().max(160).optional(),
    title: line(160).refine(Boolean, "Title is required"),
    subtitle: line(300).default(""),
    slug: slugInput,
    subject: line(180).default(""),
    preheader: line(200).default(""),
    document: editorDocument,
  })
  .strict();
export type IssueDraft = z.infer<typeof issueInput>;
export type Channels = "both" | "web" | "email";
export interface Issue extends Entity {
  collectionIds?: string[];
  collectionRevision?: number;
  deletedAt?: string;
  id: string;
  publicationId: string;
  draft: IssueDraft;
  revision: number;
  createdAt: string;
  updatedAt: string;
  publicVersionId?: string;
  publishedAt?: string;
  webUpdatedAt?: string;
  slugLocked?: boolean;
  operationId?: string;
  scheduledAt?: number;
  broadcastId?: string;
  emailReleased?: boolean;
}
export interface IssueVersion extends Entity {
  id: string;
  issueId: string;
  publicationId: string;
  draft: IssueDraft;
  html: string;
  text: string;
  settings: PublicationSettings;
  createdAt: string;
}
export interface PublicationOperation extends Entity {
  id: string;
  issueId: string;
  publicationId: string;
  versionId: string;
  channels: Channels;
  broadcastId?: string;
  scheduledAt: number;
  status: "pending" | "released" | "cancelled";
}
