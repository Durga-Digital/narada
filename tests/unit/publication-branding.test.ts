import { expect, it, vi } from "vitest";
import {
  defaultBranding,
  brandingInput,
  logoInput,
  LOGO_MAX_ENCODED,
} from "@narada/contracts/branding";
import {
  accentColors,
  newsletterPage,
  newsletterHome,
  newsletterSignup,
} from "@narada/core/newsletter-page";
import {
  publicationInput,
  type Publication,
} from "@narada/core/newsletter-model";
import { Narada } from "../../packages/sdk/src/index.js";
const pub: Publication = {
  pk: "PUBLICATION#test",
  sk: "META",
  id: "test",
  revision: 0,
  status: "active",
  topicId: "t",
  audienceId: "a",
  formId: "f",
  createdAt: "now",
  updatedAt: "now",
  settings: publicationInput.parse({
    name: "Studio & friends",
    slug: "studio",
    color: "#ffffff",
  }),
};
it("renders all themes with safe copy, accessible accent contrast and disabled private previews", () => {
  for (const theme of ["classic", "editorial", "minimal"] as const) {
    const p = {
      ...pub,
      branding: {
        ...defaultBranding,
        theme,
        welcomeText: '<script>alert("x")</script>',
      },
    };
    const body = newsletterHome(
      p,
      [],
      newsletterSignup(p, 3, "submission", true),
    );
    const html = newsletterPage(p, body, {
      origin: "https://example.test",
      path: "/n/studio",
      private: true,
      preview: true,
    });
    expect(html).toContain(`data-theme="${theme}"`);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('content="website"');
    expect(html).toContain("noindex,nofollow");
    expect(html).not.toContain("<a href=");
    expect(html).toContain("<fieldset disabled>");
    expect(html).toContain("No public issues yet");
    expect(html).toContain('name="version" value="3"');
  }
  for (const color of ["#ffffff", "#000000", "#345d37", "#777777", "#ff0000"]) {
    const selected = accentColors(color);
    const luminance = (hex: string) =>
      [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    const a = luminance(selected.accent),
      b = luminance(selected.onAccent);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  }
});
it("bounds cards, keeps the latest out of recent issues, and hides signup for archived publications", () => {
  const cards = Array.from({ length: 8 }, (_, i) => ({
    title: `Issue ${i}`,
    subtitle: "",
    slug: `issue-${i}`,
    publishedAt: "2026-10-24T00:00:00Z",
  }));
  const html = newsletterHome(
    { ...pub, status: "archived" },
    cards,
    "PRIVATE SIGNUP",
  );
  expect(html).not.toContain("PRIVATE SIGNUP");
  expect(html).toContain("archived");
  expect(html.match(/href="\/n\/studio\/p\/issue-0"/g)).toHaveLength(1);
  expect(html).toContain("Issue 5");
  expect(html).not.toContain("Issue 6");
});
it("rejects arbitrary CSS, unknown branding fields, unsafe asset references and oversized logo inputs", () => {
  expect(
    brandingInput.safeParse({ ...defaultBranding, theme: "custom" }).success,
  ).toBe(false);
  expect(
    brandingInput.safeParse({ ...defaultBranding, css: "body{}" }).success,
  ).toBe(false);
  expect(
    brandingInput.safeParse({
      ...defaultBranding,
      logoAssetId: "https://evil.test/image.png",
    }).success,
  ).toBe(false);
  expect(
    logoInput.safeParse({
      fileName: "x.png",
      contentBase64: "A".repeat(LOGO_MAX_ENCODED + 4),
    }).success,
  ).toBe(false);
});
it("SDK byte helper serializes the same bounded upload contract and explicit retry key", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ id: "asset" }));
  const sdk = new Narada({
    apiKey: "test",
    baseUrl: "https://example.test",
    fetch: transport,
  });
  await sdk.publications.logo.uploadBytes(
    "pub/1",
    { fileName: "logo.png", bytes: new Uint8Array([1, 2, 3]) },
    { idempotencyKey: "same-upload" },
  );
  const [url, init] = transport.mock.calls[0]!;
  expect(String(url)).toContain("/publications/pub%2F1/logo");
  expect(JSON.parse(String(init?.body))).toEqual({
    fileName: "logo.png",
    contentBase64: "AQID",
  });
  expect(new Headers(init?.headers).get("idempotency-key")).toBe("same-upload");
  expect(() =>
    sdk.publications.logo.uploadBytes("p", {
      fileName: "x",
      bytes: new Uint8Array(512 * 1024 + 1),
    }),
  ).toThrow("512 KiB");
});
it("escapes signup and image descriptions across fixed layouts while retaining consent", () => {
  const image = {
    id: "a".repeat(64),
    publicationId: "test",
    url: "https://example.test/media/a.png",
    contentType: "image/png" as const,
    width: 1200,
    height: 600,
  };
  for (const layout of ["letter", "feature", "grid"] as const) {
    const p = {
      ...pub,
      branding: {
        ...defaultBranding,
        layout,
        signupHeading: "<script>bad()</script>",
        signupButton: "<img onerror=bad()>",
        signupDescription: "Weekly & thoughtful",
        signupName: false,
        coverAlt: '" onload="bad()',
      },
    };
    const signup = newsletterSignup(p, 1, "submission");
    const html = newsletterHome(
      p,
      [{ title: "First", subtitle: "", slug: "first", cover: image }],
      signup,
      undefined,
      image,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Confirm your address");
    expect(html).not.toContain('name="name"');
    expect(html).toContain(`layout-${layout}`);
    expect(
      brandingInput.safeParse({ ...p.branding, html: "<div>" }).success,
    ).toBe(false);
  }
});
