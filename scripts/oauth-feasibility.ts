import { serve } from "@hono/node-server";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "@narada/core/config";
import { createFeasibilityAuth } from "./oauth-feasibility/auth.js";
import { createFeasibilityRuntime } from "./oauth-feasibility/storage.js";
import { createFeasibilityApp } from "./oauth-feasibility/app.js";

const port = Number(process.env.NARADA_OAUTH_PORT ?? 3219);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("NARADA_OAUTH_PORT must be a port between 1024 and 65535");
if (process.env.NARADA_MODE && process.env.NARADA_MODE !== "local")
  throw new Error("OAuth feasibility refuses AWS mode");
const prefix = `narada-oauth-feasibility-${randomUUID().slice(0, 8)}`;
const runtime = await createFeasibilityRuntime(
  loadConfig({
    NARADA_MODE: "local",
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    APP_TABLE: `${prefix}-app`,
    AUTH_TABLE: `${prefix}-auth`,
    DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? "http://127.0.0.1:8000",
  }),
);
const credentials = {
  email: "oauth-owner@narada.test",
  password: randomBytes(24).toString("base64url"),
};
const credentialsPath = resolve(".local", `${prefix}-owner.json`);
let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  await runtime.close();
  await rm(credentialsPath, { force: true });
}
try {
  await createFeasibilityAuth(
    runtime.config,
    runtime.store,
    true,
  ).api.signUpEmail({
    body: { ...credentials, name: "OAuth feasibility owner" },
  });
  await mkdir(resolve(".local"), { recursive: true });
  await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  const app = createFeasibilityApp(runtime);
  const server = serve(
    { fetch: app.fetch, hostname: "127.0.0.1", port },
    () => {
      console.log(
        `OAuth feasibility: ${runtime.config.BETTER_AUTH_URL}\nTemporary credentials: ${credentialsPath}\nAuth lookup slots: ${runtime.lookupSlots}\nCtrl+C removes this run's tables and temporary credentials.`,
      );
    },
  );
  server.once("error", async () => {
    await cleanup();
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      server.close(async () => {
        await cleanup();
        process.exit(0);
      });
      if ("closeIdleConnections" in server) server.closeIdleConnections();
    });
} catch (error) {
  await cleanup();
  throw error;
}
