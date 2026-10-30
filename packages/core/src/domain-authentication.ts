import { Resolver } from "node:dns/promises";
import { getDomain } from "tldts";
import {
  SESv2Client,
  PutEmailIdentityMailFromAttributesCommand,
  PutEmailIdentityDkimAttributesCommand,
  type GetEmailIdentityCommandOutput,
} from "@aws-sdk/client-sesv2";
import type { Config } from "./config.js";
import { AppError } from "./model.js";
import { validDomainName } from "./domain-name.js";
import type {
  DmarcCheck,
  DomainAuthentication,
  MailFromSettings,
  DnsCheck,
} from "./domain-authentication-model.js";
export type DnsReader = Pick<Resolver, "resolveTxt" | "resolveMx">;
export const createDnsReader = (): DnsReader =>
  new Resolver({ timeout: 2000, tries: 1 });
const noRecord = (error: unknown) =>
  ["ENODATA", "ENOTFOUND"].includes(
    (error as NodeJS.ErrnoException)?.code ?? "",
  );

export function parseDmarc(name: string, records: string[]): DmarcCheck {
  const candidates = records.filter((v) =>
    /^v\s*=\s*DMARC1(?:;|\s|$)/i.test(v.trim()),
  );
  const base = { name };
  if (!candidates.length)
    return { ...base, status: "missing", message: "No DMARC policy found." };
  if (candidates.length !== 1)
    return {
      ...base,
      status: "invalid",
      message:
        "Multiple DMARC policies found. Publish one policy at this name.",
    };
  const record = candidates[0]!.trim();
  const tags: Record<string, string> = {};
  const invalid = (message: string): DmarcCheck => ({
    ...base,
    record,
    status: "invalid",
    message,
  });
  const entries = record
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const match = /^([a-z][a-z0-9]*)\s*=\s*(.+)$/i.exec(entry);
    if (!match || tags[match[1]!.toLowerCase()] !== undefined)
      return invalid(
        "Malformed or duplicate DMARC tags. Review the existing record before changing it.",
      );
    tags[match[1]!.toLowerCase()] = match[2]!.trim();
  }
  if (
    entries[0] !== "v=DMARC1" ||
    !["none", "quarantine", "reject"].includes(tags.p ?? "")
  )
    return invalid(
      "DMARC must start with v=DMARC1 and include p=none, p=quarantine, or p=reject.",
    );
  if (
    (tags.sp && !["none", "quarantine", "reject"].includes(tags.sp)) ||
    [tags.adkim, tags.aspf].some((v) => v && !["r", "s"].includes(v)) ||
    (tags.pct !== undefined &&
      (!/^\d{1,3}$/.test(tags.pct) || Number(tags.pct) > 100))
  )
    return invalid("Invalid policy, alignment, or percentage tag.");
  if (
    tags.rua &&
    tags.rua
      .split(",")
      .some(
        (uri) =>
          !/^mailto:[^\s@,]+@[^\s@,]+(?:!\d+[kmgt]?)?$/i.test(uri.trim()),
      )
  )
    return invalid("Review the aggregate reporting addresses in rua.");
  return {
    ...base,
    record,
    status: "found",
    policy: tags.p as DmarcCheck["policy"],
    alignment: {
      dkim: (tags.adkim ?? "r") as "r" | "s",
      spf: (tags.aspf ?? "r") as "r" | "s",
    },
    message:
      "Policy found. This checks common record syntax, not authentication of an individual email or report mailbox authorization.",
  };
}
export async function checkDmarc(
  domain: string,
  dns: DnsReader = createDnsReader(),
): Promise<DmarcCheck> {
  const organization = getDomain(domain, { allowPrivateDomains: true });
  const names = [...new Set([domain, ...(organization ? [organization] : [])])];
  for (const candidate of names) {
    const name = `_dmarc.${candidate}`;
    let records: string[][];
    try {
      records = await dns.resolveTxt(name);
    } catch (e) {
      if (noRecord(e)) continue;
      return {
        name,
        status: "unknown",
        message:
          "DNS lookup could not complete. Try checking again; no policy change is needed based on this result alone.",
      };
    }
    const parsed = parseDmarc(
      name,
      records.map((chunks) => chunks.join("")),
    );
    if (parsed.status === "missing") continue;
    if (candidate !== domain) {
      parsed.inherited = true;
      const sp = parsed.record?.match(
        /(?:^|;)\s*sp\s*=\s*(none|quarantine|reject)\s*(?:;|$)/,
      )?.[1];
      if (parsed.status === "found" && sp)
        parsed.policy = sp as DmarcCheck["policy"];
    }
    return parsed;
  }
  return {
    name: `_dmarc.${domain}`,
    status: "missing",
    message:
      "No policy found at the sender domain or its organizational domain. Publish one TXT policy, then check again.",
  };
}
export function mailFromRecords(domain: string, region: string) {
  const suffix = "amazonses.com";
  return [
    { name: domain, type: "MX", value: `10 feedback-smtp.${region}.${suffix}` },
    { name: domain, type: "TXT", value: `v=spf1 include:${suffix} ~all` },
  ];
}
export function validateMailFrom(identity: string, domain: string | null) {
  if (
    domain !== null &&
    (!validDomainName(domain) || !domain.endsWith(`.${identity}`))
  )
    throw new AppError(
      400,
      "Use a dedicated subdomain of this sending domain, such as bounce." +
        identity,
    );
}
async function mailFromDns(
  domain: string,
  region: string,
  dns: DnsReader,
): Promise<{ mx: DnsCheck; spf: DnsCheck }> {
  const expected = mailFromRecords(domain, region);
  const check = async (read: () => Promise<boolean>): Promise<DnsCheck> => {
    try {
      return (await read()) ? "found" : "invalid";
    } catch (e) {
      return noRecord(e) ? "missing" : "unknown";
    }
  };
  const [mx, spf] = await Promise.all([
    check(async () => {
      const rows = await dns.resolveMx(domain);
      return (
        rows.length === 1 &&
        rows[0]!.priority === 10 &&
        `10 ${rows[0]!.exchange.toLowerCase().replace(/\.$/, "")}` ===
          expected[0]!.value
      );
    }),
    check(async () => {
      const rows = (await dns.resolveTxt(domain))
        .map((v) => v.join("").trim())
        .filter((v) => /^v=spf1(?:\s|$)/i.test(v));
      return (
        rows.length === 1 &&
        rows[0]!.replace(/\s+/g, " ") === expected[1]!.value
      );
    }),
  ]);
  return { mx, spf };
}
export async function inspectAuthentication(
  config: Config,
  name: string,
  identity?: GetEmailIdentityCommandOutput,
  localSettings?: MailFromSettings,
  dns: DnsReader = createDnsReader(),
): Promise<DomainAuthentication> {
  const local = config.NARADA_MODE === "local";
  const from = identity?.MailFromAttributes;
  const domain = local
    ? (localSettings?.domain ?? null)
    : (from?.MailFromDomain ?? null);
  const [dmarc, checks] = await Promise.all([
    local
      ? Promise.resolve({
          name: `_dmarc.${name}`,
          status: "local" as const,
          message:
            "DNS is not queried locally. These are setup previews, not verification results.",
        })
      : checkDmarc(name, dns),
    local
      ? Promise.resolve({ mx: "local" as const, spf: "local" as const })
      : domain
        ? mailFromDns(domain, config.AWS_REGION, dns)
        : Promise.resolve({ mx: "unknown" as const, spf: "unknown" as const }),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    dkim: {
      status: local ? "LOCAL" : (identity?.DkimAttributes?.Status ?? "UNKNOWN"),
      signingEnabled: local
        ? null
        : (identity?.DkimAttributes?.SigningEnabled ?? null),
      origin: identity?.DkimAttributes?.SigningAttributesOrigin,
    },
    dmarc,
    mailFrom: {
      domain,
      behavior:
        (local ? localSettings?.behavior : from?.BehaviorOnMxFailure) ??
        "USE_DEFAULT_VALUE",
      status: local
        ? "LOCAL"
        : domain
          ? (from?.MailFromDomainStatus ?? "UNKNOWN")
          : "DEFAULT",
      records: domain ? mailFromRecords(domain, config.AWS_REGION) : [],
      ...checks,
    },
  };
}
export async function configureMailFrom(
  config: Config,
  identity: string,
  settings: MailFromSettings,
) {
  validateMailFrom(identity, settings.domain);
  if (config.NARADA_MODE === "local") return;
  await new SESv2Client({ region: config.AWS_REGION }).send(
    new PutEmailIdentityMailFromAttributesCommand({
      EmailIdentity: identity,
      MailFromDomain: settings.domain ?? undefined,
      BehaviorOnMxFailure: settings.behavior,
    }),
  );
}
export async function enableDkim(config: Config, identity: string) {
  if (config.NARADA_MODE === "local") return;
  await new SESv2Client({ region: config.AWS_REGION }).send(
    new PutEmailIdentityDkimAttributesCommand({
      EmailIdentity: identity,
      SigningEnabled: true,
    }),
  );
}
