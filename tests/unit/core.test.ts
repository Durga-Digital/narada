import { describe, it, expect } from "vitest";
import { loadConfig, awsOptions } from "@narada/core/config";
import {
  emailInput,
  nextStatus,
  domainOf,
  type DeliveryEvent,
} from "@narada/core/model";
import {
  publicAddress,
  signWebhook,
  validateWebhookUrl,
} from "@narada/core/webhooks";
describe("local isolation", () => {
  const env = { BETTER_AUTH_SECRET: "a".repeat(40) };
  it("uses dummy AWS credentials even with ambient credentials", () =>
    expect(awsOptions(loadConfig(env)).credentials?.accessKeyId).toBe(
      "naradalocal",
    ));
  it("refuses external local endpoints", () => {
    expect(() =>
      loadConfig({
        ...env,
        DYNAMODB_ENDPOINT: "https://dynamodb.us-east-1.amazonaws.com",
      }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...env, SMTP_HOST: "smtp.example.com" }),
    ).toThrow();
  });
  it("refuses endpoint overrides in AWS mode", () =>
    expect(() =>
      loadConfig({
        ...env,
        NARADA_MODE: "aws",
        SQS_ENDPOINT: "http://localhost:9324",
      }),
    ).toThrow());
});
describe("email contract", () => {
  const input = {
    from: "Narada <hello@narada.test>",
    to: "TEST@example.com",
    subject: "Welcome",
    text: "Hello",
  };
  it("normalizes recipient and sets expiry", () =>
    expect(emailInput.parse(input)).toMatchObject({
      to: ["test@example.com"],
      expires_in: 3600,
    }));
  it("extracts sender domains", () =>
    expect(domainOf(input.from)).toBe("narada.test"));
  it.each([
    { subject: "hello\r\nBcc: attacker@example.com" },
    { from: "hi\nhi@example.com" },
    { to: [] },
    { text: undefined },
    { expires_in: 2 },
    { unexpected: true },
  ])("rejects malformed input %j", (patch) =>
    expect(emailInput.safeParse({ ...input, ...patch }).success).toBe(false),
  );
});
describe("feedback ordering", () => {
  const event = (
    type: DeliveryEvent["type"],
    permanent = true,
  ): DeliveryEvent => ({
    id: "id",
    type,
    at: new Date().toISOString(),
    recipients: ["a@example.com"],
    permanent,
  });
  it("never downgrades a complaint or hard bounce", () => {
    expect(nextStatus("complained", event("delivered"))).toBe("complained");
    expect(nextStatus("bounced", event("delivered"))).toBe("bounced");
    expect(nextStatus("delivered", event("delayed"))).toBe("delivered");
  });
  it("treats transient bounce as delay", () =>
    expect(nextStatus("sent", event("bounced", false))).toBe("delayed"));
});
describe("webhook security", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "224.0.0.1",
  ])("blocks %s", (ip) => expect(publicAddress(ip)).toBe(false));
  it("accepts public IPv4", () => expect(publicAddress("8.8.8.8")).toBe(true));
  it("binds signature to event, time, and raw body", () => {
    const s = signWebhook("secret", "event", "123", "{}");
    expect(s).toHaveLength(64);
    expect(signWebhook("secret", "event", "124", "{}")).not.toBe(s);
    expect(signWebhook("secret", "event", "123", "{ }")).not.toBe(s);
  });
  it("only exempts exact local receiver", async () => {
    await expect(
      validateWebhookUrl(
        "http://localhost:3001/api/dev/webhook-receiver",
        true,
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateWebhookUrl("http://localhost:3001/other", true),
    ).rejects.toThrow();
    await expect(
      validateWebhookUrl("https://127.0.0.1", false),
    ).rejects.toThrow();
  });
});
