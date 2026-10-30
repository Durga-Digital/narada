import { commitMutation, type MutationCommit } from "./idempotency.js";
import { randomUUID } from "node:crypto";
import { hash, type Entity } from "./model.js";
import type { Store } from "./store.js";
import {
  legacyWebhookEvents,
  type WebhookEventType,
  type WebhookPayload,
} from "./webhook-events.js";

export async function webhookJobs(
  store: Store,
  event: WebhookPayload,
  endpoints?: Entity[],
) {
  const targets = endpoints ?? (await store.list<Entity>("webhooks", 5));
  const now = Date.now();
  return targets
    .filter((endpoint) =>
      (
        (endpoint.events as WebhookEventType[] | undefined) ??
        legacyWebhookEvents
      ).includes(event.type),
    )
    .map((endpoint) => {
      const id = hash(`${event.id}:${endpoint.id}`);
      return store.create({
        pk: `HOOKJOB#${id}`,
        sk: "META",
        scope: "webhookAttempts",
        sort: `${new Date(now).toISOString()}#${id}`,
        createdAt: new Date(now).toISOString(),
        id,
        endpointId: endpoint.id,
        state: "webhook",
        due: now,
        attempts: 0,
        payload: event,
        ttl: Math.floor(now / 1000) + 30 * 86400,
      });
    });
}

// The domain mutation and its deliveries commit together. No publish-after-write gap.
export async function putWithEvent(
  store: Store,
  item: Entity,
  type: WebhookEventType,
  data: Record<string, unknown>,
  options: {
    commit?: MutationCommit;
    unique?: boolean;
    revision?: number;
    activeDomain?: boolean;
    registrationId?: string;
  } = {},
) {
  await commitMutation(
    store,
    [
      {
        Put: {
          TableName: store.config.APP_TABLE,
          Item: item,
          ...(options.activeDomain
            ? {
                ConditionExpression: `attribute_exists(pk) AND attribute_not_exists(removedAt) AND ${options.registrationId ? "registrationId = :registration" : "attribute_not_exists(registrationId)"}`,
                ...(options.registrationId
                  ? {
                      ExpressionAttributeValues: {
                        ":registration": options.registrationId,
                      },
                    }
                  : {}),
              }
            : {}),
          ...(options.unique
            ? { ConditionExpression: "attribute_not_exists(pk)" }
            : {}),
          ...(options.revision !== undefined
            ? {
                ConditionExpression: "revision = :revision",
                ExpressionAttributeValues: { ":revision": options.revision },
              }
            : {}),
        },
      },
      ...(await webhookJobs(store, {
        id: randomUUID(),
        type,
        created_at: new Date().toISOString(),
        data,
      })),
    ],
    item,
    options.commit,
  );
}

/** Stable across worker retries; the caller must commit these writes with the guarded transition. */
export function lifecycleJobs(
  store: Store,
  type: WebhookEventType,
  transition: string,
  data: Record<string, unknown>,
  at = new Date().toISOString(),
) {
  return webhookJobs(store, {
    id: hash(`lifecycle:v1:${type}:${transition}`),
    type,
    created_at: at,
    data,
  });
}
