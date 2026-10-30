import { betterAuth } from "better-auth";
import { jwt, type Jwk } from "better-auth/plugins/jwt";
import { mcp } from "@better-auth/mcp";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  defineRequestState,
  getCurrentAuthEndpointContext,
} from "@better-auth/core/context";
import { GrantStore, hashOAuthToken } from "./grants.js";
import { baseAuthOptions as authOptions } from "@narada/core/auth-base";
import type { Config } from "@narada/core/config";
import type { Store } from "@narada/core/store";
import { scopeDefinitions } from "@narada/contracts/scopes";

// These are real, read-only probe capabilities, not promises of product access.
export const feasibilityScopes = scopeDefinitions
  .filter(
    ([scope]) =>
      scope === "narada:identity:read" || scope === "narada:capabilities:read",
  )
  .map(([scope, label]) => ({ scope, label }));
export const oauthScopes = [
  "openid",
  "offline_access",
  ...feasibilityScopes.map((s) => s.scope),
];

export function feasibilityAuthOptions(
  config: Config,
  store: Store,
  bootstrap = false,
) {
  if (
    config.NARADA_MODE !== "local" ||
    !["127.0.0.1", "localhost"].includes(
      new URL(config.BETTER_AUTH_URL).hostname,
    ) ||
    !config.AUTH_TABLE.startsWith("narada-oauth-feasibility-") ||
    !config.APP_TABLE.startsWith("narada-oauth-feasibility-")
  )
    throw new Error(
      "OAuth feasibility requires loopback and isolated local tables",
    );
  const base = authOptions(config, store, bootstrap);
  const grants = new GrantStore(store, `${config.BETTER_AUTH_URL}/api/mcp`);
  const referenceState = defineRequestState<string | undefined>(
    () => undefined,
  );
  const invalidGrant = () =>
    new APIError("BAD_REQUEST", {
      error: "invalid_grant",
      error_description: "Connection changed or was revoked; authorize again",
    });
  return {
    ...base,
    // Only the resource-bound OAuth tokens are useful in this probe.
    disabledPaths: ["/token"],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Check even the provider's cached refresh-rotation replay path, which skips claims hooks.
        if (
          ctx.path === "/oauth2/token" &&
          ctx.body?.grant_type === "refresh_token"
        ) {
          const raw = ctx.body.refresh_token;
          if (typeof raw !== "string") throw invalidGrant();
          const refresh = await ctx.context.adapter.findOne<{
            userId: string;
            clientId: string;
            referenceId?: string;
            scopes: string[];
          }>({
            model: "oauthRefreshToken",
            where: [{ field: "token", value: hashOAuthToken(raw) }],
          });
          const grant =
            refresh &&
            (await grants.active(
              refresh.referenceId,
              refresh.userId,
              refresh.clientId,
            ));
          if (!grant) throw invalidGrant();
          const scopes: string[] =
            typeof ctx.body.scope === "string"
              ? ctx.body.scope.split(" ")
              : refresh!.scopes;
          if (scopes.some((scope) => !refresh!.scopes.includes(scope)))
            throw new APIError("BAD_REQUEST", {
              error: "invalid_scope",
              error_description: "Scope was not granted to this refresh token",
            });
          if (scopes.some((scope) => !grant.scopes.includes(scope)))
            throw invalidGrant();
        }
        if (
          ctx.path === "/oauth2/delete-consent" ||
          ctx.path === "/oauth2/update-consent"
        ) {
          // This hook writes before the provider endpoint's own middleware.
          // Require the same owner-origin boundary for HTTP and direct API calls.
          if (ctx.headers?.get("origin") !== config.BETTER_AUTH_URL)
            throw new APIError("FORBIDDEN");
          const session = await getSessionFromCtx(ctx);
          if (!session) throw new APIError("UNAUTHORIZED");
          if (typeof ctx.body?.id !== "string")
            throw new APIError("BAD_REQUEST");
          const consent = await ctx.context.adapter.findOne<{
            userId: string;
            clientId: string;
            referenceId?: string;
          }>({
            model: "oauthConsent",
            where: [{ field: "id", value: ctx.body.id }],
          });
          if (!consent || consent.userId !== session.user.id)
            throw new APIError("NOT_FOUND");
          const scopes =
            ctx.path === "/oauth2/update-consent"
              ? ctx.body.update?.scopes
              : undefined;
          if (
            ctx.path === "/oauth2/update-consent" &&
            (!Array.isArray(scopes) ||
              scopes.some((s) => typeof s !== "string"))
          )
            throw new APIError("BAD_REQUEST");
          // Commit the authority change first. A later provider write failure remains fail-closed.
          const changed = await grants.change(
            consent.referenceId,
            consent.userId,
            consent.clientId,
            scopes,
          );
          if (!changed && scopes !== undefined) throw invalidGrant();
        }
      }),
    },
    plugins: [
      ...(base.plugins ?? []),
      {
        id: "narada-feasibility-keyring",
        schema: {
          jwks: {
            fields: {
              keySet: {
                type: "string" as const,
                required: true,
                defaultValue: "primary",
                index: true,
                input: false,
              },
            },
          },
        },
      },
      jwt({
        adapter: {
          getJwks: async (ctx) => {
            const keys = await ctx.context.adapter.findMany<Jwk>({
              model: "jwks",
              where: [{ field: "keySet", value: "primary" }],
              limit: 21,
            });
            if (keys.length > 20)
              throw new Error(
                "OAuth keyring exceeds the feasibility limit; rotate and retire keys explicitly",
              );
            return keys;
          },
        },
      }),
      mcp({
        resource: `${config.BETTER_AUTH_URL}/api/mcp`,
        loginPage: "/oauth/login",
        consentPage: "/oauth/consent",
        scopes: oauthScopes,
        grantTypes: ["authorization_code", "refresh_token"],
        // Client registration is owner-session only in the feasibility slice.
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        refreshTokenReuseInterval: 30,
        storeTokens: { hash: hashOAuthToken },
        postLogin: {
          page: "/oauth/consent",
          shouldRedirect: () => false,
          consentReferenceId: async ({ user, scopes }) => {
            const cached = await referenceState.get();
            if (cached) return cached;
            const ctx = getCurrentAuthEndpointContext();
            const query =
              typeof ctx.body?.oauth_query === "string"
                ? new URLSearchParams(ctx.body.oauth_query)
                : undefined;
            const clientId = query?.get("client_id") ?? ctx.query?.client_id;
            if (typeof clientId !== "string" || !user?.id) throw invalidGrant();
            // This callback runs after the provider validates the signed consent request.
            // Cache within this request: consent calls authorize again before issuing its code.
            const reference = await grants.reference(
              user.id,
              clientId,
              ctx.path === "/oauth2/consent" && ctx.body?.accept === true
                ? scopes
                : undefined,
            );
            await referenceState.set(reference);
            return reference;
          },
        },
        extensions: [
          {
            claims: {
              accessToken: async ({
                ctx,
                user,
                client,
                scopes,
                referenceId,
              }) => {
                const grant =
                  user &&
                  (await grants.active(referenceId, user.id, client.clientId));
                if (
                  !grant ||
                  scopes.some((scope) => !grant.scopes.includes(scope))
                )
                  throw invalidGrant();
                const consent = await ctx.context.adapter.findOne<{
                  id: string;
                  scopes: string[];
                }>({
                  model: "oauthConsent",
                  where: [
                    { field: "userId", value: user?.id ?? "" },
                    { field: "clientId", value: client.clientId },
                    { field: "referenceId", value: referenceId! },
                  ],
                });
                if (
                  !consent ||
                  scopes.some((scope) => !consent.scopes.includes(scope))
                ) {
                  throw new APIError("BAD_REQUEST", {
                    error: "invalid_grant",
                    error_description:
                      "Current consent does not permit this token",
                  });
                }
                return {
                  narada_consent_id: consent.id,
                  narada_grant: referenceId,
                };
              },
            },
          },
        ],
      }),
    ],
  };
}

export const createFeasibilityAuth = (
  config: Config,
  store: Store,
  bootstrap = false,
) => betterAuth(feasibilityAuthOptions(config, store, bootstrap));
export type FeasibilityAuth = ReturnType<typeof createFeasibilityAuth>;
