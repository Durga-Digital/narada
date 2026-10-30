import { it, expect } from "vitest";
import { draftInput } from "@narada/core/broadcast-model";
import {
  matchesRules,
  propertyInput,
  validateValue,
  type SharedContact,
  type PropertyDefinition,
} from "@narada/core/audience-model";
import {
  personalize,
  personalizationValues,
  personalizationKeys,
} from "@narada/core/personalization";
const contact: SharedContact = {
  pk: "CONTACT#test",
  sk: "META",
  email: "alex@example.com",
  name: "Alex",
  first_name: "<Alex & Co>",
  last_name: "",
  properties: { city: "Sydney", age: 30, enabled: false },
  revision: 0,
  addedAt: "2026-01-01",
};
it("evaluates typed AND/OR rules without confusing false, zero, and missing", () => {
  expect(
    matchesRules(
      contact,
      [
        { property: "age", operator: "greater_than", value: 20 },
        { property: "city", operator: "contains", value: "SYD" },
      ],
      "all",
    ),
  ).toBe(true);
  expect(
    matchesRules(
      contact,
      [{ property: "enabled", operator: "equals", value: false }],
      "all",
    ),
  ).toBe(true);
  expect(
    matchesRules(
      contact,
      [{ property: "missing", operator: "not_equals", value: "Sydney" }],
      "all",
    ),
  ).toBe(false);
  expect(
    matchesRules(
      contact,
      [{ property: "missing", operator: "is_not_set" }],
      "all",
    ),
  ).toBe(true);
  expect(
    matchesRules(
      contact,
      [
        { property: "age", operator: "less_than", value: 20 },
        { property: "city", operator: "equals", value: "Sydney" },
      ],
      "any",
    ),
  ).toBe(true);
});
it("validates property types and real calendar dates and rejects reserved keys", () => {
  expect(validateValue({ key: "count", type: "number" }, 0)).toBe(0);
  expect(() => validateValue({ key: "count", type: "number" }, "3")).toThrow();
  expect(() =>
    validateValue({ key: "date", type: "date" }, "2026-02-30"),
  ).toThrow();
  expect(
    propertyInput.safeParse({ key: "email", type: "string" }).success,
  ).toBe(false);
  expect(
    propertyInput.safeParse({ key: "constructor", type: "string" }).success,
  ).toBe(false);
});
it("escapes recipient values, accepts both token syntaxes, and keeps false fallbacks", () => {
  const draft = draftInput.parse({
    name: "Test",
    subject: "Hello {{contact.name}}",
    text: "{{contact.first_name}} {{{contact.plan}}}",
    html: "<h1>{{contact.first_name}}</h1>",
  });
  const definitions = [
    { key: "plan", type: "boolean", fallback: false },
  ] as PropertyDefinition[];
  const values = personalizationValues(draft, contact, definitions),
    result = personalize(draft, values);
  expect(result.subject).toBe("Hello Alex");
  expect(result.text).toBe("<Alex & Co> false");
  expect(result.html).toBe("<h1>&lt;Alex &amp; Co&gt;</h1>");
});
it("rejects missing or unknown properties and tokens inside HTML attributes", () => {
  expect(() =>
    personalizationValues(
      draftInput.parse({ name: "Test", text: "{{contact.last_name}}" }),
      contact,
      [],
    ),
  ).toThrow(/Missing last_name/);
  expect(() =>
    personalizationValues(
      draftInput.parse({ name: "Test", text: "{{contact.missing}}" }),
      contact,
      [],
    ),
  ).toThrow(/Unknown/);
  expect(() =>
    personalizationKeys(
      draftInput.parse({
        name: "Test",
        html: '<a href="{{contact.name}}">Link</a>',
      }),
    ),
  ).toThrow(/only appear/);
});
it("allows message personalization after a closed style element but rejects tokens inside CSS", () => {
  expect(
    personalizationKeys(
      draftInput.parse({
        name: "Styled",
        html: "<style>p{color:red}</style><p>{{contact.name}}</p>",
      }),
    ),
  ).toEqual(["name"]);
  expect(() =>
    personalizationKeys(
      draftInput.parse({
        name: "Unsafe",
        html: "<style>p{color:{{contact.name}}}</style>",
      }),
    ),
  ).toThrow();
});
