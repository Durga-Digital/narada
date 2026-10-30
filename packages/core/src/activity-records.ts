import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { OperationStatus, OperationTarget } from "@narada/contracts/types";
import { domainOf, hash, type Entity } from "./model.js";
import type { Store } from "./store.js";
import type { AuthorizationResources } from "./authorization.js";

type Writes = NonNullable<TransactWriteCommandInput["TransactItems"]>;
export type ActivityContext = {
  principal: string;
  actor: OperationStatus["actor"];
  operation: string;
  transport: "api" | "mcp" | "dashboard";
  requestId: string;
  resources: AuthorizationResources[];
  targets: OperationTarget[];
  requiredScopes?: string[];
  /** Compound requests must retain the target's resource policy in history. */
  authorizationOperation?: string;
  retryable: boolean;
};
export type ActivityRecord = Entity &
  ActivityContext & {
    id: string;
    status: "running" | "succeeded" | "failed" | "unknown";
    createdAt: string;
    updatedAt: string;
    busyUntil: number;
    replayExpiresAt?: string;
    revision?: number;
    work: {
      kind:
        | "publication"
        | "broadcast"
        | "message"
        | "form-response"
        | "publication-domain";
      id: string;
    }[];
  };
export function activityRecord(
  id: string,
  context: ActivityContext,
): ActivityRecord {
  const now = new Date().toISOString();
  return {
    ...context,
    pk: `ACTIVITY#${id}`,
    sk: "META",
    scope: `activity#${hash(context.principal)}`,
    sort: `${now}#${id}`,
    id,
    createdAt: now,
    updatedAt: now,
    status: "running",
    busyUntil: Date.now() + 120_000,
    work: [],
  };
}
export function activityWrites(store: Store, record: ActivityRecord): Writes {
  return [
    { Put: { TableName: store.config.APP_TABLE, Item: record } },
    {
      Put: {
        TableName: store.config.APP_TABLE,
        Item: {
          pk: `ACTIVITYALL#${record.id}`,
          sk: "META",
          scope: "activity",
          sort: record.sort,
          id: record.id,
          ttl: record.ttl,
        },
      },
    },
  ];
}
export function finishActivity(
  store: Store,
  record: ActivityRecord,
  status: ActivityRecord["status"],
  body?: unknown,
  writes: Writes = [],
): ActivityRecord {
  const next = structuredClone(record);
  next.status = status;
  next.updatedAt = new Date().toISOString();
  if (status === "succeeded" || status === "failed")
    next.ttl =
      Math.floor(Date.now() / 1000) +
      (store.config.ACTIVITY_RETENTION_DAYS ?? 90) * 86400;
  if (status === "succeeded")
    next.replayExpiresAt = new Date(Date.now() + 86400_000).toISOString();
  if (body && typeof body === "object") {
    const value = body as {
      id?: unknown;
      revision?: unknown;
      draft?: { from?: string };
      settings?: { from?: string };
      publicationId?: string;
    };
    // IDs and revision only. Never copy arbitrary output fields into the ledger.
    if (
      typeof value.id === "string" &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(value.id)
    ) {
      const kind = record.operation.endsWith(".test")
        ? "message"
        : ["forms.broadcasts.create", "templates.broadcasts.create"].includes(
              record.operation,
            )
          ? "broadcast"
          : record.operation.startsWith("forms.responses.")
            ? "form-response"
            : record.operation.split(".")[0]?.replace(/s$/, "");
      if (
        [
          "form",
          "publication",
          "issue",
          "broadcast",
          "template",
          "email",
          "message",
          "segment",
          "topic",
          "webhook",
        ].includes(kind ?? "") ||
        kind === "form-response"
      ) {
        const target = {
          kind: kind === "email" ? "message" : kind!,
          id: value.id,
        };
        if (
          !next.targets.some(
            (t) => t.kind === target.kind && t.id === target.id,
          )
        )
          next.targets.push(target);
      }
      if (
        record.operation.startsWith("forms.") &&
        record.operation !== "forms.broadcasts.create" &&
        value.draft
      )
        next.resources.push({
          formId: value.id,
          publicationId: value.publicationId,
          senderDomain: safeDomain(value.draft.from),
        });
      if (record.operation.startsWith("publications.") && value.settings)
        next.resources.push({
          publicationId: value.id,
          senderDomain: safeDomain(value.settings.from),
        });
    }
    if (
      record.operation === "forms.responses.retry" &&
      typeof value.id === "string"
    )
      next.work.push({ kind: "form-response", id: value.id });
    if (Number.isInteger(value.revision))
      next.revision = Number(value.revision);
  }
  for (const write of writes) {
    const item = write.Put?.Item;
    if (!item || typeof item.id !== "string") continue;
    const kind = String(item.pk).startsWith("PUBLICATIONDOMAIN#")
      ? "publication-domain"
      : String(item.pk).startsWith("PUBLICATIONOP#")
        ? "publication"
        : String(item.pk).startsWith("BROADCAST#") &&
            ["scheduled", "sending"].includes(item.status)
          ? "broadcast"
          : String(item.pk).startsWith("MSG#")
            ? "message"
            : String(item.pk).startsWith("FORMRESPONSE#")
              ? "form-response"
              : undefined;
    if (kind) next.work.push({ kind, id: item.id });
  }
  next.work = next.work.filter(
    (w, i, a) => a.findIndex((x) => x.kind === w.kind && x.id === w.id) === i,
  );
  return next;
}
function safeDomain(from?: string) {
  try {
    return from ? domainOf(from) : undefined;
  } catch {
    return undefined;
  }
}
