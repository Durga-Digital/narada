import {
  activityRecord,
  activityWrites,
  finishActivity,
  type ActivityContext,
  type ActivityRecord,
} from "./activity-records.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { AppError, hash, type Entity } from "./model.js";
import type { Store } from "./store.js";

type Writes = NonNullable<TransactWriteCommandInput["TransactItems"]>;
export type MutationCommit = <T>(items: Writes, result: T) => Promise<T>;
export type ResponseReceipt = {
  body: string;
  status: number;
  contentType: string;
};
export type MutationRecord = Entity & {
  activity?: ActivityRecord;
  digest: string;
  operationId: string;
  busyUntil: number;
  outcome: "pending" | "complete";
  response?: Uint8Array;
};
export class IdempotencyError extends AppError {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfter?: number,
    readonly operationId?: string,
  ) {
    super(409, message);
  }
}
// Only tracks side effects inside this request, never authentication/rate-limit writes.
const effects = new AsyncLocalStorage<{ started: boolean }>();
export function markMutation() {
  const current = effects.getStore();
  if (current) current.started = true;
}
/** Confirmed rejected writes are safe to retry; transport failures are not. */
export async function trackMutation<T>(write: () => Promise<T>): Promise<T> {
  try {
    const result = await write();
    markMutation();
    return result;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      ![
        "ConditionalCheckFailedException",
        "TransactionCanceledException",
        "ValidationException",
      ].includes(error.name) ||
      // A later SDK attempt may reject because an earlier attempt committed but lost its response.
      (error as Error & { $metadata?: { attempts?: number } }).$metadata
        ?.attempts !== 1
    )
      markMutation();
    throw error;
  }
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as { [key: string]: unknown })[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export function validateIdempotencyKey(key: string) {
  if (!/^[\x21-\x7e]{1,128}$/.test(key))
    throw new AppError(
      400,
      "Idempotency-Key must contain 1–128 non-space printable ASCII characters",
    );
}
function cipherKey(secret: string) {
  return createHmac("sha256", secret)
    .update("narada:mutation-receipts:v1")
    .digest();
}
function seal(value: ResponseReceipt, secret: string, pk: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", cipherKey(secret), iv);
  cipher.setAAD(Buffer.from(pk));
  const data = Buffer.concat([
    cipher.update(deflateSync(JSON.stringify(value))),
    cipher.final(),
  ]);
  if (data.length > 380_000)
    throw new AppError(413, "Idempotency response is too large");
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}
function open(value: Uint8Array, secret: string, pk: string): ResponseReceipt {
  const data = Buffer.from(value),
    cipher = createDecipheriv(
      "aes-256-gcm",
      cipherKey(secret),
      data.subarray(0, 12),
    );
  cipher.setAAD(Buffer.from(pk));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    inflateSync(
      Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]),
      { maxOutputLength: 4_000_000 },
    ).toString(),
  );
}

/** Durable request ownership. Pending/uncertain operations NEVER expire or get stolen. */
export class MutationReceipt {
  completed?: ResponseReceipt;
  private readonly effect = { started: false };
  private failureHandled = false;
  private constructor(
    readonly store: Store,
    readonly record: MutationRecord,
  ) {}
  static async acquire(
    store: Store,
    principal: string,
    operation: string,
    key: string,
    payload: unknown,
    activity?: ActivityContext,
  ) {
    validateIdempotencyKey(key);
    const pk = mutationReceiptKey(principal, operation, key);
    const digest = hash(canonicalJson(payload));
    const read = async () => {
      const old = await store.get<MutationRecord>(pk);
      if (
        !old ||
        (old.outcome === "complete" && Number(old.ttl) <= Date.now() / 1000)
      )
        return;
      if (old.digest !== digest)
        throw new IdempotencyError(
          "Idempotency key was used for different content",
          "idempotency_conflict",
          undefined,
          old.operationId,
        );
      if (old.outcome === "complete" && old.response)
        return {
          replay: open(old.response, store.config.BETTER_AUTH_SECRET, pk),
          operationId: old.operationId,
          activity: old.activity,
        };
      const busy = old.busyUntil > Date.now();
      if (!busy)
        console.warn(
          JSON.stringify({
            event: "idempotency_unknown",
            operationId: old.operationId,
            receiptKey: pk,
          }),
        );
      throw new IdempotencyError(
        busy
          ? "This operation is still in progress; retry with the same key"
          : `Operation outcome is uncertain. Reconcile operation ${old.operationId} before attempting it with a new key`,
        busy ? "idempotency_in_progress" : "idempotency_unknown",
        busy ? 1 : undefined,
        old.operationId,
      );
    };
    const existing = await read();
    if (existing) return existing;
    const record: MutationRecord = {
      pk,
      sk: "META",
      digest,
      operationId: randomUUID(),
      outcome: "pending",
      busyUntil: Date.now() + 120_000,
      createdAt: new Date().toISOString(),
    };
    if (activity)
      record.activity = activityRecord(record.operationId, activity);
    try {
      await store.transaction([
        {
          Put: {
            TableName: store.config.APP_TABLE,
            Item: record,
            ConditionExpression:
              "attribute_not_exists(pk) OR (#outcome = :complete AND #ttl <= :now)",
            ExpressionAttributeNames: { "#outcome": "outcome", "#ttl": "ttl" },
            ExpressionAttributeValues: {
              ":complete": "complete",
              ":now": Math.floor(Date.now() / 1000),
            },
          },
        },
        ...(record.activity ? activityWrites(store, record.activity) : []),
      ]);
    } catch (error) {
      const winner = await read();
      if (winner) return winner;
      throw error;
    }
    return { receipt: new MutationReceipt(store, record) };
  }
  run<T>(operation: () => Promise<T>) {
    return effects.run(this.effect, operation);
  }
  getCompleted() {
    return this.completed;
  }
  get uncertain() {
    return this.effect.started && !this.completed;
  }
  unknownError() {
    return new IdempotencyError(
      `Operation outcome is uncertain. Reconcile operation ${this.record.operationId} before attempting it with a new key`,
      "idempotency_unknown",
      undefined,
      this.record.operationId,
    );
  }
  async commit(items: Writes, response: ResponseReceipt) {
    const activity = this.record.activity
      ? finishActivity(
          this.store,
          this.record.activity,
          "succeeded",
          JSON.parse(response.body || "null"),
          items,
        )
      : undefined;
    const item = {
      ...this.record,
      ...(activity ? { activity } : {}),
      outcome: "complete",
      response: seal(
        response,
        this.store.config.BETTER_AUTH_SECRET,
        this.record.pk,
      ),
      ttl: Math.floor(Date.now() / 1000) + 86400,
    };
    await this.store.transaction([
      ...items,
      ...(activity ? activityWrites(this.store, activity) : []),
      {
        Put: {
          TableName: this.store.config.APP_TABLE,
          Item: item,
          ConditionExpression: "operationId = :owner AND #outcome = :pending",
          ExpressionAttributeNames: { "#outcome": "outcome" },
          ExpressionAttributeValues: {
            ":owner": this.record.operationId,
            ":pending": "pending",
          },
        },
      },
    ]);
    this.completed = response;
  }
  async failed() {
    if (this.completed || this.failureHandled) return;
    this.failureHandled = true;
    return effects.run({ started: false }, async () => {
      // Once any write/external call began, a transport failure can mean it committed.
      // Keep ownership for operator reconciliation; never turn uncertainty into a duplicate.
      // A transaction may have committed even if its acknowledgement was lost.
      const saved = await this.store.get<MutationRecord>(this.record.pk);
      if (
        saved?.operationId === this.record.operationId &&
        saved.outcome === "complete" &&
        saved.response
      ) {
        this.completed = open(
          saved.response,
          this.store.config.BETTER_AUTH_SECRET,
          this.record.pk,
        );
        return;
      }
      const activity = this.record.activity
        ? finishActivity(
            this.store,
            this.record.activity,
            this.effect.started ? "unknown" : "failed",
          )
        : undefined;
      await this.store.transaction([
        ...(this.effect.started
          ? [
              {
                Update: {
                  TableName: this.store.config.APP_TABLE,
                  Key: { pk: this.record.pk, sk: "META" },
                  UpdateExpression: "SET busyUntil = :zero",
                  ConditionExpression:
                    "operationId = :owner AND #outcome = :pending",
                  ExpressionAttributeNames: { "#outcome": "outcome" },
                  ExpressionAttributeValues: {
                    ":owner": this.record.operationId,
                    ":pending": "pending",
                    ":zero": 0,
                  },
                },
              },
            ]
          : [
              {
                Delete: {
                  TableName: this.store.config.APP_TABLE,
                  Key: { pk: this.record.pk, sk: "META" },
                  ConditionExpression:
                    "operationId = :owner AND #outcome = :pending",
                  ExpressionAttributeNames: { "#outcome": "outcome" },
                  ExpressionAttributeValues: {
                    ":owner": this.record.operationId,
                    ":pending": "pending",
                  },
                },
              },
            ]),
        ...(activity ? activityWrites(this.store, activity) : []),
      ]);
      if (this.effect.started)
        console.warn(
          JSON.stringify({
            event: "idempotency_unknown",
            operationId: this.record.operationId,
          }),
        );
    });
  }
}

export async function commitMutation<T>(
  store: Store,
  items: Writes,
  result: T,
  commit?: MutationCommit,
): Promise<T> {
  if (commit) return commit(items, result);
  await store.transaction(items);
  return result;
}

export function mutationReceiptKey(
  principal: string,
  operation: string,
  key: string,
) {
  return `MUTATION#${hash(canonicalJson([principal, operation, key]))}`;
}

/** Guard a terminal field update and its result receipt in one transaction. */
export async function commitRevisionPatch<T extends Entity>(
  store: Store,
  current: T,
  fields: Record<string, unknown>,
  revision: number,
  commit?: MutationCommit,
): Promise<T> {
  const entries = Object.entries(fields).filter(
    ([, value]) => value !== undefined,
  );
  return commitMutation(
    store,
    [
      {
        Update: {
          TableName: store.config.APP_TABLE,
          Key: { pk: current.pk, sk: current.sk },
          UpdateExpression:
            "SET " + entries.map((_, i) => `#f${i} = :v${i}`).join(", "),
          ConditionExpression: "revision = :expected",
          ExpressionAttributeNames: Object.fromEntries(
            entries.map(([key], i) => [`#f${i}`, key]),
          ),
          ExpressionAttributeValues: {
            ...Object.fromEntries(
              entries.map(([, value], i) => [`:v${i}`, value]),
            ),
            ":expected": revision,
          },
        },
      },
    ],
    { ...current, ...fields },
    commit,
  );
}
