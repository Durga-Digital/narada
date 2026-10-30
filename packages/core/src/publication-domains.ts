import {
  publicOrigin,
  apiOrigin,
  dashboardOrigin,
  assetOrigin,
} from "./origins.js";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type {
  PublicationDomain,
  PublicationDomainResult,
  PublicationDomainRecord,
} from "@narada/contracts/types";
import {
  domainConfigureInput,
  domainRevisionInput,
} from "@narada/contracts/publication-domains";
import type { Store } from "./store.js";
import { conditional } from "./store.js";
import { AppError, type Entity, type Domain } from "./model.js";
import type { Publication } from "./newsletter-model.js";
import { newsletterCommit } from "./publications.js";
import type { MutationCommit } from "./idempotency.js";
import {
  normalizePublicationHostname,
  shortRecordName,
  dnsName,
  type PublicationDns,
  type DnsAnswer,
} from "./publication-domain-dns.js";
import {
  DomainProviderError,
  type DomainProviderBinding,
  type PublicationDomainProvider,
} from "./publication-domain-provider.js";

type Writes = NonNullable<TransactWriteCommandInput["TransactItems"]>;
export type DomainConnection = Entity &
  DomainProviderBinding & {
    publicationId: string;
    revision: number;
    observation: number;
    status: PublicationDomain["state"];
    desired: "ready" | "active" | "disconnected";
    records: PublicationDomainRecord[];
    certificate: PublicationDomain["certificate"];
    routing: PublicationDomain["routing"];
    nonce: string;
    distributionIntent?: boolean;
    createdAt: string;
    lastCheckedAt?: string;
    lastHealthyAt?: string;
    certificateWarningAt?: string;
    ownershipLossAt?: number;
    ownershipLosses: number;
    errors: number;
    leaseUntil: number;
    checkRequestedAt: number;
    message?: string;
  };
type DomainLink = Entity & { id: string; revision: number };
type Capacity = Entity & { count: number; version: number; created: number[] };
const key = (id: string) => `PUBLICATIONDOMAIN#${id}`;
const linkKey = (id: string) => `PUBLICATIONDOMAINLINK#${id}`;
const reservationKey = (name: string) => `PUBLICATIONDOMAINHOST#${name}`;
const nowIso = () => new Date().toISOString();
const unhealthyAfter = 24 * 60 * 60_000;
export function domainIsPublic(row: DomainConnection | undefined) {
  return (
    !!row &&
    row.desired === "active" &&
    row.status === "active" &&
    row.certificate.status === "issued" &&
    Date.parse(row.certificate.expiresAt ?? "") > Date.now() &&
    Date.parse(row.lastHealthyAt ?? "") + unhealthyAfter > Date.now()
  );
}
export class PublicationDomains {
  constructor(
    readonly store: Store,
    readonly dns: PublicationDns,
    readonly provider: PublicationDomainProvider,
  ) {}
  async connection(publicationId: string) {
    const link = await this.store.get<DomainLink>(linkKey(publicationId));
    return link ? this.store.get<DomainConnection>(key(link.id)) : undefined;
  }
  defaultUrl(pub: Publication) {
    return new URL(`/n/${pub.settings.slug}`, publicOrigin(this.store.config))
      .href;
  }
  result(pub: Publication, row?: DomainConnection): PublicationDomainResult {
    const defaultUrl = this.defaultUrl(pub),
      preferredUrl = domainIsPublic(row)
        ? `https://${row!.hostname}`
        : defaultUrl;
    return {
      defaultUrl,
      preferredUrl,
      domain: row
        ? {
            id: row.id,
            publicationId: row.publicationId,
            hostname: row.hostname,
            revision: row.revision,
            state: row.status,
            records: row.records,
            certificate: row.certificate,
            routing: row.routing,
            ...(row.lastCheckedAt ? { lastCheckedAt: row.lastCheckedAt } : {}),
            ...(row.state === "publication-domain" &&
            typeof row.due === "number"
              ? { nextCheckAt: new Date(row.due).toISOString() }
              : {}),
            ...(row.message ? { message: row.message } : {}),
            defaultUrl,
            preferredUrl,
          }
        : null,
    };
  }
  async get(pub: Publication) {
    return this.result(pub, await this.connection(pub.id));
  }
  private guard(pub: Publication) {
    return {
      ConditionCheck: {
        TableName: this.store.config.APP_TABLE,
        Key: { pk: pub.pk, sk: pub.sk },
        ConditionExpression: "revision = :r",
        ExpressionAttributeValues: { ":r": pub.revision },
      },
    };
  }
  private replace(row: DomainConnection, observation: number) {
    return {
      Put: {
        TableName: this.store.config.APP_TABLE,
        Item: row,
        ConditionExpression: "observation = :o",
        ExpressionAttributeValues: { ":o": observation },
      },
    };
  }
  private async capacity() {
    return (
      (await this.store.get<Capacity>("PUBLICATIONDOMAINCAPACITY")) ?? {
        pk: "PUBLICATIONDOMAINCAPACITY",
        sk: "META",
        count: 0,
        version: 0,
        created: [],
      }
    );
  }
  private capacityWrite(row: Capacity, change: number) {
    const created = row.created.filter((at) => at > Date.now() - 3600_000);
    if (
      change > 0 &&
      (row.count >= this.store.config.PUBLICATION_DOMAIN_LIMIT ||
        created.length >= this.store.config.PUBLICATION_DOMAIN_LIMIT)
    )
      throw new AppError(
        429,
        "Publication domain capacity reached; finish cleanup or retry after an hour",
      );
    return {
      Put: {
        TableName: this.store.config.APP_TABLE,
        Item: {
          ...row,
          count: row.count + change,
          version: row.version + 1,
          created: change > 0 ? [...created, Date.now()] : created,
        },
        ConditionExpression: row.version
          ? "#v = :v"
          : "attribute_not_exists(pk)",
        ...(row.version
          ? {
              ExpressionAttributeNames: { "#v": "version" },
              ExpressionAttributeValues: { ":v": row.version },
            }
          : {}),
      },
    };
  }
  async configure(pub: Publication, raw: unknown, commit?: MutationCommit) {
    const input = domainConfigureInput.parse(raw);
    if (!this.provider.available)
      throw new AppError(
        503,
        "Publication hosting is not configured on this installation",
      );
    const blocked = [
      publicOrigin(this.store.config),
      apiOrigin(this.store.config),
      dashboardOrigin(this.store.config),
      assetOrigin(this.store.config),
      this.store.config.BETTER_AUTH_URL,
    ].map((origin) => new URL(origin).hostname);
    if (this.store.config.PUBLICATION_SITE_ORIGIN)
      blocked.push(new URL(this.store.config.PUBLICATION_SITE_ORIGIN).hostname);
    // Stored diagnostics are only used internally to avoid occupying a known MAIL FROM host.
    const senders = await this.store.list<Domain>("domains", 1000);
    for (const sender of senders)
      if (sender.authentication?.mailFrom.domain)
        blocked.push(sender.authentication.mailFrom.domain);
    const hostname = normalizePublicationHostname(input.hostname, blocked);
    const previous = await this.connection(pub.id);
    if (input.revision !== (previous?.revision ?? 0))
      throw new AppError(
        409,
        "Domain configuration changed; reload before continuing",
      );
    if (previous && previous.status !== "disconnected")
      throw new AppError(
        409,
        "Disconnect the current domain and finish cleanup before connecting another",
      );
    const id = randomUUID(),
      value = `narada=${randomBytes(32).toString("hex")}`;
    const row: DomainConnection = {
      pk: key(id),
      sk: "META",
      scope: "publication-domains",
      sort: nowIso(),
      id,
      publicationId: pub.id,
      hostname,
      secret: randomBytes(32).toString("hex"),
      nonce: randomBytes(32).toString("hex"),
      revision: input.revision + 1,
      observation: 0,
      status: "awaiting_ownership",
      desired: "ready",
      state: "publication-domain",
      due: Date.now(),
      createdAt: nowIso(),
      leaseUntil: 0,
      ownershipLosses: 0,
      errors: 0,
      checkRequestedAt: Date.now(),
      certificate: { status: "not_requested" },
      routing: "not_created",
      records: [
        {
          purpose: "ownership",
          type: "TXT",
          name: `_narada.${hostname}`,
          shortName: shortRecordName(`_narada.${hostname}`, hostname),
          value,
          status: "pending",
        },
      ],
      message:
        "Publish the ownership TXT record, then check DNS. Keep this record while connected.",
    };
    const writes: Writes = [
      this.guard(pub),
      this.store.create(row),
      this.store.create({
        pk: reservationKey(hostname),
        sk: "META",
        id,
        publicationId: pub.id,
      }),
      this.capacityWrite(await this.capacity(), 1),
      {
        Put: {
          TableName: this.store.config.APP_TABLE,
          Item: { pk: linkKey(pub.id), sk: "META", id, revision: row.revision },
          ConditionExpression: previous
            ? "id = :id AND revision = :r"
            : "attribute_not_exists(pk)",
          ...(previous
            ? {
                ExpressionAttributeValues: {
                  ":id": previous.id,
                  ":r": previous.revision,
                },
              }
            : {}),
        },
      },
    ];
    return newsletterCommit(this.store, writes, this.result(pub, row), commit);
  }
  async mutate(
    pub: Publication,
    action: "check" | "activate" | "disconnect",
    raw: unknown,
    commit?: MutationCommit,
  ) {
    const { revision } = domainRevisionInput.parse(raw),
      row = await this.connection(pub.id);
    if (!row) throw new AppError(404, "No custom domain is configured");
    if (row.revision !== revision)
      throw new AppError(
        409,
        "Domain configuration changed; reload before continuing",
      );
    if (row.status === "disconnected")
      throw new AppError(409, "This domain has been disconnected");
    if (
      action === "activate" &&
      (row.status !== "ready" || row.desired === "disconnected")
    )
      throw new AppError(
        409,
        "Wait for DNS and HTTPS readiness before activating",
      );
    if (action === "check" && Date.now() - row.checkRequestedAt < 30_000)
      throw new AppError(
        429,
        "A check was recently requested; wait 30 seconds",
      );
    const next: DomainConnection = {
      ...row,
      revision: revision + 1,
      observation: row.observation + 1,
      state: "publication-domain",
      due: Date.now(),
      errors: 0,
      checkRequestedAt: Date.now(),
      ...(action === "activate" ? { desired: "active" } : {}),
      ...(action === "disconnect"
        ? {
            desired: "disconnected",
            status: "disconnecting",
            message:
              "Default publication URLs are in use. Remove the website CNAME to finish cleanup.",
          }
        : {}),
    };
    return newsletterCommit(
      this.store,
      [
        this.guard(pub),
        this.replace(next, row.observation),
        {
          Put: {
            TableName: this.store.config.APP_TABLE,
            Item: {
              pk: linkKey(pub.id),
              sk: "META",
              id: row.id,
              revision: next.revision,
            },
            ConditionExpression: "id = :id AND revision = :r",
            ExpressionAttributeValues: { ":id": row.id, ":r": revision },
          },
        },
      ],
      this.result(pub, next),
      commit,
    );
  }
  private record(
    row: DomainConnection,
    purpose: PublicationDomainRecord["purpose"],
    name: string,
    value: string,
  ) {
    const old = row.records.find((r) => r.purpose === purpose);
    const record: PublicationDomainRecord = {
      purpose,
      name,
      shortName: shortRecordName(name, row.hostname),
      type: purpose === "ownership" ? "TXT" : "CNAME",
      value,
      status: old?.status ?? "pending",
    };
    row.records = [...row.records.filter((r) => r.purpose !== purpose), record];
    return record;
  }
  private async observe(record: PublicationDomainRecord) {
    const answer = await this.dns.resolve(record.name, record.type);
    record.status =
      answer.status === "unknown"
        ? "unknown"
        : answer.values.some((v) =>
              record.type === "TXT"
                ? v === record.value
                : dnsName(v) === dnsName(record.value),
            )
          ? "verified"
          : "missing";
    return answer;
  }
  async run(id: string) {
    let row = await this.store.get<DomainConnection>(key(id));
    if (
      !row ||
      row.status === "disconnected" ||
      row.state !== "publication-domain" ||
      row.leaseUntil > Date.now()
    )
      return;
    const claimed = {
      ...row,
      observation: row.observation + 1,
      leaseUntil: Date.now() + 120_000,
    };
    try {
      await this.store.transaction([this.replace(claimed, row.observation)]);
    } catch (e) {
      if (conditional(e)) return;
      throw e;
    }
    row = structuredClone(claimed);
    const previousStatus = row.status;
    row.lastCheckedAt = nowIso();
    row.due = Date.now() + 60_000;
    row.message = undefined;
    try {
      if (row.desired === "disconnected") await this.cleanup(row);
      else await this.advance(row);
      row.errors = 0;
    } catch (e) {
      row.errors++;
      row.message =
        e instanceof DomainProviderError && e.code === "reconcile"
          ? "Provider outcome needs operator reconciliation. Resources remain reserved; do not create replacements."
          : "The provider or DNS check could not complete. Existing resources remain reserved; retry the check.";
      const providerName = e instanceof Error ? e.name : "";
      if (
        [
          "TooManyDistributions",
          "TooManyCertificates",
          "LimitExceededException",
        ].includes(providerName)
      )
        row.message =
          "AWS hosting or certificate quota reached. Ask the operator to check account quotas before retrying.";
      if (providerName === "CNAMEAlreadyExists")
        row.message =
          "This hostname is attached to another CloudFront distribution. Resolve that connection before retrying.";
      if (["AccessDenied", "AccessDeniedException"].includes(providerName))
        row.message =
          "AWS denied provisioning. Ask the operator to verify the publication hosting permissions and account configuration.";
      if (row.errors >= 8) {
        row.status = "failed";
        row.state = "complete";
      }
      row.due = Date.now() + Math.min(3600_000, 30_000 * 2 ** row.errors);
    }
    row.observation++;
    row.leaseUntil = 0;
    if (row.status === "active") row.due = Date.now() + 3600_000;
    if (
      row.desired === "disconnected" &&
      row.status !== "disconnected" &&
      row.status !== "failed"
    )
      row.status = "disconnecting";
    const warnExpiry =
      row.certificate.status === "issued" &&
      row.certificate.expiresAt &&
      Date.parse(row.certificate.expiresAt) - Date.now() < 30 * 86400_000 &&
      (!row.certificateWarningAt ||
        Date.parse(row.certificateWarningAt) + 86400_000 < Date.now());
    if (warnExpiry) row.certificateWarningAt = nowIso();
    const writes: Writes = [this.replace(row, claimed.observation)];
    if (row.status === "disconnected") {
      row.state = "complete";
      writes.push(
        {
          Delete: {
            TableName: this.store.config.APP_TABLE,
            Key: { pk: reservationKey(row.hostname), sk: "META" },
            ConditionExpression: "id = :id",
            ExpressionAttributeValues: { ":id": row.id },
          },
        },
        this.capacityWrite(await this.capacity(), -1),
      );
    }
    try {
      await this.store.transaction(writes);
      if (warnExpiry)
        console.warn(
          JSON.stringify({
            event: "publication_domain_certificate_expiring",
            connectionId: row.id,
            expiresAt: row.certificate.expiresAt,
          }),
        );
      if (previousStatus !== row.status)
        console.info(
          JSON.stringify({
            event: "publication_domain_transition",
            connectionId: row.id,
            from: previousStatus,
            to: row.status,
          }),
        );
    } catch (e) {
      if (!conditional(e))
        throw e; /* A concurrent client mutation wins. Reconcile provider intent on the next pass. */
    }
  }
  private async advance(row: DomainConnection) {
    const ownership = row.records.find((r) => r.purpose === "ownership")!;
    await this.observe(ownership);
    if (ownership.status === "unknown") {
      row.message =
        "Ownership DNS is temporarily unavailable. The last healthy result is retained for at most 24 hours.";
      return;
    }
    if (ownership.status !== "verified") {
      row.ownershipLossAt ??= Date.now();
      row.ownershipLosses++;
      if (row.desired === "active") {
        if (
          row.ownershipLosses >= 3 &&
          Date.now() - row.ownershipLossAt >= 300_000
        )
          row.status = "suspended";
      } else row.status = "awaiting_ownership";
      row.message = "Publish and retain the exact ownership TXT record.";
      return;
    }
    row.ownershipLossAt = undefined;
    row.ownershipLosses = 0;
    if (!row.certificateIntentAt) {
      const conflicts = await Promise.all(
        ["CNAME", "A", "AAAA", "MX"].map((type) =>
          this.dns.resolve(row.hostname, type as "CNAME"),
        ),
      );
      if (conflicts.some((a) => a.status === "unknown")) {
        row.message = "DNS conflicts could not be checked. Try again later.";
        return;
      }
      if (conflicts.some((a) => a.values.length)) {
        row.status = "failed";
        row.state = "complete";
        row.message =
          "This hostname has existing website or mail records. Choose an unused subdomain; do not overwrite a working service.";
        return;
      }
      // Commit intent in this pass; the next pass is allowed to request resources.
      row.certificateIntentAt = nowIso();
      row.status = "awaiting_certificate";
      return;
    }
    const certificate = await this.provider.certificate(row);
    row.certificateArn = certificate.arn;
    row.certificate = {
      status: certificate.status,
      ...(certificate.expiresAt ? { expiresAt: certificate.expiresAt } : {}),
    };
    if (certificate.validation)
      await this.observe(
        this.record(
          row,
          "certificate",
          certificate.validation.name,
          certificate.validation.value,
        ),
      );
    if (
      row.records.find((record) => record.purpose === "certificate")?.status ===
      "missing"
    )
      row.message =
        "The certificate validation CNAME is missing. Restore it so HTTPS can renew automatically.";
    if (certificate.status !== "issued") {
      row.status =
        certificate.status === "invalid" ? "suspended" : "awaiting_certificate";
      row.message =
        "Publish and retain the certificate CNAME. If issuance fails, check DNS and CAA restrictions.";
      return;
    }
    if (!row.distributionIntent) {
      row.distributionIntent = true;
      row.status = "provisioning";
      return;
    }
    const distribution = await this.provider.distribution(row);
    row.distributionId = distribution.id;
    row.distributionHostname = distribution.hostname;
    row.routing = distribution.status;
    const website = this.record(
      row,
      "website",
      row.hostname,
      distribution.hostname,
    );
    await this.observe(website);
    if (distribution.status !== "deployed") {
      row.status = "provisioning";
      return;
    }
    if (website.status === "unknown") {
      row.message = "Website DNS is temporarily unavailable.";
      return;
    }
    if (website.status !== "verified") {
      row.status = row.desired === "active" ? "degraded" : "awaiting_dns";
      row.message =
        "Point the website CNAME to the displayed target using DNS-only mode.";
      return;
    }
    if (!(await this.dns.probe(row.hostname, row.nonce))) {
      row.status = row.desired === "active" ? "degraded" : "awaiting_dns";
      row.message =
        "HTTPS verification has not succeeded. Check DNS, proxy settings and certificate validation.";
      return;
    }
    row.lastHealthyAt = nowIso();
    row.status = row.desired === "active" ? "active" : "ready";
    if (
      certificate.expiresAt &&
      Date.parse(certificate.expiresAt) - Date.now() < 30 * 86400_000
    )
      row.message =
        "The HTTPS certificate expires within 30 days. Keep the certificate validation CNAME in place and check renewal.";
  }
  private async cleanup(row: DomainConnection) {
    row.status = "disconnecting";
    // A crash may have occurred after a provider accepted an intent but before its ID was saved.
    if (row.certificateIntentAt && !row.certificateArn) {
      row.certificateArn = (await this.provider.certificate(row)).arn;
      return;
    }
    if (row.distributionIntent && !row.distributionId) {
      const d = await this.provider.distribution(row);
      row.distributionId = d.id;
      row.distributionHostname = d.hostname;
      row.routing = d.status;
      return;
    }
    if (row.distributionId && row.routing !== "deleted") {
      const d = await this.provider.disable(row);
      row.routing = d.status;
      if (d.status !== "disabled") return;
      const answers: DnsAnswer[] = await Promise.all([
        this.dns.resolve(row.hostname, "CNAME"),
        this.dns.resolve(row.hostname, "A"),
        this.dns.resolve(row.hostname, "AAAA"),
      ]);
      // Fail closed on aliases/proxies/unknown DNS. Delete only once this name has no address records.
      if (answers.some((a) => a.status === "unknown" || a.values.length > 0)) {
        row.message =
          "Hosting is disabled and retained. Remove the website DNS record and wait for propagation to finish cleanup.";
        row.due = Date.now() + 300_000;
        return;
      }
      await this.provider.deleteDistribution(row);
      row.routing = "deleted";
      return;
    }
    await this.provider.deleteCertificate(row);
    row.status = "disconnected";
    row.message =
      "Custom hosting is disconnected. The default publication address remains available.";
  }
  async authenticate(id: string, secret: string, hostname: string) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(secret)) return;
    const row = await this.store.get<DomainConnection>(key(id));
    if (
      !row ||
      hostname !== row.hostname ||
      row.desired === "disconnected" ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(row.secret))
    )
      return;
    return row;
  }
}
