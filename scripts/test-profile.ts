import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { serve } from "@hono/node-server";
import { createServer } from "vite";
import { initialize } from "./local.js";
import { createApp } from "../apps/api/src/app.js";

// This suite changes and resets its owner's password. Never use shared dev tables.
const fixture = `narada-profile-${randomUUID().slice(0, 8)}`;
const credentials = `.local/${fixture}.json`;
Object.assign(process.env, {
  NARADA_MODE: "local",
  APP_TABLE: `${fixture}-app`,
  AUTH_TABLE: `${fixture}-auth`,
  OWNER_EMAIL: `${fixture}@example.net`,
  BETTER_AUTH_URL: "http://localhost:5173",
  NARADA_TEST_OWNER_FILE: credentials,
});
const runtime = await initialize(credentials);
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let api: ReturnType<typeof serve> | undefined;
try {
  vite = await createServer({ configFile: "apps/web/vite.config.ts" });
  await vite.listen(); // strictPort refuses to reuse someone else's dashboard.
  await new Promise<void>((resolve, reject) => {
    api = serve(
      { fetch: createApp(runtime).fetch, hostname: "127.0.0.1", port: 3001 },
      () => resolve(),
    );
    api.on("error", reject);
  });
  const child = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "tests/e2e/profile.test.ts",
      "tests/e2e/settings.test.ts",
      "--reporter=list",
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await vite?.close();
  if (api) {
    if ("closeAllConnections" in api) api.closeAllConnections();
    await new Promise<void>((resolve) => api!.close(() => resolve()));
  }
  try {
    for (const TableName of [
      runtime.config.APP_TABLE,
      runtime.config.AUTH_TABLE,
    ])
      await runtime.store.client.send(new DeleteTableCommand({ TableName }));
  } finally {
    await rm(credentials, { force: true });
    runtime.store.client.destroy();
  }
}
