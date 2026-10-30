import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer as reservePort, type AddressInfo } from "node:net";
import { DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { serve } from "@hono/node-server";
import { createServer } from "vite";
import { initialize } from "./local.js";
import { createApp } from "../apps/api/src/app.js";

// Exercise the composed dashboard/API without touching a running developer app.
const fixture = `narada-browser-${randomUUID()}`;
const credentials = `.local/${fixture}.json`;
const reservation = reservePort();
await new Promise<void>((resolve) =>
  reservation.listen(0, "127.0.0.1", resolve),
);
const port = (reservation.address() as AddressInfo).port;
await new Promise<void>((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const origin = `http://127.0.0.1:${port}`;
Object.assign(process.env, {
  NARADA_MODE: "local",
  APP_TABLE: `${fixture}-app`,
  AUTH_TABLE: `${fixture}-auth`,
  OWNER_EMAIL: `${fixture}@example.net`,
  BETTER_AUTH_URL: origin,
  NARADA_E2E_BASE_URL: origin,
  NARADA_TEST_OWNER_FILE: credentials,
});
let runtime: Awaited<ReturnType<typeof initialize>> | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let api: ReturnType<typeof serve> | undefined;
try {
  runtime = await initialize(credentials);
  api = serve({
    fetch: createApp(runtime).fetch,
    hostname: "127.0.0.1",
    port: 0,
  });
  await new Promise<void>((resolve, reject) => {
    api!.once("listening", resolve);
    api!.once("error", reject);
  });
  const target = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const proxy = Object.fromEntries(
    ["/media", "^/n(?:/|$)", "/oauth", "/.well-known", "/api"].map((path) => [
      path,
      { target, changeOrigin: false },
    ]),
  );
  vite = await createServer({
    configFile: "apps/web/vite.config.ts",
    server: { port, host: "127.0.0.1", strictPort: true, proxy },
  });
  await vite.listen();
  const child = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "tests/e2e/api-reference.test.ts",
      "tests/e2e/integration-guide.test.ts",
      "tests/e2e/form-motion.test.ts",
      "--reporter=list",
    ],
    { stdio: "inherit", env: process.env },
  );
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await vite?.close();
  if (api) {
    if ("closeAllConnections" in api) api.closeAllConnections();
    await new Promise<void>((resolve) => api!.close(() => resolve()));
  }
  const db = new DynamoDBClient({
    region: "us-east-1",
    endpoint: "http://127.0.0.1:8000",
    credentials: { accessKeyId: "naradalocal", secretAccessKey: "naradalocal" },
  });
  try {
    for (const TableName of [`${fixture}-app`, `${fixture}-auth`]) {
      try {
        await db.send(new DeleteTableCommand({ TableName }));
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "ResourceNotFoundException"
        )
          throw error;
      }
    }
  } finally {
    db.destroy();
    runtime?.store.client.destroy();
    runtime?.queues.client.destroy();
    await rm(credentials, { force: true });
  }
}
