import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { z } from "zod";
import type { Runtime } from "@narada/core/runtime";
import { AppError, type Entity } from "@narada/core/model";
import { GrantStore } from "@narada/core/oauth-grants";
import { oauthApproval } from "@narada/core/oauth-context";
import { oauthScopes } from "@narada/contracts/mcp";
import { resourceRestrictions } from "@narada/contracts/delegation";
import { ProductPagination } from "@narada/core/product-pagination";
import { loginPage, selectionPage, connectionsPage } from "./oauth-pages.js";

export function oauthRoutes(runtime: Runtime) {
  const { auth, config, store } = runtime,
    resource = `${config.BETTER_AUTH_URL}/api/mcp`,
    grants = new GrantStore(store, resource);
  const app = new Hono<{
    Variables: { nonce: string; user: { id: string; email: string } };
  }>();
  const wantsJson = (accept: string | undefined) =>
    accept?.includes("application/json") ?? false;
  app.use("/oauth/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    const nonce = randomBytes(18).toString("base64url");
    c.set("nonce", nonce);
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    );
    if (
      c.req.method !== "GET" &&
      c.req.header("origin") !== config.BETTER_AUTH_URL
    )
      throw new AppError(403, "Invalid origin");
    if (c.req.path === "/oauth/login") return next();
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      if (c.req.method === "GET" && c.req.path === "/oauth/consent")
        return c.redirect(`/oauth/login${new URL(c.req.url).search}`);
      if (
        c.req.method === "GET" &&
        c.req.path.startsWith("/oauth/connections") &&
        !wantsJson(c.req.header("accept"))
      )
        return c.redirect("/oauth/login");
      throw new AppError(401, "Sign in to continue");
    }
    c.set("user", session.user);
    await next();
  });
  async function signed(query: string) {
    if (!(await verifyOAuthQueryParams(query, config.BETTER_AUTH_SECRET)))
      throw new AppError(400, "Invalid or expired authorization request");
    const params = new URLSearchParams(query),
      requested = (params.get("scope") ?? "").split(" ").filter(Boolean);
    if (
      !params.get("client_id") ||
      requested.some((scope) => !oauthScopes.includes(scope)) ||
      params.getAll("resource").some((value) => value !== resource)
    )
      throw new AppError(400, "Unsupported authorization request");
    return { params, requested };
  }
  async function selectedResources(input: unknown) {
    const resources = resourceRestrictions.parse(input);
    for (const [field, prefix] of [
      ["formIds", "FORM"],
      ["publicationIds", "PUBLICATION"],
      ["senderDomains", "DOMAIN"],
    ] as const)
      for (const id of resources[field] ?? []) {
        const row = await store.get(`${prefix}#${id}`);
        if (!row || row.removedAt)
          throw new AppError(422, "Choose existing resources");
      }
    return resources;
  }
  const clientName = async (clientId: string, headers: Headers) => {
    try {
      return (
        (
          await auth.api.getOAuthClientPublic({
            headers,
            query: { client_id: clientId },
          })
        ).client_name ?? clientId
      );
    } catch {
      return clientId;
    }
  };
  app.get("/oauth/login", (c) => c.html(loginPage(c.get("nonce"))));
  app.get("/oauth/consent", async (c) => {
    const query = new URL(c.req.url).search.slice(1),
      { params, requested } = await signed(query),
      clientId = params.get("client_id")!;
    return c.html(
      selectionPage(
        c.get("nonce"),
        c.get("user").email,
        await clientName(clientId, c.req.raw.headers),
        requested,
        { query, clientId },
      ),
    );
  });
  app.post("/oauth/consent", async (c) => {
    const input = z
      .object({
        accept: z.boolean(),
        mode: z.enum(["all", "selected"]),
        scopes: z.array(z.string()).max(oauthScopes.length).optional(),
        resources: resourceRestrictions.default({}),
        oauth_query: z.string().max(16000),
      })
      .strict()
      .parse(await c.req.json());
    const { params, requested } = await signed(input.oauth_query);
    const selected =
      input.mode === "all" ? requested : [...new Set(input.scopes ?? [])];
    if (
      selected.some((scope) => !requested.includes(scope)) ||
      (input.accept && !selected.length)
    )
      throw new AppError(400, "Select only requested permissions");
    const resources = input.accept
      ? await selectedResources(input.resources)
      : {};
    const body = {
      accept: input.accept,
      scope: selected.join(" "),
      oauth_query: input.oauth_query,
    };
    return oauthApproval.run(
      {
        userId: c.get("user").id,
        clientId: params.get("client_id")!,
        query: input.oauth_query,
        scopes: selected,
        resources,
      },
      () =>
        auth.handler(
          new Request(`${config.BETTER_AUTH_URL}/api/auth/oauth2/consent`, {
            method: "POST",
            headers: c.req.raw.headers,
            body: JSON.stringify(body),
          }),
        ),
    );
  });
  app.get("/oauth/resources", async (c) => {
    const kind = z
      .enum(["forms", "publications", "domains"])
      .parse(c.req.query("kind"));
    const prefix = {
      forms: "FORM#",
      publications: "PUBLICATION#",
      domains: "DOMAIN#",
    }[kind];
    const result = await new ProductPagination(store).records<Entity>(
      kind,
      prefix,
      {
        limit: 20,
        ...(c.req.query("cursor") ? { cursor: c.req.query("cursor") } : {}),
      },
      (row) => !row.removedAt,
    );
    return c.json({
      ...result,
      data: result.data.map((row) => ({
        id: String(kind === "domains" ? row.name : row.id),
        label: String(
          kind === "forms"
            ? (row.draft as { name: string }).name
            : kind === "publications"
              ? (row.settings as { name: string }).name
              : row.name,
        ),
      })),
    });
  });
  app.get("/oauth/connections", async (c) => {
    const page = await grants.list(c.get("user").id, {
      cursor: c.req.query("cursor"),
    });
    const connections = await Promise.all(
      page.data.map(async (row) => ({
        reference: grants.referenceOf(row),
        clientId: row.clientId,
        name: await clientName(row.clientId, c.req.raw.headers),
        scopes: row.scopes,
        resources: row.resources,
        active: row.active,
        revision: row.revision,
        updatedAt: row.updatedAt,
      })),
    );
    c.header("Vary", "Accept");
    if (wantsJson(c.req.header("accept")))
      return c.json({
        resource,
        data: connections,
        nextCursor: page.nextCursor,
      });
    return c.html(
      connectionsPage(c.get("nonce"), resource, connections, page.nextCursor),
    );
  });
  async function connection(reference: string, userId: string) {
    const row = await grants.forOwner(reference, userId);
    if (!row) throw new AppError(404, "Connection not found");
    return row;
  }
  app.get("/oauth/connections/:reference", async (c) => {
    const row = await connection(c.req.param("reference"), c.get("user").id);
    c.header("Vary", "Accept");
    if (wantsJson(c.req.header("accept")))
      return c.json({
        reference: grants.referenceOf(row),
        clientId: row.clientId,
        name: await clientName(row.clientId, c.req.raw.headers),
        scopes: row.scopes,
        resources: row.resources,
        active: row.active,
        revision: row.revision,
        updatedAt: row.updatedAt,
      });
    if (!row.active)
      throw new AppError(409, "Reconnect from the app to authorize again");
    return c.html(
      selectionPage(
        c.get("nonce"),
        c.get("user").email,
        await clientName(row.clientId, c.req.raw.headers),
        row.scopes,
        {
          reference: grants.referenceOf(row),
          clientId: row.clientId,
          revision: row.revision,
          resources: row.resources,
        },
      ),
    );
  });
  app.post("/oauth/connections/:reference", async (c) => {
    const input = z
      .object({
        scopes: z.array(z.string()).max(oauthScopes.length),
        resources: resourceRestrictions,
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await c.req.json());
    const row = await connection(c.req.param("reference"), c.get("user").id);
    const resources = await selectedResources(input.resources);
    if (
      !(await grants.change(
        grants.referenceOf(row),
        row.userId,
        row.clientId,
        input.scopes,
        resources,
        input.revision,
      ))
    )
      throw new AppError(403, "Reconnect to expand permissions");
    return c.json({ ok: true });
  });
  app.post("/oauth/connections/:reference/revoke", async (c) => {
    const row = await connection(c.req.param("reference"), c.get("user").id);
    await grants.change(grants.referenceOf(row), row.userId, row.clientId);
    return c.json({ ok: true });
  });
  return app;
}
