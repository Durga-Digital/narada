import { AppError, type ApiKey } from "./model.js";
import { legacyKeyAccess } from "@narada/contracts/legacy-access";
import { apiScopes } from "@narada/contracts/legacy-scopes";
import { scopes } from "@narada/contracts/scopes";
import {
  contractVersion,
  operationById,
  type OperationId,
  type OperationDefinition,
} from "@narada/contracts/operations";
import {
  resourceRestrictions,
  type ResourceRestrictions,
} from "@narada/contracts/delegation";
import type { Capabilities } from "@narada/contracts/types";

// The caller is an opaque, request-local handle. A JSON body or structural cast
// cannot manufacture a caller. Only server authentication adapters mint one.
declare const callerBrand: unique symbol;
export type Caller = { readonly [callerBrand]: true };
type Identity =
  | { kind: "session"; userId: string }
  | { kind: "api-key"; keyId: string }
  | { kind: "oauth"; userId: string; clientId: string; grantId: string };
type Context = {
  identity: Identity;
  scopes: readonly string[];
  resources: ResourceRestrictions;
  legacy?: Pick<ApiKey, "permission" | "scopes" | "domain">;
};
const callers = new WeakMap<Caller, Context>();
function mint(context: Context): Caller {
  const caller = Object.freeze({}) as Caller;
  callers.set(caller, structuredClone(context));
  return caller;
}
function context(caller: Caller) {
  const value = callers.get(caller);
  if (!value) throw new AppError(401, "Authenticated caller required");
  return value;
}

/** Call only after verifying the owner's server session (including origin on writes). */
export function ownerCaller(userId: string): Caller {
  if (!userId) throw new AppError(401, "Authenticated owner required");
  return mint({ identity: { kind: "session", userId }, scopes, resources: {} });
}

/** Call only with the fresh record returned by service.authenticate, never request input. */
export function apiKeyCaller(key: ApiKey): Caller {
  if (!key.id || key.revoked)
    throw new AppError(401, "Invalid or revoked API key");
  if (key.permission === "operations") {
    if (!key.operationAccess)
      throw new AppError(401, "Missing operation grant");
    return mint({
      identity: { kind: "api-key", keyId: key.id },
      scopes: key.operationAccess.scopes.filter((scope) =>
        scopes.includes(scope),
      ),
      resources: resourceRestrictions.parse(key.operationAccess.resources),
    });
  }
  return mint({
    identity: { kind: "api-key", keyId: key.id },
    legacy: {
      permission: key.permission,
      scopes: key.scopes,
      domain: key.domain,
    },
    scopes:
      key.permission === "full"
        ? apiScopes
        : key.permission === "scoped"
          ? (key.scopes ?? [])
          : ["emails:send"],
    resources: key.domain ? { senderDomains: [key.domain] } : {},
  });
}

/** JWT signature, issuer, audience and expiry must already have been verified.
 * Grant and consent must be loaded afresh for this request, with consistent reads.
 * Never persist this caller between requests or use token claims as the live grant.
 */
export function oauthCaller(input: {
  subject: string;
  clientId: string;
  resource: string;
  tokenScopes: readonly string[];
  tokenGrantId: string;
  grant: {
    id: string;
    userId: string;
    clientId: string;
    resource: string;
    active: boolean;
    scopes: readonly string[];
    resources?: ResourceRestrictions;
  };
  consent: { userId: string; clientId: string; scopes: readonly string[] };
}): Caller {
  const { grant, consent } = input;
  if (
    !input.subject ||
    !input.clientId ||
    !input.tokenGrantId ||
    !grant.active ||
    grant.id !== input.tokenGrantId ||
    grant.userId !== input.subject ||
    grant.clientId !== input.clientId ||
    grant.resource !== input.resource ||
    consent.userId !== input.subject ||
    consent.clientId !== input.clientId
  )
    throw new AppError(401, "Invalid or revoked delegation");
  return mint({
    identity: {
      kind: "oauth",
      userId: input.subject,
      clientId: input.clientId,
      grantId: grant.id,
    },
    scopes: scopes.filter(
      (scope) =>
        input.tokenScopes.includes(scope) &&
        grant.scopes.includes(scope) &&
        consent.scopes.includes(scope),
    ),
    resources: resourceRestrictions.parse(grant.resources ?? {}),
  });
}

export function callerIdentity(caller: Caller): Readonly<Identity> {
  return Object.freeze({ ...context(caller).identity });
}

export function assertLegacyAccess(
  key: Pick<ApiKey, "permission" | "scopes">,
  operationId: string,
) {
  // Migration to mandatory review: legacy keys may request/read their own
  // reviews, but SendApprovals always rechecks the original target capability.
  // This does not expand their frozen product-operation ceiling.
  if (
    ["approvals.request", "approvals.get", "approvals.list"].includes(
      operationId,
    )
  )
    return;
  // Capability discovery is authenticated metadata, not a new product permission.
  if (operationId === "capabilities.read" || operationId === "contracts.read")
    return;
  const requirements = Object.hasOwn(legacyKeyAccess, operationId)
    ? (legacyKeyAccess as Record<string, readonly (readonly string[])[]>)[
        operationId
      ]
    : undefined;
  const granted: readonly string[] =
    key.permission === "scoped"
      ? (key.scopes ?? [])
      : key.permission === "sending" || key.permission === undefined
        ? ["emails:send"]
        : [];
  if (
    !requirements ||
    (key.permission !== "full" &&
      !requirements.every((alternatives) =>
        alternatives.some((scope) => granted.includes(scope)),
      ))
  )
    throw new AppError(403, "API key does not permit this operation");
}

function operation(id: string): OperationDefinition {
  const op = operationById.get(id);
  if (!op) throw new AppError(403, "Operation is not available");
  return op;
}

/** Scope gate before parsing, resource lookup, idempotency replay or side effects.
 * This is only the first stage for resource-restricted operations.
 */
export function assertOperationAccess(
  caller: Caller,
  id: OperationId | string,
) {
  const ctx = context(caller),
    op = operation(id);
  if (ctx.legacy) assertLegacyAccess(ctx.legacy, id);
  else if (
    !op.scopes.every((scope) => ctx.scopes.includes(scope)) ||
    (op.anyScopes && !op.anyScopes.some((scope) => ctx.scopes.includes(scope)))
  )
    throw new AppError(
      403,
      `Operation requires ${[...op.scopes, ...(op.anyScopes ? [op.anyScopes.join(" or ")] : [])].join(" and ")}`,
    );

  // Identity/capability metadata doesn't disclose product resources.
  if (
    id === "identity.read" ||
    id === "capabilities.read" ||
    id === "contracts.read" ||
    op.resources === "operation"
  )
    return;
  if (!ctx.legacy) {
    // Every restriction dimension must be supported by the operation.
    // Generic contacts, audiences and broadcasts cannot bypass selected resources.
    if (
      (ctx.resources.formIds && !op.resources.startsWith("form")) ||
      (ctx.resources.publicationIds &&
        !op.resources.startsWith("publication") &&
        !op.resources.startsWith("form")) ||
      (ctx.resources.senderDomains &&
        ![
          "sender-domain",
          "form",
          "form-collection",
          "form-create",
          "publication",
          "publication-collection",
          "publication-create",
        ].includes(op.resources)) ||
      (op.resources.endsWith("-create") &&
        (ctx.resources.formIds || ctx.resources.publicationIds))
    )
      throw new AppError(
        403,
        "This operation does not support the delegation's resource restrictions",
      );
  }
}

export type AuthorizationResources = {
  senderDomain?: string;
  formId?: string;
  publicationId?: string;
};
/** Complete authorization, including server-resolved resources. */
export function authorizeOperation(
  caller: Caller,
  id: OperationId | string,
  resources: AuthorizationResources = {},
) {
  assertOperationAccess(caller, id);
  const ctx = context(caller),
    op = operation(id);
  if (
    op.resources === "operation" ||
    ["identity.read", "capabilities.read", "contracts.read"].includes(id)
  )
    return;
  if (!ctx.legacy) {
    if (
      ctx.resources.formIds &&
      (!resources.formId || !ctx.resources.formIds.includes(resources.formId))
    )
      throw new AppError(403, "Form is outside this grant");
    if (
      ctx.resources.publicationIds &&
      (!resources.publicationId ||
        !ctx.resources.publicationIds.includes(resources.publicationId))
    )
      throw new AppError(403, "Publication is outside this grant");
  }
  if (
    (op.resources === "sender-domain" ||
      (!ctx.legacy &&
        (op.resources.startsWith("form") ||
          op.resources.startsWith("publication")))) &&
    ctx.resources.senderDomains
  ) {
    if (
      !resources.senderDomain ||
      !ctx.resources.senderDomains.includes(
        resources.senderDomain.toLowerCase(),
      )
    )
      throw new AppError(
        403,
        "Caller cannot access emails from that sending domain",
      );
  }
}

/** Snapshot the verified effective scopes for a review request; later execution intersects them with live consent. */
export function callerScopes(caller: Caller) {
  return [...context(caller).scopes];
}
export function callerRestrictions(caller: Caller): ResourceRestrictions {
  return structuredClone(context(caller).resources);
}
export function requireScopes(caller: Caller, required: readonly string[]) {
  if (!required.every((scope) => context(caller).scopes.includes(scope)))
    throw new AppError(403, `Operation requires ${required.join(" and ")}`);
}
export function resourceAllowed(
  caller: Caller,
  id: OperationId,
  resources: AuthorizationResources,
) {
  try {
    authorizeOperation(caller, id, resources);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.status === 403) return false;
    throw error;
  }
}

/** Shared transport boundary. Resource resolvers may read, but must not mutate. */
export async function executeAuthorized<T>(
  caller: Caller,
  id: OperationId,
  resolve: () => Promise<AuthorizationResources> | AuthorizationResources,
  execute: () => Promise<T> | T,
): Promise<T> {
  assertOperationAccess(caller, id);
  authorizeOperation(caller, id, await resolve());
  return execute();
}

/** Supply only the operations actually implemented on this transport. */
export function describeCapabilities(
  caller: Caller,
  implemented: readonly OperationId[],
  environment: string,
): Capabilities {
  const ctx = context(caller);
  const permitted = [...new Set(implemented)].flatMap((id) => {
    try {
      assertOperationAccess(caller, id);
      return [operation(id)];
    } catch (error) {
      if (error instanceof AppError && error.status === 403) return [];
      throw error;
    }
  });
  return {
    contractVersion,
    apiVersion: "v1" as const,
    environment,
    permissionModel: ctx.legacy
      ? "legacy-key-v1"
      : ctx.identity.kind === "oauth"
        ? "delegated-v1"
        : ctx.identity.kind === "api-key"
          ? "operation-key-v1"
          : "owner",
    scopes: [...ctx.scopes],
    resources: structuredClone(ctx.resources),
    operations: permitted,
    pagination: { defaultLimit: 20, maxLimit: 100 },
  };
}
