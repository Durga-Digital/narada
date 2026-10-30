import { it, expect } from "vitest";
import {
  templateInput,
  renderTemplate,
  validateTemplate,
} from "@narada/core/template-model";
import {
  starters,
  editableTemplate,
} from "../../apps/web/src/features/templates/starters.js";
const content = (extra: Record<string, unknown> = {}) =>
  templateInput.parse({
    name: "Welcome",
    subject: "Hello {{vars.name}}",
    html: "<p>{{vars.name}}</p>",
    text: "{{vars.name}}",
    variables: [{ key: "name", type: "string", fallback: "Friend" }],
    ...extra,
  });
it("renders typed variables and fallbacks with escaped HTML and literal false/zero", () => {
  expect(
    renderTemplate(content(), { name: "<img src=x onerror=alert(1)>" }).html,
  ).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  expect(renderTemplate(content()).subject).toBe("Hello Friend");
  const c = content({
    subject: "Values",
    text: "{{vars.count}} {{vars.enabled}}",
    html: "",
    variables: [
      { key: "count", type: "number", fallback: 0 },
      { key: "enabled", type: "boolean", fallback: false },
    ],
  });
  expect(renderTemplate(c).text).toBe("0 false");
  expect(() => renderTemplate(c, { count: "2" })).toThrow("must be number");
});
it("allows explicit HTTP URL variables only in complete quoted hrefs", () => {
  const c = content({
    subject: "Reset password",
    html: '<a href="{{vars.reset_url}}">Reset</a>',
    text: "{{vars.reset_url}}",
    variables: [{ key: "reset_url", type: "url" }],
  });
  expect(
    renderTemplate(c, { reset_url: "https://example.com/reset?a=1&b=2" }).html,
  ).toContain("a=1&amp;b=2");
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.com",
  ])
    expect(() => renderTemplate(c, { reset_url: url })).toThrow("HTTP(S)");
  expect(() =>
    validateTemplate({ ...c, html: '<img src="{{vars.reset_url}}">' }),
  ).toThrow();
  expect(() =>
    validateTemplate({
      ...c,
      html: `<a onclick='const x = "href=\"{{vars.reset_url}}\""'>Link</a>`,
    }),
  ).toThrow();
  expect(() =>
    validateTemplate({
      ...c,
      html: '<a title="x > {{vars.reset_url}}">Link</a>',
    }),
  ).toThrow();

  expect(() =>
    validateTemplate({
      ...c,
      html: '<a href="https://example.com/{{vars.reset_url}}">Reset</a>',
    }),
  ).toThrow();
});
it("rejects unsafe contexts, missing or unknown variables, expressions and header injection", () => {
  expect(() => renderTemplate(content(), { other: "x" })).toThrow("Unknown");
  expect(() =>
    renderTemplate(content({ variables: [{ key: "name", type: "string" }] })),
  ).toThrow("Missing");
  for (const html of [
    '<p style="color:{{vars.name}}">Hi</p>',
    "<script>{{vars.name}}</script>",
    "<style>p{color:{{vars.name}}}</style>",
  ])
    expect(() => validateTemplate(content({ html }))).toThrow();
  expect(() =>
    renderTemplate(content(), { name: "x\r\nBcc: evil@example.com" }),
  ).toThrow("subject");
  expect(() => renderTemplate(content(), { name: "{{vars.secret}}" })).toThrow(
    "expressions",
  );
  expect(() => validateTemplate(content({ html: "{{unknown}}" }))).toThrow();
  expect(() =>
    validateTemplate(
      content({
        variables: [
          { key: "name", type: "string" },
          { key: "name", type: "string" },
        ],
      }),
    ),
  ).toThrow("unique");
});
it("keeps contact personalization for broadcasts and validates all starter designs", () => {
  const broadcast = content({
    kind: "broadcast",
    subject: "Hi {{contact.first_name}}",
    text: "{{contact.email}}",
  });
  expect(renderTemplate(broadcast).subject).toBe("Hi {{contact.first_name}}");
  expect(() =>
    validateTemplate({ ...broadcast, kind: "transactional" }),
  ).toThrow("contact properties");
  for (const [key, starter] of Object.entries(starters)) {
    validateTemplate(templateInput.parse(starter), !key.startsWith("blank"));
  }
});

it("accepts editor CSS braces without accepting variables in CSS", () => {
  const html =
    "<style>@media (prefers-color-scheme: dark){li::marker{color:#ccc}}</style><p>{{vars.name}}</p>";
  expect(renderTemplate(content({ html })).html).toContain("<p>Friend</p>");
  expect(() =>
    validateTemplate(
      content({
        html: "<style>@media screen {p{color:{{vars.name}}}}</style>",
      }),
    ),
  ).toThrow();
  expect(() =>
    validateTemplate(content({ html: "<p>broken }}</p>" })),
  ).toThrow();
});
it("recognizes unchanged legacy starter bodies without converting custom imports", () => {
  const starter = starters.welcome!;
  const legacy = { ...starter, document: undefined, subject: "Custom subject" };
  expect(editableTemplate(legacy).document).toEqual(starter.document);
  const imported = { ...legacy, html: starter.html + "<p>Custom footer</p>" };
  expect(editableTemplate(imported)).toBe(imported);
  const customPlainText = { ...legacy, text: "Custom plain text" };
  expect(editableTemplate(customPlainText)).toBe(customPlainText);
});
