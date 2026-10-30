import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { chromium } from "@playwright/test";
import { loadConfig } from "@narada/core/config";
import {
  createFeasibilityAuth,
  oauthScopes,
} from "../../scripts/oauth-feasibility/auth.js";
import {
  createFeasibilityRuntime,
  type FeasibilityRuntime,
} from "../../scripts/oauth-feasibility/storage.js";
import { createFeasibilityApp } from "../../scripts/oauth-feasibility/app.js";

let runtime: FeasibilityRuntime;
let app: ReturnType<typeof createFeasibilityApp>;
let server: ReturnType<typeof serve>;
let origin: string;
let cookie = "";
let requestNo = 0;
const redirect = "http://127.0.0.1:3218/callback";
const selected = ["openid", "offline_access", "narada:identity:read"];
const account = {
  email: "oauth-owner@narada.test",
  password: randomBytes(24).toString("base64url"),
};
function headers(session = cookie) {
  const n = ++requestNo;
  return {
    origin,
    cookie: session,
    accept: "application/json",
    "x-forwarded-for": `198.18.${Math.floor(n / 250)}.${(n % 250) + 1}`,
  };
}
function request(path: string, body?: unknown, session = cookie) {
  return fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "manual",
    headers: {
      ...headers(session),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function client() {
  const res = await request("/api/auth/oauth2/create-client", {
    client_name: "Narada feasibility client",
    application_type: "native",
    redirect_uris: [redirect],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: oauthScopes.join(" "),
  });
  const result = await res.json();
  expect(res.status, result.error_description).toBe(201);
  return result as { client_id: string };
}
function authorizationQuery(clientId: string, scopes = oauthScopes) {
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: scopes.join(" "),
    state: randomUUID(),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: `${origin}/api/mcp`,
    prompt: "consent",
  });
  return { verifier, query };
}
async function authorize(clientId: string, scopes = oauthScopes) {
  const flow = authorizationQuery(clientId, scopes);
  const response = await request(`/api/auth/oauth2/authorize?${flow.query}`);
  const result = await response.json();
  expect(response.status, result.error_description).toBe(200);
  const url = new URL(result.url, origin);
  expect(url.pathname).toBe("/oauth/consent");
  return { ...flow, signedQuery: url.search.slice(1) };
}
function token(body: Record<string, string>) {
  return fetch(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: {
      ...headers(""),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
}
async function acceptedCode(
  scopes = oauthScopes,
  existing?: { client_id: string },
) {
  const c = existing ?? (await client());
  const flow = await authorize(c.client_id);
  const response = await request("/api/auth/oauth2/consent", {
    accept: true,
    scope: scopes.join(" "),
    oauth_query: flow.signedQuery,
  });
  const consent = await response.json();
  expect(response.status, consent.error_description).toBe(200);
  const callback = new URL(consent.url);
  expect(callback.searchParams.get("state")).toBe(flow.query.get("state"));
  expect(callback.searchParams.get("iss")).toBe(`${origin}/api/auth`);
  const code = callback.searchParams.get("code")!;
  expect(code).toBeTruthy();
  return {
    c,
    exchange: {
      grant_type: "authorization_code",
      client_id: c.client_id,
      code,
      code_verifier: flow.verifier,
      redirect_uri: redirect,
      resource: `${origin}/api/mcp`,
    },
  };
}
async function grant(scopes = oauthScopes, existing?: { client_id: string }) {
  const g = await acceptedCode(scopes, existing);
  const response = await token(g.exchange);
  const tokens = await response.json();
  expect(response.status, tokens.error_description).toBe(200);
  return { ...g, tokens };
}
function mcp(accessToken: string, method = "tools/list", params = {}) {
  return fetch(`${origin}/api/mcp`, {
    method: "POST",
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "narada-test",
            version: "1",
          },
        },
      },
    }),
  });
}
async function consentFor(clientId: string) {
  const response = await request("/api/auth/oauth2/get-consents");
  expect(response.status).toBe(200);
  const items = (await response.json()) as { id: string; clientId: string }[];
  return items.find((c) => c.clientId === clientId)!;
}
beforeAll(async () => {
  server = serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => app.fetch(request),
  });
  if (!server.listening)
    await new Promise<void>((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const prefix = `narada-oauth-feasibility-${randomUUID().slice(0, 8)}`;
  runtime = await createFeasibilityRuntime(
    loadConfig({
      NARADA_MODE: "local",
      BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
      BETTER_AUTH_URL: origin,
      APP_TABLE: `${prefix}-app`,
      AUTH_TABLE: `${prefix}-auth`,
      DYNAMODB_ENDPOINT:
        process.env.DYNAMODB_ENDPOINT ?? "http://127.0.0.1:8000",
    }),
  );
  app = createFeasibilityApp(runtime);
  await createFeasibilityAuth(
    runtime.config,
    runtime.store,
    true,
  ).api.signUpEmail({ body: { ...account, name: "OAuth owner" } });
  const login = await request("/api/auth/sign-in/email", account, "");
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  if (runtime) await runtime.close();
});

describe("Better Auth OAuth with the real DynamoDB adapter", () => {
  it("exposes discovery and requires authentication without enabling public signup or registration", async () => {
    const metadata = await request(
      "/.well-known/oauth-authorization-server/api/auth",
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      issuer: `${origin}/api/auth`,
      scopes_supported: oauthScopes,
    });
    const resource = await request(
      "/.well-known/oauth-protected-resource/api/mcp",
    );
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({
      resource: `${origin}/api/mcp`,
    });
    expect(
      (
        await request(
          "/api/auth/sign-up/email",
          { ...account, name: "Intruder" },
          "",
        )
      ).ok,
    ).toBe(false);
    expect((await request("/api/auth/oauth2/register", {}, "")).ok).toBe(false);
    const unauth = await mcp("");
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("www-authenticate")).toContain(
      "resource_metadata",
    );
  });
  it.each([
    { mode: "all", scopes: oauthScopes },
    { mode: "selected", scopes: selected },
  ])(
    "grants and refreshes exactly the accepted $mode scopes",
    async ({ scopes }) => {
      const { c, tokens } = await grant(scopes);
      expect(tokens.scope.split(" ").sort()).toEqual([...scopes].sort());
      const payload = JSON.parse(
        Buffer.from(tokens.access_token.split(".")[1], "base64url").toString(),
      );
      expect(payload).toMatchObject({
        aud: expect.arrayContaining([`${origin}/api/mcp`]),
        iss: `${origin}/api/auth`,
        azp: c.client_id,
        sub: expect.any(String),
      });
      const refresh = await token({
        grant_type: "refresh_token",
        client_id: c.client_id,
        refresh_token: tokens.refresh_token,
        resource: `${origin}/api/mcp`,
      });
      const refreshed = await refresh.json();
      expect(refresh.status, refreshed.error_description).toBe(200);
      expect(refreshed.scope.split(" ").sort()).toEqual([...scopes].sort());
      const list = await mcp(refreshed.access_token);
      const result = await list.json();
      expect(list.status, JSON.stringify(result)).toBe(200);
      expect(
        result.result.tools.map((t: { name: string }) => t.name).sort(),
      ).toEqual(
        scopes.includes("narada:capabilities:read")
          ? ["capabilities", "whoami"]
          : ["whoami"],
      );
      if (!scopes.includes("narada:capabilities:read")) {
        const hidden = await mcp(refreshed.access_token, "tools/call", {
          name: "capabilities",
          arguments: {},
        });
        const body = await hidden.json();
        expect(body.error ?? body.result?.isError).toBeTruthy();
      }
    },
  );
  it("allows declining refresh access and all product permissions", async () => {
    const { tokens } = await grant(["openid"]);
    expect(tokens.scope).toBe("openid");
    expect(tokens.refresh_token).toBeUndefined();
    const response = await mcp(tokens.access_token);
    expect(response.status).toBe(200);
    expect((await response.json()).result.tools).toEqual([]);
  });
  it.each(["2025-06-18", "2025-11-25"])(
    "enforces the same grant on MCP %s",
    async (protocolVersion) => {
      const { c, tokens } = await grant(selected);
      async function legacy(
        method: string,
        params: Record<string, unknown> = {},
      ) {
        return fetch(`${origin}/api/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${tokens.access_token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": protocolVersion,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
      }
      async function result(response: Response) {
        const body = await response.text();
        return JSON.parse(
          body.startsWith("event:") || body.startsWith("data:")
            ? body
                .split("\n")
                .find((line) => line.startsWith("data: "))!
                .slice(6)
            : body,
        );
      }
      expect(
        (
          await legacy("initialize", {
            protocolVersion,
            capabilities: {},
            clientInfo: { name: "legacy-test", version: "1" },
          })
        ).status,
      ).toBe(200);
      const listing = await result(await legacy("tools/list"));
      expect(listing.result.tools.map((t: { name: string }) => t.name)).toEqual(
        ["whoami"],
      );
      const allowed = await result(
        await legacy("tools/call", { name: "whoami", arguments: {} }),
      );
      expect(JSON.parse(allowed.result.content[0].text).clientId).toBe(
        c.client_id,
      );
      const denied = await result(
        await legacy("tools/call", { name: "capabilities", arguments: {} }),
      );
      expect(denied.error ?? denied.result?.isError).toBeTruthy();
      const consent = await consentFor(c.client_id);
      expect(
        (await request("/api/auth/oauth2/delete-consent", { id: consent.id }))
          .ok,
      ).toBe(true);
      expect(
        (await legacy("tools/call", { name: "whoami", arguments: {} })).status,
      ).toBe(401);
    },
  );
  it("rejects scope escalation at consent and refresh", async () => {
    const c = await client(),
      flow = await authorize(c.client_id, selected);
    expect(
      (
        await request("/api/auth/oauth2/consent", {
          accept: true,
          scope: oauthScopes.join(" "),
          oauth_query: flow.signedQuery,
        })
      ).status,
    ).toBe(400);
    const g = await grant(selected);
    const r = await token({
      grant_type: "refresh_token",
      client_id: g.c.client_id,
      refresh_token: g.tokens.refresh_token,
      scope: oauthScopes.join(" "),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_scope");
  });
  it("denial issues no code and tampered consent queries are rejected", async () => {
    const c = await client(),
      flow = await authorize(c.client_id);
    const deny = await request("/api/auth/oauth2/consent", {
      accept: false,
      oauth_query: flow.signedQuery,
    });
    const url = new URL((await deny.json()).url);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.has("code")).toBe(false);
    expect(
      (await request(`/oauth/consent?${flow.signedQuery}&scope=admin`)).status,
    ).toBe(400);
    expect(
      (
        await request("/api/auth/oauth2/consent", {
          accept: true,
          scope: selected.join(" "),
          oauth_query: flow.signedQuery.replace("narada", "evil"),
        })
      ).status,
    ).toBe(400);
  });
  it("rejects a wrong PKCE verifier, wrong client, and wrong resource", async () => {
    for (const change of [
      { code_verifier: randomBytes(32).toString("base64url") },
      { client_id: (await client()).client_id },
      { resource: "https://wrong.example/mcp" },
    ]) {
      const g = await acceptedCode();
      expect((await token({ ...g.exchange, ...change })).ok).toBe(false);
    }
  });
  it("consumes an authorization code only once under concurrent exchange", async () => {
    const { exchange } = await acceptedCode();
    const results = await Promise.all([token(exchange), token(exchange)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await token(exchange)).ok).toBe(false);
  });
  it("rotates concurrently without creating two different successor refresh tokens", async () => {
    const { c, tokens } = await grant();
    const body = {
      grant_type: "refresh_token",
      client_id: c.client_id,
      refresh_token: tokens.refresh_token,
      resource: `${origin}/api/mcp`,
    };
    const responses = await Promise.all([token(body), token(body)]);
    const successful = await Promise.all(
      responses.filter((r) => r.ok).map((r) => r.json()),
    );
    expect(successful.length).toBeGreaterThan(0);
    expect(new Set(successful.map((r) => r.refresh_token)).size).toBe(1);
    const replay = await token(body);
    const replayed = await replay.json();
    expect(replay.status, replayed.error_description).toBe(200);
    // Compare booleans to avoid printing credentials if an assertion fails.
    expect(replayed.refresh_token === successful[0].refresh_token).toBe(true);
  });
  it("atomically enforces a nullable predicate on concurrent adapter updates", async () => {
    const { c } = await grant();
    const adapter = (await runtime.auth.$context).adapter;
    const row = await adapter.findOne<{ id: string }>({
      model: "oauthRefreshToken",
      where: [{ field: "clientId", value: c.client_id }],
    });
    expect(row).toBeTruthy();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        adapter.incrementOne({
          model: "oauthRefreshToken",
          where: [
            { field: "id", value: row!.id },
            { field: "revoked", value: null },
          ],
          increment: {},
          set: { revoked: new Date() },
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("rejects ID tokens and invalid signatures at the MCP boundary", async () => {
    const { tokens } = await grant();
    expect((await mcp(tokens.id_token)).status).toBe(401);
    const parts = tokens.access_token.split(".");
    parts[1] = Buffer.from(
      JSON.stringify({ sub: "someone-else", scope: oauthScopes.join(" ") }),
    ).toString("base64url");
    expect((await mcp(parts.join("."))).status).toBe(401);
  });
  it("enforces reduced current consent and revocation on an already issued JWT", async () => {
    const { c, tokens } = await grant();
    const consent = await consentFor(c.client_id);
    expect(consent).toBeTruthy();
    expect(
      (
        await request("/api/auth/oauth2/update-consent", {
          id: consent.id,
          update: { scopes: selected },
        })
      ).ok,
    ).toBe(true);
    const listing = await (await mcp(tokens.access_token)).json();
    expect(listing.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "whoami",
    ]);
    expect(
      (await request("/api/auth/oauth2/delete-consent", { id: consent.id })).ok,
    ).toBe(true);
    expect((await mcp(tokens.access_token)).status).toBe(401);
    expect(
      (
        await token({
          grant_type: "refresh_token",
          client_id: c.client_id,
          refresh_token: tokens.refresh_token,
        })
      ).ok,
    ).toBe(false);
  });
  it("never reactivates old JWTs, refresh tokens, or pending codes after reconnect and restart", async () => {
    const old = await grant();
    const refreshBody = {
      grant_type: "refresh_token",
      client_id: old.c.client_id,
      refresh_token: old.tokens.refresh_token,
      resource: `${origin}/api/mcp`,
    };
    const rotated = await (await token(refreshBody)).json();
    expect(rotated.refresh_token).toBeTruthy();
    // An independently approved code that has not yet been exchanged also becomes stale.
    const pending = await acceptedCode(oauthScopes, old.c);
    const allConsents = await (
      await request("/api/auth/oauth2/get-consents")
    ).json();
    for (const consent of allConsents.filter(
      (c: { clientId: string }) => c.clientId === old.c.client_id,
    )) {
      expect(
        (await request("/api/auth/oauth2/delete-consent", { id: consent.id }))
          .ok,
      ).toBe(true);
    }
    const fresh = await grant(selected, old.c);
    // Reconstruct both auth and MCP; no process-local revocation state can help this check.
    const restarted = {
      ...runtime,
      auth: createFeasibilityAuth(runtime.config, runtime.store),
    };
    app = createFeasibilityApp(restarted);
    expect((await mcp(fresh.tokens.access_token)).status).toBe(200);
    for (const access of [old.tokens.access_token, rotated.access_token])
      expect((await mcp(access)).status).toBe(401);
    for (const refresh of [old.tokens.refresh_token, rotated.refresh_token]) {
      const denied = await token({ ...refreshBody, refresh_token: refresh });
      expect(denied.status).toBe(400);
      expect((await denied.json()).error).toBe("invalid_grant");
    }
    expect((await token(pending.exchange)).status).toBe(400);
    // Replaying an old family must not revoke the new connection as collateral damage.
    expect(
      (
        await token({
          ...refreshBody,
          refresh_token: fresh.tokens.refresh_token,
        })
      ).status,
    ).toBe(200);
  });
  it("requires fresh consent for expansion and keeps superseded tokens invalid", async () => {
    const old = await grant();
    const consent = await consentFor(old.c.client_id);
    expect(
      (
        await request("/api/auth/oauth2/update-consent", {
          id: consent.id,
          update: { scopes: selected },
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await request("/api/auth/oauth2/update-consent", {
          id: consent.id,
          update: { scopes: oauthScopes },
        })
      ).status,
    ).toBe(400);
    const narrowed = await token({
      grant_type: "refresh_token",
      client_id: old.c.client_id,
      refresh_token: old.tokens.refresh_token,
      scope: selected.join(" "),
      resource: `${origin}/api/mcp`,
    });
    expect(narrowed.status).toBe(200);
    const narrowedTokens = await narrowed.json();
    expect(narrowedTokens.scope.split(" ").sort()).toEqual(
      [...selected].sort(),
    );
    const fresh = await grant(oauthScopes, old.c);
    expect((await mcp(old.tokens.access_token)).status).toBe(401);
    expect((await mcp(narrowedTokens.access_token)).status).toBe(401);
    expect(
      (
        await request("/api/auth/oauth2/update-consent", {
          id: consent.id,
          update: { scopes: oauthScopes },
        })
      ).status,
    ).toBe(400);
    // Deleting a historical consent cannot disconnect a newer generation.
    expect(
      (await request("/api/auth/oauth2/delete-consent", { id: consent.id })).ok,
    ).toBe(true);
    expect((await mcp(fresh.tokens.access_token)).status).toBe(200);
  });
  it("blocks cached rotation responses immediately after revocation", async () => {
    const old = await grant();
    const body = {
      grant_type: "refresh_token",
      client_id: old.c.client_id,
      refresh_token: old.tokens.refresh_token,
      resource: `${origin}/api/mcp`,
    };
    expect((await token(body)).status).toBe(200);
    const consent = await consentFor(old.c.client_id);
    expect(
      (await request("/api/auth/oauth2/delete-consent", { id: consent.id })).ok,
    ).toBe(true);
    expect((await token(body)).status).toBe(400);
  });
  it("does not mutate a grant for unauthenticated or foreign-origin consent management", async () => {
    const { c, tokens } = await grant();
    const consent = await consentFor(c.client_id);
    for (const path of ["delete-consent", "update-consent"]) {
      const body = { id: consent.id, update: { scopes: selected } };
      expect((await request(`/api/auth/oauth2/${path}`, body, "")).ok).toBe(
        false,
      );
      const foreign = await fetch(`${origin}/api/auth/oauth2/${path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      expect(foreign.status).toBe(403);
      const direct = await runtime.auth.handler(
        new Request(`${origin}/api/auth/oauth2/${path}`, {
          method: "POST",
          headers: {
            cookie,
            origin: "https://evil.example",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      expect(direct.status).toBe(403);
      const listing = await (await mcp(tokens.access_token)).json();
      expect(
        listing.result.tools.map((t: { name: string }) => t.name).sort(),
      ).toEqual(["capabilities", "whoami"]);
    }
  });
  it("canceling a new consent request leaves the existing connection usable", async () => {
    const { c, tokens } = await grant();
    const flow = await authorize(c.client_id);
    expect(
      (
        await request("/api/auth/oauth2/consent", {
          accept: false,
          oauth_query: flow.signedQuery,
        })
      ).ok,
    ).toBe(true);
    expect((await mcp(tokens.access_token)).status).toBe(200);
  });
  it("keeps concurrent refresh results powerless after revocation while other clients remain active", async () => {
    const old = await grant(),
      unrelated = await grant();
    const consent = await consentFor(old.c.client_id);
    const body = {
      grant_type: "refresh_token",
      client_id: old.c.client_id,
      refresh_token: old.tokens.refresh_token,
      resource: `${origin}/api/mcp`,
    };
    const [revoked, ...responses] = await Promise.all([
      request("/api/auth/oauth2/delete-consent", { id: consent.id }),
      ...Array.from({ length: 4 }, () => token(body)),
    ]);
    expect(revoked!.ok).toBe(true);
    const fresh = await grant(selected, old.c);
    for (const response of responses)
      if (response.ok) {
        const tokens = await response.json();
        expect((await mcp(tokens.access_token)).status).toBe(401);
        expect(
          (await token({ ...body, refresh_token: tokens.refresh_token }))
            .status,
        ).toBe(400);
      }
    expect((await mcp(old.tokens.access_token)).status).toBe(401);
    expect((await mcp(fresh.tokens.access_token)).status).toBe(200);
    expect((await mcp(unrelated.tokens.access_token)).status).toBe(200);
  });
  it("keeps signing keys across auth instances without unbounded scans", async () => {
    const first = await (await request("/api/auth/jwks")).json();
    const another = createFeasibilityAuth(runtime.config, runtime.store);
    const second = await (
      await another.handler(new Request(`${origin}/api/auth/jwks`))
    ).json();
    expect(second.keys.map((k: { kid: string }) => k.kid)).toEqual(
      first.keys.map((k: { kid: string }) => k.kid),
    );
  });
  it("runs the local demo through a real callback without exposing tokens", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        "x-forwarded-for": headers()["x-forwarded-for"],
      });
      page.setDefaultTimeout(5000);
      await page.goto(`${origin}/oauth/login`);
      await page.getByLabel("Email", { exact: true }).fill(account.email);
      await page.getByLabel("Password", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page
        .getByRole("button", { name: "Test all or selected permissions" })
        .click();
      await page.waitForLoadState("networkidle");
      expect(
        new URL(page.url()).pathname,
        await page.locator("body").innerText(),
      ).toBe("/oauth/consent");
      await page.getByLabel("Choose permissions", { exact: true }).check();
      await page
        .getByLabel("Read this connection's capabilities", { exact: true })
        .uncheck();
      await page
        .getByRole("button", { name: "Authorize connection", exact: true })
        .click();
      await page.waitForURL(`${origin}/oauth/result`);
      expect(await page.locator("li code").allTextContents()).toEqual(selected);
      expect(await page.content()).not.toMatch(
        /access_token|refresh_token|eyJ[A-Za-z0-9_-]+\./,
      );
    } finally {
      await browser.close();
    }
  });
  it("completes browser login and both all/selected consent choices", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const mode of ["all", "selected"]) {
        const c = await client(),
          flow = authorizationQuery(c.client_id);
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.setExtraHTTPHeaders({
          "x-forwarded-for": headers()["x-forwarded-for"],
        });
        await page.route(`${redirect}**`, (route) =>
          route.fulfill({
            contentType: "text/html",
            body: "<h1>Returned to client</h1>",
          }),
        );
        await page.goto(`${origin}/api/auth/oauth2/authorize?${flow.query}`);
        await page.getByLabel("Email", { exact: true }).fill(account.email);
        await page
          .getByLabel("Password", { exact: true })
          .fill(account.password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page.getByRole("heading", { name: "Connect an app" }).waitFor();
        if (mode === "selected") {
          await page.getByLabel("Choose permissions", { exact: true }).check();
          await page
            .getByLabel("Read this connection's capabilities", { exact: true })
            .uncheck();
        }
        await page
          .getByRole("button", { name: "Authorize connection", exact: true })
          .click();
        await page.waitForURL(`${redirect}**`);
        const callback = new URL(page.url());
        expect(callback.searchParams.get("state")).toBe(
          flow.query.get("state"),
        );
        const response = await token({
          grant_type: "authorization_code",
          client_id: c.client_id,
          code: callback.searchParams.get("code")!,
          code_verifier: flow.verifier,
          redirect_uri: redirect,
          resource: `${origin}/api/mcp`,
        });
        const result = await response.json();
        expect(response.status, result.error_description).toBe(200);
        expect(result.scope.split(" ").sort()).toEqual(
          [...(mode === "all" ? oauthScopes : selected)].sort(),
        );
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
  it("preserves the OAuth request across two-factor login before consent", async () => {
    const mfaAccount = {
      email: "oauth-mfa@narada.test",
      password: randomBytes(24).toString("base64url"),
    };
    await createFeasibilityAuth(
      runtime.config,
      runtime.store,
      true,
    ).api.signUpEmail({ body: { ...mfaAccount, name: "MFA owner" } });
    const login = await request("/api/auth/sign-in/email", mfaAccount, "");
    const session = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const enrollment = await request(
      "/api/auth/two-factor/enable",
      { password: mfaAccount.password },
      session,
    );
    expect(enrollment.status).toBe(200);
    const data = await enrollment.json();
    const secret = new URL(data.totpURI).searchParams.get("secret")!;
    const bits = [...secret.replace(/=+$/, "")]
      .map((c) =>
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
          .indexOf(c)
          .toString(2)
          .padStart(5, "0"),
      )
      .join("");
    const key = Buffer.from(
      (bits.match(/.{8}/g) ?? []).map((s) => parseInt(s, 2)),
    );
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const digest = createHmac("sha1", key).update(counter).digest();
    const code = (
      (digest.readUInt32BE(digest[digest.length - 1]! & 15) & 0x7fffffff) %
      1_000_000
    )
      .toString()
      .padStart(6, "0");
    expect(
      (await request("/api/auth/two-factor/verify-totp", { code }, session))
        .status,
    ).toBe(200);
    const c = await client(),
      flow = authorizationQuery(c.client_id);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        "x-forwarded-for": headers()["x-forwarded-for"],
      });
      page.setDefaultTimeout(5000);
      await page.route(`${redirect}**`, (route) =>
        route.fulfill({ body: "Connected" }),
      );
      await page.goto(`${origin}/api/auth/oauth2/authorize?${flow.query}`);
      await page.getByLabel("Email", { exact: true }).fill(mfaAccount.email);
      await page
        .getByLabel("Password", { exact: true })
        .fill(mfaAccount.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page
        .getByLabel("Authenticator or recovery code", { exact: true })
        .fill(data.backupCodes[0]);
      await page.getByLabel("Use a recovery code", { exact: true }).check();
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("heading", { name: "Connect an app" }).waitFor();
      await page
        .getByRole("button", { name: "Authorize connection", exact: true })
        .click();
      await page.waitForURL(`${redirect}**`);
      expect(new URL(page.url()).searchParams.get("state")).toBe(
        flow.query.get("state"),
      );
    } finally {
      await browser.close();
    }
  });
});
