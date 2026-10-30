import { z } from "zod";
import { AppError, type Entity } from "./model.js";
import { messageContentFields, escapeHtml } from "./message-content.js";
export const variableInput = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/)
      .refine(
        (k) => !["constructor", "prototype", "__proto__"].includes(k),
        "Reserved variable name",
      ),
    type: z.enum(["string", "number", "boolean", "url"]).default("string"),
    fallback: z
      .union([z.string().max(2000), z.number().finite(), z.boolean()])
      .optional(),
  })
  .strict();
export const templateInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["transactional", "broadcast"]).default("transactional"),
    subject: z
      .string()
      .max(200)
      .refine((v) => !/[\r\n]/.test(v), "Subject cannot contain newlines")
      .default(""),
    ...messageContentFields,
    variables: z.array(variableInput).max(30).default([]),
  })
  .strict()
  .refine(
    (v) => Buffer.byteLength(JSON.stringify(v)) <= 300000,
    "Template exceeds 300 KB",
  );
export type TemplateContent = z.output<typeof templateInput>;
export type TemplateVariable = z.output<typeof variableInput>;
export interface Template extends Entity {
  id: string;
  alias: string;
  draft: TemplateContent;
  revision: number;
  publishedVersion?: number;
  publishedRevision?: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface TemplateVersion extends Entity {
  version: number;
  content: TemplateContent;
  publishedAt: string;
}
export const variableValues = z.record(
  z.string(),
  z.union([z.string().max(2000), z.number().finite(), z.boolean()]),
);
const token = /\{\{\s*vars\.([a-z][a-z0-9_]*)\s*\}\}/g;
export function validateVariable(def: TemplateVariable, value: unknown) {
  if (def.type === "url") {
    if (typeof value !== "string")
      throw new AppError(422, `${def.key} must be a URL`);
    try {
      const u = new URL(value);
      if (
        !["https:", "http:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        /[\r\n]/.test(value)
      )
        throw new Error();
    } catch {
      throw new AppError(
        422,
        `${def.key} must be an HTTP(S) URL without credentials`,
      );
    }
  } else if (
    typeof value !== def.type ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw new AppError(422, `${def.key} must be ${def.type}`);
  if (typeof value === "string" && /\{\{|\}\}/.test(value))
    throw new AppError(
      422,
      "Variable values cannot contain template expressions",
    );
  return String(value);
}
export function validateTemplate(content: TemplateContent, ready = false) {
  const definitions = new Map(content.variables.map((v) => [v.key, v]));
  if (definitions.size !== content.variables.length)
    throw new AppError(422, "Variable keys must be unique");
  for (const v of content.variables)
    if (v.fallback !== undefined) validateVariable(v, v.fallback);
  // URL variables are permitted only as the entire value of a quoted href attribute.
  const withoutLinks = content.html.replace(
    /<a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,
    (tag) =>
      tag.replace(
        /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
        (
          attribute,
          name: string,
          double: string | undefined,
          single: string | undefined,
        ) => {
          const match = /^\{\{\s*vars\.([a-z][a-z0-9_]*)\s*\}\}$/.exec(
            double ?? single ?? "",
          );
          return name.toLowerCase() === "href" &&
            match &&
            definitions.get(match[1]!)?.type === "url"
            ? ' href="#"'
            : attribute;
        },
      ),
  );
  if (
    /<[^>]*\{\{/.test(withoutLinks) ||
    [...withoutLinks.matchAll(/<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)].some((m) =>
      m[0].includes("{{"),
    ) ||
    [
      ...withoutLinks.matchAll(
        /<(script|style)\b[^>]*>([\s\S]*?)(?:<\/\1\s*>|$)/gi,
      ),
    ].some((m) => m[2]!.includes("{{"))
  )
    throw new AppError(
      422,
      "Variables are allowed in text or a complete quoted href for a URL variable",
    );
  // Nested CSS rules legitimately end with }}. Variable openings in these
  // contexts were rejected above; exclude their literal braces from token checks.
  const visibleHtml = content.html.replace(
    /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
    "",
  );
  const combined = `${content.subject}\n${content.text}\n${visibleHtml}`;
  for (const match of combined.matchAll(token))
    if (!definitions.has(match[1]!))
      throw new AppError(422, `Undefined template variable: ${match[1]}`);
  const remainder = combined
    .replace(token, "")
    .replace(
      content.kind === "broadcast"
        ? /\{\{\{?\s*contact\.[a-z][a-z0-9_]*\s*\}?\}\}/g
        : /$^/g,
      "",
    );
  if (/\{\{|\}\}/.test(remainder))
    throw new AppError(
      422,
      "Use {{vars.key}} variables; contact properties are available only in broadcast templates",
    );
  if (
    ready &&
    (!content.subject.trim() || !(content.text.trim() || content.html.trim()))
  )
    throw new AppError(422, "Add a subject and message before publishing");
}
export function renderTemplate(content: TemplateContent, input: unknown = {}) {
  validateTemplate(content, true);
  const supplied = variableValues.parse(input),
    definitions = new Map(content.variables.map((v) => [v.key, v]));
  for (const key of Object.keys(supplied))
    if (!definitions.has(key))
      throw new AppError(422, `Unknown template variable: ${key}`);
  const values: Record<string, string> = {};
  for (const v of content.variables) {
    const raw = Object.hasOwn(supplied, v.key) ? supplied[v.key] : v.fallback;
    if (raw !== undefined) values[v.key] = validateVariable(v, raw);
  }
  const replace = (value: string, html = false) =>
    value.replace(token, (_match, key: string) => {
      if (!Object.hasOwn(values, key))
        throw new AppError(422, `Missing template variable: ${key}`);
      return html ? escapeHtml(values[key]!) : values[key]!;
    });
  const rendered = {
    subject: replace(content.subject),
    text: replace(content.text),
    html: replace(content.html, true),
  };
  if (/[\r\n]/.test(rendered.subject) || rendered.subject.length > 200)
    throw new AppError(
      422,
      "Rendered subject must be at most 200 characters without newlines",
    );
  if (Buffer.byteLength(JSON.stringify(rendered)) > 300000)
    throw new AppError(422, "Rendered template exceeds 300 KB");
  return rendered;
}
export function templateDto(t: Template, includeDocument = true) {
  const { document, ...content } = t.draft;
  return {
    id: t.id,
    alias: t.alias,
    draft: includeDocument ? t.draft : content,
    revision: t.revision,
    publishedVersion: t.publishedVersion,
    archived: t.archived,
    status: t.archived
      ? "archived"
      : t.publishedVersion
        ? "published"
        : "draft",
    hasUnpublishedChanges: t.publishedRevision !== t.revision,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
