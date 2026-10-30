import { createHash, randomUUID } from "node:crypto";
import {
  resourceRestrictions,
  type ResourceRestrictions,
} from "@narada/contracts/delegation";
import { ProductPagination } from "./product-pagination.js";
import { AppError } from "./model.js";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Store } from "./store.js";

export type Grant = {
  scope: string;
  sort: string;
  userGeneration: string;
  resources: ResourceRestrictions;
  pk: string;
  sk: "META";
  userId: string;
  clientId: string;
  resource: string;
  epoch: string;
  revision: number;
  active: boolean;
  scopes: string[];
  updatedAt: string;
};

// Also explicitly configured as the provider's token hasher. Never store raw tokens.
export const hashOAuthToken = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

/** One durable generation per user/client/resource; no TTL and no in-memory cache. */
export class GrantStore {
  constructor(
    private readonly store: Store,
    readonly resource: string,
  ) {}

  async invalidateUser(userId: string) {
    await this.store.put({
      pk: `OAUTH_USER#${hashOAuthToken(userId)}`,
      sk: "META",
      generation: randomUUID(),
    });
  }
  private async generation(userId: string) {
    return String(
      (await this.store.get(`OAUTH_USER#${hashOAuthToken(userId)}`))
        ?.generation ?? "initial",
    );
  }
  async list(userId: string, input: unknown = {}) {
    const page = await new ProductPagination(this.store).records<Grant>(
      `oauthGrants#${userId}`,
      "OAUTH_GRANT#",
      input,
      (row) => row.userId === userId && row.resource === this.resource,
    );
    const generation = await this.generation(userId);
    return {
      ...page,
      data: page.data.map((row) => ({
        ...row,
        active: row.active && row.userGeneration === generation,
      })),
    };
  }
  async forOwner(reference: string, userId: string) {
    const [key] = reference.split(".");
    if (!/^[A-Za-z0-9_-]{43}$/.test(key ?? "")) return undefined;
    const row = await this.read(key!);
    if (
      !row ||
      row.userId !== userId ||
      row.resource !== this.resource ||
      reference !== this.referenceOf(row)
    )
      return undefined;
    return {
      ...row,
      active:
        row.active && row.userGeneration === (await this.generation(userId)),
    };
  }
  referenceOf(row: Grant) {
    return `${row.pk.slice("OAUTH_GRANT#".length)}.${row.epoch}`;
  }
  private key(userId: string, clientId: string) {
    return hashOAuthToken(JSON.stringify([userId, clientId, this.resource]));
  }
  private async read(key: string) {
    const result = await this.store.client.send(
      new GetCommand({
        TableName: this.store.config.APP_TABLE,
        Key: { pk: `OAUTH_GRANT#${key}`, sk: "META" },
        ConsistentRead: true,
      }),
    );
    return result.Item as Grant | undefined;
  }
  private async write(next: Grant, previous?: Grant) {
    try {
      await this.store.client.send(
        new PutCommand({
          TableName: this.store.config.APP_TABLE,
          Item: next,
          ConditionExpression: previous
            ? "revision = :revision"
            : "attribute_not_exists(pk)",
          ...(previous
            ? { ExpressionAttributeValues: { ":revision": previous.revision } }
            : {}),
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      )
        return false;
      throw error;
    }
  }
  async reference(
    userId: string,
    clientId: string,
    acceptedScopes?: string[],
    resources: ResourceRestrictions = {},
  ) {
    resources = resourceRestrictions.parse(resources);
    const key = this.key(userId, clientId);
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = await this.read(key);
      if (previous && acceptedScopes === undefined)
        return `${key}.${previous.epoch}`;
      const next: Grant = {
        scope: `oauthGrants#${userId}`,
        sort: new Date().toISOString(),
        userGeneration: await this.generation(userId),
        resources,
        pk: `OAUTH_GRANT#${key}`,
        sk: "META",
        userId,
        clientId,
        resource: this.resource,
        epoch: randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        active: acceptedScopes !== undefined,
        scopes: [...new Set(acceptedScopes ?? [])],
        updatedAt: new Date().toISOString(),
      };
      if (await this.write(next, previous)) return `${key}.${next.epoch}`;
    }
    throw new Error("Concurrent OAuth grant changes; retry authorization");
  }
  async active(
    reference: string | undefined,
    userId: string,
    clientId: string,
  ) {
    const key = this.key(userId, clientId);
    if (!reference?.startsWith(`${key}.`)) return undefined;
    const row = await this.read(key);
    return row?.active &&
      row.userGeneration === (await this.generation(userId)) &&
      reference === `${key}.${row.epoch}`
      ? row
      : undefined;
  }
  async change(
    reference: string | undefined,
    userId: string,
    clientId: string,
    scopes?: string[],
    resources?: ResourceRestrictions,
    revision?: number,
  ) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = await this.active(reference, userId, clientId);
      if (!previous) return false; // A stale consent cannot mutate a newer connection.
      if (scopes?.some((scope) => !previous.scopes.includes(scope)))
        return false;
      if (revision !== undefined && previous.revision !== revision)
        throw new AppError(409, "Connection changed; reload before continuing");
      if (resources) {
        resources = resourceRestrictions.parse(resources);
        for (const dimension of [
          "formIds",
          "publicationIds",
          "senderDomains",
        ] as const) {
          const old = previous.resources[dimension],
            next = resources[dimension];
          if (old && (!next || next.some((id) => !old.includes(id))))
            throw new AppError(403, "Reconnect to expand resource access");
        }
      }
      const next: Grant = {
        ...previous,
        resources: resources ?? previous.resources,
        active: scopes !== undefined,
        scopes: scopes ?? [],
        revision: previous.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      if (await this.write(next, previous)) return true;
    }
    throw new Error("Concurrent OAuth grant changes; retry authorization");
  }
}
