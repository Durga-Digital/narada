import { Application } from "@narada/core/application";
import { ApprovalRequiredError } from "@narada/core/send-approval-context";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { mcpOperationIds } from "@narada/contracts/mcp";
import { type OperationId, operationById } from "@narada/contracts/operations";
import { operationSchemas } from "@narada/contracts/discovery";
import { AppError } from "@narada/core/model";
import {
  assertOperationAccess,
  callerIdentity,
  type Caller,
} from "@narada/core/authorization";

import { IdempotencyError } from "@narada/core/idempotency";
import type { Runtime } from "@narada/core/runtime";

/** MCP mutations require an explicit retry key. The operation envelope remains canonical. */
export function mcpInputSchema(id: OperationId) {
  const schema = structuredClone(operationSchemas[id].input);
  if (operationById.get(id)?.effect !== "read") {
    schema.properties = {
      ...schema.properties,
      idempotencyKey: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[\\x21-\\x7e]+$",
        description:
          "Stable key for this logical action. Reuse this key and identical arguments after a lost response.",
      },
    };
    schema.required = [...(schema.required ?? []), "idempotencyKey"];
  }
  return z.fromJSONSchema(schema);
}
export async function executeMcpOperation(
  runtime: Runtime,
  caller: Caller,
  id: OperationId,
  raw: Record<string, unknown>,
  options: { requestId?: string; onOperation?: (id: string) => void } = {},
) {
  assertOperationAccess(caller, id);
  if (!mcpOperationIds.includes(id))
    throw new AppError(403, "Operation is unavailable on MCP");
  if (
    operationById.get(id)?.effect !== "read" &&
    callerIdentity(caller).kind !== "oauth"
  )
    throw new AppError(401, "Delegated authentication required");
  const { idempotencyKey, ...input } = raw;
  const result = await new Application(runtime).executeUnknown(
    caller,
    id,
    input,
    {
      ...options,
      idempotencyKey:
        operationById.get(id)?.effect === "read"
          ? undefined
          : z.string().min(1).max(128).parse(idempotencyKey),
      availableOperations: mcpOperationIds,
    },
  );
  return result.value;
}

export function mcpError(error: unknown, requestId = randomUUID()) {
  const status =
    error instanceof AppError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 500;
  const code =
    error instanceof IdempotencyError || error instanceof ApprovalRequiredError
      ? error.code
      : ((
          {
            400: "invalid_request",
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            409: "conflict",
            422: "validation_error",
            429: "rate_limited",
          } as Record<number, string>
        )[status] ?? "internal_error");
  return {
    error:
      status === 500
        ? "Request failed"
        : error instanceof Error
          ? error.message
          : "Request failed",
    code,
    status,
    requestId,
    ...(error instanceof IdempotencyError && error.operationId
      ? { operationId: error.operationId }
      : {}),
    ...(error instanceof IdempotencyError && error.retryAfter
      ? { retryAfter: error.retryAfter }
      : {}),
  };
}
