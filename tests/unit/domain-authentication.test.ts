import { expect, it, vi, afterEach } from "vitest";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { loadConfig } from "@narada/core/config";
import {
  checkDmarc,
  parseDmarc,
  inspectAuthentication,
  configureMailFrom,
  enableDkim,
  validateMailFrom,
} from "@narada/core/domain-authentication";
const config = loadConfig({
  NARADA_MODE: "local",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-chars",
});
afterEach(() => vi.restoreAllMocks());
it("parses policies without treating duplicate or malformed records as valid", () => {
  expect(
    parseDmarc("_dmarc.example.com", [
      "v=DMARC1; p=none; rua=mailto:reports@example.com;",
    ]),
  ).toMatchObject({ status: "found", policy: "none" });
  for (const rows of [
    ["v=DMARC1; p=reject", "v=DMARC1; p=none"],
    ["v=DMARC1; p=invalid"],
    ["v=DMARC1; p=none; p=reject"],
    ["v=DMARC1; p=none; pct=101"],
    ["v=DMARC1; p=none; aspf=x"],
    ["v=DMARC1; p=none; rua=not-an-email"],
  ])
    expect(parseDmarc("_dmarc.example.com", rows).status).toBe("invalid");
});
it("joins split TXT strings and uses organizational-domain subdomain policy", async () => {
  const resolveTxt = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error(), { code: "ENODATA" }))
    .mockResolvedValueOnce([["v=DMARC1; p=reject; ", "sp=quarantine; aspf=s"]]);
  const result = await checkDmarc("mail.example.co.uk", {
    resolveTxt,
    resolveMx: vi.fn(),
  });
  expect(result).toMatchObject({
    status: "found",
    inherited: true,
    name: "_dmarc.example.co.uk",
    policy: "quarantine",
    alignment: { spf: "s" },
  });
  expect(resolveTxt.mock.calls.map((c) => c[0])).toEqual([
    "_dmarc.mail.example.co.uk",
    "_dmarc.example.co.uk",
  ]);
});
it("does not fall back past an invalid explicit policy or call a timeout a missing record", async () => {
  const resolveTxt = vi.fn().mockResolvedValue([["v=DMARC1; p=oops"]]);
  expect(
    (await checkDmarc("mail.example.com", { resolveTxt, resolveMx: vi.fn() }))
      .status,
  ).toBe("invalid");
  expect(resolveTxt).toHaveBeenCalledTimes(1);
  resolveTxt.mockRejectedValue(
    Object.assign(new Error(), { code: "ETIMEOUT" }),
  );
  expect(
    (await checkDmarc("mail.example.com", { resolveTxt, resolveMx: vi.fn() }))
      .status,
  ).toBe("unknown");
});
it("keeps local previews isolated from both AWS and DNS", async () => {
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockImplementation(() => {
      throw new Error("Unexpected AWS call");
    });
  const dns = { resolveTxt: vi.fn(), resolveMx: vi.fn() };
  const settings = {
    domain: "bounce.example.com",
    behavior: "REJECT_MESSAGE" as const,
  };
  await configureMailFrom(config, "example.com", settings);
  await enableDkim(config, "example.com");
  const result = await inspectAuthentication(
    config,
    "example.com",
    undefined,
    settings,
    dns,
  );
  expect(result).toMatchObject({
    dkim: { status: "LOCAL", signingEnabled: null },
    dmarc: { status: "local" },
    mailFrom: {
      domain: "bounce.example.com",
      status: "LOCAL",
      mx: "local",
      spf: "local",
    },
  });
  expect(send).not.toHaveBeenCalled();
  expect(dns.resolveTxt).not.toHaveBeenCalled();
  expect(dns.resolveMx).not.toHaveBeenCalled();
});
it("separates SES identity status, DKIM signing and MAIL FROM DNS readiness", async () => {
  const dns = {
    resolveTxt: vi.fn(async (name: string) =>
      name.startsWith("_dmarc.")
        ? [["v=DMARC1; p=none"]]
        : [["v=spf1 include:amazonses.com ~all"]],
    ),
    resolveMx: vi.fn(async () => [
      { priority: 10, exchange: "feedback-smtp.us-east-1.amazonses.com." },
    ]),
  };
  const result = await inspectAuthentication(
    { ...config, NARADA_MODE: "aws" },
    "example.com",
    {
      $metadata: {},
      VerifiedForSendingStatus: true,
      DkimAttributes: { Status: "SUCCESS", SigningEnabled: false },
      MailFromAttributes: {
        MailFromDomain: "bounce.example.com",
        MailFromDomainStatus: "PENDING",
        BehaviorOnMxFailure: "REJECT_MESSAGE",
      },
    },
    undefined,
    dns,
  );
  expect(result.dkim.signingEnabled).toBe(false);
  expect(result.mailFrom).toMatchObject({
    status: "PENDING",
    mx: "found",
    spf: "found",
    behavior: "REJECT_MESSAGE",
  });
  dns.resolveMx.mockResolvedValue([
    { priority: 10, exchange: "mx.inbox.example.com" },
    { priority: 10, exchange: "feedback-smtp.us-east-1.amazonses.com" },
  ]);
  expect(
    (
      await inspectAuthentication(
        { ...config, NARADA_MODE: "aws" },
        "example.com",
        {
          $metadata: {},
          MailFromAttributes: {
            MailFromDomain: "bounce.example.com",
            MailFromDomainStatus: "PENDING",
            BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
          },
        },
        undefined,
        dns,
      )
    ).mailFrom.mx,
  ).toBe("invalid");
});
it("validates dedicated subdomains and sends the correct SES configuration commands", async () => {
  for (const domain of [
    "example.com",
    "evil-example.com",
    "bounce.other.com",
    "https://bounce.example.com",
  ])
    expect(() => validateMailFrom("example.com", domain)).toThrow();
  expect(() =>
    validateMailFrom("example.com", "bounce.example.com"),
  ).not.toThrow();
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockResolvedValue({} as never);
  const aws = { ...config, NARADA_MODE: "aws" as const };
  await configureMailFrom(aws, "example.com", {
    domain: "bounce.example.com",
    behavior: "REJECT_MESSAGE",
  });
  expect(send.mock.calls[0]![0].input).toMatchObject({
    EmailIdentity: "example.com",
    MailFromDomain: "bounce.example.com",
    BehaviorOnMxFailure: "REJECT_MESSAGE",
  });
  await configureMailFrom(aws, "example.com", {
    domain: null,
    behavior: "USE_DEFAULT_VALUE",
  });
  expect(send.mock.calls[1]![0].input).toMatchObject({
    EmailIdentity: "example.com",
    MailFromDomain: undefined,
  });
  await enableDkim(aws, "example.com");
  expect(send.mock.calls[2]![0].input).toMatchObject({ SigningEnabled: true });
});
