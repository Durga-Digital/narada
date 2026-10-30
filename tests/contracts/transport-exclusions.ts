import type { OperationId } from "@narada/contracts/operations";
import type { ownerSecurityOperations } from "@narada/contracts/owner-security";

// Separate owner-only bindings must never enter REST v1, SDK or MCP discovery.
export const ownerSecurityExclusions = {
  "owner.recovery-sender.get":
    "Account-security sender preferences require an authenticated owner session; unavailable to API keys, SDK and OAuth MCP.",
  "owner.recovery-sender.update":
    "Changing the password-recovery sender is an owner-session and same-origin operation; unavailable to API keys, SDK and OAuth MCP.",
} satisfies Record<(typeof ownerSecurityOperations)[number]["id"], string>;

// Reviewed exceptions, not namespace wildcards. Remove an entry when coverage lands.
export const sdkExclusions = {
  "identity.read":
    "OAuth caller identity is MCP-only; it has no public HTTP binding.",
  "contracts.read":
    "OpenAPI is fetched directly from /api/v1/openapi.json; the SDK has no wrapper for this discovery document.",
} as const satisfies Partial<Record<OperationId, string>>;

export const mcpExclusions = {
  "contracts.read":
    "MCP exposes tools/list schemas and capabilities instead of the REST OpenAPI document.",
} as const satisfies Partial<Record<OperationId, string>>;
