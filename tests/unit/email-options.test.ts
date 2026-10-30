import { afterEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { emailInput } from "@narada/core/model";
import { createTransport } from "@narada/core/transport";
import { loadConfig } from "@narada/core/config";

const body = {
  from: "hello@narada.test",
  to: "a@example.com",
  subject: "Audit",
  text: "Request",
};
afterEach(() => vi.restoreAllMocks());
describe("message tags", () => {
  it("accepts migration metadata and canonicalizes key order", () => {
    const tags = {
      source: "audit",
      tier: "premium",
      tag: "enquiry",
      urgency: "urgent",
    };
    expect(emailInput.parse({ ...body, tags }).tags).toEqual(tags);
    expect(JSON.stringify(emailInput.parse({ ...body, tags }))).toBe(
      JSON.stringify(
        emailInput.parse({
          ...body,
          tags: Object.fromEntries(Object.entries(tags).reverse()),
        }),
      ),
    );
  });
  it.each([
    { source: 1 },
    { source: "" },
    { source: "x\r\nInjected: yes" },
    { "bad key": "value" },
    { ["a".repeat(65)]: "value" },
    { constructor: "value" },
    JSON.parse('{"__proto__":"value"}'),
    { source: "v".repeat(257) },
    Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`key${i}`, "v"])),
    [{ name: "source", value: "audit" }],
    null,
  ])("rejects invalid tags %j", (tags) => {
    expect(emailInput.safeParse({ ...body, tags }).success).toBe(false);
  });
  it("continues to reject custom headers and invalid priority", () => {
    for (const patch of [
      { priority: "urgent" },
      { priority: "high\r\nBcc: x" },
      { headers: { From: "other@example.com" } },
    ])
      expect(emailInput.safeParse({ ...body, ...patch }).success).toBe(false);
  });
});
describe("priority delivery", () => {
  const config = loadConfig({ BETTER_AUTH_SECRET: "a".repeat(40) });
  it.each([undefined, "normal", "high"] as const)(
    "generates real SMTP headers for %s without leaking tags",
    async (priority) => {
      const stream = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
      });
      const sendMail = vi.spyOn(stream, "sendMail");
      vi.spyOn(nodemailer, "createTransport").mockReturnValue(stream);
      await createTransport(config).send(
        emailInput.parse({
          ...body,
          priority,
          tags: { source: "private-audit" },
        }),
        "message-id",
      );
      const result = await sendMail.mock.results[0]!.value;
      const raw = result.message.toString();
      expect(raw).not.toContain("private-audit");
      expect(raw).toMatch(/X-Narada-Id: message-id/i);
      if (priority === "high") {
        expect(raw).toMatch(/X-Priority: 1 \(Highest\)/i);
        expect(raw).toMatch(/Importance: High/i);
        expect(raw).toMatch(/X-MSMail-Priority: High/i);
      } else expect(raw).not.toMatch(/(?:X-Priority|Importance):/i);
    },
  );
  it("passes high priority and generated unsubscribe headers to SES", async () => {
    const send = vi
      .spyOn(SESv2Client.prototype, "send")
      .mockResolvedValue({ MessageId: "ses-id" } as never);
    await createTransport({ ...config, NARADA_MODE: "aws" }).send(
      emailInput.parse({
        ...body,
        priority: "high",
        tags: { source: "private-audit" },
      }),
      "message-id",
      "https://example.com/unsubscribe",
    );
    const command = send.mock.calls[0]![0] as { input: unknown };
    expect(command.input).toMatchObject({
      Content: {
        Simple: {
          Headers: expect.arrayContaining([
            { Name: "Importance", Value: "High" },
            { Name: "X-Priority", Value: "1 (Highest)" },
            { Name: "X-MSMail-Priority", Value: "High" },
            {
              Name: "List-Unsubscribe",
              Value: "<https://example.com/unsubscribe>",
            },
          ]),
        },
      },
      EmailTags: [{ Name: "narada_id", Value: "message-id" }],
    });
    expect(JSON.stringify(command.input)).not.toContain("private-audit");
  });
});
