import { DomainSetup } from "./domain-setup.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, secret, type Domain, type Entity } from "./model.js";
import { conditional, type Store } from "./store.js";
import { commitMutation, type MutationCommit } from "./idempotency.js";
import { webhookJobs } from "./event-outbox.js";
import { webhookEvents, legacyWebhookEvents } from "./webhook-events.js";
import { validateWebhookUrl } from "./webhooks.js";
import { createSesStatusReader } from "./ses-status.js";
import type {
  SenderDomain,
  SendingStatus,
  Suppression,
  WebhookEndpoint,
} from "@narada/contracts/types";

export const diagnosticDomain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/,
  );
export const webhookConfiguration = z
  .object({
    url: z.url().max(2048),
    events: z
      .array(z.enum(webhookEvents.map((event) => event.type)))
      .min(1)
      .max(webhookEvents.length)
      .transform((events) => [...new Set(events)]),
  })
  .strict();
export function domainDiagnostic(row: Domain): SenderDomain {
  const {
    name,
    verified,
    local,
    region,
    checkedAt,
    createdAt,
    records,
    authentication,
  } = row;
  return {
    name,
    revision: Number(row.revision ?? 0),
    verified,
    local,
    region,
    checkedAt,
    createdAt,
    records: records.map(({ type, name, value }) => ({ type, name, value })),
    authentication: authentication
      ? {
          checkedAt: authentication.checkedAt,
          dkim: {
            status: authentication.dkim.status,
            signingEnabled: authentication.dkim.signingEnabled,
            origin: authentication.dkim.origin,
          },
          dmarc: {
            status: authentication.dmarc.status,
            name: authentication.dmarc.name,
            record: authentication.dmarc.record,
            inherited: authentication.dmarc.inherited,
            policy: authentication.dmarc.policy,
            alignment: authentication.dmarc.alignment
              ? {
                  dkim: authentication.dmarc.alignment.dkim,
                  spf: authentication.dmarc.alignment.spf,
                }
              : undefined,
            message: authentication.dmarc.message,
          },
          mailFrom: {
            domain: authentication.mailFrom.domain,
            behavior: authentication.mailFrom.behavior,
            status: authentication.mailFrom.status,
            mx: authentication.mailFrom.mx,
            spf: authentication.mailFrom.spf,
            records: authentication.mailFrom.records.map(
              ({ type, name, value }) => ({ type, name, value }),
            ),
          },
        }
      : undefined,
  };
}
export function webhookEndpoint(row: Entity): WebhookEndpoint {
  return {
    id: String(row.id),
    url: String(row.url),
    events: (row.events ?? legacyWebhookEvents) as WebhookEndpoint["events"],
    revision: Number(row.revision ?? 0),
    createdAt: String(row.createdAt),
  };
}
export function suppression(row: Entity): Suppression {
  return {
    email: String(row.email),
    reason: String(row.reason ?? "suppressed"),
  };
}
function conflict(error: unknown): never {
  if (conditional(error))
    throw new AppError(
      409,
      "Configuration changed; reload and retry with the same operation key",
    );
  throw error;
}
/** Workspace operational services shared by owner, REST and MCP adapters. */
export class OperationalService {
  readonly diagnostics: ReturnType<typeof createSesStatusReader>;
  constructor(readonly store: Store) {
    this.diagnostics = createSesStatusReader(store.config);
  }
  async sending(): Promise<SendingStatus> {
    const row = await this.store.get("SETTINGS");
    return {
      mode: this.store.config.NARADA_MODE,
      region: this.store.config.AWS_REGION,
      paused: !!row?.paused,
      revision: Number(row?.revision ?? 0),
    };
  }
  async setSending(
    paused: boolean,
    revision?: number,
    commit?: MutationCommit,
  ) {
    const previous = await this.store.get("SETTINGS"),
      current = Number(previous?.revision ?? 0);
    if (revision !== undefined && revision !== current)
      throw new AppError(
        409,
        "Sending settings changed; reload before continuing",
      );
    const next = {
      ...previous,
      pk: "SETTINGS",
      sk: "META",
      paused,
      revision: current + 1,
    };
    try {
      return await commitMutation(
        this.store,
        [
          {
            Put: {
              TableName: this.store.config.APP_TABLE,
              Item: next,
              ConditionExpression: previous
                ? previous.revision === undefined
                  ? "attribute_exists(pk) AND attribute_not_exists(revision)"
                  : "revision = :revision"
                : "attribute_not_exists(pk)",
              ...(previous?.revision !== undefined
                ? { ExpressionAttributeValues: { ":revision": current } }
                : {}),
            },
          },
        ],
        {
          mode: this.store.config.NARADA_MODE,
          region: this.store.config.AWS_REGION,
          paused,
          revision: next.revision,
        },
        commit,
      );
    } catch (e) {
      conflict(e);
    }
  }
  async domain(name: string) {
    const row = await this.store.get<Domain>(
      `DOMAIN#${diagnosticDomain.parse(name)}`,
    );
    if (!row || row.removedAt) throw new AppError(404, "Domain not found");
    return row;
  }
  async refreshDomain(name: string, commit?: MutationCommit) {
    return domainDiagnostic(
      await new DomainSetup(this.store).configure(
        name,
        "refresh",
        undefined,
        commit
          ? async (writes, value) => {
              await commit(writes, domainDiagnostic(value as Domain));
              return value;
            }
          : undefined,
      ),
    );
  }
  async getSuppression(email: string) {
    const row = await this.store.get(`SUPPRESS#${email}`);
    if (!row) throw new AppError(404, "Suppression not found");
    return suppression(row);
  }
  async addSuppression(email: string, commit?: MutationCommit) {
    const old = await this.store.get(`SUPPRESS#${email}`);
    if (old) return commit ? commit([], suppression(old)) : suppression(old);
    const row = {
      pk: `SUPPRESS#${email}`,
      sk: "META",
      scope: "suppressions",
      sort: new Date().toISOString(),
      email,
      reason: "manual",
    };
    try {
      return await commitMutation(
        this.store,
        [
          this.store.create(row),
          ...(await webhookJobs(this.store, {
            id: randomUUID(),
            type: "suppression.added",
            created_at: row.sort,
            data: { email, reason: "manual" },
          })),
        ],
        suppression(row),
        commit,
      );
    } catch (e) {
      conflict(e);
    }
  }
  async removeSuppression(email: string, commit?: MutationCommit) {
    const old = await this.store.get(`SUPPRESS#${email}`);
    const result = { ok: true as const };
    if (!old) return commit ? commit([], result) : result;
    return commitMutation(
      this.store,
      [
        {
          Delete: {
            TableName: this.store.config.APP_TABLE,
            Key: { pk: old.pk, sk: "META" },
          },
        },
        ...(await webhookJobs(this.store, {
          id: randomUUID(),
          type: "suppression.removed",
          created_at: new Date().toISOString(),
          data: { email },
        })),
      ],
      result,
      commit,
    );
  }
  async endpoint(id: string) {
    const row = await this.store.get(`WEBHOOK#${z.uuid().parse(id)}`);
    if (!row) throw new AppError(404, "Webhook not found");
    return row;
  }
  private async registry() {
    const old = await this.store.get("WEBHOOKREGISTRY");
    if (old)
      return { old, ids: old.ids as string[], revision: Number(old.revision) };
    // Adopt existing installations. Configuration writes now all use this CAS registry.
    const rows = await this.store.list<Entity>("webhooks", 6);
    return { old, ids: rows.map((row) => String(row.id)), revision: 0 };
  }
  private registryWrite(
    registry: Awaited<ReturnType<OperationalService["registry"]>>,
    ids: string[],
  ) {
    return {
      Put: {
        TableName: this.store.config.APP_TABLE,
        Item: {
          pk: "WEBHOOKREGISTRY",
          sk: "META",
          ids,
          revision: registry.revision + 1,
        },
        ConditionExpression: registry.old
          ? "revision = :revision"
          : "attribute_not_exists(pk)",
        ...(registry.old
          ? { ExpressionAttributeValues: { ":revision": registry.revision } }
          : {}),
      },
    };
  }
  async createWebhook(input: unknown, commit?: MutationCommit) {
    const config = webhookConfiguration.parse(input);
    await validateWebhookUrl(
      config.url,
      this.store.config.NARADA_MODE === "local",
    );
    const registry = await this.registry();
    if (registry.ids.length >= 5)
      throw new AppError(422, "Maximum five webhook endpoints");
    const id = randomUUID(),
      row = {
        pk: `WEBHOOK#${id}`,
        sk: "META",
        scope: "webhooks",
        sort: id,
        id,
        ...config,
        secret: secret("whsec_"),
        revision: 0,
        createdAt: new Date().toISOString(),
      };
    try {
      return await commitMutation(
        this.store,
        [
          this.registryWrite(registry, [...registry.ids, id]),
          this.store.create(row),
        ],
        { ...webhookEndpoint(row), secret: row.secret },
        commit,
      );
    } catch (e) {
      conflict(e);
    }
  }
  async updateWebhook(
    id: string,
    input: unknown,
    revision?: number,
    commit?: MutationCommit,
  ) {
    const config = webhookConfiguration.parse(input),
      old = await this.endpoint(id),
      current = Number(old.revision ?? 0);
    if (revision !== undefined && current !== revision)
      throw new AppError(409, "Webhook changed; reload before continuing");
    await validateWebhookUrl(
      config.url,
      this.store.config.NARADA_MODE === "local",
    );
    const next = { ...old, ...config, revision: current + 1 };
    try {
      return await commitMutation(
        this.store,
        [
          {
            Put: {
              TableName: this.store.config.APP_TABLE,
              Item: next,
              ConditionExpression:
                old.revision === undefined
                  ? "attribute_exists(pk) AND attribute_not_exists(revision)"
                  : "revision = :revision",
              ...(old.revision !== undefined
                ? { ExpressionAttributeValues: { ":revision": current } }
                : {}),
            },
          },
        ],
        webhookEndpoint(next),
        commit,
      );
    } catch (e) {
      conflict(e);
    }
  }
  async deleteWebhook(id: string, commit?: MutationCommit) {
    z.uuid().parse(id);
    const registry = await this.registry();
    try {
      return await commitMutation(
        this.store,
        [
          this.registryWrite(
            registry,
            registry.ids.filter((value) => value !== id),
          ),
          {
            Delete: {
              TableName: this.store.config.APP_TABLE,
              Key: { pk: `WEBHOOK#${id}`, sk: "META" },
            },
          },
        ],
        { ok: true as const },
        commit,
      );
    } catch (e) {
      conflict(e);
    }
  }
}
