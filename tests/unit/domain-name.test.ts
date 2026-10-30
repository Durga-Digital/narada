import { it, expect } from "vitest";
import { normalizeDomainName, validDomainName } from "@narada/core/domain-name";
it("normalizes hostnames while rejecting URLs, addresses, and invalid DNS labels", () => {
  expect(normalizeDomainName("  Mail.Example.COM  ")).toBe("mail.example.com");
  for (const name of [
    "example.com",
    "mail.example.com",
    "xn--bcher-kva.example",
    `${"a".repeat(63)}.example`,
  ])
    expect(validDomainName(name)).toBe(true);
  for (const name of [
    "https://example.com",
    "me@example.com",
    "example.com/path",
    "-mail.example.com",
    "mail-.example.com",
    "mail..example.com",
    `${"a".repeat(64)}.example`,
    "localhost",
    "a.".repeat(127) + "com",
  ])
    expect(validDomainName(name)).toBe(false);
});
