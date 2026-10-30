import { describe, expect, it } from "vitest";
import { dnsHost } from "../../apps/web/src/features/domains/dns-names.js";

describe("DNS hosts for provider forms", () => {
  it("avoids repeating the Squarespace zone while keeping the DKIM selector", () => {
    expect(
      dnsHost("token._domainkey.example.com", {
        zone: "example.com",
        format: "relative",
      }),
    ).toBe("token._domainkey");
  });
  it("preserves sending subdomains and handles separately delegated zones", () => {
    expect(
      dnsHost("token._domainkey.mail.example.co.uk", {
        zone: "example.co.uk",
        format: "relative",
      }),
    ).toBe("token._domainkey.mail");
    expect(
      dnsHost("token._domainkey.mail.example.co.uk", {
        zone: "mail.example.co.uk",
        format: "relative",
      }),
    ).toBe("token._domainkey");
    expect(
      dnsHost("bounce.mail.example.co.uk", {
        zone: "example.co.uk",
        format: "relative",
      }),
    ).toBe("bounce.mail");
  });
  it("handles root hosts, case and trailing dots", () => {
    expect(
      dnsHost("EXAMPLE.COM.", { zone: " example.com. ", format: "relative" }),
    ).toBe("@");
    expect(
      dnsHost("_dmarc.example.com", {
        zone: "example.com",
        format: "relative",
      }),
    ).toBe("_dmarc");
  });
  it("refuses unrelated or invalid zones rather than copying a misleading host", () => {
    for (const zone of [
      "",
      "com",
      "ample.com",
      "other.com",
      "https://example.com",
      "example.com/path",
    ]) {
      expect(
        dnsHost("token._domainkey.example.com", { zone, format: "relative" }),
      ).toBeNull();
    }
  });
  it("leaves full DNS names complete regardless of the zone input", () => {
    expect(
      dnsHost("token._domainkey.mail.example.com", {
        zone: "",
        format: "full",
      }),
    ).toBe("token._domainkey.mail.example.com");
  });
});
