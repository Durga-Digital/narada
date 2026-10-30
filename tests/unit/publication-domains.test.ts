import { expect, it } from "vitest";
import {
  normalizePublicationHostname,
  isDomainChild,
  shortRecordName,
  publicAddress,
} from "@narada/core/publication-domain-dns";
import { domainConfigureInput } from "@narada/contracts/publication-domains";
import {
  domainIsPublic,
  type DomainConnection,
} from "@narada/core/publication-domains";

it("normalizes IDNA subdomains and preserves exact verified-parent label boundaries", () => {
  expect(normalizePublicationHostname("News.Example.COM.")).toBe(
    "news.example.com",
  );
  expect(normalizePublicationHostname("bücher.example.com")).toBe(
    "xn--bcher-kva.example.com",
  );
  expect(normalizePublicationHostname("news.example.co.uk")).toBe(
    "news.example.co.uk",
  );
  expect(
    shortRecordName("_acm.news.example.co.uk.", "news.example.co.uk"),
  ).toBe("_acm.news");
  expect(isDomainChild("news.mail.example.com", "mail.example.com")).toBe(true);
  expect(isDomainChild("notmail.example.com", "mail.example.com")).toBe(false);
  expect(isDomainChild("news.example.com", "mail.example.com")).toBe(false);
});
it.each([
  "example.com",
  "co.uk",
  "localhost",
  "news.local",
  "127.0.0.1",
  "[::1]",
  "*.example.com",
  "https://news.example.com",
  "news.example.com:443",
  "u@news.example.com",
  "news.example.com/path",
  " news.example.com",
  "news.example.com..",
  "_news.example.com",
  "-news.example.com",
  "a".repeat(64) + ".example.com",
  "news.github.io",
  "foo%2eexample.com",
])("rejects invalid or unsupported host %s", (value) => {
  // github.io is a private suffix: news.github.io is a tenant apex, not a subdomain.
  expect(() => normalizePublicationHostname(value)).toThrow();
});
it("blocks infrastructure hostnames and bounds transport inputs", () => {
  expect(() =>
    normalizePublicationHostname("mail.example.com", ["mail.example.com"]),
  ).toThrow();
  expect(
    domainConfigureInput.safeParse({ hostname: "x".repeat(254), revision: 0 })
      .success,
  ).toBe(false);
  expect(
    domainConfigureInput.safeParse({
      hostname: "news.example.com",
      revision: -1,
    }).success,
  ).toBe(false);
  expect(
    domainConfigureInput.safeParse({
      hostname: "news.example.com",
      revision: 0,
      enabled: true,
    }).success,
  ).toBe(false);
});
it.each([
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.1.1",
  "100.64.0.1",
  "203.0.113.1",
  "0.0.0.0",
  "::1",
  "::",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
  "ff00::1",
])("refuses private/reserved probe destination %s", (address) =>
  expect(publicAddress(address)).toBe(false),
);
it("allows only a recently healthy, valid and explicitly active binding", () => {
  const row = {
    desired: "active",
    status: "active",
    certificate: {
      status: "issued",
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    },
    lastHealthyAt: new Date().toISOString(),
  } as DomainConnection;
  expect(domainIsPublic(row)).toBe(true);
  expect(domainIsPublic({ ...row, desired: "disconnected" })).toBe(false);
  expect(domainIsPublic({ ...row, status: "ready" })).toBe(false);
  expect(
    domainIsPublic({
      ...row,
      lastHealthyAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
    }),
  ).toBe(false);
  expect(
    domainIsPublic({
      ...row,
      certificate: { status: "issued", expiresAt: "2020-01-01T00:00:00Z" },
    }),
  ).toBe(false);
});

it("resolves legacy article links against their old base while preserving fragments and absolute media", async () => {
  const { publicationContentLinks } =
    await import("@narada/core/publication-content-links");
  const html = publicationContentLinks(
    '<a href="../older">Old</a><a href="#heading">Jump</a><img src="/media/a.png"><a href="https://example.org?q=1&amp;x=2">External</a>',
    "https://app.example.com/n/studio/p/first",
  );
  expect(html).toContain('href="https://app.example.com/n/studio/older"');
  expect(html).toContain('href="#heading"');
  expect(html).toContain('src="https://app.example.com/media/a.png"');
  expect(html).toContain('href="https://example.org?q=1&amp;x=2"');
});
