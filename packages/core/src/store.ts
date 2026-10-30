import { markMutation, trackMutation } from "./idempotency.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
  BatchGetCommand,
  BatchWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { awsOptions, type Config } from "./config.js";
import type { Entity } from "./model.js";

export class Store {
  readonly client: DynamoDBDocumentClient;
  constructor(readonly config: Config) {
    this.client = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        ...awsOptions(config),
        endpoint: config.DYNAMODB_ENDPOINT,
      }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }
  async get<T extends Entity>(pk: string, sk = "META"): Promise<T | undefined> {
    const r = await this.client.send(
      new GetCommand({
        TableName: this.config.APP_TABLE,
        Key: { pk, sk },
        ConsistentRead: true,
      }),
    );
    return r.Item as T | undefined;
  }
  async put(item: Entity, unique = false) {
    await trackMutation(() =>
      this.client.send(
        new PutCommand({
          TableName: this.config.APP_TABLE,
          Item: item,
          ...(unique
            ? { ConditionExpression: "attribute_not_exists(pk)" }
            : {}),
        }),
      ),
    );
  }
  async remove(pk: string) {
    await trackMutation(() =>
      this.client.send(
        new DeleteCommand({
          TableName: this.config.APP_TABLE,
          Key: { pk, sk: "META" },
        }),
      ),
    );
  }
  async getMany<T extends Entity>(
    keys: string[],
    fields?: string[],
  ): Promise<T[]> {
    const rows: T[] = [];
    const unique = [...new Set(keys)];
    for (let offset = 0; offset < unique.length; offset += 100) {
      let pending = unique
        .slice(offset, offset + 100)
        .map((pk) => ({ pk, sk: "META" }));
      for (let attempt = 0; pending.length; attempt++) {
        if (attempt >= 8) throw new Error("Database batch read throttled");
        const response = await this.client.send(
          new BatchGetCommand({
            RequestItems: {
              [this.config.APP_TABLE]: {
                Keys: pending,
                ConsistentRead: true,
                ...(fields
                  ? {
                      ProjectionExpression: fields
                        .map((_, i) => `#f${i}`)
                        .join(","),
                      ExpressionAttributeNames: Object.fromEntries(
                        fields.map((f, i) => [`#f${i}`, f]),
                      ),
                    }
                  : {}),
              },
            },
          }),
        );
        rows.push(
          ...((response.Responses?.[this.config.APP_TABLE] ?? []) as T[]),
        );
        pending = (response.UnprocessedKeys?.[this.config.APP_TABLE]?.Keys ??
          []) as typeof pending;
        if (pending.length)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000, 25 * 2 ** attempt)),
          );
      }
    }
    return rows;
  }
  async listPage<T extends Entity>(
    scope: string,
    limit: number,
    cursor?: Record<string, unknown>,
  ) {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.config.APP_TABLE,
        IndexName: "byScope",
        KeyConditionExpression: "#scope = :scope",
        ExpressionAttributeNames: { "#scope": "scope" },
        ExpressionAttributeValues: { ":scope": scope },
        Limit: limit,
        ExclusiveStartKey: cursor,
        ScanIndexForward: false,
      }),
    );
    return {
      items: (result.Items ?? []) as T[],
      cursor: result.LastEvaluatedKey,
    };
  }
  async list<T extends Entity>(scope: string, limit = 100): Promise<T[]> {
    const items: T[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const r = await this.client.send(
        new QueryCommand({
          TableName: this.config.APP_TABLE,
          IndexName: "byScope",
          KeyConditionExpression: "#s = :s",
          ExpressionAttributeNames: { "#s": "scope" },
          ExpressionAttributeValues: { ":s": scope },
          Limit: limit - items.length,
          ExclusiveStartKey: cursor,
          ScanIndexForward: false,
        }),
      );
      items.push(...((r.Items ?? []) as T[]));
      cursor = r.LastEvaluatedKey;
    } while (cursor && items.length < limit);
    return items;
  }
  async children<T extends Entity>(
    pk: string,
    prefix: string,
    limit = 1001,
  ): Promise<T[]> {
    const items: T[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const r = await this.client.send(
        new QueryCommand({
          TableName: this.config.APP_TABLE,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: { ":pk": pk, ":prefix": prefix },
          ConsistentRead: true,
          ExclusiveStartKey: cursor,
          Limit: limit - items.length,
        }),
      );
      items.push(...((r.Items ?? []) as T[]));
      cursor = r.LastEvaluatedKey;
    } while (cursor && items.length < limit);
    return items;
  }
  async putMany(items: Entity[]) {
    markMutation();
    for (let offset = 0; offset < items.length; offset += 25) {
      let pending = items
        .slice(offset, offset + 25)
        .map((Item) => ({ PutRequest: { Item } }));
      for (let attempt = 0; pending.length; attempt++) {
        if (attempt >= 8) throw new Error("Database batch write throttled");
        const r = await this.client.send(
          new BatchWriteCommand({
            RequestItems: { [this.config.APP_TABLE]: pending },
          }),
        );
        pending = (r.UnprocessedItems?.[this.config.APP_TABLE] ??
          []) as typeof pending;
        if (pending.length)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000, 25 * 2 ** attempt)),
          );
      }
    }
  }
  async due<T extends Entity>(state: string, now = Date.now()): Promise<T[]> {
    const r = await this.client.send(
      new QueryCommand({
        TableName: this.config.APP_TABLE,
        IndexName: "byState",
        KeyConditionExpression: "#s = :s AND due <= :now",
        ExpressionAttributeNames: { "#s": "state" },
        ExpressionAttributeValues: { ":s": state, ":now": now },
        Limit: 50,
      }),
    );
    return (r.Items ?? []) as T[];
  }
  async patch(
    pk: string,
    values: Record<string, unknown>,
    expected?: { field: string; value: unknown },
    remove: readonly (readonly string[])[] = [],
  ) {
    const entries = Object.entries(values).filter(([, v]) => v !== undefined);
    const names: Record<string, string> = Object.fromEntries(
      entries.map(([k], i) => [`#k${i}`, k]),
    );
    const vals: Record<string, unknown> = Object.fromEntries(
      entries.map(([, v], i) => [`:v${i}`, v]),
    );
    let condition = "attribute_exists(pk)";
    if (expected) {
      names["#guard"] = expected.field;
      vals[":guard"] = expected.value;
      condition += " AND #guard = :guard";
    }
    const removed = remove.map((path, i) =>
      path
        .map((part, j) => {
          const alias = `#r${i}_${j}`;
          names[alias] = part;
          return alias;
        })
        .join("."),
    );
    await trackMutation(() =>
      this.client.send(
        new UpdateCommand({
          TableName: this.config.APP_TABLE,
          Key: { pk, sk: "META" },
          ConditionExpression: condition,
          UpdateExpression:
            "SET " +
            entries.map((_, i) => `#k${i} = :v${i}`).join(", ") +
            (removed.length ? " REMOVE " + removed.join(", ") : ""),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: vals,
        }),
      ),
    );
  }
  transaction(items: NonNullable<TransactWriteCommandInput["TransactItems"]>) {
    return trackMutation(() =>
      this.client.send(new TransactWriteCommand({ TransactItems: items })),
    );
  }
  create(item: Entity) {
    return {
      Put: {
        TableName: this.config.APP_TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
      },
    };
  }
}
export const conditional = (e: unknown) =>
  e instanceof Error &&
  ["ConditionalCheckFailedException", "TransactionCanceledException"].includes(
    e.name,
  );
