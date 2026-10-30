import { installationIdentity } from "./origins.js";
import { randomUUID } from "node:crypto";
import type {
  OperationInput,
  OperationOutput,
} from "@narada/contracts/operation-types";
import {
  operationById,
  operations,
  type OperationId,
} from "@narada/contracts/operations";
import { openApiDocument } from "@narada/contracts/discovery";
import { Activity, activityContext, activityPrincipal } from "./activity.js";
import {
  assertOperationAccess,
  callerIdentity,
  describeCapabilities,
  type Caller,
} from "./authorization.js";
import { AppError } from "./model.js";
import { MutationReceipt, type MutationCommit } from "./idempotency.js";
import { SharedOperations, isSharedOperation } from "./shared-operations.js";
import type { Runtime } from "./runtime.js";
import type { EmailSubmissionContext } from "./email-operations.js";

/** Trusted adapter metadata, never accepted from an operation's JSON input. */
export interface ExecutionOptions {
  requestId?: string;
  idempotencyKey?: string;
  onOperation?: (id: string) => void;
  /** Preserve v1 receipt keys and digests, including raw path encoding/query order. */
  http?: { path: string; query: string; body: unknown };
  submission?: Pick<
    EmailSubmissionContext,
    "project" | "timing" | "onAccepted"
  >;
  /** Discovery is restricted to the operations exposed by this adapter. */
  availableOperations?: readonly OperationId[];
}
export interface ExecutionResult<T> {
  value: T;
  requestId: string;
  operationId?: string;
  replayed?: boolean;
  status: 200 | 201 | 202;
}

/** Request-local authorization and recovery for REST, MCP and trusted server callers.
 * Keep Caller handles and prepared operations within this request. */
export class Application {
  private readonly shared: SharedOperations;
  private readonly activity: Activity;
  constructor(private readonly runtime: Runtime) {
    this.shared = new SharedOperations(runtime);
    this.activity = new Activity(runtime);
  }
  execute<K extends OperationId>(
    caller: Caller,
    id: K,
    input: OperationInput<K>,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult<OperationOutput<K>>> {
    return this.executeUnknown(caller, id, input, options) as Promise<
      ExecutionResult<OperationOutput<K>>
    >;
  }

  /** Transport inputs are unknown until canonical schemas/domain validators run. */
  async executeUnknown(
    caller: Caller,
    id: OperationId,
    input: unknown,
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult<unknown>> {
    assertOperationAccess(caller, id);
    const definition = operationById.get(id)!;
    const identity = callerIdentity(caller);
    const requestId = options.requestId ?? randomUUID();
    let operationId: string | undefined;
    let replayed: boolean | undefined;
    const onOperation = (id: string) => {
      operationId = id;
      options.onOperation?.(id);
    };
    const result = (value: unknown): ExecutionResult<unknown> => ({
      value,
      requestId,
      ...(operationId ? { operationId } : {}),
      ...(replayed === undefined ? {} : { replayed }),
      status: definition.http?.status ?? 200,
    });
    const available =
      options.availableOperations ?? operations.map((op) => op.id);
    if (!available.includes(id))
      throw new AppError(403, "Operation is unavailable on this transport");
    if (id === "identity.read") {
      if (identity.kind !== "oauth")
        throw new AppError(401, "Delegated authentication required");
      return result({ userId: identity.userId, clientId: identity.clientId });
    }
    if (id === "capabilities.read")
      return result(
        describeCapabilities(
          caller,
          available,
          this.runtime.config.NARADA_MODE,
        ),
      );
    if (id === "contracts.read")
      return result(
        openApiDocument(
          describeCapabilities(
            caller,
            available,
            this.runtime.config.NARADA_MODE,
          ).operations.map((op) => op.id),
        ),
      );
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new AppError(400, "Expected an operation input object");
    const envelope = input as {
      params?: { id: string };
      query?: unknown;
      body?: unknown;
    };
    if (id === "operations.list")
      return result(await this.activity.list(caller, envelope.query));
    if (id === "operations.get")
      return result(await this.activity.get(caller, envelope.params?.id ?? ""));
    if (id === "operations.lookup")
      return result(await this.activity.lookup(caller, envelope.body));
    if (!isSharedOperation(id))
      throw new AppError(403, "Operation is unavailable");
    const email = id === "emails.send" && identity.kind !== "oauth";
    const prepared = await this.shared.prepare(
      caller,
      id,
      input,
      email
        ? {
            project: options.submission?.project ?? "default",
            idempotencyKey: options.idempotencyKey,
            timing: options.submission?.timing,
            activity: {
              context: activityContext(
                caller,
                installationIdentity(this.runtime.config),
                id,
                requestId,
                undefined,
                !!options.idempotencyKey,
              ),
              onOperation,
            },
            onAccepted: (accepted) => {
              replayed = accepted.replayed;
              options.submission?.onAccepted?.(accepted);
            },
          }
        : undefined,
    );
    if (definition.effect === "read" || email)
      return result(await prepared.run());
    if (identity.kind === "oauth" && options.idempotencyKey === undefined)
      throw new AppError(400, "An idempotencyKey is required");
    const key = options.idempotencyKey ?? randomUUID();
    const params = (input as { params?: Record<string, string> }).params;
    const route = definition.http;
    const path =
      options.http?.path ??
      route?.path.replace(/:([a-zA-Z]+)/g, (_, name: string) =>
        encodeURIComponent(params?.[name] ?? ""),
      );
    // These are the existing transport namespaces, not a new receipt generation.
    const receiptOperation =
      identity.kind === "oauth"
        ? id
        : `${route!.method} ${identity.kind === "session" ? path!.replace("/api/v1/", "/api/admin/") : path}`;
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(envelope.query ?? {}))
      if (value !== undefined) query.set(name, String(value));
    const queryString = query.toString();
    const acquired = await MutationReceipt.acquire(
      this.runtime.store,
      activityPrincipal(caller, installationIdentity(this.runtime.config)),
      receiptOperation,
      key,
      identity.kind === "oauth"
        ? input
        : {
            body: options.http ? options.http.body : (envelope.body ?? null),
            query:
              options.http?.query ?? (queryString ? `?${queryString}` : ""),
          },
      activityContext(
        caller,
        installationIdentity(this.runtime.config),
        id,
        requestId,
        prepared.activity,
        !!options.idempotencyKey,
      ),
    );
    if ("replay" in acquired) {
      const value: unknown = JSON.parse(acquired.replay.body);
      await prepared.authorizeReplay(value, acquired.activity);
      onOperation(acquired.operationId);
      replayed = true;
      return result(value);
    }
    const receipt = acquired.receipt!;
    onOperation(receipt.record.operationId);
    replayed = false;
    const commit: MutationCommit = async (writes, value) => {
      await receipt.commit(writes, {
        body: JSON.stringify(value),
        status: identity.kind === "oauth" ? 200 : route!.status,
        contentType: "application/json",
      });
      return value;
    };
    try {
      return await receipt.run(async () => {
        const value = await prepared.run(commit);
        if (!receipt.completed) await commit([], value);
        return result(JSON.parse(receipt.completed!.body));
      });
    } catch (error) {
      if (receipt.completed) return result(JSON.parse(receipt.completed.body));
      await receipt.failed();
      const recovered = receipt.getCompleted();
      if (recovered) {
        replayed = true;
        return result(JSON.parse(recovered.body));
      }
      if (receipt.uncertain) throw receipt.unknownError();
      throw error;
    }
  }
}
