import { AppError } from "./model.js";
import { escapeHtml, type DraftInput } from "./broadcast-model.js";
import {
  builtInProperties,
  contactValue,
  type PropertyDefinition,
  type SharedContact,
} from "./audience-model.js";
const tokenPattern = /\{\{\{?\s*contact\.([a-z][a-z0-9_]*)\s*\}?\}\}/g;
export function personalizationKeys(draft: DraftInput) {
  // Values can appear in text, not URLs, styles, scripts, or HTML attributes.
  if (
    /<[^>]*\{\{/.test(draft.html) ||
    [
      ...draft.html.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi),
    ].some((match) => match[2]!.includes("{{"))
  )
    throw new AppError(
      422,
      "Contact properties can only appear in message text, not HTML tags, URLs, styles, or scripts",
    );
  return [
    ...new Set(
      [
        ...`${draft.subject}\n${draft.text}\n${draft.html}`.matchAll(
          tokenPattern,
        ),
      ].map((m) => m[1]!),
    ),
  ];
}
export function personalizationValues(
  draft: DraftInput,
  contact: SharedContact | undefined,
  definitions: PropertyDefinition[],
) {
  const values: Record<string, string> = {};
  for (const key of personalizationKeys(draft)) {
    const definition = definitions.find((d) => d.key === key);
    if (
      !definition &&
      !builtInProperties.includes(key as (typeof builtInProperties)[number])
    )
      throw new AppError(422, `Unknown contact property: ${key}`);
    const raw = contact ? contactValue(contact, key) : undefined;
    const value = raw !== undefined && raw !== "" ? raw : definition?.fallback;
    if (value === undefined || value === "")
      throw new AppError(
        422,
        `Missing ${key}${contact ? ` for ${contact.email}` : ": choose a preview contact or define a fallback"}`,
      );
    values[key] = String(value);
  }
  return values;
}
export function personalize(
  draft: DraftInput,
  values: Record<string, string>,
): DraftInput {
  const replace = (s: string, html = false) =>
    s.replace(tokenPattern, (_, key: string) => {
      if (!Object.hasOwn(values, key))
        throw new AppError(422, `Missing contact property: ${key}`);
      return html ? escapeHtml(values[key]!) : values[key]!;
    });
  return {
    ...draft,
    subject: replace(draft.subject),
    text: replace(draft.text),
    html: replace(draft.html, true),
  };
}
