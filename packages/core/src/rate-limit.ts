import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { hash } from "./model.js";
import { conditional, type Store } from "./store.js";
// Fixed windows give an atomic, shared limiter without scanning auth rows or running Redis.
export function createRateLimitStorage(store: Store) {
  return {
    async consume(key: string, rule: { window: number; max: number }) {
      const now = Math.floor(Date.now() / 1000),
        bucket = Math.floor(now / rule.window),
        end = (bucket + 1) * rule.window;
      try {
        await store.client.send(
          new UpdateCommand({
            TableName: store.config.APP_TABLE,
            Key: {
              pk: `RATE#${hash(key)}#${rule.window}#${bucket}`,
              sk: "META",
            },
            UpdateExpression: "SET #ttl = :ttl ADD #count :one",
            ConditionExpression:
              "attribute_not_exists(#count) OR #count < :max",
            ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
            ExpressionAttributeValues: {
              ":ttl": end + 86400,
              ":one": 1,
              ":max": rule.max,
            },
          }),
        );
        return { allowed: true, retryAfter: null };
      } catch (e) {
        if (!conditional(e)) throw e;
        return { allowed: false, retryAfter: Math.max(1, end - now) };
      }
    },
  };
}
