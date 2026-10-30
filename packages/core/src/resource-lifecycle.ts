import { AppError, type ApiKey, type Domain } from "./model.js";
import type { Store } from "./store.js";

export function confirmName(actual: string, supplied: string) {
  if (actual !== supplied)
    throw new AppError(400, "Type the exact name to confirm");
}

export async function findKey(store: Store, id: string) {
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await store.listPage<ApiKey>("keys", 100, cursor);
    const candidate = page.items.find((key) => key.id === id);
    if (candidate) {
      const fresh = await store.get<ApiKey>(candidate.pk);
      if (fresh) return fresh;
    }
    cursor = page.cursor;
  } while (cursor);
  throw new AppError(404, "Key not found. Refresh the list and try again.");
}

export async function deleteKey(
  store: Store,
  id: string,
  confirmation: string,
) {
  const key = await findKey(store, id);
  confirmName(key.name, confirmation);
  if (!key.revoked)
    throw new AppError(409, "Revoke this key before deleting it");
  await store.transaction([
    {
      Delete: {
        TableName: store.config.APP_TABLE,
        Key: { pk: key.pk, sk: "META" },
        ConditionExpression: "revoked = :revoked AND #name = :name",
        ExpressionAttributeNames: { "#name": "name" },
        ExpressionAttributeValues: { ":revoked": true, ":name": confirmation },
      },
    },
  ]);
}

export async function removeDomain(
  store: Store,
  name: string,
  confirmation: string,
) {
  confirmName(name, confirmation);
  const domain = await store.get<Domain>(`DOMAIN#${name}`);
  if (!domain || domain.removedAt) throw new AppError(404, "Domain not found");
  // Keep a tombstone so existing queued work can observe removal. SES/DNS may be shared.
  await store.patch(domain.pk, {
    removedAt: new Date().toISOString(),
    verified: false,
    scope: "removedDomains",
  });
}
