import { z } from "zod";
import { AppError, hash, type Entity } from "./model.js";
export const propertyValue = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
]);
export type PropertyValue = z.infer<typeof propertyValue>;
export const builtInProperties = [
  "email",
  "name",
  "first_name",
  "last_name",
] as const;
export const propertyInput = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/)
      .refine(
        (k) =>
          ![
            ...builtInProperties,
            "constructor",
            "prototype",
            "__proto__",
          ].includes(k),
        "Reserved property name",
      ),
    type: z.enum(["string", "number", "boolean", "date"]),
    fallback: propertyValue.optional(),
  })
  .strict();
export interface PropertyDefinition extends Entity {
  key: string;
  type: "string" | "number" | "boolean" | "date";
  fallback?: PropertyValue;
  revision: number;
  createdAt: string;
}
export interface SharedContact extends Entity {
  email: string;
  name: string;
  first_name: string;
  last_name: string;
  properties: Record<string, PropertyValue>;
  revision: number;
  addedAt: string;
}
export const ruleInput = z
  .object({
    property: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    operator: z.enum([
      "equals",
      "not_equals",
      "contains",
      "greater_than",
      "less_than",
      "is_set",
      "is_not_set",
    ]),
    value: propertyValue.optional(),
  })
  .strict();
export const segmentInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["manual", "dynamic"]),
    match: z.enum(["all", "any"]).default("all"),
    rules: z.array(ruleInput).max(10).default([]),
  })
  .strict();
export type SegmentRule = z.infer<typeof ruleInput>;
export const topicInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(300).default(""),
    visibility: z.enum(["public", "private"]).default("public"),
    active: z.boolean().default(true),
  })
  .strict();
export interface Topic extends Entity {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  active: boolean;
  revision: number;
  createdAt: string;
}
export interface TopicPreference extends Entity {
  subscribed: boolean;
  source: string;
  updatedAt: string;
}
export const contactKey = (email: string) =>
  `CONTACT#${hash(email.toLowerCase())}`;
export const topicPreferenceKey = (id: string, email: string) =>
  `PREFERENCE#${id}#${hash(email.toLowerCase())}`;
// Explicit list consent is independent of the membership row. New integrations use topics.
export const segmentConsentKey = (id: string, email: string) =>
  `SEGMENT_CONSENT#${id}#${hash(email.toLowerCase())}`;
export const marketingKey = (email: string) =>
  `MARKETING#${hash(email.toLowerCase())}`;
export function validateValue(
  definition: Pick<PropertyDefinition, "key" | "type">,
  value: unknown,
): PropertyValue {
  const parsed = propertyValue.parse(value);
  const valid =
    definition.type === "date"
      ? typeof parsed === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsed) &&
        !Number.isNaN(Date.parse(parsed)) &&
        new Date(parsed).toISOString().slice(0, 10) === parsed
      : typeof parsed === definition.type;
  if (!valid)
    throw new AppError(422, `${definition.key} must be ${definition.type}`);
  return parsed;
}
export function contactValue(
  contact: SharedContact,
  key: string,
): PropertyValue | undefined {
  if (builtInProperties.includes(key as (typeof builtInProperties)[number]))
    return contact[key] as string;
  return Object.hasOwn(contact.properties, key)
    ? contact.properties[key]
    : undefined;
}
export function matchesRules(
  contact: SharedContact,
  rules: SegmentRule[],
  match: "all" | "any",
) {
  const values = rules.map((r) => {
    const value = contactValue(contact, r.property),
      set = value !== undefined && value !== "";
    if (r.operator === "is_set") return set;
    if (r.operator === "is_not_set") return !set;
    if (!set) return false;
    if (r.operator === "equals") return value === r.value;
    if (r.operator === "not_equals") return value !== r.value;
    if (r.operator === "contains")
      return (
        typeof value === "string" &&
        value.toLowerCase().includes(String(r.value).toLowerCase())
      );
    if (typeof value === "number" && typeof r.value === "number")
      return r.operator === "greater_than" ? value > r.value : value < r.value;
    if (typeof value === "string" && typeof r.value === "string")
      return r.operator === "greater_than" ? value > r.value : value < r.value;
    return false;
  });
  return (
    values.length > 0 &&
    (match === "all" ? values.every(Boolean) : values.some(Boolean))
  );
}
