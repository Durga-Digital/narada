import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  importContacts,
  unsubscribeToken,
  readUnsubscribeToken,
  renderBroadcast,
  broadcastMessageId,
  draftInput,
} from "@narada/core/broadcast-model";
import { unsubscribeHeaders } from "@narada/core/transport";
describe("broadcast contracts", () => {
  it("imports quoted CSV, handles BOM, and deduplicates normalized emails", () => {
    const rows = importContacts(
      '\uFEFFemail,name\nA@example.com,"Alex, Smith"\na@example.com,Alex',
      "Signup",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("a@example.com");
    expect(
      importContacts('email,name\na@example.com,"Alex, Smith"', "Signup")[0]
        ?.name,
    ).toBe("Alex, Smith");
  });
  it("rejects malformed CSV and invalid addresses", () => {
    expect(() => importContacts("not-an-email", "source")).toThrow();
    expect(() => importContacts('a@example.com,"unclosed', "source")).toThrow();
    expect(() => importContacts("email,name", "source")).toThrow();
  });
  it("binds unsubscribe tokens to the audience and rejects tampering", () => {
    const audienceId = randomUUID(),
      token = unsubscribeToken("secret", audienceId, "a@example.com");
    expect(readUnsubscribeToken("secret", token)).toEqual({
      audienceId,
      email: "a@example.com",
    });
    expect(() => readUnsubscribeToken("wrong", token)).toThrow();
    expect(() => readUnsubscribeToken("secret", token + ".extra")).toThrow();
  });
  it("creates stable UUIDs for one message per recipient per broadcast", () => {
    const id = randomUUID();
    expect(broadcastMessageId(id, "a@example.com")).toBe(
      broadcastMessageId(id, "a@example.com"),
    );
    expect(broadcastMessageId(id, "b@example.com")).not.toBe(
      broadcastMessageId(id, "a@example.com"),
    );
    expect(broadcastMessageId(id, "a@example.com")).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-a[\da-f]{3}-[\da-f]{12}$/,
    );
  });
  it("escapes plain text and inserts the unsubscribe footer inside HTML documents", () => {
    const draft = draftInput.parse({
      name: "Test",
      text: "<script>bad</script>",
      organization: "A & B",
      postalAddress: "<Street>",
    });
    const body = renderBroadcast(draft, "https://example.com/unsubscribe");
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("A &amp; B");
    expect(body.text).toContain("Unsubscribe: https://example.com/unsubscribe");
    expect(
      renderBroadcast(
        { ...draft, html: "<html><body>Hello</body></html>" },
        "#",
      ).html,
    ).toContain("</footer></body>");
  });
  it("adds one-click headers only to broadcasts", () => {
    expect(unsubscribeHeaders()).toEqual({});
    expect(unsubscribeHeaders("https://example.com/u")).toEqual({
      "List-Unsubscribe": "<https://example.com/u>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
it("preserves structured editor content and rejects oversized documents or unsafe Reply-To", () => {
  const document = {
    type: "doc" as const,
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Hello" }],
      },
    ],
  };
  expect(
    draftInput.parse({ name: "Blocks", document, replyTo: "reply@example.com" })
      .document,
  ).toEqual(document);
  expect(() =>
    draftInput.parse({
      name: "Blocks",
      document: { type: "not-a-doc", content: [] },
    }),
  ).toThrow();
  expect(() =>
    draftInput.parse({
      name: "Blocks",
      document: {
        type: "doc",
        content: [{ type: "text", text: "x".repeat(100001) }],
      },
    }),
  ).toThrow();
  expect(() =>
    draftInput.parse({
      name: "Blocks",
      replyTo: "a@example.com\r\nBcc: b@example.com",
    }),
  ).toThrow();
});
it("keeps existing source drafts compatible without requiring an editor document", () => {
  const draft = draftInput.parse({
    name: "Legacy",
    html: "<h1>Original HTML</h1>",
    text: "Original text",
  });
  expect(draft.document).toBeUndefined();
  expect(
    renderBroadcast(draft, "https://example.com/unsubscribe").html,
  ).toContain("<h1>Original HTML</h1>");
});
