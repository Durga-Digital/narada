import schemas from "./operation-schemas.json" with { type: "json" };
import {
  contractVersion,
  operations,
  issuePublishScopes,
  type OperationId,
} from "./operations.js";
import type { OpenApiDocument } from "./types.js";
export type JsonSchema = {
  type?:
    "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  [key: string]: unknown;
};
export const operationSchemas = schemas as Record<
  OperationId,
  { input: JsonSchema; output: JsonSchema }
>;

/** REST authenticates API keys; delegated OAuth is exposed by the MCP adapter. */
export function openApiDocument(
  allowed: readonly string[] = operations.map((op) => op.id),
): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of operations) {
    if (!("http" in op) || !allowed.includes(op.id)) continue;
    const { input, output } = operationSchemas[op.id];
    const parameters: unknown[] = [];
    for (const [field, location] of [
      ["params", "path"],
      ["query", "query"],
    ] as const) {
      const shape = input.properties?.[field];
      for (const [name, schema] of Object.entries(shape?.properties ?? {}))
        parameters.push({
          name,
          in: location,
          required:
            location === "path" || shape?.required?.includes(name) || false,
          schema,
        });
    }
    if (op.idempotency === "optional-key")
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: false,
        schema: { type: "string" },
        description:
          "Reuse the same key and payload after a lost response; never retry an uncertain result with a new key.",
      });
    const path = op.http.path.replace(/:([a-zA-Z]+)/g, "{$1}");
    const body = input.properties?.body;
    (paths[path] ??= {})[op.http.method.toLowerCase()] = {
      operationId: op.id,
      ...("description" in op ? { description: op.description } : {}),
      security: [{ apiKey: [] }],
      parameters,
      ...(body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: body } },
            },
          }
        : {}),
      responses: {
        [op.http.status]: {
          description:
            op.http.status === 202
              ? "Accepted; delivery may still be pending"
              : "Success",
          headers: {
            "X-Request-Id": {
              description: "Correlation ID for this HTTP request",
              schema: { type: "string" },
            },
            ...(op.effect !== "read"
              ? {
                  "X-Operation-Id": {
                    description: "Durable operation ID when tracked",
                    schema: { type: "string" },
                  },
                  "Operation-Location": {
                    description:
                      "Authorized operation-status path when tracked",
                    schema: { type: "string" },
                  },
                  "Idempotency-Replayed": {
                    description: "Whether the saved result was replayed",
                    schema: { type: "string", enum: ["true", "false"] },
                  },
                }
              : {}),
          },
          content: { "application/json": { schema: output } },
        },
        default: {
          description: "API error",
          headers: {
            "Retry-After": {
              description:
                "Suggested wait in seconds for throttled or in-progress requests",
              schema: { type: "integer", minimum: 1 },
            },
          },
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["error", "code", "requestId"],
                properties: {
                  error: { type: "string" },
                  code: { type: "string" },
                  requestId: { type: "string" },
                  operationId: {
                    type: "string",
                    description:
                      "Operation to reconcile after an uncertain result or receipt conflict",
                  },
                },
              },
            },
          },
        },
      },
      "x-narada-delegated-scopes": op.scopes,
      ...("anyScopes" in op ? { "x-narada-any-scopes": op.anyScopes } : {}),
      ...(op.id === "issues.publish"
        ? { "x-narada-channel-scopes": issuePublishScopes }
        : {}),
      "x-narada-effect": op.effect,
      "x-narada-resources": op.resources,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Narada public API",
      version: contractVersion,
      description:
        "Structural v1 contracts. Domain validation, limits, consent, revisions and sender verification are additionally enforced by the server. Delegated scope metadata describes the shared policy; this REST transport currently authenticates API keys.",
    },
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Narada API key",
        },
      },
    },
  };
}
