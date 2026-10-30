import { PublicationDomains } from "@narada/core/publication-domains";
import {
  FakeDomainProvider,
  FakePublicationDns,
} from "../helpers/publication-domains.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { chromium } from "@playwright/test";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { createAuth } from "@narada/core/auth";
import type { Runtime } from "@narada/core/runtime";
import { GrantStore } from "@narada/core/oauth-grants";
import { oauthScopes, mcpOperations, mcpToolName } from "@narada/contracts/mcp";
import type { ResourceRestrictions } from "@narada/contracts/delegation";

const prefix = `narada-mcp-production-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`;
let runtime: Runtime,
  app: ReturnType<typeof createApp>,
  server: ReturnType<typeof serve>,
  origin: string,
  cookie: string,
  userId: string,
  account: { email: string; password: string },
  grants: GrantStore;
let network = 0;
const feedback = () => ({
  name: "MCP feedback",
  kind: "feedback",
  from: "hello@narada.test",
  questions: [{ id: "note", label: "Feedback", type: "text" }],
});
const settings = () => ({
  name: "MCP newsletter",
  slug: `mcp-${randomUUID().slice(0, 8)}`,
  from: "hello@narada.test",
  organization: "Narada",
  postalAddress: "1 Test Street",
});
const issue = () => ({
  title: "MCP issue",
  slug: `issue-${randomUUID().slice(0, 8)}`,
  document: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hello subscribers" }],
      },
    ],
  },
});
const headers = (session = cookie) => ({
  origin,
  cookie: session,
  accept: "application/json",
  "x-forwarded-for": `198.18.${Math.floor(++network / 250)}.${(network % 250) + 1}`,
});
function request(path: string, body?: unknown, session = cookie) {
  return fetch(origin + path, {
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
  const response = await request(
    "/api/auth/oauth2/register",
    {
      client_name: "Production MCP test",
      application_type: "native",
      redirect_uris: [origin + "/test/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: oauthScopes.join(" "),
    },
    "",
  );
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(201);
  return data as { client_id: string };
}
async function authorization(clientId: string, requested = oauthScopes) {
  const verifier = randomBytes(32).toString("base64url"),
    query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: origin + "/test/callback",
      response_type: "code",
      scope: requested.join(" "),
      state: randomUUID(),
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource: origin + "/api/mcp",
    });
  const response = await request("/api/auth/oauth2/authorize?" + query);
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(200);
  expect(new URL(data.url, origin).pathname).toBe("/oauth/consent");
  return { verifier, query, signed: new URL(data.url, origin).search.slice(1) };
}
function token(body: Record<string, string>) {
  return fetch(origin + "/api/auth/oauth2/token", {
    method: "POST",
    headers: {
      ...headers(""),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
}
async function code(
  c: { client_id: string },
  selected = oauthScopes,
  resources: ResourceRestrictions = {},
  mode = "selected",
) {
  const flow = await authorization(c.client_id),
    res = await request("/oauth/consent", {
      accept: true,
      mode,
      scopes: selected,
      resources,
      oauth_query: flow.signed,
    }),
    data = await res.json();
  expect(res.status, JSON.stringify(data)).toBe(200);
  expect(
    typeof data.url,
    JSON.stringify({
      keys: Object.keys(data),
      urlType: typeof data.url,
      redirect: data.redirect,
      error: data.error,
    }),
  ).toBe("string");
  const callback = new URL(data.url, origin);
  expect(callback.searchParams.get("iss")).toBe(origin + "/api/auth");
  return {
    grant_type: "authorization_code",
    client_id: c.client_id,
    code: callback.searchParams.get("code")!,
    code_verifier: flow.verifier,
    redirect_uri: origin + "/test/callback",
    resource: origin + "/api/mcp",
  };
}
async function grant(
  selected = oauthScopes,
  resources: ResourceRestrictions = {},
  existing?: { client_id: string },
  mode = "selected",
) {
  const c = existing ?? (await client()),
    exchange = await code(c, selected, resources, mode),
    res = await token(exchange),
    tokens = await res.json();
  expect(res.status, JSON.stringify(tokens)).toBe(200);
  return { c, exchange, tokens };
}
async function rpc(
  accessToken: string,
  method = "tools/list",
  params: Record<string, unknown> = {},
  protocol = "2026-07-28",
) {
  const response = await fetch(origin + "/api/mcp", {
    method: "POST",
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": protocol,
      ...(protocol === "2026-07-28"
        ? {
            "Mcp-Method": method,
            ...(typeof (params.name ?? params.uri) === "string"
              ? { "Mcp-Name": String(params.name ?? params.uri) }
              : {}),
          }
        : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        ...(protocol === "2026-07-28"
          ? {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": protocol,
                "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/clientInfo": {
                  name: "test",
                  version: "1",
                },
              },
            }
          : {}),
      },
    }),
  });
  const text = await response.text();
  const data = JSON.parse(
    text.startsWith("event:") || text.startsWith("data:")
      ? text
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6)
      : text,
  );
  return { response, data };
}
async function call(
  g: Awaited<ReturnType<typeof grant>>,
  name: string,
  args: Record<string, unknown> = {},
) {
  return rpc(g.tokens.access_token, "tools/call", { name, arguments: args });
}
async function result(
  g: Awaited<ReturnType<typeof grant>>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const r = await call(g, name, args);
  expect(r.response.status, JSON.stringify(r.data)).toBe(200);
  expect(r.data.error, JSON.stringify(r.data)).toBeUndefined();
  expect(r.data.result.isError, JSON.stringify(r.data)).not.toBe(true);
  return r.data.result.structuredContent;
}
async function reviewRequest(
  g: Awaited<ReturnType<typeof grant>>,
  operation: string,
  input: Record<string, unknown>,
) {
  return result(g, "approvals_request", {
    body: { operation, input },
    idempotencyKey: randomUUID(),
  });
}
async function ownerReview(id: string) {
  const response = await request(`/api/admin/approvals/${id}`);
  expect(response.status).toBe(200);
  return response.json();
}
async function approvedSend(
  g: Awaited<ReturnType<typeof grant>>,
  operation: string,
  input: Record<string, unknown>,
) {
  const proposal = await reviewRequest(g, operation, input);
  const review = await ownerReview(proposal.id);
  const response = await request(
    `/api/admin/approvals/${proposal.id}/approve`,
    { digest: review.digest },
  );
  const decision = await response.json();
  expect(response.status, JSON.stringify(decision)).toBe(200);
  expect(decision.status).toBe("succeeded");
  expect(
    await (
      await request(`/api/admin/approvals/${proposal.id}/approve`, {
        digest: review.digest,
      })
    ).json(),
  ).toEqual(decision);
  expect(
    await result(g, "approvals_get", { params: { id: proposal.id } }),
  ).toEqual(decision);
  // The canonical target result is committed with approval consumption and activity.
  const { MutationReceipt } = await import("@narada/core/idempotency");
  const saved = await MutationReceipt.acquire(
    runtime.store,
    `send-approval:${proposal.id}`,
    operation,
    proposal.id,
    { digest: review.digest },
  );
  if (!("replay" in saved)) throw new Error("Missing approved send receipt");
  return JSON.parse(saved.replay.body);
}
async function connection(g: Awaited<ReturnType<typeof grant>>) {
  return (await grants.list(userId)).data.find(
    (row) => row.clientId === g.c.client_id,
  )!;
}
async function refresh(g: Awaited<ReturnType<typeof grant>>) {
  return token({
    grant_type: "refresh_token",
    client_id: g.c.client_id,
    refresh_token: g.tokens.refresh_token,
    resource: origin + "/api/mcp",
  });
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
  vi.stubEnv("APP_TABLE", prefix + "-app");
  vi.stubEnv("AUTH_TABLE", prefix + "-auth");
  vi.stubEnv("BETTER_AUTH_URL", origin);
  runtime = await initialize(credentials);
  app = createApp(runtime);
  account = JSON.parse(await readFile(credentials, "utf8"));
  const login = await request("/api/auth/sign-in/email", account, "");
  expect(login.status).toBe(200);
  userId = (await login.json()).user.id;
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  grants = new GrantStore(runtime.store, origin + "/api/mcp");
});
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    if (runtime)
      for (const TableName of [
        runtime.config.APP_TABLE,
        runtime.config.AUTH_TABLE,
      ])
        await runtime.store.client.send(new DeleteTableCommand({ TableName }));
  } finally {
    await rm(credentials, { force: true });
    vi.unstubAllEnvs();
  }
});

it("serves production discovery, rejects unauthenticated MCP, and registers clients without granting access", async () => {
  const denied = await rpc("");
  expect(denied.response.status).toBe(401);
  expect(denied.response.headers.get("cache-control")).toBe("no-store");
  expect(denied.response.headers.get("www-authenticate")).toContain(
    "/.well-known/oauth-protected-resource/api/mcp",
  );
  const metadata = await (
    await request(
      "/.well-known/oauth-protected-resource/api/mcp",
      undefined,
      "",
    )
  ).json();
  expect(metadata.resource).toBe(origin + "/api/mcp");
  const as = await request(
    "/.well-known/oauth-authorization-server/api/auth",
    undefined,
    "",
  );
  expect(as.status).toBe(200);
  expect((await as.json()).registration_endpoint).toBe(
    origin + "/api/auth/oauth2/register",
  );
  const c = await client();
  expect(
    (await grants.list(userId)).data.find((g) => g.clientId === c.client_id),
  ).toBeUndefined();
  const bad = await request(
    "/api/auth/oauth2/register",
    {
      client_name: "Unsafe",
      redirect_uris: [origin + "/test/callback"],
      token_endpoint_auth_method: "none",
      skip_consent: true,
    },
    "",
  );
  expect(bad.status).toBeGreaterThanOrEqual(400);
});
it("classifies untyped loopback public clients without allowing web or mixed HTTP callbacks", async () => {
  const metadata = {
    client_name: "Untyped native",
    token_endpoint_auth_method: "none",
    redirect_uris: ["http://localhost:3247/callback"],
  };
  const registered = await request("/api/auth/oauth2/register", metadata, "");
  expect(registered.status).toBe(201);
  expect((await registered.json()).application_type).toBe("native");
  for (const body of [
    { ...metadata, application_type: "web" },
    {
      ...metadata,
      redirect_uris: [...metadata.redirect_uris, "http://example.com/callback"],
    },
    { ...metadata, redirect_uris: ["http://127.1/callback"] },
  ])
    expect((await request("/api/auth/oauth2/register", body, "")).status).toBe(
      400,
    );
});
it("issues all requested scopes and exposes canonical tools with durable mutation replay", async () => {
  const g = await grant(oauthScopes, {}, undefined, "all");
  expect(g.tokens.scope.split(" ").sort()).toEqual([...oauthScopes].sort());
  const list = await rpc(g.tokens.access_token);
  expect(list.response.headers.get("cache-control")).toBe("no-store");
  expect(
    list.data.result.tools.map((t: { name: string }) => t.name).sort(),
  ).toEqual(mcpOperations.map((op) => mcpToolName(op.id)).sort());
  const args = { body: feedback(), idempotencyKey: randomUUID() },
    created = await result(g, "forms_create", args);
  expect(created.pk).toBeUndefined();
  const tracked = await result(g, "operations_lookup", {
    body: { operation: "forms.create", idempotencyKey: args.idempotencyKey },
  });
  expect(tracked.status).toBe("succeeded");
  expect(tracked.targets).toContainEqual({ kind: "form", id: created.id });
  const meta = await call(g, "forms_create", args);
  expect(meta.data.result._meta.operationId).toBe(tracked.id);
  expect(
    (await result(g, "operations_get", { params: { id: tracked.id } }))
      .recovery,
  ).toBe("replay_available");
  expect(await result(g, "forms_create", args)).toEqual(created);
  expect(
    (await result(g, "forms_get", { params: { id: created.id } })).id,
  ).toBe(created.id);
  const bad = await call(g, "forms_create", { body: feedback() });
  expect(bad.data.result?.isError || bad.data.error).toBeTruthy();
  const conflict = await call(g, "forms_create", {
    ...args,
    body: { ...feedback(), name: "Different" },
  });
  expect(JSON.parse(conflict.data.result.content[0].text).code).toBe(
    "idempotency_conflict",
  );
  const renewed = await refresh(g);
  expect(renewed.status).toBe(200);
  g.tokens = await renewed.json();
  expect(g.tokens.scope.split(" ").sort()).toEqual([...oauthScopes].sort());
  expect(await result(g, "forms_create", args)).toEqual(created);
  const reconnected = await grant(oauthScopes, {}, g.c);
  expect(await result(reconnected, "forms_create", args)).toEqual(created);
  expect(
    (
      await result(reconnected, "operations_lookup", {
        body: {
          operation: "forms.create",
          idempotencyKey: args.idempotencyKey,
        },
      })
    ).id,
  ).toBe(tracked.id);
  const other = await grant(oauthScopes);
  const deniedHistory = await call(other, "operations_get", {
    params: { id: tracked.id },
  });
  expect(JSON.parse(deniedHistory.data.result.content[0].text).status).toBe(
    404,
  );
  const reduced = await grant(
    ["offline_access", "narada:forms:read", "narada:operations:read"],
    {},
    g.c,
  );
  const reducedHistory = await call(reduced, "operations_get", {
    params: { id: tracked.id },
  });
  expect(JSON.parse(reducedHistory.data.result.content[0].text).status).toBe(
    403,
  );
});
it("enforces selected scopes, resource-filtered lists and direct IDs for access and refreshed tokens", async () => {
  const permitted = await runtime.forms.create(feedback()),
    excluded = await runtime.forms.create(feedback());
  const selected = [
    "openid",
    "offline_access",
    "narada:forms:read",
    "narada:capabilities:read",
  ];
  const g = await grant(selected, {
    formIds: [permitted.id],
    senderDomains: ["narada.test"],
  });
  expect(g.tokens.scope.split(" ").sort()).toEqual([...selected].sort());
  const listed = await result(g, "forms_list");
  expect(listed.data.map((f: { id: string }) => f.id)).toEqual([permitted.id]);
  expect((await result(g, "capabilities")).resources).toEqual({
    formIds: [permitted.id],
    senderDomains: ["narada.test"],
  });
  const denied = await call(g, "forms_get", { params: { id: excluded.id } });
  expect(JSON.parse(denied.data.result.content[0].text).status).toBe(403);
  const write = await call(g, "forms_create", {
    body: feedback(),
    idempotencyKey: randomUUID(),
  });
  expect(write.data.error || write.data.result?.isError).toBeTruthy();
  const renewed = await refresh(g);
  expect(renewed.status).toBe(200);
  g.tokens = await renewed.json();
  expect(
    (await result(g, "forms_list")).data.map((f: { id: string }) => f.id),
  ).toEqual([permitted.id]);
});
it("binds consent to signed requests and disallows provider bypass, scope injection and nonexistent resources", async () => {
  const c = await client(),
    flow = await authorization(c.client_id, ["openid", "narada:forms:read"]);
  expect(
    (
      await request("/api/auth/oauth2/consent", {
        accept: true,
        scope: "openid narada:forms:read",
        oauth_query: flow.signed,
      })
    ).status,
  ).toBe(403);
  const body = {
    accept: true,
    mode: "selected",
    scopes: ["narada:forms:read"],
    resources: {},
    oauth_query: flow.signed,
  };
  expect(
    (
      await request("/oauth/consent", {
        ...body,
        scopes: ["narada:issues:send"],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request("/oauth/consent", {
        ...body,
        resources: { formIds: [randomUUID()] },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await request("/oauth/consent", {
        ...body,
        oauth_query: flow.signed + "&scope=narada:issues:send",
      })
    ).status,
  ).toBe(400);
  const foreign = await fetch(origin + "/oauth/consent", {
    method: "POST",
    headers: {
      ...headers(),
      origin: "https://other.example",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(foreign.status).toBe(403);
  expect((await request("/oauth/consent", body, "")).status).toBe(401);
});
it("enforces publication ownership and separate publishing channels through MCP", async () => {
  let p = await runtime.publications.create(settings());
  p = await runtime.publications.update(p.id, p.settings, p.revision, "active");
  const other = await runtime.publications.create(settings());
  const selected = [
    "narada:publications:read",
    "narada:forms:read",
    "narada:issues:read",
    "narada:issues:write",
    "narada:issues:publish",
    "narada:approvals:request",
    "narada:approvals:read",
  ];
  const g = await grant(selected, { publicationIds: [p.id] });
  expect(
    (await result(g, "publications_list")).data.map(
      (row: { id: string }) => row.id,
    ),
  ).toEqual([p.id]);
  expect(
    (await result(g, "forms_list")).data.map((row: { id: string }) => row.id),
  ).toEqual([p.formId]);
  const denied = await call(g, "publications_get", {
    params: { id: other.id },
  });
  expect(JSON.parse(denied.data.result.content[0].text).status).toBe(403);
  const i = await result(g, "issues_create", {
    params: { id: p.id },
    body: issue(),
    idempotencyKey: randomUUID(),
  });
  const bad = await call(g, "issues_publish", {
    params: { id: p.id, issueId: i.id },
    body: { revision: i.revision, channels: "both", confirmed: true },
    idempotencyKey: randomUUID(),
  });
  expect(JSON.parse(bad.data.result.content[0].text).status).toBe(403);
  const published = await approvedSend(g, "issues.publish", {
    params: { id: p.id, issueId: i.id },
    body: { revision: i.revision, channels: "web", confirmed: true },
  });
  expect(published.revision).toBeGreaterThan(i.revision);
});
it("narrows scopes and resources on live tokens before replay, refuses expansion and stale edits", async () => {
  const a = await runtime.forms.create(feedback()),
    b = await runtime.forms.create(feedback()),
    selected = ["offline_access", "narada:forms:read", "narada:forms:write"];
  const g = await grant(selected, { formIds: [a.id, b.id] });
  const args = {
    params: { id: a.id },
    body: { draft: { ...feedback(), name: "Changed" }, revision: a.revision },
    idempotencyKey: randomUUID(),
  };
  await result(g, "forms_update", args);
  const row = await connection(g),
    path = "/oauth/connections/" + grants.referenceOf(row);
  expect(
    (
      await request(path, {
        scopes: selected,
        resources: { formIds: [b.id] },
        revision: row.revision,
      })
    ).status,
  ).toBe(200);
  expect(
    (await result(g, "forms_list")).data.map((f: { id: string }) => f.id),
  ).toEqual([b.id]);
  const replay = await call(g, "forms_update", args);
  expect(JSON.parse(replay.data.result.content[0].text).status).toBe(403);
  expect(
    (
      await request(path, {
        scopes: selected,
        resources: {},
        revision: row.revision + 1,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(path, {
        scopes: selected,
        resources: { formIds: [b.id] },
        revision: row.revision,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(path, {
        scopes: ["narada:forms:read"],
        resources: { formIds: [b.id] },
        revision: row.revision + 1,
      })
    ).status,
  ).toBe(200);
  const listed = await rpc(g.tokens.access_token);
  expect(
    listed.data.result.tools.map((t: { name: string }) => t.name),
  ).not.toContain("forms_update");
  expect((await refresh(g)).status).toBe(400);
});
it("keeps revoked access tokens, refresh tokens and pending codes revoked across reconnect and server reconstruction", async () => {
  const g = await grant(),
    pending = await code(g.c); // new accepted generation invalidates the earlier one
  expect((await rpc(g.tokens.access_token)).response.status).toBe(401);
  const tokensResponse = await token(pending);
  expect(tokensResponse.status).toBe(200);
  const pendingTokens = await tokensResponse.json();
  const row = (await grants.list(userId)).data.find(
    (row) => row.clientId === g.c.client_id,
  )!;
  expect(
    (
      await request(
        "/oauth/connections/" + grants.referenceOf(row) + "/revoke",
        {},
      )
    ).status,
  ).toBe(200);
  expect((await rpc(pendingTokens.access_token)).response.status).toBe(401);
  const next = await grant(["openid", "narada:forms:read"], {}, g.c);
  runtime.auth;
  app = createApp({
    ...runtime,
    auth: createAuth(runtime.config, runtime.store),
  });
  expect((await rpc(g.tokens.access_token)).response.status).toBe(401);
  expect((await refresh(g)).status).toBe(400);
  expect((await token(pending)).status).toBe(400);
  expect((await rpc(next.tokens.access_token)).response.status).toBe(200);
});
it("authorizes all and selected resources in the actual browser consent UI without exposing tokens", async () => {
  const f = await runtime.forms.create(feedback()),
    c = await client(),
    flow = await authorization(c.client_id, [
      "openid",
      "offline_access",
      "narada:forms:read",
      "narada:forms:write",
    ]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      extraHTTPHeaders: { "x-forwarded-for": "198.20.1.1" },
    });
    await page.goto(origin + "/oauth/consent?" + flow.signed);
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Choose permissions", { exact: true }).check();
    await page.locator('[name=scope][value="narada:forms:write"]').uncheck();
    const field = page.locator("[data-dimension=formIds]");
    await field.getByLabel("Selected forms", { exact: true }).check();
    await field.getByRole("button", { name: "Load resources" }).click();
    await field.locator(`input[value="${f.id}"]`).check();
    await page.getByRole("button", { name: "Authorize connection" }).click();
    await page.waitForURL((url) => url.pathname === "/test/callback");
    const callback = new URL(page.url());
    const exchange = await token({
      grant_type: "authorization_code",
      client_id: c.client_id,
      code: callback.searchParams.get("code")!,
      code_verifier: flow.verifier,
      redirect_uri: origin + "/test/callback",
      resource: origin + "/api/mcp",
    });
    expect(exchange.status).toBe(200);
    const tokens = await exchange.json();
    expect(tokens.scope).not.toContain("narada:forms:write");
    const r = await rpc(tokens.access_token, "tools/call", {
      name: "forms_list",
      arguments: {},
    });
    expect(
      r.data.result.structuredContent.data.map((row: { id: string }) => row.id),
    ).toEqual([f.id]);
    await page.goto(origin + "/oauth/connections");
    await expect.poll(() => page.locator("article").count()).toBeGreaterThan(0);
    expect(await page.content()).not.toContain(tokens.access_token);
  } finally {
    await browser.close();
  }
});
it("supports both installed clients protocol versions and cancels consent without changing an existing connection", async () => {
  const g = await grant(["narada:forms:read"]);
  for (const protocol of ["2025-06-18", "2025-11-25"]) {
    const response = await rpc(
      g.tokens.access_token,
      "tools/list",
      {},
      protocol,
    );
    expect(response.response.status, JSON.stringify(response.data)).toBe(200);
    expect(
      response.data.result.tools.map((t: { name: string }) => t.name),
    ).toContain("forms_get");
  }
  const before = await connection(g),
    flow = await authorization(g.c.client_id);
  const denied = await request("/oauth/consent", {
    accept: false,
    mode: "all",
    resources: {},
    oauth_query: flow.signed,
  });
  expect(denied.status).toBe(200);
  expect((await connection(g)).epoch).toBe(before.epoch);
  expect((await rpc(g.tokens.access_token)).response.status).toBe(200);
});
it("rejects disabled or deleted clients even with a valid unexpired access token", async () => {
  const g = await grant(["narada:forms:read"]),
    ctx = await runtime.auth.$context;
  await ctx.adapter.update({
    model: "oauthClient",
    where: [{ field: "clientId", value: g.c.client_id }],
    update: { disabled: true },
  });
  expect((await rpc(g.tokens.access_token)).response.status).toBe(401);
  await ctx.adapter.delete({
    model: "oauthClient",
    where: [{ field: "clientId", value: g.c.client_id }],
  });
  expect((await rpc(g.tokens.access_token)).response.status).toBe(401);
});
it("paginates connections and checks direct management against the owner without depending on index visibility", async () => {
  let reference = "";
  for (let i = 0; i < 25; i++)
    reference = await grants.reference(userId, randomUUID(), [
      "narada:forms:read",
    ]);
  const first = await grants.list(userId, { limit: 20 });
  expect(first.data).toHaveLength(20);
  expect(first.nextCursor).toBeTruthy();
  const second = await grants.list(userId, {
    limit: 20,
    cursor: first.nextCursor,
  });
  expect(second.data.length).toBeGreaterThan(0);
  expect(
    new Set([...first.data, ...second.data].map((row) => row.pk)).size,
  ).toBe(first.data.length + second.data.length);
  expect(await grants.forOwner(reference, "another-user")).toBeUndefined();
  const direct = await request("/oauth/connections/" + reference);
  expect(direct.status).toBe(200);
  expect(direct.headers.get("cache-control")).toBe("no-store");
  const listing = await request("/oauth/connections");
  const listed = await listing.json();
  expect(listed.data).toHaveLength(20);
  expect(listed.nextCursor).toBeTruthy();
  expect(Object.keys(listed.data[0]).sort()).toEqual(
    [
      "reference",
      "clientId",
      "name",
      "scopes",
      "resources",
      "active",
      "revision",
      "updatedAt",
    ].sort(),
  );
  const detail = await direct.json();
  expect(detail.reference).toBe(reference);
  expect(detail.revision).toBeTypeOf("number");
  const html = await fetch(origin + "/oauth/connections", {
    headers: { cookie, accept: "text/html" },
  });
  expect(await html.text()).toContain("Next page");
  expect(
    (await request("/oauth/connections/" + reference + "/revoke", {})).status,
  ).toBe(200);
});
it("invalidates all user delegations durably on the password-reset lifecycle hook", async () => {
  const g = await grant();
  await runtime.auth.options.emailAndPassword!.onPasswordReset!({
    user: { id: userId } as never,
  });
  expect((await rpc(g.tokens.access_token)).response.status).toBe(401);
  expect((await refresh(g)).status).toBe(400);
});
it("recovers a lost MCP result through operation lookup without another mutation", async () => {
  const g = await grant(oauthScopes),
    args = { body: feedback(), idempotencyKey: randomUUID() };
  const create = vi.spyOn(runtime.forms, "create");
  try {
    // Simulate the consuming client losing the completed network response.
    const dropped = async () => {
      await call(g, "forms_create", args);
      throw new Error("MCP response lost");
    };
    await expect(dropped()).rejects.toThrow("MCP response lost");
    const status = await result(g, "operations_lookup", {
      body: { operation: "forms.create", idempotencyKey: args.idempotencyKey },
    });
    expect(status.status).toBe("succeeded");
    const recovered = await result(g, "forms_create", args);
    expect(status.targets).toContainEqual({ kind: "form", id: recovered.id });
    expect(create).toHaveBeenCalledTimes(1);
  } finally {
    create.mockRestore();
  }
});

it("exposes operational tools with reduced OAuth scopes, sender restrictions, and live revocation", async () => {
  const restricted = await grant(
    [
      "offline_access",
      "narada:domains:read",
      "narada:domains:refresh",
      "narada:metrics:read",
      "narada:webhooks:read",
      "narada:sending:read",
    ],
    { senderDomains: ["narada.test"] },
  );
  const discovered = await rpc(restricted.tokens.access_token);
  const names = discovered.data.result.tools.map(
    (tool: { name: string }) => tool.name,
  );
  expect(names).toContain("domains_list");
  expect(names).toContain("metrics_get");
  expect(names).not.toContain("webhooks_list");
  expect(names).not.toContain("sending_get");
  expect(
    (await result(restricted, "domains_list")).data.every(
      (domain: { name: string }) => domain.name === "narada.test",
    ),
  ).toBe(true);
  expect(
    (
      await result(restricted, "domains_get", {
        params: { name: "narada.test" },
      })
    ).name,
  ).toBe("narada.test");
  expect(
    (
      await result(restricted, "domains_refresh", {
        params: { name: "narada.test" },
        idempotencyKey: randomUUID(),
      })
    ).verified,
  ).toBe(true);
  expect(
    (
      await result(restricted, "metrics_get", {
        query: { days: 1, domain: "narada.test" },
      })
    ).days,
  ).toHaveLength(1);
  const denied = await call(restricted, "domains_get", {
    params: { name: "outside.test" },
  });
  expect(JSON.parse(denied.data.result.content[0].text).status).toBe(403);
  const bypass = await call(restricted, "webhooks_list");
  expect(bypass.data.error || bypass.data.result?.isError).toBeTruthy();
  const refreshed = await refresh(restricted);
  expect(refreshed.status).toBe(200);
  restricted.tokens = await refreshed.json();
  expect(
    (
      await result(restricted, "domains_get", {
        params: { name: "narada.test" },
      })
    ).name,
  ).toBe("narada.test");
  const row = await connection(restricted);
  expect(
    (
      await request(
        "/oauth/connections/" + grants.referenceOf(row) + "/revoke",
        {},
      )
    ).status,
  ).toBe(200);
  expect((await rpc(restricted.tokens.access_token)).response.status).toBe(401);
});
it("runs workspace operational mutations through MCP with history, safe replay, and secret-safe reads", async () => {
  const g = await grant(oauthScopes, {}, undefined, "all");
  let status = await result(g, "sending_get");
  status = await result(g, "sending_update", {
    body: { paused: true, revision: status.revision },
    idempotencyKey: randomUUID(),
  });
  expect(status.paused).toBe(true);
  await result(g, "sending_update", {
    body: { paused: false, revision: status.revision },
    idempotencyKey: randomUUID(),
  });
  expect((await result(g, "sending_diagnostics")).account).toBeNull();
  const email = `${randomUUID()}@example.com`,
    add = { body: { email }, idempotencyKey: randomUUID() };
  expect((await result(g, "suppressions_create", add)).email).toBe(email);
  expect(await result(g, "suppressions_create", add)).toMatchObject({ email });
  expect(
    (await result(g, "suppressions_get", { params: { email } })).email,
  ).toBe(email);
  expect(
    (await result(g, "suppressions_list", { query: { email } })).data,
  ).toHaveLength(1);
  await result(g, "suppressions_delete", {
    params: { email },
    idempotencyKey: randomUUID(),
  });
  expect(
    (await result(g, "webhooks_events")).data.some(
      (e: { type: string }) => e.type === "form.response.received",
    ),
  ).toBe(true);
  const input = {
    body: {
      url: "http://localhost:3001/api/dev/webhook-receiver",
      events: ["broadcast.completed"],
    },
    idempotencyKey: randomUUID(),
  };
  const hook = await result(g, "webhooks_create", input);
  expect(await result(g, "webhooks_create", input)).toEqual(hook);
  expect(
    await result(g, "webhooks_get", { params: { id: hook.id } }),
  ).not.toHaveProperty("secret");
  expect(JSON.stringify(await result(g, "webhooks_list"))).not.toContain(
    hook.secret,
  );
  const activity = await result(g, "operations_lookup", {
    body: {
      operation: "webhooks.create",
      idempotencyKey: input.idempotencyKey,
    },
  });
  expect(activity.status).toBe("succeeded");
  expect(JSON.stringify(activity)).not.toContain(hook.secret);
  await result(g, "webhooks_update", {
    params: { id: hook.id },
    body: { ...input.body, revision: 0 },
    idempotencyKey: randomUUID(),
  });
  const { lifecycleJobs } = await import("@narada/core/event-outbox");
  const jobs = await lifecycleJobs(
    runtime.store,
    "broadcast.completed",
    randomUUID(),
    { broadcast_id: randomUUID() },
  );
  await runtime.store.transaction(jobs);
  const id = String(jobs[0]!.Put.Item.id);
  await runtime.store.patch(`HOOKJOB#${id}`, { state: "failed", attempts: 6 });
  expect(
    (await result(g, "webhooks_deliveries_list")).data.some(
      (job: { id: string }) => job.id === id,
    ),
  ).toBe(true);
  expect(
    (await result(g, "webhooks_deliveries_get", { params: { id } })).delivery
      .state,
  ).toBe("failed");
  const retry = { params: { id }, idempotencyKey: randomUUID() };
  await result(g, "webhooks_deliveries_retry", retry);
  await result(g, "webhooks_deliveries_retry", retry);
  const reader = await grant(["narada:webhooks:read"]);
  const denied = await call(reader, "webhooks_create", input);
  expect(denied.data.error || denied.data.result?.isError).toBeTruthy();
  await result(g, "webhooks_delete", {
    params: { id: hook.id },
    idempotencyKey: randomUUID(),
  });
  const deleted = await call(g, "webhooks_create", input);
  expect(JSON.parse(deleted.data.result.content[0].text).status).toBe(404);
});

it("executes audience and campaign operations with owner-approved sends, canonical output and safe retries", async () => {
  const g = await grant(undefined, {}, undefined, "all");
  const { z } = await import("zod");
  const { operationSchemas } = await import("@narada/contracts/discovery");
  const { isCampaignOperation } =
    await import("@narada/core/campaign-operations");
  const covered = new Set<string>();
  const run = async (
    operation: keyof typeof operationSchemas,
    args: Record<string, unknown> = {},
  ) => {
    const metadata = mcpOperations.find((row) => row.id === operation)!;
    const input = {
      ...args,
      ...(metadata.effect === "read" ? {} : { idempotencyKey: randomUUID() }),
    };
    const value =
      metadata.effect === "send"
        ? await approvedSend(g, operation, args)
        : await result(g, mcpToolName(operation), input);
    z.fromJSONSchema(operationSchemas[operation].output).parse(value);
    covered.add(operation);
    if (metadata.effect === "write")
      expect(await result(g, mcpToolName(operation), input)).toEqual(value);
    return value;
  };
  const suffix = randomUUID().slice(0, 8),
    email = `${suffix}@example.com`,
    propertyKey = `mcp_${suffix}`;
  let property = await run("properties.create", {
    body: { key: propertyKey, type: "string" },
  });
  await run("properties.list");
  await run("properties.get", { params: { key: property.key } });
  await run("properties.update", {
    params: { key: property.key },
    body: {
      property: { key: property.key, type: "string", fallback: "standard" },
      revision: property.revision,
    },
  });
  let topic = await run("topics.create", { body: { name: "MCP campaign" } });
  await run("topics.list");
  await run("topics.get", { params: { id: topic.id } });
  topic = await run("topics.update", {
    params: { id: topic.id },
    body: {
      topic: { name: "MCP updates", active: true },
      revision: topic.revision,
    },
  });
  let contact = await run("contacts.create", {
    body: {
      email,
      first_name: "Alex",
      properties: { [propertyKey]: "premium" },
    },
  });
  await run("contacts.list");
  await run("contacts.get", { params: { email } });
  contact = await run("contacts.update", {
    params: { email },
    body: {
      contact: {
        name: "Alex Example",
        first_name: "Alex",
        last_name: "",
        properties: contact.properties,
      },
      revision: contact.revision,
    },
  });
  contact = await run("contacts.properties.patch", {
    params: { email },
    body: {
      properties: { [propertyKey]: "standard" },
      revision: contact.revision,
    },
  });
  await run("contacts.topics.unsubscribe", { params: { email, id: topic.id } });
  expect(
    (await runtime.contacts.details(email)).topics.find(
      (t) => t.id === topic.id,
    )?.subscribed,
  ).toBe(false);
  await run("contacts.subscribe", {
    params: { email, id: topic.id },
    body: {
      subscribed: true,
      source: "Explicit test newsletter signup",
      confirmed: true,
    },
  });
  let segment = await run("segments.create", {
    body: { name: "MCP manual", kind: "manual" },
  });
  await run("segments.list");
  await run("segments.get", { params: { id: segment.id } });
  await run("segments.members.add", {
    params: { id: segment.id, email },
    body: {},
  });
  await run("segments.members.list", { params: { id: segment.id } });
  segment = await result(g, "segments_get", { params: { id: segment.id } });
  await run("segments.update", {
    params: { id: segment.id },
    body: {
      segment: { name: "MCP edited", kind: "manual" },
      revision: segment.revision,
    },
  });
  await run("segments.import", {
    params: { id: segment.id },
    body: {
      csv: `email,first_name\nimport-${suffix}@example.com,Sam`,
      consentSource: "Explicit import signup",
      consentConfirmed: true,
      topicIds: [topic.id],
    },
  });
  const draft = {
    name: "MCP campaign",
    audienceId: segment.id,
    topicId: topic.id,
    from: "hello@narada.test",
    subject: "Campaign update",
    text: "Hello readers",
    organization: "Example",
    postalAddress: "1 Test Street",
  };
  let broadcast = await run("broadcasts.create", { body: draft });
  await run("broadcasts.list");
  await run("broadcasts.get", { params: { id: broadcast.id } });
  broadcast = await run("broadcasts.update", {
    params: { id: broadcast.id },
    body: {
      draft: { ...draft, subject: "Edited campaign" },
      revision: broadcast.revision,
    },
  });
  await run("broadcasts.preview", {
    params: { id: broadcast.id },
    query: { contact: email },
  });
  await run("broadcasts.test", {
    params: { id: broadcast.id },
    body: { to: `test-${suffix}@example.com` },
  });
  await run("broadcasts.duplicate", { params: { id: broadcast.id } });
  const launched = await run("broadcasts.send", {
    params: { id: broadcast.id },
    body: {
      revision: broadcast.revision,
      confirmed: true,
      scheduledAt: Date.now() + 60000,
    },
  });
  expect(launched.status).toBe("scheduled");
  const recipients = await run("broadcasts.recipients.list", {
    params: { id: broadcast.id },
  });
  expect(recipients.data).toHaveLength(2);
  expect(recipients.data[0]).not.toHaveProperty("consentSource");
  await run("broadcasts.cancel", { params: { id: broadcast.id } });
  const templateDraft = {
    name: "MCP template",
    kind: "broadcast",
    subject: "Hello {{vars.name}}",
    text: "Welcome {{vars.name}}",
    variables: [{ key: "name", type: "string", fallback: "reader" }],
  };
  let template = await run("templates.create", {
    body: { ...templateDraft, alias: `mcp-${suffix}` },
  });
  await run("templates.list");
  await run("templates.get", { params: { id: template.alias } });
  template = await run("templates.update", {
    params: { id: template.id },
    body: {
      draft: { ...templateDraft, name: "Edited template" },
      revision: template.revision,
    },
  });
  template = await run("templates.publish", {
    params: { id: template.id },
    body: { revision: template.revision },
  });
  await run("templates.preview", {
    params: { id: template.id },
    body: { variables: { name: "Taylor" }, version: template.publishedVersion },
  });
  await run("templates.test", {
    params: { id: template.id },
    body: { from: "hello@narada.test", to: `template-${suffix}@example.com` },
  });
  await run("templates.duplicate", {
    params: { id: template.id },
    body: { alias: `mcp-copy-${suffix}` },
  });
  const converted = await run("templates.broadcasts.create", {
    params: { id: template.id },
    body: {
      audienceId: segment.id,
      topicId: topic.id,
      from: draft.from,
      organization: draft.organization,
      postalAddress: draft.postalAddress,
    },
  });
  expect(converted.status).toBe("draft");
  await run("templates.archive", {
    params: { id: template.id },
    body: { archived: true, revision: template.revision },
  });
  await run("segments.members.remove", { params: { id: segment.id, email } });
  await run("contacts.unsubscribe", { params: { email } });
  expect(
    (await result(g, "contacts_get", { params: { email } })).unsubscribedAll,
  ).toBe(true);
  expect([...covered].sort()).toEqual(
    mcpOperations
      .filter((row) => isCampaignOperation(row.id))
      .map((row) => row.id)
      .sort(),
  );
});

it("enforces selected campaign scopes, compound permissions, live reduction and revocation before replay", async () => {
  const selected = [
    "offline_access",
    "narada:contacts:create",
    "narada:templates:read",
    "narada:templates:write",
    "narada:broadcasts:read",
    "narada:broadcasts:write",
    "narada:contacts:import",
    "narada:operations:read",
  ];
  const g = await grant(selected);
  const names = (await rpc(g.tokens.access_token)).data.result.tools.map(
    (tool: { name: string }) => tool.name,
  );
  expect(names).toContain("contacts_create");
  expect(names).toContain("templates_broadcasts_create");
  expect(names).not.toContain("contacts_get");
  for (const name of [
    "templates_publish",
    "templates_test",
    "templates_archive",
    "broadcasts_send",
    "broadcasts_test",
    "broadcasts_cancel",
    "segments_import",
    "contacts_subscribe",
  ]) {
    expect(names).not.toContain(name);
    const denied = await call(g, name, { idempotencyKey: randomUUID() });
    expect(denied.data.error || denied.data.result?.isError).toBeTruthy();
  }
  const args = {
    body: { email: `scope-${randomUUID()}@example.com` },
    idempotencyKey: randomUUID(),
  };
  const created = await result(g, "contacts_create", args);
  const status = await result(g, "operations_lookup", {
    body: { operation: "contacts.create", idempotencyKey: args.idempotencyKey },
  });
  expect(status.status).toBe("succeeded");
  expect(JSON.stringify(status)).not.toContain(created.email);
  const refreshed = await refresh(g);
  expect(refreshed.status).toBe(200);
  g.tokens = await refreshed.json();
  expect(g.tokens.scope.split(" ").sort()).toEqual([...selected].sort());
  expect(await result(g, "contacts_create", args)).toEqual(created);
  const connectionRecord = await connection(g);
  const connectionPath =
    "/oauth/connections/" + grants.referenceOf(connectionRecord);
  expect(
    (
      await request(connectionPath, {
        scopes: [
          "offline_access",
          "narada:templates:read",
          "narada:broadcasts:read",
          "narada:operations:read",
        ],
        resources: {},
        revision: connectionRecord.revision,
      })
    ).status,
  ).toBe(200);
  const replay = await call(g, "contacts_create", args);
  expect(replay.data.error || replay.data.result?.isError).toBeTruthy();
  const lookup = await call(g, "operations_lookup", {
    body: { operation: "contacts.create", idempotencyKey: args.idempotencyKey },
  });
  expect(lookup.data.error || lookup.data.result?.isError).toBeTruthy();
  expect((await request(connectionPath + "/revoke", {})).status).toBe(200);
  expect((await call(g, "templates_list")).response.status).toBe(401);
  expect((await refresh(g)).status).toBe(400);
  const onlyTemplate = await grant(["narada:templates:read"]);
  expect(
    (await rpc(onlyTemplate.tokens.access_token)).data.result.tools.map(
      (tool: { name: string }) => tool.name,
    ),
  ).not.toContain("templates_broadcasts_create");
});

it("excludes every workspace campaign tool from domain, form and publication restricted grants", async () => {
  const form = await runtime.forms.create(feedback());
  const publication = await runtime.publications.create(settings());
  const campaign = mcpOperations.filter((row) =>
    /^(contacts|properties|topics|segments|templates|broadcasts)\./.test(
      row.id,
    ),
  );
  for (const resources of [
    { senderDomains: ["narada.test"] },
    { formIds: [form.id] },
    { publicationIds: [publication.id] },
  ]) {
    const g = await grant(oauthScopes, resources);
    const names = (await rpc(g.tokens.access_token)).data.result.tools.map(
      (tool: { name: string }) => tool.name,
    );
    for (const operation of campaign) {
      expect(names).not.toContain(mcpToolName(operation.id));
      const denied = await call(g, mcpToolName(operation.id), {
        idempotencyKey: randomUUID(),
      });
      expect(denied.data.error || denied.data.result?.isError).toBeTruthy();
    }
  }
});

it("recovers a lost campaign commit acknowledgment and fences partially completed imports", async () => {
  const g = await grant();
  const broadcast = await runtime.broadcasts.create({
    name: "Recover edit",
    subject: "Original",
  });
  const args = {
    params: { id: broadcast.id },
    body: {
      draft: { name: "Recovered", subject: "Edited" },
      revision: broadcast.revision,
    },
    idempotencyKey: randomUUID(),
  };
  const transaction = runtime.store.transaction.bind(runtime.store);
  let lost = false;
  const database = vi
    .spyOn(runtime.store, "transaction")
    .mockImplementation(async (writes) => {
      const committed = await transaction(writes);
      if (
        !lost &&
        writes.some((write) => write.Update?.Key?.pk === broadcast.pk)
      ) {
        lost = true;
        throw new Error(
          "Database acknowledgment lost after update and receipt commit",
        );
      }
      return committed;
    });
  try {
    const saved = await result(g, "broadcasts_update", args);
    expect(lost).toBe(true);
    expect(saved.revision).toBe(1);
    expect(await result(g, "broadcasts_update", args)).toEqual(saved);
    expect((await runtime.broadcasts.get(broadcast.id)).revision).toBe(1);
    const tracked = await result(g, "operations_lookup", {
      body: {
        operation: "broadcasts.update",
        idempotencyKey: args.idempotencyKey,
      },
    });
    expect(tracked.status).toBe("succeeded");
    expect(tracked.recovery).toBe("replay_available");
  } finally {
    database.mockRestore();
  }
  const segment = await runtime.contacts.createSegment({
    name: "Import recovery",
    kind: "manual",
  });
  const email = `partial-${randomUUID()}@example.com`;
  const importArgs = {
    params: { id: segment.id },
    body: {
      csv: `email\n${email}`,
      consentSource: "Explicit test signup",
      consentConfirmed: true,
    },
    idempotencyKey: randomUUID(),
  };
  const imported = vi
    .spyOn(runtime.contacts, "import")
    .mockImplementationOnce(async () => {
      await runtime.contacts.createContact({ email });
      throw new Error("Interrupted after one import step");
    });
  try {
    const failed = await call(g, "segments_import", importArgs);
    expect(JSON.parse(failed.data.result.content[0].text).code).toBe(
      "idempotency_unknown",
    );
    const retried = await call(g, "segments_import", importArgs);
    expect(JSON.parse(retried.data.result.content[0].text).code).toBe(
      "idempotency_unknown",
    );
    expect(imported).toHaveBeenCalledTimes(1);
    const tracked = await result(g, "operations_lookup", {
      body: {
        operation: "segments.import",
        idempotencyKey: importArgs.idempotencyKey,
      },
    });
    expect(tracked.status).toBe("unknown");
    expect(tracked.recovery).toBe("reconcile");
    expect((await runtime.contacts.contact(email)).revision).toBe(0);
  } finally {
    imported.mockRestore();
  }
});

async function testApprovalFixture(g?: Awaited<ReturnType<typeof grant>>) {
  g ??= await grant(oauthScopes);
  const template = await runtime.templates.create({
    alias: `approval-${randomUUID().slice(0, 8)}`,
    name: "Approval fixture",
    kind: "transactional",
    subject: "Review this exact subject",
    text: "Private review content",
    variables: [],
  });
  const input = {
    params: { id: template.id },
    body: {
      from: "hello@narada.test",
      to: `approval-${randomUUID()}@example.com`,
    },
  };
  const approval = await reviewRequest(g, "templates.test", input);
  return {
    g,
    template,
    input,
    approval,
    review: await ownerReview(approval.id),
  };
}
it("requires authenticated human decisions even with all scopes and agent-supplied confirmation", async () => {
  const f = await testApprovalFixture();
  const count = (await runtime.store.list("messages#default", 10000)).length;
  const direct = await call(f.g, "templates_test", {
    ...f.input,
    idempotencyKey: randomUUID(),
  });
  expect(JSON.parse(direct.data.result.content[0].text).code).toBe(
    "approval_required",
  );
  const forged = await call(f.g, "templates_test", {
    ...f.input,
    approvalId: f.approval.id,
    confirmed: true,
    idempotencyKey: randomUUID(),
  });
  expect(forged.data.error || forged.data.result?.isError).toBeTruthy();
  const tools = (await rpc(f.g.tokens.access_token)).data.result.tools.map(
    (t: { name: string }) => t.name,
  );
  expect(tools).not.toContain("approvals_approve");
  expect(
    (
      await request(
        `/api/admin/approvals/${f.approval.id}/approve`,
        { digest: f.review.digest },
        "",
      )
    ).status,
  ).toBe(401);
  const crossOrigin = await fetch(
    origin + `/api/admin/approvals/${f.approval.id}/approve`,
    {
      method: "POST",
      headers: {
        ...headers(),
        origin: "https://other.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ digest: f.review.digest }),
    },
  );
  expect(crossOrigin.status).toBe(403);
  expect(
    (
      await request(`/api/admin/approvals/${f.approval.id}/approve`, {
        digest: "forged",
      })
    ).status,
  ).toBe(409);
  const visible = await result(f.g, "approvals_get", {
    params: { id: f.approval.id },
  });
  expect(JSON.stringify(visible)).not.toContain("Private review content");
  expect(JSON.stringify(visible)).not.toContain(f.input.body.to);
  const stored = await runtime.store.get(`SENDREVIEW#${f.approval.id}`);
  expect(stored).toHaveProperty("ciphertext");
  expect(JSON.stringify(stored)).not.toContain("Private review content");
  expect((await runtime.store.list("messages#default", 10000)).length).toBe(
    count,
  );
});
it("consumes an approval once under concurrency and recovers a lost owner response", async () => {
  const f = await testApprovalFixture();
  const accept = vi.spyOn(runtime.service, "accept");
  try {
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        request(`/api/admin/approvals/${f.approval.id}/approve`, {
          digest: f.review.digest,
        }),
      ),
    );
    expect(outcomes.some((r) => r.status === 200)).toBe(true);
    expect(outcomes.every((r) => [200, 409].includes(r.status))).toBe(true);
    const recovered = await request(
      `/api/admin/approvals/${f.approval.id}/approve`,
      { digest: f.review.digest },
    );
    expect(recovered.status).toBe(200);
    const saved = await recovered.json();
    expect(saved.status).toBe("succeeded");
    expect(
      await result(f.g, "approvals_get", { params: { id: f.approval.id } }),
    ).toEqual(saved);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(
      await runtime.store.get(`SENDREVIEW#${f.approval.id}`),
    ).toBeUndefined();
  } finally {
    accept.mockRestore();
  }
});
it("rejects changed content, expired reviews and attempts by another connection", async () => {
  const f = await testApprovalFixture(),
    other = await grant(oauthScopes);
  const denied = await call(other, "approvals_get", {
    params: { id: f.approval.id },
  });
  expect(JSON.parse(denied.data.result.content[0].text).status).toBe(404);
  expect(
    (await result(other, "approvals_list")).data.some(
      (row: { id: string }) => row.id === f.approval.id,
    ),
  ).toBe(false);
  await runtime.templates.update(
    f.template.id,
    { ...f.template.draft, subject: "Changed after review" },
    f.template.revision,
  );
  const stale = await request(`/api/admin/approvals/${f.approval.id}/approve`, {
    digest: f.review.digest,
  });
  expect(stale.status).toBe(409);
  expect(await stale.text()).toContain("changed after review");
  const row = (await runtime.store.get(`SENDAPPROVAL#${f.approval.id}`))!;
  await runtime.store.put({
    ...row,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  expect(
    (
      await request(`/api/admin/approvals/${f.approval.id}/approve`, {
        digest: f.review.digest,
      })
    ).status,
  ).toBe(409);
  expect(
    (await result(f.g, "approvals_get", { params: { id: f.approval.id } }))
      .status,
  ).toBe("expired");
});
it("rejects revoked, narrowed and replaced grants before approving a send", async () => {
  const f = await testApprovalFixture(),
    row = await connection(f.g);
  await grants.change(
    grants.referenceOf(row),
    userId,
    f.g.c.client_id,
    row.scopes.filter((s) => s !== "narada:templates:test"),
  );
  expect(
    (
      await request(`/api/admin/approvals/${f.approval.id}/approve`, {
        digest: f.review.digest,
      })
    ).status,
  ).toBe(403);
  const fresh = await testApprovalFixture();
  const original = await connection(fresh.g);
  await grants.change(
    grants.referenceOf(original),
    userId,
    fresh.g.c.client_id,
  );
  expect(
    (
      await request(`/api/admin/approvals/${fresh.approval.id}/approve`, {
        digest: fresh.review.digest,
      })
    ).status,
  ).toBe(403);
  await code(fresh.g.c, oauthScopes);
  expect(
    (
      await request(`/api/admin/approvals/${fresh.approval.id}/approve`, {
        digest: fresh.review.digest,
      })
    ).status,
  ).toBe(403);
});
it("atomically refuses approval when a grant is revoked immediately before acceptance commits", async () => {
  const f = await testApprovalFixture(),
    original = runtime.store.transaction.bind(runtime.store);
  let revoke = true;
  const transaction = vi
    .spyOn(runtime.store, "transaction")
    .mockImplementation(async (items) => {
      if (
        revoke &&
        items.some(
          (item) =>
            item.Put?.Item?.pk === `SENDAPPROVAL#${f.approval.id}` &&
            item.Put.Item.status === "succeeded",
        )
      ) {
        revoke = false;
        const row = await connection(f.g);
        await grants.change(grants.referenceOf(row), userId, f.g.c.client_id);
      }
      return original(items);
    });
  const count = (await runtime.store.list("messages#default", 10000)).length;
  try {
    const response = await request(
      `/api/admin/approvals/${f.approval.id}/approve`,
      { digest: f.review.digest },
    );
    expect(response.ok).toBe(false);
    expect((await runtime.store.list("messages#default", 10000)).length).toBe(
      count,
    );
    expect(
      (await runtime.store.get(`SENDAPPROVAL#${f.approval.id}`))?.status,
    ).toBe("pending");
  } finally {
    transaction.mockRestore();
  }
});
it("records owner rejection and prevents a rejected approval from later sending", async () => {
  const f = await testApprovalFixture();
  const rejection = await request(
    `/api/admin/approvals/${f.approval.id}/reject`,
    { digest: f.review.digest },
  );
  expect(rejection.status).toBe(200);
  expect((await rejection.json()).status).toBe("rejected");
  const again = await request(`/api/admin/approvals/${f.approval.id}/approve`, {
    digest: f.review.digest,
  });
  expect((await again.json()).status).toBe("rejected");
  expect(
    await runtime.store.get(`SENDREVIEW#${f.approval.id}`),
  ).toBeUndefined();
});
it("binds broadcast recipients and personalized values to the reviewed send", async () => {
  const g = await grant(oauthScopes),
    segment = await runtime.contacts.createSegment({
      name: "Reviewed audience",
      kind: "manual",
    });
  const email = `reviewed-${randomUUID()}@example.com`;
  await runtime.contacts.createContact({ email, first_name: "Alice" });
  await runtime.contacts.addMember(segment.id, email);
  await runtime.contacts.recordListConsent(
    segment.id,
    email,
    "Fixture consent",
    new Date().toISOString(),
  );
  const broadcast = await runtime.broadcasts.create({
    name: "Reviewed campaign",
    audienceId: segment.id,
    from: "hello@narada.test",
    subject: "Hello {{contact.first_name}}",
    text: "Exact campaign",
    organization: "Example",
    postalAddress: "1 Test Street",
  });
  const input = {
    params: { id: broadcast.id },
    body: {
      revision: broadcast.revision,
      confirmed: true,
      scheduledAt: Date.now() + 60000,
    },
  };
  const first = await reviewRequest(g, "broadcasts.send", input),
    review = await ownerReview(first.id);
  expect(review.recipients).toEqual([email]);
  expect(review.subject).toBe("Hello Alice");
  const added = `added-${randomUUID()}@example.com`;
  await runtime.contacts.createContact({ email: added, first_name: "Bob" });
  await runtime.contacts.addMember(segment.id, added);
  await runtime.contacts.recordListConsent(
    segment.id,
    added,
    "Fixture consent",
    new Date().toISOString(),
  );
  const denied = await request(`/api/admin/approvals/${first.id}/approve`, {
    digest: review.digest,
  });
  expect(denied.status).toBe(409);
  expect((await runtime.broadcasts.get(broadcast.id)).status).toBe("draft");
  const second = await reviewRequest(g, "broadcasts.send", input),
    secondReview = await ownerReview(second.id);
  const contact = await runtime.contacts.contact(email);
  await runtime.contacts.updateContact(
    email,
    {
      name: contact.name,
      first_name: "Mallory",
      last_name: contact.last_name,
      properties: contact.properties,
    },
    contact.revision,
  );
  expect(
    (
      await request(`/api/admin/approvals/${second.id}/approve`, {
        digest: secondReview.digest,
      })
    ).status,
  ).toBe(409);
  expect((await runtime.broadcasts.get(broadcast.id)).status).toBe("draft");
  const launched = await approvedSend(g, "broadcasts.send", input);
  expect(launched.status).toBe("scheduled");
  await runtime.broadcasts.cancel(broadcast.id);
});

it("reviews issue tests and combined publication under selected publication scopes", async () => {
  let p = await runtime.publications.create(settings());
  p = await runtime.publications.update(p.id, p.settings, p.revision, "active");
  const email = `issue-review-${randomUUID()}@example.com`;
  await runtime.contacts.createContact({ email });
  await runtime.contacts.subscribe(email, p.topicId, true, "Fixture consent");
  const i = await runtime.issues.create(p.id, issue());
  const g = await grant(
    [
      "narada:approvals:request",
      "narada:approvals:read",
      "narada:issues:test",
      "narada:issues:send",
      "narada:issues:publish",
    ],
    { publicationIds: [p.id], senderDomains: ["narada.test"] },
  );
  const tested = await approvedSend(g, "issues.test", {
    params: { id: p.id, issueId: i.id },
    body: { to: email, revision: i.revision },
  });
  expect(tested.id).toBeTruthy();
  const input = {
    params: { id: p.id, issueId: i.id },
    body: {
      revision: i.revision,
      channels: "both",
      confirmed: true,
      scheduledAt: Date.now() + 60000,
    },
  };
  const proposal = await reviewRequest(g, "issues.publish", input),
    review = await ownerReview(proposal.id);
  expect(review.recipients).toEqual([email]);
  expect(review.channels).toBe("both");
  expect(review.webHtml).toContain("Hello subscribers");
  p = await runtime.publications.update(
    p.id,
    { ...p.settings, author: "Changed author" },
    p.revision,
    "active",
  );
  expect(
    (
      await request(`/api/admin/approvals/${proposal.id}/approve`, {
        digest: review.digest,
      })
    ).status,
  ).toBe(409);
  const published = await approvedSend(g, "issues.publish", input);
  expect(published.scheduledAt).toBe(input.body.scheduledAt);
  const saved = await runtime.issues.get(p.id, i.id);
  expect(saved.broadcastId).toBeTruthy();
  expect((await runtime.broadcasts.get(saved.broadcastId!)).status).toBe(
    "scheduled",
  );
  await runtime.issues.cancel(p.id, i.id, published.revision);
});

it("lets rejection win a race before send acceptance commits", async () => {
  const f = await testApprovalFixture(),
    original = runtime.store.transaction.bind(runtime.store);
  let rejected = false;
  const transaction = vi
    .spyOn(runtime.store, "transaction")
    .mockImplementation(async (items) => {
      if (
        !rejected &&
        items.some(
          (item) =>
            item.Put?.Item?.pk === `SENDAPPROVAL#${f.approval.id}` &&
            item.Put.Item.status === "succeeded",
        )
      ) {
        rejected = true;
        expect(
          (
            await request(`/api/admin/approvals/${f.approval.id}/reject`, {
              digest: f.review.digest,
            })
          ).status,
        ).toBe(200);
      }
      return original(items);
    });
  const count = (await runtime.store.list("messages#default", 10000)).length;
  try {
    expect(
      (
        await request(`/api/admin/approvals/${f.approval.id}/approve`, {
          digest: f.review.digest,
        })
      ).ok,
    ).toBe(false);
    expect((await runtime.store.list("messages#default", 10000)).length).toBe(
      count,
    );
    expect(
      (await result(f.g, "approvals_get", { params: { id: f.approval.id } }))
        .status,
    ).toBe("rejected");
  } finally {
    transaction.mockRestore();
  }
});

it("blocks OAuth retries that could send form emails even with every scope", async () => {
  const g = await grant(oauthScopes);
  let form = await runtime.forms.create({
    ...feedback(),
    syncContacts: true,
    questions: [
      { id: "email", label: "Email", type: "email", required: true },
      { id: "consent", label: "Subscribe", type: "consent" },
    ],
  });
  form = await runtime.forms.publish(form.id, form.revision);
  const submissionId = randomUUID();
  await runtime.forms.submit(form.id, {
    submissionId,
    version: form.version,
    answers: { email: `retry-${randomUUID()}@example.com`, consent: true },
  });
  const { hash } = await import("@narada/core/model");
  const responseId = hash(`${form.id}:${submissionId}`);
  await runtime.store.patch(`FORMRESPONSE#${responseId}`, { status: "failed" });
  const retry = vi.spyOn(runtime.forms, "retry");
  try {
    const denied = await call(g, "forms_responses_retry", {
      params: { id: form.id, responseId },
      idempotencyKey: randomUUID(),
    });
    expect(JSON.parse(denied.data.result.content[0].text).status).toBe(403);
    expect(retry).not.toHaveBeenCalled();
    expect((await runtime.forms.response(responseId)).status).toBe("failed");
  } finally {
    retry.mockRestore();
  }
});

it("checks resource restrictions again when the owner approves a pending publication", async () => {
  let p = await runtime.publications.create(settings());
  p = await runtime.publications.update(p.id, p.settings, p.revision, "active");
  const other = await runtime.publications.create(settings());
  const g = await grant(
    [
      "narada:approvals:request",
      "narada:approvals:read",
      "narada:issues:publish",
      "narada:operations:read",
    ],
    { publicationIds: [p.id, other.id] },
  );
  const i = await runtime.issues.create(p.id, issue());
  const input = {
    params: { id: p.id, issueId: i.id },
    body: { revision: i.revision, channels: "web", confirmed: true },
  };
  const created = await call(g, "approvals_request", {
    body: { operation: "issues.publish", input },
    idempotencyKey: randomUUID(),
  });
  expect(created.data.result.isError).not.toBe(true);
  const proposal = created.data.result.structuredContent,
    activityId = created.data.result._meta.operationId,
    review = await ownerReview(proposal.id);
  expect(
    (await result(g, "operations_get", { params: { id: activityId } })).status,
  ).toBe("succeeded");
  const current = await connection(g);
  await grants.change(
    grants.referenceOf(current),
    userId,
    g.c.client_id,
    current.scopes,
    { publicationIds: [other.id] },
  );
  expect(
    (
      await request(`/api/admin/approvals/${proposal.id}/approve`, {
        digest: review.digest,
      })
    ).status,
  ).toBe(403);
  expect(
    (await runtime.issues.get(p.id, i.id)).publicVersionId,
  ).toBeUndefined();
  const denied = await call(g, "approvals_request", {
    body: { operation: "issues.publish", input },
    idempotencyKey: randomUUID(),
  });
  expect(JSON.parse(denied.data.result.content[0].text).status).toBe(403);
  const history = await call(g, "operations_get", {
    params: { id: activityId },
  });
  expect(JSON.parse(history.data.result.content[0].text).status).toBe(403);
  expect(
    (await result(g, "operations_list")).data.some(
      (row: { id: string }) => row.id === activityId,
    ),
  ).toBe(false);
});

it("exposes transactional email with selected scopes, owner approval and authorized status lookup", async () => {
  const g = await grant(
    [
      "narada:emails:send",
      "narada:emails:read",
      "narada:approvals:request",
      "narada:approvals:read",
    ],
    { senderDomains: ["narada.test"] },
  );
  const tools = (await rpc(g.tokens.access_token)).data.result.tools.map(
    (t: { name: string }) => t.name,
  );
  expect(tools).toContain("emails_send");
  expect(tools).toContain("emails_get");
  const input = {
    body: {
      from: "hello@narada.test",
      to: [
        `first-${randomUUID()}@example.com`,
        `second-${randomUUID()}@example.com`,
      ],
      reply_to: "reply@narada.test",
      subject: "Transactional review",
      html: "<p>Exact content</p>",
      text: "Exact content",
      tags: { workflow: "agent" },
      priority: "high" as const,
      expires_in: 600,
    },
  };
  const blocked = await call(g, "emails_send", {
    ...input,
    idempotencyKey: randomUUID(),
  });
  expect(JSON.parse(blocked.data.result.content[0].text).code).toBe(
    "approval_required",
  );
  const pending = await reviewRequest(g, "emails.send", input),
    review = await ownerReview(pending.id);
  expect(review).toMatchObject({
    recipients: input.body.to,
    replyTo: input.body.reply_to,
    html: input.body.html,
    priority: "high",
    tags: input.body.tags,
    expiresInSeconds: 600,
  });
  expect(pending.messageId).toBeUndefined();
  expect(
    (
      await request(`/api/admin/approvals/${pending.id}/approve`, {
        digest: review.digest,
      })
    ).status,
  ).toBe(200);
  const completed = await result(g, "approvals_get", {
    params: { id: pending.id },
  });
  expect(completed.messageId).toBeTruthy();
  const status = await result(g, "emails_get", {
    params: { id: completed.messageId },
  });
  const { z } = await import("zod"),
    { operationSchemas } = await import("@narada/contracts/discovery");
  z.fromJSONSchema(operationSchemas["emails.get"].output).parse(status);
  expect(status).toMatchObject({
    status: "queued",
    priority: "high",
    tags: input.body.tags,
  });
  expect(status).not.toHaveProperty("text");
  const other = await runtime.publications.create(settings());
  const restricted = await grant(["narada:emails:read"], {
    publicationIds: [other.id],
  });
  expect(
    (await rpc(restricted.tokens.access_token)).data.result.tools.some(
      (t: { name: string }) => t.name === "emails_get",
    ),
  ).toBe(false);
  const denied = await call(g, "approvals_request", {
    body: {
      operation: "emails.send",
      input: { body: { ...input.body, from: "other@outside.test" } },
    },
    idempotencyKey: randomUUID(),
  });
  expect(JSON.parse(denied.data.result.content[0].text).status).toBe(403);
  const connectionRecord = await connection(g);
  await grants.change(
    grants.referenceOf(connectionRecord),
    userId,
    g.c.client_id,
  );
  expect(
    (await call(g, "emails_get", { params: { id: completed.messageId } }))
      .response.status,
  ).toBe(401);
});

it("supports publication logo upload, private preview and branding save through scoped MCP with replay and revocation", async () => {
  const pub = await runtime.publications.create(settings());
  const other = await runtime.publications.create(settings());
  const selected = [
    "openid",
    "narada:publications:read",
    "narada:publications:branding:write",
  ];
  const g = await grant(selected, { publicationIds: [pub.id] });
  const tools = (await rpc(g.tokens.access_token)).data.result.tools;
  for (const name of [
    "publications_logo_upload",
    "publications_branding_update",
    "publications_branding_preview",
  ])
    expect(tools.some((tool: { name: string }) => tool.name === name)).toBe(
      true,
    );
  const body = {
    fileName: "mcp-logo.png",
    contentBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=",
  };
  const upload = { params: { id: pub.id }, body, idempotencyKey: randomUUID() };
  const asset = await result(g, "publications_logo_upload", upload);
  expect(await result(g, "publications_logo_upload", upload)).toEqual(asset);
  expect(
    (
      await call(g, "publications_logo_upload", {
        ...upload,
        params: { id: other.id },
      })
    ).data.result.isError,
  ).toBe(true);
  const branding = {
    theme: "minimal",
    logoAssetId: asset.id,
    logoAlt: "MCP mark",
    welcomeText: "Created through a scoped client",
  };
  const preview = await result(g, "publications_branding_preview", {
    params: { id: pub.id },
    body: { branding, revision: pub.revision },
  });
  expect(preview.html).toContain('data-theme="minimal"');
  expect(preview.html).toContain(asset.url);
  expect(preview.html).toContain("noindex,nofollow");
  expect((await runtime.publications.get(pub.id)).branding).toBeUndefined();
  const update = {
    params: { id: pub.id },
    body: { branding, revision: pub.revision },
    idempotencyKey: randomUUID(),
  };
  const saved = await result(g, "publications_branding_update", update);
  expect(saved.branding).toEqual(branding);
  expect(await result(g, "publications_branding_update", update)).toEqual(
    saved,
  );
  expect((await runtime.publications.get(pub.id)).revision).toBe(
    pub.revision + 1,
  );
  const reader = await grant(["openid", "narada:publications:read"], {
    publicationIds: [pub.id],
  });
  expect(
    (await rpc(reader.tokens.access_token)).data.result.tools.some(
      (tool: { name: string }) => tool.name === "publications_logo_upload",
    ),
  ).toBe(false);
  const denied = await call(reader, "publications_branding_update", update);
  expect(denied.data.error || denied.data.result?.isError).toBeTruthy();
  const row = (await grants.list(userId)).data.find(
    (row) => row.clientId === g.c.client_id,
  )!;
  expect(
    (
      await request(
        "/oauth/connections/" + grants.referenceOf(row) + "/revoke",
        {},
      )
    ).status,
  ).toBe(200);
  expect(
    (await call(g, "publications_logo_upload", upload)).response.status,
  ).toBe(401);
});

it("does not let OAuth callers use REST or API keys use MCP to change the approval boundary", async () => {
  const g = await grant(["narada:emails:send", "narada:emails:read"], {});
  const body = {
    from: "hello@narada.test",
    to: "boundary@example.com",
    subject: "Boundary",
    text: "Test",
  };
  const rest = await fetch(origin + "/api/v1/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${g.tokens.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  expect(rest.status).toBe(401);
  const key = await runtime.service.createKey("Application key", "full");
  expect((await rpc(key.token)).response.status).toBe(401);
  const disguised = await call(g, "emails_send", {
    body,
    idempotencyKey: randomUUID(),
  });
  expect(JSON.parse(disguised.data.result.content[0].text).code).toBe(
    "approval_required",
  );
});

it("keeps native connected-app JSON management owner-only and mutations same-origin", async () => {
  const g = await grant(["narada:forms:read"]);
  const row = await connection(g);
  const path = "/oauth/connections/" + grants.referenceOf(row);
  const key = await runtime.service.createKey(
    "owner-management-denied",
    "full",
  );
  try {
    for (const authorization of [
      "",
      `Bearer ${g.tokens.access_token}`,
      `Bearer ${key.token}`,
    ]) {
      for (const target of ["/oauth/connections", path]) {
        const response = await fetch(origin + target, {
          redirect: "manual",
          headers: { accept: "application/json", authorization },
        });
        expect(response.status).toBe(401);
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
    const other = await grants.reference("different-owner", randomUUID(), [
      "narada:forms:read",
    ]);
    expect((await request("/oauth/connections/" + other)).status).toBe(404);
    const crossOrigin = await fetch(origin + path + "/revoke", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://untrusted.example",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(crossOrigin.status).toBe(403);
    const response = await request(path);
    expect(response.headers.get("vary")).toContain("Accept");
    const detail = await response.json();
    expect(detail.active).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(g.tokens.access_token);
    await request(path + "/revoke", {});
    expect((await (await request(path)).json()).active).toBe(false);
    expect((await rpc(g.tokens.access_token)).response.status).toBe(401);
  } finally {
    await runtime.store.remove(
      `KEY#${createHash("sha256").update(key.token).digest("hex")}`,
    );
  }
});

it("manages custom publication domains through OAuth MCP with explicit consent, replay and revocation", async () => {
  const previous = runtime.publicationDomains;
  const previousApp = app;
  const dns = new FakePublicationDns(),
    provider = new FakeDomainProvider();
  runtime.publicationDomains = new PublicationDomains(
    runtime.store,
    dns,
    provider,
  );
  app = createApp(runtime);
  try {
    const pub = await runtime.publications.create(settings()),
      other = await runtime.publications.create(settings());
    const g = await grant(
      [
        "openid",
        "narada:publications:read",
        "narada:publications:domains:write",
      ],
      { publicationIds: [pub.id] },
    );
    const tools = (await rpc(g.tokens.access_token)).data.result.tools;
    for (const action of [
      "get",
      "configure",
      "check",
      "activate",
      "disconnect",
    ]) {
      const tool = tools.find(
        (t: { name: string }) => t.name === `publications_domain_${action}`,
      );
      expect(tool).toBeTruthy();
      expect(tool.annotations.readOnlyHint).toBe(action === "get");
      if (action === "disconnect")
        expect(tool.annotations.destructiveHint).toBe(true);
    }
    const configure = {
      params: { id: pub.id },
      body: {
        hostname: `mcp-${randomUUID().slice(0, 8)}.example.com`,
        revision: 0,
      },
      idempotencyKey: randomUUID(),
    };
    expect(
      (await result(g, "publications_domain_get", { params: { id: pub.id } }))
        .domain,
    ).toBeNull();
    const configured = await result(
      g,
      "publications_domain_configure",
      configure,
    );
    expect(await result(g, "publications_domain_configure", configure)).toEqual(
      configured,
    );
    expect(
      (
        await call(g, "publications_domain_configure", {
          ...configure,
          params: { id: other.id },
        })
      ).data.result.isError,
    ).toBe(true);
    const row = configured.domain;
    dns.set(row.records[0].name, "TXT", row.records[0].value);
    await runtime.store.patch(`PUBLICATIONDOMAIN#${row.id}`, {
      checkRequestedAt: 0,
    });
    const check = await result(g, "publications_domain_check", {
      params: { id: pub.id },
      body: { revision: row.revision },
      idempotencyKey: randomUUID(),
    });
    for (let i = 0; i < 3; i++) await runtime.publicationDomains.run(row.id);
    const provisioned = (await runtime.publicationDomains.connection(pub.id))!;
    dns.set(provisioned.hostname, "CNAME", provisioned.distributionHostname!);
    await runtime.publicationDomains.run(row.id);
    const activation = await result(g, "publications_domain_activate", {
      params: { id: pub.id },
      body: { revision: check.domain.revision },
      idempotencyKey: randomUUID(),
    });
    await runtime.publicationDomains.run(row.id);
    expect(
      (await result(g, "publications_domain_get", { params: { id: pub.id } }))
        .domain.state,
    ).toBe("active");
    const disconnected = await result(g, "publications_domain_disconnect", {
      params: { id: pub.id },
      body: { revision: activation.domain.revision },
      idempotencyKey: randomUUID(),
    });
    expect(disconnected.preferredUrl).toBe(disconnected.defaultUrl);
    const reader = await grant(["openid", "narada:publications:read"], {
      publicationIds: [pub.id],
    });
    expect(
      (await rpc(reader.tokens.access_token)).data.result.tools.some(
        (t: { name: string }) => t.name === "publications_domain_configure",
      ),
    ).toBe(false);
    const denied = await call(
      reader,
      "publications_domain_configure",
      configure,
    );
    expect(denied.data.error || denied.data.result?.isError).toBeTruthy();
    const saved = (await grants.list(userId)).data.find(
      (row) => row.clientId === g.c.client_id,
    )!;
    expect(
      (
        await request(
          "/oauth/connections/" + grants.referenceOf(saved) + "/revoke",
          {},
        )
      ).status,
    ).toBe(200);
    expect(
      (await call(g, "publications_domain_configure", configure)).response
        .status,
    ).toBe(401);
  } finally {
    runtime.publicationDomains = previous;
    app = previousApp;
  }
});

it("onboards a migration through OAuth with discoverable guidance, domain setup, owner-only keys and revocation", async () => {
  const selected = [
    "offline_access",
    "narada:capabilities:read",
    "narada:domains:read",
    "narada:domains:create",
    "narada:domains:configure",
    "narada:domains:refresh",
  ];
  const g = await grant(selected),
    name = "mcp-migration.example.test";
  const discovery = await rpc(g.tokens.access_token);
  const names = discovery.data.result.tools.map(
    (t: { name: string }) => t.name,
  );
  expect(names).toEqual(
    expect.arrayContaining([
      "integration_guide",
      "resources_search",
      "domains_create",
      "domains_mailFrom_update",
      "domains_dkim_enable",
    ]),
  );
  expect(names.some((n: string) => /keys.*create|credentials/.test(n))).toBe(
    false,
  );
  const resources = await rpc(g.tokens.access_token, "resources/list");
  expect(resources.data.result.resources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ uri: "narada://guides/project-integration" }),
    ]),
  );
  const resource = await rpc(g.tokens.access_token, "resources/read", {
    uri: "narada://guides/project-integration",
  });
  expect(resource.data.result.contents[0].text).toContain(
    "owner creates a Sending API key",
  );
  const prompt = await rpc(g.tokens.access_token, "prompts/get", {
    name: "migrate_from_resend",
  });
  expect(prompt.data.result.messages[0].content.text).toContain(
    "Preserve Resend's records",
  );
  expect((await result(g, "integration_guide")).mcpUrl).toBe(
    origin + "/api/mcp",
  );
  const input = { body: { name }, idempotencyKey: randomUUID() };
  const domain = await result(g, "domains_create", input);
  expect(await result(g, "domains_create", input)).toEqual(domain);
  const configured = await result(g, "domains_mailFrom_update", {
    params: { name },
    body: {
      domain: `bounce.${name}`,
      behavior: "REJECT_MESSAGE",
      revision: domain.revision,
    },
    idempotencyKey: randomUUID(),
  });
  expect(configured.authentication.mailFrom.records).toHaveLength(2);
  expect(
    (
      await result(g, "domains_dkim_enable", {
        params: { name },
        body: { revision: configured.revision },
        idempotencyKey: randomUUID(),
      })
    ).revision,
  ).toBe(2);
  expect(
    (
      await result(g, "resources_search", {
        query: { kind: "domains", text: "mcp-migration" },
      })
    ).data,
  ).toEqual([expect.objectContaining({ id: name })]);
  const readOnly = await grant(["narada:domains:read"], {
    senderDomains: [name],
  });
  const readNames = (
    await rpc(readOnly.tokens.access_token)
  ).data.result.tools.map((t: { name: string }) => t.name);
  expect(readNames).not.toContain("domains_create");
  expect(readNames).not.toContain("domains_mailFrom_update");
  const denied = await call(readOnly, "resources_search", {
    query: { kind: "contacts", text: "test" },
  });
  expect(JSON.parse(denied.data.result.content[0].text).status).toBe(403);
  expect(
    (
      await result(readOnly, "resources_search", {
        query: { kind: "domains", text: "narada" },
      })
    ).data,
  ).toEqual([]);
  const restrictedWriter = await grant(selected, { senderDomains: [name] });
  for (const [tool, args] of [
    [
      "domains_create",
      {
        body: { name: "outside-migration.test" },
        idempotencyKey: randomUUID(),
      },
    ],
    [
      "domains_dkim_enable",
      {
        params: { name: "narada.test" },
        body: { revision: 0 },
        idempotencyKey: randomUUID(),
      },
    ],
  ] as const) {
    const deniedWrite = await call(restrictedWriter, tool, args);
    expect(JSON.parse(deniedWrite.data.result.content[0].text).status).toBe(
      403,
    );
  }
  const row = await connection(g);
  expect(
    (
      await request(
        "/oauth/connections/" + grants.referenceOf(row) + "/revoke",
        {},
      )
    ).status,
  ).toBe(200);
  expect((await call(g, "domains_create", input)).response.status).toBe(401);
});
it("supports scoped branding assets and draft deletion through MCP, including lost-response replay", async () => {
  let p = await runtime.publications.create(settings());
  p = await runtime.publications.update(p.id, p.settings, p.revision, "active");
  const g = await grant(
    [
      "narada:publications:branding:write",
      "narada:issues:write",
      "narada:issues:read",
      "narada:issues:delete",
    ],
    { publicationIds: [p.id] },
  );
  const tools = (await rpc(g.tokens.access_token)).data.result.tools;
  expect(tools.some((t: { name: string }) => t.name === "issues_delete")).toBe(
    true,
  );
  expect(
    tools.some(
      (t: { name: string }) => t.name === "publications_assets_upload",
    ),
  ).toBe(true);
  const upload = {
    params: { id: p.id },
    body: {
      fileName: "cover.png",
      contentBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=",
    },
    idempotencyKey: randomUUID(),
  };
  const asset = await result(g, "publications_assets_upload", upload);
  expect(await result(g, "publications_assets_upload", upload)).toEqual(asset);
  const draft = await result(g, "issues_create", {
    params: { id: p.id },
    body: { ...issue(), coverAssetId: asset.id, coverAlt: "MCP cover" },
    idempotencyKey: randomUUID(),
  });
  expect(draft.canDelete).toBe(true);
  expect(
    (
      await result(g, "issues_list", {
        params: { id: p.id },
        query: { status: "draft" },
      })
    ).data.map((i: { id: string }) => i.id),
  ).toContain(draft.id);
  const deletion = {
    params: { id: p.id, issueId: draft.id },
    body: { revision: draft.revision },
    idempotencyKey: randomUUID(),
  };
  expect(await result(g, "issues_delete", deletion)).toEqual({
    id: draft.id,
    deleted: true,
  });
  expect(await result(g, "issues_delete", deletion)).toEqual({
    id: draft.id,
    deleted: true,
  });
  expect(
    (await result(g, "issues_list", { params: { id: p.id } })).data,
  ).toHaveLength(0);
  const reader = await grant(["narada:issues:read", "narada:issues:write"], {
    publicationIds: [p.id],
  });
  expect(
    (await rpc(reader.tokens.access_token)).data.result.tools.some(
      (t: { name: string }) => t.name === "issues_delete",
    ),
  ).toBe(false);
  const denied = await call(reader, "issues_delete", deletion);
  expect(denied.data.error || denied.data.result?.isError).toBeTruthy();
});

it("publishes website drafts and manages collections through scoped OAuth MCP without sending", async () => {
  let p = await runtime.publications.create(settings());
  p = await runtime.publications.update(p.id, p.settings, p.revision, "active");
  const g = await grant(
    [
      "narada:publications:read",
      "narada:publications:site:write",
      "narada:publications:site:publish",
      "narada:publications:collections:write",
      "narada:issues:read",
      "narada:issues:write",
    ],
    { publicationIds: [p.id] },
  );
  const params = { id: p.id };
  const draft = await result(g, "publications_about_update", {
    params,
    body: {
      revision: 0,
      draft: {
        title: "Our story",
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Welcome to our publication" }],
            },
          ],
        },
      },
    },
    idempotencyKey: randomUUID(),
  });
  const publish = {
    params,
    body: { revision: draft.revision },
    idempotencyKey: randomUUID(),
  };
  const live = await result(g, "publications_about_publish", publish);
  expect(await result(g, "publications_about_publish", publish)).toEqual(live);
  const collection = await result(g, "publications_collections_create", {
    params,
    body: { name: "Research", slug: "research", description: "Deep dives" },
    idempotencyKey: randomUUID(),
  });
  const i = await result(g, "issues_create", {
    params,
    body: issue(),
    idempotencyKey: randomUUID(),
  });
  const assign = {
    params: { ...params, issueId: i.id },
    body: {
      revision: 0,
      issueRevision: i.revision,
      collectionIds: [collection.id],
    },
    idempotencyKey: randomUUID(),
  };
  const assigned = await result(g, "issues_collections_update", assign);
  expect(await result(g, "issues_collections_update", assign)).toEqual(
    assigned,
  );
  const site = await result(g, "publications_site_update", {
    params,
    body: {
      revision: 0,
      draft: {
        navigation: [
          { type: "about", label: "About" },
          {
            type: "collection",
            label: "Research",
            collectionId: collection.id,
          },
        ],
        featuredIssueId: null,
        collectionIds: [collection.id],
      },
    },
    idempotencyKey: randomUUID(),
  });
  expect(
    (
      await result(g, "publications_site_preview", {
        params,
        body: { revision: site.revision },
      })
    ).html,
  ).toContain("noindex");
  expect(
    (
      await result(g, "publications_site_publish", {
        params,
        body: { revision: site.revision },
        idempotencyKey: randomUUID(),
      })
    ).published,
  ).not.toBeNull();
  const reader = await grant(
    ["narada:publications:read", "narada:issues:read"],
    { publicationIds: [p.id] },
  );
  expect(
    (await rpc(reader.tokens.access_token)).data.result.tools.some(
      (t: { name: string }) => t.name === "publications_site_publish",
    ),
  ).toBe(false);
  const denied = await call(reader, "publications_about_publish", publish);
  expect(denied.data.error || denied.data.result?.isError).toBeTruthy();
  const archived = await result(g, "publications_collections_archive", {
    params: { ...params, collectionId: collection.id },
    body: { revision: collection.revision },
    idempotencyKey: randomUUID(),
  });
  expect(archived.status).toBe("archived");
});
