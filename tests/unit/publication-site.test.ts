import { expect, it } from "vitest";
import {
  aboutInput,
  siteInput,
  defaultSite,
  collectionInput,
  collectionIdsInput,
} from "@narada/contracts/publication-site";
import { newsletterPage, newsletterHome } from "@narada/core/newsletter-page";
import {
  publicationInput,
  type Publication,
} from "@narada/core/newsletter-model";
const pub: Publication = {
  pk: "PUBLICATION#p",
  sk: "META",
  id: "p",
  revision: 1,
  status: "active",
  topicId: "t",
  audienceId: "a",
  formId: "f",
  createdAt: "now",
  updatedAt: "now",
  settings: publicationInput.parse({ name: "Notes", slug: "notes" }),
};
it("rejects unsafe external destinations and duplicate or oversized navigation", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/\nattack",
  ]) {
    expect(
      siteInput.safeParse({
        ...defaultSite,
        navigation: [{ type: "external", label: "Visit", url }],
      }).success,
    ).toBe(false);
  }
  expect(
    siteInput.safeParse({
      ...defaultSite,
      navigation: [
        ...defaultSite.navigation,
        { type: "home", label: "Duplicate" },
      ],
    }).success,
  ).toBe(false);
  expect(
    siteInput.safeParse({
      ...defaultSite,
      navigation: Array.from({ length: 9 }, () => ({
        type: "external",
        label: "Visit",
        url: "https://example.com",
      })),
    }).success,
  ).toBe(false);
  expect(
    siteInput.safeParse({ ...defaultSite, collectionIds: ["a", "b", "c", "d"] })
      .success,
  ).toBe(false);
  expect(collectionIdsInput.safeParse(["a", "a"]).success).toBe(false);
  expect(
    collectionIdsInput.safeParse(["a", "b", "c", "d", "e", "f"]).success,
  ).toBe(false);
});
it("bounds collection fields and accepts safe editorial text without executing it", () => {
  expect(
    collectionInput.safeParse({ name: "N", slug: "../about", description: "" })
      .success,
  ).toBe(false);
  expect(
    collectionInput.safeParse({
      name: "x".repeat(101),
      slug: "valid",
      description: "",
    }).success,
  ).toBe(false);
  expect(
    aboutInput.safeParse({
      title: "About",
      document: { type: "doc", content: [] },
      html: "<script>",
    }).success,
  ).toBe(false);
  const html = newsletterPage(pub, "Content", {
    origin: "https://example.com",
    path: "/n/notes",
    navigation: [
      {
        label: '<img src=x onerror="alert(1)">',
        href: 'https://example.com/?q="bad"&a=1',
      },
    ],
  });
  expect(html).toContain("&lt;img");
  expect(html).toContain("&quot;bad&quot;&amp;a=1");
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("<summary>Menu</summary>");
});
it("labels manually curated features and keeps previews non-navigable", () => {
  const body = newsletterHome(
    pub,
    [{ title: "An older issue", slug: "older", subtitle: "" }],
    "",
    undefined,
    undefined,
    true,
  );
  expect(body).toContain("Featured issue");
  expect(body).not.toContain("Latest issue");
  const html = newsletterPage(pub, body, {
    origin: "https://example.com",
    path: "/n/notes",
    preview: true,
    private: true,
    navigation: [{ label: "Collection", href: "/n/notes/c/research" }],
  });
  expect(html).not.toContain("<a href=");
  expect(html).toContain("noindex,nofollow");
});
it("preserves configured Subscribe ordering and supplies a primary action when omitted", () => {
  const options = {
    origin: "https://example.com",
    path: "/n/notes",
    navigation: [
      { href: "/n/notes/subscribe", label: "Join" },
      { href: "/n/notes/archive", label: "Archive" },
    ],
  };
  const html = newsletterPage(pub, "", options);
  const desktop = html
    .split('<nav aria-label="Publication navigation">')[1]!
    .split("</nav>")[0]!;
  expect(desktop.indexOf(">Join</a>")).toBeLessThan(
    desktop.indexOf(">Archive</a>"),
  );
  expect(desktop.match(/class="subscribe-link"/g)).toHaveLength(1);
  const fallback = newsletterPage(pub, "", { ...options, navigation: [] });
  expect(fallback).toContain('class="subscribe-link"');
});
