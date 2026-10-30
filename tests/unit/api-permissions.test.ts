import { operations } from "@narada/contracts/operations";
import { isCampaignOperation } from "@narada/core/campaign-operations";
import { expect, it } from "vitest";
import {
  apiKeyAccess,
  apiScopes,
  assertApiAccess,
  type ApiScope,
} from "@narada/core/api-permissions";
import type { ApiKey } from "@narada/core/model";
import { restRoutes } from "@narada/http-api/rest-routes";
import { createRuntime, loadConfig } from "@narada/runtime-aws";

// Public route inventory, independent of the authorization matcher.
const routes: [string, string, ApiScope[]][] = [
  ["GET", "/capabilities", apiScopes],
  ["GET", "/openapi.json", apiScopes],
  ["POST", "/emails", ["emails:send"]],
  ["GET", "/emails/:id", ["emails:send"]],
  ["POST", "/contacts", ["contacts:create", "contacts:write"]],
  ["GET", "/contacts", ["contacts:read"]],
  ["GET", "/contacts/:email", ["contacts:read", "contacts:write"]],
  ["PUT", "/contacts/:email", ["contacts:write"]],
  ["PATCH", "/contacts/:email/properties", ["contacts:write"]],
  ["POST", "/contacts/:email/topics/:id", ["contacts:subscriptions"]],
  [
    "POST",
    "/contacts/:email/topics/:id/unsubscribe",
    ["contacts:subscriptions"],
  ],
  ["POST", "/contacts/:email/unsubscribe", ["contacts:subscriptions"]],
  ["GET", "/properties", ["properties:read"]],
  ["GET", "/properties/:key", ["properties:read"]],
  ["POST", "/properties", ["properties:write"]],
  ["PUT", "/properties/:key", ["properties:write"]],
  ["GET", "/topics", ["topics:read"]],
  ["GET", "/topics/:id", ["topics:read"]],
  ["POST", "/topics", ["topics:write"]],
  ["PUT", "/topics/:id", ["topics:write"]],
  ["GET", "/segments", ["segments:read"]],
  ["GET", "/segments/:id", ["segments:read"]],
  ["GET", "/segments/:id/contacts", ["segments:read"]],
  ["POST", "/segments", ["segments:write"]],
  ["PUT", "/segments/:id", ["segments:write"]],
  ["POST", "/segments/:id/contacts/:email", ["segments:members"]],
  ["DELETE", "/segments/:id/contacts/:email", ["segments:members"]],
  ["POST", "/segments/:id/import", ["segments:import"]],
  ["GET", "/broadcasts", ["broadcasts:read"]],
  ["GET", "/broadcasts/:id", ["broadcasts:read"]],
  ["GET", "/broadcasts/:id/recipients", ["broadcasts:read"]],
  ["GET", "/broadcasts/:id/preview", ["broadcasts:read"]],
  ["POST", "/broadcasts", ["broadcasts:write"]],
  ["PUT", "/broadcasts/:id", ["broadcasts:write"]],
  ["POST", "/broadcasts/:id/duplicate", ["broadcasts:write"]],
  ["POST", "/broadcasts/:id/send", ["broadcasts:send"]],
  ["POST", "/broadcasts/:id/test", ["broadcasts:send"]],
  ["POST", "/broadcasts/:id/cancel", ["broadcasts:send"]],
  ["GET", "/templates", ["templates:read"]],
  ["GET", "/templates/:id", ["templates:read"]],
  ["POST", "/templates/:id/preview", ["templates:read"]],
  ["POST", "/templates", ["templates:write"]],
  ["PUT", "/templates/:id", ["templates:write"]],
  ["POST", "/templates/:id/publish", ["templates:write"]],
  ["POST", "/templates/:id/archive", ["templates:write"]],
  ["POST", "/templates/:id/duplicate", ["templates:write"]],
  ["POST", "/templates/:id/test", ["templates:test"]],
  // This cross-resource operation requires BOTH scopes.
  ["POST", "/templates/:id/broadcasts", ["templates:read", "broadcasts:write"]],
];
const pathFor = (path: string) =>
  `/api/v1${path.replace(/:email/g, "alex%40example.com").replace(/:(id|key)/g, "example-id")}`;
it("covers every current public endpoint in the permission matrix", () => {
  const runtime = createRuntime(
    loadConfig({ BETTER_AUTH_SECRET: "x".repeat(40) }),
  );
  const legacyIds = new Set(
    operations
      .filter(
        (op) =>
          isCampaignOperation(op.id) ||
          op.id.startsWith("emails.") ||
          ["capabilities.read", "contracts.read"].includes(op.id),
      )
      .map((op) => op.id),
  );
  const legacyPaths = new Set(
    operations.flatMap((op) =>
      legacyIds.has(op.id) && "http" in op
        ? [`${op.http.method} ${op.http.path}`]
        : [],
    ),
  );
  const actual = restRoutes(runtime)
    .routes.filter((route) => legacyPaths.has(`${route.method} ${route.path}`))
    .map((route) => `${route.method} ${route.path.replace(/^\/api\/v1/, "")}`);
  expect(routes.map(([method, path]) => `${method} ${path}`).sort()).toEqual(
    actual.sort(),
  );
});
it("isolates every scope by resource and method, with explicit cross-resource grants", () => {
  for (const scope of apiScopes) {
    for (const [method, path, allowed] of routes) {
      const call = () =>
        assertApiAccess(
          { permission: "scoped", scopes: [scope] } as ApiKey,
          method,
          pathFor(path),
        );
      if (allowed.includes(scope) && path !== "/templates/:id/broadcasts")
        expect(call, `${scope}: ${method} ${path}`).not.toThrow();
      else expect(call, `${scope}: ${method} ${path}`).toThrow();
    }
  }
  for (const [method, path] of routes) {
    expect(() =>
      assertApiAccess(
        { permission: "scoped", scopes: apiScopes } as ApiKey,
        method,
        pathFor(path),
      ),
    ).not.toThrow();
    expect(() =>
      assertApiAccess({ permission: "full" } as ApiKey, method, pathFor(path)),
    ).not.toThrow();
  }
});
it("preserves legacy sending access and denies unknown endpoints and methods", () => {
  for (const permission of [undefined, "sending"] as const) {
    for (const [method, path, scopes] of routes) {
      const call = () =>
        assertApiAccess({ permission } as ApiKey, method, pathFor(path));
      if (scopes.includes("emails:send")) expect(call).not.toThrow();
      else expect(call).toThrow();
    }
  }
  for (const [method, path] of [
    ["DELETE", "/api/v1/contacts/id"],
    ["PATCH", "/api/v1/templates/id"],
    ["POST", "/api/v1/new-api"],
    ["POST", "/api/admin/keys"],
    ["GET", "/api/v1/templates/id/private"],
  ]) {
    expect(() =>
      assertApiAccess(
        { permission: "scoped", scopes: apiScopes } as ApiKey,
        method!,
        path!,
      ),
    ).toThrow();
  }
  expect(() =>
    assertApiAccess(
      { permission: "scoped" } as ApiKey,
      "POST",
      "/api/v1/emails",
    ),
  ).toThrow();
});
it("requires explicit, known, nonduplicated scopes only on scoped keys", () => {
  for (const value of [
    { permission: "scoped" },
    { permission: "scoped", scopes: [] },
    { permission: "scoped", scopes: ["admin"] },
    { permission: "scoped", scopes: ["contacts:write", "contacts:write"] },
    { permission: "sending", scopes: ["contacts:write"] },
    { permission: "full", scopes: ["emails:send"] },
  ])
    expect(apiKeyAccess.safeParse(value).success).toBe(false);
  expect(
    apiKeyAccess.safeParse({ permission: "scoped", scopes: apiScopes }).success,
  ).toBe(true);
});
