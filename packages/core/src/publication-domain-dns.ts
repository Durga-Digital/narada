import { Resolver } from "node:dns/promises";
import { domainToASCII } from "node:url";
import { isIP } from "node:net";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import { parse } from "tldts";
import { AppError } from "./model.js";

export function normalizePublicationHostname(
  input: string,
  blocked: string[] = [],
) {
  if (!input || input !== input.trim() || /[\s/:@*\\?#%]/.test(input))
    throw new AppError(422, "Enter a subdomain only, such as news.example.com");
  const name = domainToASCII(input.replace(/\.$/, "")).toLowerCase();
  const labels = name.split(".");
  const suffix = parse(name, { allowPrivateDomains: true });
  if (
    !name ||
    name.length > 253 ||
    isIP(name) ||
    !suffix.domain ||
    !suffix.subdomain ||
    (!suffix.isIcann && !suffix.isPrivate) ||
    labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))
  )
    throw new AppError(
      422,
      "Choose a valid public subdomain; apex domains and IP addresses are not supported",
    );
  if (blocked.some((h) => name === h.toLowerCase()))
    throw new AppError(
      409,
      "This hostname is already used by Narada or email delivery",
    );
  return name;
}
export const isDomainChild = (hostname: string, parent: string) =>
  hostname.endsWith(`.${parent.toLowerCase()}`);
export const dnsName = (name: string) => name.toLowerCase().replace(/\.$/, "");
export function shortRecordName(name: string, hostname: string) {
  const domain = parse(hostname, { allowPrivateDomains: true }).domain;
  return domain && dnsName(name).endsWith(`.${domain}`)
    ? dnsName(name).slice(0, -domain.length - 1)
    : name;
}
export type DnsAnswer =
  { status: "known"; values: string[] } | { status: "unknown"; values: [] };
export interface PublicationDns {
  resolve(
    name: string,
    type: "TXT" | "CNAME" | "A" | "AAAA" | "MX",
  ): Promise<DnsAnswer>;
  probe(hostname: string, nonce: string): Promise<boolean>;
}
export function publicAddress(address: string) {
  try {
    const parsed = ipaddr.parse(address);
    return (
      parsed.range() === "unicast" &&
      !(
        parsed.kind() === "ipv6" &&
        (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      )
    );
  } catch {
    return false;
  }
}
/** DNS resolution and the actual socket share the same validated addresses. No redirects. */
export class PublicPublicationDns implements PublicationDns {
  private resolver = new Resolver({ timeout: 2000, tries: 1 });
  async resolve(
    name: string,
    type: "TXT" | "CNAME" | "A" | "AAAA" | "MX",
  ): Promise<DnsAnswer> {
    try {
      const values =
        type === "TXT"
          ? (await this.resolver.resolveTxt(name)).map((parts) =>
              parts.join(""),
            )
          : type === "MX"
            ? (await this.resolver.resolveMx(name)).map((r) => r.exchange)
            : ((await this.resolver.resolve(name, type)) as string[]);
      return { status: "known", values };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENODATA" || code === "ENOTFOUND"
        ? { status: "known", values: [] }
        : { status: "unknown", values: [] };
    }
  }
  async probe(hostname: string, nonce: string) {
    normalizePublicationHostname(hostname);
    const results = await Promise.all([
      this.resolve(hostname, "A"),
      this.resolve(hostname, "AAAA"),
    ]);
    if (results.some((r) => r.status === "unknown")) return false;
    const addresses = results.flatMap((r) => r.values);
    if (!addresses.length || addresses.some((a) => !publicAddress(a)))
      return false;
    return new Promise<boolean>((resolve) => {
      const req = request(
        {
          hostname,
          port: 443,
          path: "/.well-known/narada-site",
          method: "GET",
          servername: hostname,
          rejectUnauthorized: true,
          agent: false,
          lookup: (_host, options, callback) =>
            callback(
              null,
              options.all
                ? addresses.map((address) => ({
                    address,
                    family: isIP(address),
                  }))
                : addresses[0]!,
              options.all ? undefined : isIP(addresses[0]!),
            ),
          timeout: 5000,
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > 512) req.destroy();
          });
          response.on("end", () =>
            resolve(response.statusCode === 200 && body === nonce),
          );
          response.on("error", () => resolve(false));
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(false));
      req.end();
    });
  }
}
