import {
  senderRegistrationInput,
  senderRevisionInput,
  senderMailFromInput,
} from "@narada/contracts/integration";
import { randomUUID } from "node:crypto";
import { PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import type { Store } from "./store.js";
import { conditional } from "./store.js";
import { AppError, type Domain } from "./model.js";
import { domainNamePattern } from "./domain-name.js";
import { verifyDomain } from "./transport.js";
import {
  configureMailFrom,
  enableDkim,
  validateMailFrom,
} from "./domain-authentication.js";
import {
  commitMutation,
  markMutation,
  type MutationCommit,
} from "./idempotency.js";
import { webhookJobs } from "./event-outbox.js";

export const setupDomainName = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(domainNamePattern);
export const mailFromInput = senderMailFromInput.extend({
  domain: setupDomainName.nullable(),
});

/** Shared by the dashboard and delegated setup. Never edits a DNS provider. */
export class DomainSetup {
  constructor(private store: Store) {}
  private async locked<T>(
    name: string,
    run: (lock: { pk: string; owner: string }) => Promise<T>,
  ) {
    const pk = `DOMAINSETUP#${name}`,
      owner = randomUUID(),
      now = Date.now();
    try {
      // Coordination only: this is not a product mutation or a send receipt.
      await this.store.client.send(
        new PutCommand({
          TableName: this.store.config.APP_TABLE,
          Item: {
            pk,
            sk: "META",
            owner,
            expiresAt: now + 300000,
            ttl: Math.floor(now / 1000) + 600,
          },
          ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now",
          ExpressionAttributeValues: { ":now": now },
        }),
      );
    } catch (error) {
      if (conditional(error))
        throw new AppError(
          409,
          "Domain setup is already running. Retry the same operation key later.",
        );
      throw error;
    }
    try {
      return await run({ pk, owner });
    } finally {
      await this.store.client
        .send(
          new DeleteCommand({
            TableName: this.store.config.APP_TABLE,
            Key: { pk, sk: "META" },
            ConditionExpression: "#owner = :owner",
            ExpressionAttributeNames: { "#owner": "owner" },
            ExpressionAttributeValues: { ":owner": owner },
          }),
        )
        .catch(() => {});
    }
  }
  private async save(
    next: Domain,
    previous: Domain | undefined,
    lock: { pk: string; owner: string },
    commit?: MutationCommit,
  ) {
    const conditions = previous
      ? [
          "attribute_exists(pk)",
          previous.registrationId
            ? "registrationId = :registration"
            : "attribute_not_exists(registrationId)",
          previous.revision === undefined
            ? "attribute_not_exists(revision)"
            : "revision = :revision",
          previous.removedAt
            ? "removedAt = :removed"
            : "attribute_not_exists(removedAt)",
        ]
      : ["attribute_not_exists(pk)"];
    const values = {
      ...(previous?.registrationId
        ? { ":registration": previous.registrationId }
        : {}),
      ...(previous?.revision !== undefined
        ? { ":revision": previous.revision }
        : {}),
      ...(previous?.removedAt ? { ":removed": previous.removedAt } : {}),
    };
    return commitMutation(
      this.store,
      [
        {
          ConditionCheck: {
            TableName: this.store.config.APP_TABLE,
            Key: { pk: lock.pk, sk: "META" },
            ConditionExpression: "#owner = :owner AND expiresAt > :now",
            ExpressionAttributeNames: { "#owner": "owner" },
            ExpressionAttributeValues: {
              ":owner": lock.owner,
              ":now": Date.now(),
            },
          },
        },
        {
          Put: {
            TableName: this.store.config.APP_TABLE,
            Item: next,
            ConditionExpression: conditions.join(" AND "),
            ...(Object.keys(values).length
              ? { ExpressionAttributeValues: values }
              : {}),
          },
        },
        ...(await webhookJobs(this.store, {
          id: randomUUID(),
          type:
            previous && !previous.removedAt
              ? "domain.updated"
              : "domain.created",
          created_at: new Date().toISOString(),
          data: { name: next.name, verified: next.verified },
        })),
      ],
      next,
      commit,
    );
  }
  async create(raw: string, commit?: MutationCommit) {
    const name = setupDomainName.parse(
      senderRegistrationInput.parse({ name: raw }).name,
    );
    return this.locked(name, async (lock) => {
      const previous = await this.store.get<Domain>(`DOMAIN#${name}`);
      if (previous && !previous.removedAt)
        return commitMutation(this.store, [], previous, commit);
      markMutation();
      const next = {
        ...(await verifyDomain(this.store.config, name, true)),
        registrationId: randomUUID(),
        revision: 0,
        createdAt: new Date().toISOString(),
      };
      return this.save(next, previous, lock, commit);
    });
  }
  async configure(
    raw: string,
    action: "mailFrom" | "dkim" | "refresh",
    input: unknown,
    commit?: MutationCommit,
  ) {
    const name = setupDomainName.parse(raw);
    const body =
      action === "mailFrom"
        ? mailFromInput.parse(input)
        : action === "dkim"
          ? senderRevisionInput.parse(input)
          : undefined;
    if (action === "mailFrom")
      validateMailFrom(name, (body as z.infer<typeof mailFromInput>).domain);
    return this.locked(name, async (lock) => {
      const previous = await this.store.get<Domain>(`DOMAIN#${name}`);
      if (!previous || previous.removedAt)
        throw new AppError(404, "Domain not found");
      if (body && body.revision !== Number(previous.revision ?? 0))
        throw new AppError(
          409,
          "Domain configuration changed. Fetch the current revision before preparing a new change.",
        );
      let settings = previous.authentication?.mailFrom;
      if (action === "mailFrom") {
        const desired = body as z.infer<typeof mailFromInput>;
        const identity = desired.domain
          ? await this.store.get<Domain>(`DOMAIN#${desired.domain}`)
          : undefined;
        if (identity && !identity.removedAt)
          throw new AppError(
            409,
            "Choose a dedicated bounce subdomain that is not also a sending identity",
          );
        markMutation();
        await configureMailFrom(this.store.config, name, desired);
        settings = {
          ...desired,
          status: "PENDING",
          mx: "unknown",
          spf: "unknown",
          records: [],
        };
      } else if (action === "dkim") {
        markMutation();
        await enableDkim(this.store.config, name);
      }
      const next = {
        ...(await verifyDomain(this.store.config, name, false, settings)),
        registrationId: previous.registrationId,
        createdAt: previous.createdAt,
        revision:
          Number(previous.revision ?? 0) + (action === "refresh" ? 0 : 1),
      };
      return this.save(next, previous, lock, commit);
    });
  }
}
