import { inspectAuthentication } from "./domain-authentication.js";
import type { MailFromSettings } from "./domain-authentication-model.js";
import nodemailer from "nodemailer";
import { priorityHeaders } from "./email-options.js";
import {
  SESv2Client,
  SendEmailCommand,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
} from "@aws-sdk/client-sesv2";
import type { Config } from "./config.js";
import type { Domain, EmailInput } from "./model.js";

export interface Transport {
  send(
    input: EmailInput,
    id: string,
    unsubscribeUrl?: string,
  ): Promise<{ id: string; captured: boolean }>;
}
export function unsubscribeHeaders(url?: string): Record<string, string> {
  return url
    ? {
        "List-Unsubscribe": `<${url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : {};
}
export function createTransport(config: Config, trackEvents = true): Transport {
  if (config.NARADA_MODE === "local") {
    const smtp = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
      connectionTimeout: 5000,
      socketTimeout: 10000,
    });
    return {
      async send(input, id, unsubscribeUrl) {
        const result = await smtp.sendMail({
          from: input.from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          replyTo: input.reply_to,
          headers: {
            "X-Narada-Id": id,
            ...priorityHeaders(input.priority),
            ...unsubscribeHeaders(unsubscribeUrl),
          },
        });
        return { id: result.messageId, captured: true };
      },
    };
  }
  // Retrying an ambiguous SES response can duplicate an email. Reconciliation owns that decision.
  const ses = new SESv2Client({ region: config.AWS_REGION, maxAttempts: 1 });
  return {
    async send(input, id, unsubscribeUrl) {
      const result = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: input.from,
          Destination: { ToAddresses: input.to },
          ReplyToAddresses: input.reply_to ? [input.reply_to] : undefined,
          Content: {
            Simple: {
              Headers: Object.entries({
                ...priorityHeaders(input.priority),
                ...unsubscribeHeaders(unsubscribeUrl),
              }).map(([Name, Value]) => ({ Name, Value })),
              Subject: { Data: input.subject },
              Body: {
                Html: input.html ? { Data: input.html } : undefined,
                Text: input.text ? { Data: input.text } : undefined,
              },
            },
          },
          EmailTags: trackEvents
            ? [{ Name: "narada_id", Value: id }]
            : undefined,
          ConfigurationSetName: trackEvents
            ? config.SES_CONFIGURATION_SET
            : undefined,
        }),
      );
      return { id: result.MessageId!, captured: false };
    },
  };
}
export async function verifyDomain(
  config: Config,
  name: string,
  create = false,
  localSettings?: MailFromSettings,
): Promise<Domain> {
  if (config.NARADA_MODE === "local")
    return {
      pk: `DOMAIN#${name}`,
      sk: "META",
      scope: "domains",
      sort: name,
      name,
      verified: true,
      records: [],
      authentication: await inspectAuthentication(
        config,
        name,
        undefined,
        localSettings,
      ),
      local: true,
      region: config.AWS_REGION,
      checkedAt: new Date().toISOString(),
    };
  const ses = new SESv2Client({ region: config.AWS_REGION });
  if (create) {
    try {
      await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: name }));
    } catch (e) {
      if (!(e instanceof Error && e.name === "AlreadyExistsException")) throw e;
    }
  }
  const identity = await ses.send(
    new GetEmailIdentityCommand({ EmailIdentity: name }),
  );
  return {
    pk: `DOMAIN#${name}`,
    sk: "META",
    scope: "domains",
    sort: name,
    name,
    verified: !!identity.VerifiedForSendingStatus,
    authentication: await inspectAuthentication(config, name, identity),
    local: false,
    region: config.AWS_REGION,
    checkedAt: new Date().toISOString(),
    records: (identity.DkimAttributes?.Tokens ?? []).map((t) => ({
      type: "CNAME",
      name: `${t}._domainkey.${name}`,
      value: `${t}.dkim.amazonses.com`,
    })),
  };
}
