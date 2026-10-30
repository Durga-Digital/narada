import { randomBytes, createHash } from "node:crypto";
import { Hono } from "hono";
import { setCookie, getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { requireMcpAuth } from "@better-auth/mcp";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { operationSchemas } from "@narada/contracts/discovery";
import type { FeasibilityRuntime } from "./storage.js";
import { feasibilityScopes, oauthScopes } from "./auth.js";
import { GrantStore } from "./grants.js";
import { loginPage, consentPage, page, escape } from "./pages.js";
import {
  oauthCaller,
  assertOperationAccess,
  executeAuthorized,
  describeCapabilities,
} from "@narada/core/authorization";

export function createFeasibilityApp(runtime: FeasibilityRuntime) {
  const { auth, config } = runtime;
  const app = new Hono();
  const resource = `${config.BETTER_AUTH_URL}/api/mcp`;
  const grants = new GrantStore(runtime.store, resource);
  const demo = new Map<
    string,
    {
      userId: string;
      verifier: string;
      clientId: string;
      expires: number;
      scopes?: string[];
    }
  >();
  app.use("*", bodyLimit({ maxSize: 32_000 }));
  app.use("*", async (c, next) => {
    if (new URL(c.req.url).origin !== config.BETTER_AUTH_URL)
      return c.text("Invalid host", 403);
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    if (
      c.req.header("origin") &&
      c.req.header("origin") !== config.BETTER_AUTH_URL
    )
      return c.json({ error: "Invalid origin" }, 403);
    await next();
  });
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.get("/.well-known/*", (c) => auth.handler(c.req.raw));
  app.get("/oauth/login", (c) => {
    const nonce = randomBytes(18).toString("base64url");
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    );
    return c.html(loginPage(nonce));
  });
  app.get("/oauth/consent", async (c) => {
    const query = new URL(c.req.url).search.slice(1);
    if (!(await verifyOAuthQueryParams(query, config.BETTER_AUTH_SECRET)))
      return c.text("Invalid or expired authorization request", 400);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.redirect(`/oauth/login?${query}`);
    const params = new URLSearchParams(query);
    const client = await auth.api.getOAuthClientPublic({
      headers: c.req.raw.headers,
      query: { client_id: params.get("client_id")! },
    });
    const requested = (params.get("scope") ?? "").split(" ").filter(Boolean);
    if (requested.some((s) => !oauthScopes.includes(s)))
      return c.text("Unsupported permission", 400);
    const labels = new Map<string, string>([
      ["openid", "Identify your Narada account"],
      ["offline_access", "Keep this connection active using refresh tokens"],
      ...feasibilityScopes.map((s) => [s.scope, s.label] as [string, string]),
    ]);
    const nonce = randomBytes(18).toString("base64url");
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    );
    return c.html(
      consentPage(
        nonce,
        session.user.email,
        client.client_name ?? "OAuth client",
        requested.map((scope) => ({ scope, label: labels.get(scope)! })),
      ),
    );
  });
  app.get("/", async (c) => {
    const nonce = randomBytes(18).toString("base64url");
    return c.html(
      page(
        "OAuth feasibility",
        `<p>This server uses disposable local data and exposes two read-only probe tools.</p><p>MCP endpoint: <code>${escape(resource)}</code></p><p><a href="/oauth/login">Sign in</a>, then start a local client connection.</p><form><button>Test all or selected permissions</button></form>`,
        nonce,
        `document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();try{const r=await fetch('/oauth/demo',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const data=await r.json();if(!r.ok)throw Error(data.error||'Could not start the test');location.assign(data.url);}catch(e){document.querySelector('#error').textContent=e.message;}});`,
      ),
    );
  });
  app.post("/oauth/demo", async (c) => {
    if (c.req.header("origin") !== config.BETTER_AUTH_URL)
      return c.text("Invalid origin", 403);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ url: "/oauth/login" });
    for (const [key, value] of demo)
      if (value.expires < Date.now()) demo.delete(key);
    if (demo.size >= 20)
      return c.text(
        "Too many pending tests; restart the disposable server",
        429,
      );
    const redirect = `${config.BETTER_AUTH_URL}/oauth/callback`;
    const client = await auth.api.createOAuthClient({
      headers: c.req.raw.headers,
      body: {
        client_name: "Local Narada test client",
        application_type: "native",
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: oauthScopes.join(" "),
      },
    });
    const verifier = randomBytes(32).toString("base64url"),
      state = randomBytes(32).toString("base64url");
    demo.set(state, {
      userId: session.user.id,
      verifier,
      clientId: client.client_id,
      expires: Date.now() + 600_000,
    });
    setCookie(c, "narada_oauth_probe", state, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/oauth",
      maxAge: 600,
    });
    return c.json({
      url: `/api/auth/oauth2/authorize?${new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirect,
        scope: oauthScopes.join(" "),
        response_type: "code",
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        resource,
        prompt: "consent",
      })}`,
    });
  });
  app.get("/oauth/callback", async (c) => {
    const state = c.req.query("state"),
      pending = state ? demo.get(state) : undefined;
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (
      !state ||
      state !== getCookie(c, "narada_oauth_probe") ||
      !pending ||
      pending.expires < Date.now() ||
      pending.userId !== session?.user.id ||
      pending.scopes
    )
      return c.text("Invalid or expired test connection", 400);
    if (c.req.query("error")) {
      demo.delete(state);
      return c.text("Connection canceled. No new permission was granted.");
    }
    if (
      c.req.query("iss") !== `${config.BETTER_AUTH_URL}/api/auth` ||
      !c.req.query("code")
    )
      return c.text("Invalid callback", 400);
    const response = await auth.handler(
      new Request(`${config.BETTER_AUTH_URL}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: pending.clientId,
          code: c.req.query("code")!,
          code_verifier: pending.verifier,
          redirect_uri: `${config.BETTER_AUTH_URL}/oauth/callback`,
          resource,
        }),
      }),
    );
    if (!response.ok) {
      demo.delete(state);
      return c.text(
        "Token exchange failed; run the integration suite for diagnostics",
        400,
      );
    }
    const tokens = await response.json();
    // Never expose or retain tokens in the demonstration UI.
    pending.scopes = tokens.scope.split(" ");
    pending.verifier = "";
    return c.redirect("/oauth/result", 303);
  });
  app.get("/oauth/result", async (c) => {
    const state = getCookie(c, "narada_oauth_probe"),
      result = state ? demo.get(state) : undefined;
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (
      !result?.scopes ||
      result.expires < Date.now() ||
      result.userId !== session?.user.id
    )
      return c.text("Test result expired", 404);
    return c.html(
      page(
        "Connection authorized",
        `<p>The token was issued with exactly these permissions:</p><ul>${result.scopes.map((scope) => `<li><code>${escape(scope)}</code></li>`).join("")}</ul><p>No credentials are displayed or retained by this demo.</p><a href="/">Test another selection</a>`,
        randomBytes(18).toString("base64url"),
      ),
    );
  });
  const protectedMcp = requireMcpAuth(
    auth,
    async (request, claims) => {
      const ctx = await auth.$context;
      const grant =
        typeof claims.narada_grant === "string" &&
        typeof claims.sub === "string" &&
        typeof claims.azp === "string"
          ? await grants.active(claims.narada_grant, claims.sub, claims.azp)
          : undefined;
      const consent =
        typeof claims.narada_consent_id === "string"
          ? await ctx.adapter.findOne<{
              userId: string;
              clientId: string;
              scopes: string[];
            }>({
              model: "oauthConsent",
              where: [{ field: "id", value: claims.narada_consent_id }],
            })
          : null;
      if (
        !grant ||
        !consent ||
        consent.userId !== claims.sub ||
        consent.clientId !== claims.azp
      ) {
        return new Response(JSON.stringify({ error: "invalid_token" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
            "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${config.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/mcp"`,
          },
        });
      }
      const caller = oauthCaller({
        subject: claims.sub!,
        clientId: claims.azp as string,
        resource,
        tokenScopes:
          typeof claims.scope === "string" ? claims.scope.split(" ") : [],
        tokenGrantId: claims.narada_grant as string,
        grant: {
          ...grant,
          id: `${grant.pk.slice("OAUTH_GRANT#".length)}.${grant.epoch}`,
        },
        consent,
      });
      const handler = createMcpHandler(
        () => {
          const server = new McpServer({
            name: "narada-oauth-feasibility",
            version: "0.1.0",
          });
          for (const item of feasibilityScopes) {
            const operationId =
              item.scope === "narada:identity:read"
                ? "identity.read"
                : "capabilities.read";
            const tool = server.registerTool(
              item.scope === "narada:identity:read" ? "whoami" : "capabilities",
              {
                description: item.label,
                inputSchema: z.fromJSONSchema(
                  operationSchemas[operationId].input,
                ),
                annotations: { readOnlyHint: true },
              },
              async () =>
                executeAuthorized(
                  caller,
                  operationId,
                  () => ({}),
                  () => ({
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify(
                          item.scope === "narada:identity:read"
                            ? { userId: claims.sub, clientId: claims.azp }
                            : describeCapabilities(
                                caller,
                                ["identity.read", "capabilities.read"],
                                "local-feasibility",
                              ),
                        ),
                      },
                    ],
                  }),
                ),
            );
            // Keep tools/list available even when this grant has no tools.
            // Disabled tools are omitted from discovery and reject invocation.
            try {
              assertOperationAccess(caller, operationId);
            } catch {
              tool.disable();
            }
          }
          return server;
        },
        // Installed clients still negotiate 2025-era MCP. Both protocol paths
        // use the same per-request grant checks and filtered tool registry.
        { legacy: "stateless" },
      );
      return handler.fetch(request);
    },
    { resource, challengeScopes: feasibilityScopes.map((s) => s.scope) },
  );
  app.on(["POST", "GET", "DELETE"], "/api/mcp", (c) => protectedMcp(c.req.raw));
  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        event: "oauth_feasibility_error",
        name: error.name,
        message: error.message,
      }),
    );
    return c.json(
      {
        error:
          "Feasibility request failed; inspect the integration test result",
      },
      500,
    );
  });
  return app;
}
