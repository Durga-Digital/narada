import { oauthApproval } from "./oauth-context.js";
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
import { GrantStore, hashOAuthToken } from "./oauth-grants.js";
import { baseAuthOptions as authOptions } from "./auth-base.js";
import type { Config } from "./config.js";
import type { Store } from "./store.js";
import { oauthScopes } from "@narada/contracts/mcp";
export { oauthScopes } from "@narada/contracts/mcp";
export function oauthAuthOptions(
  config: Config,
  store: Store,
  bootstrap = false,
) {
  const origin = new URL(config.BETTER_AUTH_URL);
  if (
    origin.origin !== config.BETTER_AUTH_URL ||
    origin.username ||
    origin.password ||
    (config.NARADA_MODE === "aws" && origin.protocol !== "https:")
  )
    throw new Error(
      "OAuth requires a canonical HTTPS origin (loopback HTTP is supported locally)",
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
    emailAndPassword: {
      ...base.emailAndPassword!,
      onPasswordReset: async ({ user }: { user: { id: string } }) =>
        grants.invalidateUser(user.id),
    },
    // Do not expose the JWT plugin's unrelated session-token endpoint.
    disabledPaths: ["/token"],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/oauth2/authorize" &&
          ctx.query &&
          !oauthApproval.getStore()
        ) {
          // Always show consent; reconnects must choose scopes/resources afresh.
          const prompts = new Set(
            String(ctx.query.prompt ?? "")
              .split(" ")
              .filter(Boolean),
          );
          if (!prompts.has("none")) prompts.add("consent");
          ctx.query.prompt = [...prompts].join(" ");
        }
        if (ctx.path === "/oauth2/consent") {
          const approval = oauthApproval.getStore();
          if (
            !approval ||
            approval.query !== ctx.body?.oauth_query ||
            approval.scopes.join(" ") !== ctx.body?.scope ||
            ctx.headers?.get("origin") !== config.BETTER_AUTH_URL
          )
            throw new APIError("FORBIDDEN", {
              message: "Use Narada's consent page",
            });
        }
        if (
          ctx.path === "/oauth2/register" &&
          ctx.body?.application_type === undefined &&
          ctx.body?.token_endpoint_auth_method === "none"
        ) {
          // Claude Code omits application_type for its loopback callback.
          // Classify only an entirely loopback redirect set as native; the
          // provider still validates each URI and exact redirect matching/PKCE.
          const redirects = ctx.body.redirect_uris;
          if (
            Array.isArray(redirects) &&
            redirects.length > 0 &&
            redirects.every((value: unknown) => {
              if (typeof value !== "string") return false;
              try {
                const url = new URL(value);
                return (
                  url.protocol === "http:" &&
                  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
                );
              } catch {
                return false;
              }
            })
          )
            ctx.body.application_type = "native";
        }
        if (
          ctx.path === "/oauth2/register" ||
          ctx.path === "/oauth2/create-client" ||
          ctx.path === "/oauth2/update-client"
        ) {
          const body =
            (ctx.path === "/oauth2/update-client"
              ? ctx.body?.update
              : ctx.body) ?? {};
          if (
            body.skip_consent ||
            body.require_pkce === false ||
            body.jwks_uri ||
            body.jwks ||
            body.token_endpoint_auth_method === "private_key_jwt" ||
            body.client_credentials_scopes ||
            body.backchannel_logout_uri
          )
            throw new APIError("BAD_REQUEST", {
              message: "Unsupported client capability",
            });
        }

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
        id: "narada-oauth-keyring",
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
                "OAuth keyring exceeds the supported limit; rotate and retire keys explicitly",
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
        // Automatic public-client registration supports current Claude/Codex clients.
        // Registration grants no user access; PKCE and owner consent are still required.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationAllowedScopes: oauthScopes,
        clientRegistrationDefaultScopes: oauthScopes,
        clientPrivileges: ({ action, user, session }) =>
          action === "configure-client-credentials-scopes"
            ? false
            : !!(user && session),
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
            const approving =
              ctx.path === "/oauth2/consent" && ctx.body?.accept === true;
            const approval = oauthApproval.getStore();
            if (
              approving &&
              (!approval ||
                approval.userId !== user.id ||
                approval.clientId !== clientId ||
                scopes.some((scope) => !approval.scopes.includes(scope)))
            )
              throw invalidGrant();
            const reference = await grants.reference(
              user.id,
              clientId,
              approving ? scopes : undefined,
              approving ? approval!.resources : {},
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
