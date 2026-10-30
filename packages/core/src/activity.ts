import { installationIdentity } from "./origins.js";
import { z } from "zod";
import { AppError, domainOf, hash, type Entity } from "./model.js";
import {
  callerIdentity,
  assertOperationAccess,
  authorizeOperation,
  requireScopes,
  type Caller,
} from "./authorization.js";
import type { Runtime } from "./runtime.js";
import type { ActivityContext, ActivityRecord } from "./activity-records.js";
import {
  mutationReceiptKey,
  validateIdempotencyKey,
  type MutationRecord,
} from "./idempotency.js";
import { ProductPagination } from "./product-pagination.js";
import { operationById } from "@narada/contracts/operations";
import type { OperationStatus } from "@narada/contracts/types";
import type { Publication } from "./newsletter-model.js";
import type { FormRecord } from "./form-model.js";

export function activityPrincipal(caller: Caller, origin: string) {
  const identity = callerIdentity(caller);
  return identity.kind === "oauth"
    ? `oauth:${hash(JSON.stringify([identity.userId, identity.clientId, origin]))}`
    : identity.kind === "api-key"
      ? `key:${identity.keyId}`
      : `user:${identity.userId}`;
}
export function activityContext(
  caller: Caller,
  origin: string,
  operation: string,
  requestId: string,
  details?: Pick<
    ActivityContext,
    "resources" | "targets" | "requiredScopes" | "authorizationOperation"
  >,
  retryable = true,
): ActivityContext {
  const actor = callerIdentity(caller);
  return {
    principal: activityPrincipal(caller, origin),
    actor,
    operation,
    requestId,
    transport:
      actor.kind === "oauth"
        ? "mcp"
        : actor.kind === "session"
          ? "dashboard"
          : "api",
    resources: details?.resources ?? [],
    targets: details?.targets ?? [],
    requiredScopes: details?.requiredScopes ?? [],
    ...(details?.authorizationOperation
      ? { authorizationOperation: details.authorizationOperation }
      : {}),
    retryable,
  };
}
const lookupInput = z
  .object({
    operation: z.string().max(100),
    idempotencyKey: z.string().max(128),
    params: z.record(z.string().max(100), z.string().max(320)).optional(),
  })
  .strict();
export class Activity {
  constructor(private runtime: Runtime) {}
  private async authorized(caller: Caller, record: ActivityRecord) {
    if (record.ttl && Number(record.ttl) <= Date.now() / 1000)
      throw new AppError(404, "Operation not found");
    if (callerIdentity(caller).kind === "session") return;
    if (
      record.principal !==
      activityPrincipal(caller, installationIdentity(this.runtime.config))
    )
      throw new AppError(404, "Operation not found");
    assertOperationAccess(caller, record.operation);
    const authorizationOperation =
      record.authorizationOperation ?? record.operation;
    requireScopes(caller, record.requiredScopes ?? []);
    for (const facts of record.resources.length ? record.resources : [{}])
      authorizeOperation(caller, authorizationOperation, facts);
    // Historical access is not enough: current senders and resource ownership matter too.
    for (const target of record.targets) {
      if (target.kind === "form") {
        const f = await this.runtime.store.get<FormRecord>(`FORM#${target.id}`);
        if (!f) throw new AppError(404, "Operation resource is unavailable");
        authorizeOperation(caller, authorizationOperation, {
          formId: f.id,
          publicationId:
            typeof f.publicationId === "string" ? f.publicationId : undefined,
          senderDomain: f.draft.from ? domainOf(f.draft.from) : undefined,
        });
      }
      if (target.kind === "publication") {
        const p = await this.runtime.store.get<Publication>(
          `PUBLICATION#${target.id}`,
        );
        if (!p) throw new AppError(404, "Operation resource is unavailable");
        authorizeOperation(caller, authorizationOperation, {
          publicationId: p.id,
          senderDomain: p.settings.from ? domainOf(p.settings.from) : undefined,
        });
      }
    }
  }
  private async project(record: ActivityRecord): Promise<OperationStatus> {
    const status =
      record.status === "running" && record.busyUntil <= Date.now()
        ? "unknown"
        : record.status;
    const work = await Promise.all(
      record.work.map(async (job) => {
        const prefix = {
          publication: "PUBLICATIONOP",
          "publication-domain": "PUBLICATIONDOMAIN",
          broadcast: "BROADCAST",
          message: "MSG",
          "form-response": "FORMRESPONSE",
        }[job.kind];
        const row = await this.runtime.store.get(`${prefix}#${job.id}`);
        const states = [
          "awaiting_ownership",
          "awaiting_certificate",
          "provisioning",
          "awaiting_dns",
          "ready",
          "active",
          "degraded",
          "suspended",
          "disconnecting",
          "disconnected",
          "pending",
          "released",
          "cancelled",
          "canceled",
          "scheduled",
          "sending",
          "sent",
          "completed",
          "queued",
          "submitting",
          "delayed",
          "awaiting_verification",
          "complete",
          "processing",
          "failed",
          "unknown",
          "expired",
          "delivered",
          "captured",
          "bounced",
          "complained",
          "verified",
          "synced",
          "accepted",
          "unconfirmed",
        ];
        return {
          kind: job.kind,
          status:
            typeof row?.status === "string" && states.includes(row.status)
              ? row.status
              : "unavailable",
        };
      }),
    );
    return {
      id: record.id,
      operation: record.operation,
      transport: record.transport,
      actor: record.actor,
      requestId: record.requestId,
      status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      targets: record.targets,
      ...(record.revision === undefined ? {} : { revision: record.revision }),
      ...(record.replayExpiresAt
        ? { replayExpiresAt: record.replayExpiresAt }
        : {}),
      recovery:
        status === "unknown"
          ? "reconcile"
          : !record.retryable
            ? "no_retry_key"
            : status === "succeeded"
              ? Date.parse(record.replayExpiresAt ?? "") > Date.now()
                ? "replay_available"
                : "expired"
              : "retry_same_key",
      statusUrl: `/api/v1/operations/${record.id}`,
      work,
    };
  }
  async get(caller: Caller, id: string) {
    assertOperationAccess(caller, "operations.get");
    z.uuid().parse(id);
    const record = await this.runtime.store.get<ActivityRecord>(
      `ACTIVITY#${id}`,
    );
    if (!record) throw new AppError(404, "Operation not found");
    await this.authorized(caller, record);
    return this.project(record);
  }
  async lookup(caller: Caller, raw: unknown) {
    assertOperationAccess(caller, "operations.lookup");
    const input = lookupInput.parse(raw);
    validateIdempotencyKey(input.idempotencyKey);
    const op = operationById.get(input.operation);
    if (!op || op.effect === "read")
      throw new AppError(400, "Choose a supported mutation operation");
    assertOperationAccess(caller, op.id);
    if (op.id === "emails.send" && callerIdentity(caller).kind !== "oauth") {
      const receipt = await this.runtime.store.get(
        `IDEM#default#${hash(input.idempotencyKey)}`,
      );
      if (
        !receipt ||
        receipt.activityPrincipal !==
          activityPrincipal(
            caller,
            installationIdentity(this.runtime.config),
          ) ||
        typeof receipt.activityId !== "string"
      )
        throw new AppError(
          404,
          "No tracked operation for this key; do not infer that no work occurred",
        );
      return this.get(caller, receipt.activityId);
    }
    let operation = op.id as string;
    if (callerIdentity(caller).kind !== "oauth") {
      if (!op.http) throw new AppError(400, "Operation has no API route");
      let path = op.http.path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
        if (!input.params?.[key])
          throw new AppError(400, `Missing path parameter ${key}`);
        return encodeURIComponent(input.params[key]);
      });
      if (callerIdentity(caller).kind === "session")
        path = path.replace("/api/v1/", "/api/admin/");
      operation = `${op.http.method} ${path}`;
    }
    const pk = mutationReceiptKey(
      activityPrincipal(caller, installationIdentity(this.runtime.config)),
      operation,
      input.idempotencyKey,
    );
    const receipt = await this.runtime.store.get<MutationRecord>(pk);
    if (!receipt?.activity)
      throw new AppError(
        404,
        "No tracked operation for this key; do not infer that no work occurred",
      );
    return this.get(caller, receipt.operationId);
  }
  async list(caller: Caller, query: unknown) {
    assertOperationAccess(caller, "operations.list");
    const owner = callerIdentity(caller).kind === "session";
    const { clientId, ...pagination } = z
      .object({
        limit: z.coerce.number().int().min(1).max(20).optional(),
        cursor: z.string().max(2000).optional(),
        clientId: z.string().min(1).max(256).optional(),
      })
      .strict()
      .parse(query ?? {});
    if (clientId && !owner)
      throw new AppError(403, "Only the owner can filter another client");
    const identity = callerIdentity(caller);
    const clientPrincipal =
      clientId && identity.kind === "session"
        ? `oauth:${hash(JSON.stringify([identity.userId, clientId, installationIdentity(this.runtime.config)]))}`
        : undefined;
    const all = owner && !clientPrincipal;
    const scope = all
      ? "activity"
      : `activity#${hash(clientPrincipal ?? activityPrincipal(caller, installationIdentity(this.runtime.config)))}`;
    const records = new Map<string, ActivityRecord>();
    const page = await new ProductPagination(
      this.runtime.store,
    ).records<Entity>(
      scope,
      all ? "ACTIVITYALL#" : "ACTIVITY#",
      pagination,
      async (row) => {
        const record = all
          ? await this.runtime.store.get<ActivityRecord>(`ACTIVITY#${row.id}`)
          : (row as ActivityRecord);
        if (!record) return false;
        try {
          await this.authorized(caller, record);
          records.set(record.id, record);
          return true;
        } catch (error) {
          if (error instanceof AppError && [403, 404].includes(error.status))
            return false;
          throw error;
        }
      },
    );
    return {
      data: await Promise.all(
        page.data.map((row) => this.project(records.get(String(row.id))!)),
      ),
      nextCursor: page.nextCursor,
    };
  }
}
