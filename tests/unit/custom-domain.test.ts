import { describe, expect, it } from "vitest";
import { customDomainConfig } from "../../infrastructure/custom-domain.js";

const account = "222222222222";
const certificateArn = `arn:aws:acm:us-east-1:${account}:certificate/12345678-1234-1234-1234-123456789012`;
describe("custom domain deployment configuration", () => {
  it("keeps existing CloudFront deployments unchanged until explicitly configured", () => {
    expect(customDomainConfig({}, account)).toBeUndefined();
    expect(
      customDomainConfig(
        { NARADA_CUSTOM_DOMAIN: "", NARADA_CERTIFICATE_ARN: "" },
        account,
      ),
    ).toBeUndefined();
    expect(
      customDomainConfig(
        {
          NARADA_CUSTOM_DOMAIN: "mail.example.com",
          NARADA_CERTIFICATE_ARN: certificateArn,
        },
        account,
      )?.origin,
    ).toBe("https://mail.example.com");
  });
  it("rejects incomplete, cross-account and wrong-region certificate configuration", () => {
    expect(() =>
      customDomainConfig({ NARADA_CUSTOM_DOMAIN: "mail.example.com" }, account),
    ).toThrow("together");
    expect(() =>
      customDomainConfig({ NARADA_CERTIFICATE_ARN: certificateArn }, account),
    ).toThrow("together");
    for (const arn of [
      certificateArn.replace("us-east-1", "ap-southeast-2"),
      certificateArn.replace(account, "111111111111"),
    ])
      expect(() =>
        customDomainConfig(
          {
            NARADA_CUSTOM_DOMAIN: "mail.example.com",
            NARADA_CERTIFICATE_ARN: arn,
          },
          account,
        ),
      ).toThrow("deployment account");
  });
  it("rejects URLs, wildcards and malformed DNS names", () => {
    for (const name of [
      "https://mail.example.com",
      "mail.example.com/path",
      "*.example.com",
      "-mail.example.com",
      "narada..com",
      "mail.example.com:443",
    ])
      expect(() =>
        customDomainConfig(
          {
            NARADA_CUSTOM_DOMAIN: name,
            NARADA_CERTIFICATE_ARN: certificateArn,
          },
          account,
        ),
      ).toThrow("DNS hostname");
  });
});
