import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { operations } from "@narada/contracts/operations";
import { restRoutes, createPublicApi } from "@narada/http-api";
import { loadConfig, createRuntime } from "@narada/runtime-aws";
import {
  apiOrigin,
  publicOrigin,
  assetOrigin,
  dashboardOrigin,
  installationIdentity,
} from "@narada/core/origins";
import { activityPrincipal } from "@narada/core/activity";
import { oauthCaller, ownerCaller } from "@narada/core/authorization";
import { executeMcpOperation } from "@narada/mcp/operations";

it("keeps the MCP mutation adapter limited to delegated callers", async () => {
  const runtime = createRuntime(
    loadConfig({ BETTER_AUTH_SECRET: "x".repeat(40) }),
  );
  await expect(
    executeMcpOperation(runtime, ownerCaller("owner"), "contacts.create", {
      body: { email: "reader@example.com" },
      idempotencyKey: "mcp-mutation",
    }),
  ).rejects.toMatchObject({ status: 401 });
});

it("mounts every canonical REST operation exactly once without initializing auth", () => {
  const runtime = createRuntime(
    loadConfig({ BETTER_AUTH_SECRET: "x".repeat(40) }),
  );
  Object.defineProperty(runtime, "auth", {
    get() {
      throw new Error("Unexpected auth initialization");
    },
  });
  const routes = restRoutes(runtime)
    .routes.filter((route) => route.method !== "ALL")
    .map((route) => `${route.method} ${route.path}`)
    .sort();
  expect(routes).toEqual(
    operations
      .flatMap((op) =>
        "http" in op ? [`${op.http.method} ${op.http.path}`] : [],
      )
      .sort(),
  );
  expect(() => createPublicApi(runtime)).not.toThrow();
});
it("preserves existing URL defaults and OAuth receipt identity across API host moves", () => {
  const old = loadConfig({
    BETTER_AUTH_SECRET: "x".repeat(40),
    BETTER_AUTH_URL: "https://original.example",
  });
  for (const helper of [
    apiOrigin,
    publicOrigin,
    assetOrigin,
    dashboardOrigin,
    installationIdentity,
  ])
    expect(helper(old)).toBe(old.BETTER_AUTH_URL);
  const moved = loadConfig({
    BETTER_AUTH_SECRET: "x".repeat(40),
    BETTER_AUTH_URL: "https://new-auth.example",
    NARADA_INSTALLATION_ID: old.BETTER_AUTH_URL,
    API_ORIGIN: "https://api.example",
    PUBLIC_ORIGIN: "https://content.example",
    ASSET_ORIGIN: "https://assets.example",
    DASHBOARD_ORIGIN: "https://dashboard.example",
  });
  expect(apiOrigin(moved)).toBe("https://api.example");
  expect(publicOrigin(moved)).toBe("https://content.example");
  expect(assetOrigin(moved)).toBe("https://assets.example");
  expect(dashboardOrigin(moved)).toBe("https://dashboard.example");
  const caller = oauthCaller({
    subject: "user",
    clientId: "client",
    resource: "https://original.example/api/mcp",
    tokenScopes: ["narada:contacts:read"],
    tokenGrantId: "grant",
    grant: {
      id: "grant",
      userId: "user",
      clientId: "client",
      resource: "https://original.example/api/mcp",
      active: true,
      scopes: ["narada:contacts:read"],
    },
    consent: {
      userId: "user",
      clientId: "client",
      scopes: ["narada:contacts:read"],
    },
  });
  expect(activityPrincipal(caller, installationIdentity(moved))).toBe(
    activityPrincipal(caller, installationIdentity(old)),
  );
  expect(() =>
    loadConfig({
      BETTER_AUTH_SECRET: "x".repeat(40),
      API_ORIGIN: "https://api.example/path",
    }),
  ).toThrow();
});
it("keeps backend dependencies declared and prevents source-path package coupling", () => {
  const packages = ["core", "contracts", "runtime-aws", "mcp", "http-api"];
  for (const name of packages) {
    const manifest = JSON.parse(
      readFileSync(`packages/${name}/package.json`, "utf8"),
    );
    expect(manifest.scripts.build).toBeTruthy();
    expect(manifest.files).toContain("dist");
    for (const file of readdirSync(`packages/${name}/src`).filter((file) =>
      file.endsWith(".ts"),
    )) {
      const source = readFileSync(`packages/${name}/src/${file}`, "utf8");
      expect(source, `${name}/${file}`).not.toMatch(
        /(?:\.\.\/)+(?:packages\/)?(?:core|contracts|runtime-aws|http-api|mcp)\/src\//,
      );
      if (name === "core" || name === "contracts")
        expect(source).not.toMatch(
          /from ["']@narada\/(?:http-api|mcp|runtime-aws)/,
        );
      if (name === "contracts")
        expect(source).not.toMatch(/from ["'](?:@narada\/core|node:|@aws-sdk)/);
    }
  }
});
