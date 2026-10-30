import { operations, type OperationId } from "./operations.js";
import { scopeDefinitions, type Scope } from "./scopes.js";
// Branding assets, draft deletion, publication sites and editorial collections
// use the same canonical schemas, scoped executor and receipt recovery.
/** Only implemented shared handlers are advertised on this transport. */
export const mcpOperations = operations.filter(
  (op) =>
    /^(integration|resources|emails|approvals|forms|publications|issues|operations|sending|metrics|domains|suppressions|webhooks|contacts|properties|topics|segments|templates|broadcasts)\./.test(
      op.id,
    ) ||
    op.id === "identity.read" ||
    op.id === "capabilities.read",
);
export const mcpOperationIds: OperationId[] = mcpOperations.map((op) => op.id);
const required = new Set<string>(
  mcpOperations.flatMap((op) => [
    ...op.scopes,
    ...("anyScopes" in op ? op.anyScopes : []),
  ]),
);
// Form integration effects are conditional on its saved configuration.
for (const scope of [
  "narada:contacts:create",
  "narada:contacts:update",
  "narada:subscriptions:write",
  "narada:emails:send",
])
  required.add(scope);
export const mcpScopeDefinitions = scopeDefinitions.filter(([scope]) =>
  required.has(scope),
);
export const mcpProductScopes: Scope[] = mcpScopeDefinitions.map(
  ([scope]) => scope,
);
export const oauthScopes = ["openid", "offline_access", ...mcpProductScopes];
export const mcpToolName = (id: string) =>
  id === "identity.read"
    ? "whoami"
    : id === "capabilities.read"
      ? "capabilities"
      : id.replaceAll(".", "_");
