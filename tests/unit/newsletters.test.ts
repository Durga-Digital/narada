import { expect, it } from "vitest";
import { issueInput, publicationInput } from "@narada/core/newsletter-model";
import { renderIssue } from "@narada/core/newsletter-content";
const draft = (content: unknown[]) =>
  issueInput.parse({
    title: "News <&>",
    slug: "news",
    document: { type: "doc", content },
  });
it("derives escaped web and text content from the structured issue", () => {
  const rendered = renderIssue(
    draft([
      {
        type: "heading",
        attrs: { level: 2, onclick: "evil()" },
        content: [{ type: "text", text: "Hello <script>" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Read",
            marks: [
              { type: "bold" },
              { type: "link", attrs: { href: "https://example.com/?a=1&b=2" } },
            ],
          },
        ],
      },
    ]),
  );
  expect(rendered.html).toContain("News &lt;&amp;&gt;");
  expect(rendered.html).toContain('<a href="https://example.com/?a=1&amp;b=2"');
  expect(rendered.html).toContain("<strong>Read</strong>");
  expect(rendered.html).not.toMatch(/onclick|<script>/);
  expect(rendered.text).toContain("Hello <script>");
});
it.each([
  "javascript:alert(1)",
  "data:text/html,evil",
  "vbscript:evil",
  "//example.com",
  "/relative",
])("rejects unsafe or ambiguous link %s", (href) => {
  expect(() =>
    renderIssue(
      draft([
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Link",
              marks: [{ type: "link", attrs: { href } }],
            },
          ],
        },
      ]),
    ),
  ).toThrow();
});
it.each(["script", "iframe", "table", "unknown"])(
  "rejects unsupported block %s",
  (type) => {
    expect(() => renderIssue(draft([{ type }]))).toThrow(
      "Unsupported newsletter block",
    );
  },
);
it("rejects empty content, personalization, and excessive nesting", () => {
  expect(() => renderIssue(draft([{ type: "paragraph" }]))).toThrow(
    "Write some issue content",
  );
  expect(() =>
    renderIssue(draft([{ type: "text", text: "Hi {{contact.email}}" }])),
  ).toThrow("personalization");
  let node: object = { type: "text", text: "Deep" };
  for (let i = 0; i < 25; i++) node = { type: "blockquote", content: [node] };
  expect(() => renderIssue(draft([node]))).toThrow("too complex");
});
it("validates public slug, colors, headers and privacy links", () => {
  for (const value of [
    { slug: "../secret" },
    { color: "red;display:none" },
    { privacyUrl: "javascript:alert(1)" },
    { from: "hello@example.com\nBcc:other@example.com" },
  ])
    expect(
      publicationInput.safeParse({ name: "News", slug: "news", ...value })
        .success,
    ).toBe(false);
});

it("rejects malformed formatting and inherited names instead of interpreting them as blocks", () => {
  expect(() =>
    renderIssue(
      draft([
        { type: "constructor", content: [{ type: "text", text: "Invalid" }] },
      ]),
    ),
  ).toThrow("Unsupported newsletter block");
  expect(() =>
    renderIssue(
      draft([
        {
          type: "paragraph",
          content: [{ type: "text", text: "Invalid", marks: [null] }],
        },
      ]),
    ),
  ).toThrow("Invalid text formatting");
});
