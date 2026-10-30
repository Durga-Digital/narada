// Opt-in compatibility exercise using installed clients, without inference or production data.
import assert from "node:assert/strict";
import { promisify } from "node:util";
const run = promisify(execFile);
import {
  spawn,
  execFile,
  execFileSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { chromium } from "@playwright/test";
import { loadConfig } from "@narada/core/config";
import { createFeasibilityRuntime } from "./oauth-feasibility/storage.js";
import {
  createFeasibilityAuth,
  oauthScopes as probeScopes,
} from "./oauth-feasibility/auth.js";
import { createFeasibilityApp } from "./oauth-feasibility/app.js";

import { initialize } from "./local.js";
import { createApp } from "../apps/api/src/app.js";
import type { Runtime } from "@narada/core/runtime";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import {
  oauthScopes as productionScopes,
  mcpOperations,
  mcpToolName,
} from "@narada/contracts/mcp";
const production = process.env.NARADA_TEST_PRODUCTION_MCP === "1";
const oauthScopes = production ? productionScopes : probeScopes;
const allTools = production
  ? mcpOperations.map((op) => mcpToolName(op.id)).sort()
  : ["capabilities", "whoami"];

await mkdir(resolve(".local"), { recursive: true });
const directory = await mkdtemp(resolve(".local/oauth-clients-"));
const name = `narada-probe-${randomUUID().slice(0, 8)}`;
const children: ChildProcessWithoutNullStreams[] = [];
const browser = await chromium.launch({ headless: true });
let app: { fetch: (request: Request) => Response | Promise<Response> };
let clientNetwork = 1;
const traffic: {
  method: string;
  status: number;
  protocol: string | null;
  tools?: string[];
  scopes?: string[];
  clientId?: string;
}[] = [];
const server = serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const isMcp = new URL(request.url).pathname === "/api/mcp";
    const body =
      isMcp && request.method === "POST"
        ? await request
            .clone()
            .json()
            .catch(() => ({}))
        : {};
    const tokenRequest =
      new URL(request.url).pathname === "/api/auth/oauth2/token";
    const tokenBody = tokenRequest
      ? new URLSearchParams(await request.clone().text())
      : undefined;
    // Separate automated client scenarios into stable test IP buckets; keep rate limits enabled.
    const requestHeaders = new Headers(request.headers);
    if (!requestHeaders.has("x-forwarded-for"))
      requestHeaders.set("x-forwarded-for", `198.19.2.${clientNetwork}`);
    const response = await app.fetch(
      new Request(request, { headers: requestHeaders }),
    );
    if (isMcp) {
      const entry: (typeof traffic)[number] = {
        method: body.method ?? request.method,
        status: response.status,
        protocol:
          request.headers.get("mcp-protocol-version") ??
          body.params?.protocolVersion ??
          null,
      };
      if (body.method === "tools/list" && response.ok) {
        const text = await response.clone().text();
        const data = JSON.parse(
          text.startsWith("event:") || text.startsWith("data:")
            ? text
                .split("\n")
                .find((line) => line.startsWith("data: "))!
                .slice(6)
            : text,
        );
        entry.tools = data.result.tools
          .map((t: { name: string }) => t.name)
          .sort();
      }
      traffic.push(entry);
    }
    if (new URL(request.url).pathname === "/api/auth/oauth2/register")
      traffic.push({
        method: "register",
        status: response.status,
        protocol: null,
      });
    if (tokenRequest) {
      const data = await response.clone().json();
      traffic.push({
        method: tokenBody?.get("grant_type") ?? "token",
        status: response.status,
        protocol: null,
        scopes: data.scope?.split(" "),
        clientId: tokenBody?.get("client_id") ?? undefined,
      });
    }
    return response;
  },
});
if (!server.listening)
  await new Promise<void>((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const prefix = `narada-oauth-feasibility-${randomUUID().slice(0, 8)}`;
let runtime!:
  | Awaited<ReturnType<typeof createFeasibilityRuntime>>
  | (Runtime & { close: () => Promise<void> });
let account = {
  email: "client-test@narada.test",
  password: randomBytes(24).toString("base64url"),
};
let ownerHeaders: Headers;
let network = 100;
let codexArgs: string[] = [];
let claudeEnv: NodeJS.ProcessEnv | undefined;
const report: Record<string, unknown> = {
  productionRoutes: production,
  registration: production ? "automatic" : "owner-registered",
};

function child(command: string, args: string[], env = process.env) {
  const process = spawn(command, args, { cwd: directory, env, stdio: "pipe" });
  children.push(process);
  return process;
}
function rpc(process: ChildProcessWithoutNullStreams) {
  let id = 0;
  const waiting = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  const notifications: any[] = [];
  process.once("exit", (code) => {
    for (const waiter of waiting.values())
      waiter.reject(new Error(`Client exited (${code})`));
    waiting.clear();
  });
  createInterface({ input: process.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = waiting.get(message.id);
    if (waiter) {
      waiting.delete(message.id);
      message.error
        ? waiter.reject(new Error(JSON.stringify(message.error)))
        : waiter.resolve(message.result);
    } else notifications.push(message);
  });
  return {
    notifications,
    notify(method: string) {
      process.stdin.write(JSON.stringify({ method }) + "\n");
    },
    call(method: string, params: unknown) {
      const requestId = ++id;
      return new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiting.delete(requestId);
          reject(new Error(`Timed out: ${method}`));
        }, 25000);
        waiting.set(requestId, {
          resolve: (v) => {
            clearTimeout(timeout);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timeout);
            reject(e);
          },
        });
        process.stdin.write(
          JSON.stringify({ id: requestId, method, params }) + "\n",
        );
      });
    },
  };
}
async function consent(url: string, selected: boolean, intercept = false) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `198.19.0.${++network}` },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  let callback = "";
  const redirect = new URL(url).searchParams.get("redirect_uri")!;
  if (intercept)
    await page.route(`${redirect}**`, (route) => {
      callback = route.request().url();
      return route.fulfill({ body: "Returned to client" });
    });
  try {
    await page.goto(url);
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("heading", { name: "Connect an app" }).waitFor();
    if (selected) {
      await page.getByLabel("Choose permissions", { exact: true }).check();
      for (const scope of oauthScopes.filter(
        (s) => s.startsWith("narada:") && s !== "narada:identity:read",
      ))
        await page.locator(`[name=scope][value="${scope}"]`).uncheck();
    }
    await page
      .getByRole("button", { name: "Authorize connection", exact: true })
      .click();
    await page.waitForURL(`${redirect}**`);
    return callback;
  } catch (error) {
    const visible = (await page.locator("body").innerText())
      .replace(/https?:\/\/\S+/g, "[URL]")
      .slice(0, 800);
    throw new Error(
      `Consent failed at ${new URL(page.url()).pathname}: ${visible}`,
      { cause: error },
    );
  } finally {
    await context.close();
  }
}
async function register(label: string, redirects: string[]) {
  return runtime.auth.api.createOAuthClient({
    headers: ownerHeaders,
    body: {
      client_name: label,
      application_type: "native",
      redirect_uris: redirects,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: oauthScopes.join(" "),
    },
  });
}
async function revoke(clientId: string) {
  const consents = await runtime.auth.api.getOAuthConsents({
    headers: ownerHeaders,
  });
  for (const c of consents.filter((c) => c.clientId === clientId))
    await runtime.auth.api.deleteOAuthConsent({
      headers: ownerHeaders,
      body: { id: c.id },
    });
}

try {
  if (production) {
    Object.assign(process.env, {
      NARADA_MODE: "local",
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
      APP_TABLE: `${prefix}-app`,
      AUTH_TABLE: `${prefix}-auth`,
    });
    const r = await initialize(resolve(directory, "owner.json"));
    runtime = {
      ...r,
      close: async () => {
        for (const TableName of [r.config.APP_TABLE, r.config.AUTH_TABLE])
          await r.store.client.send(new DeleteTableCommand({ TableName }));
        r.store.client.destroy();
        r.queues.client.destroy();
      },
    };
    account = JSON.parse(
      await readFile(resolve(directory, "owner.json"), "utf8"),
    );
    app = createApp(r);
  } else {
    runtime = await createFeasibilityRuntime(
      loadConfig({
        NARADA_MODE: "local",
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
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
    ).api.signUpEmail({
      body: { ...account, name: "Client compatibility owner" },
    });
  }
  const login = await runtime.auth.handler(
    new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        origin,
        "x-forwarded-for": "198.19.0.99",
        "content-type": "application/json",
      },
      body: JSON.stringify(account),
    }),
  );
  assert.equal(login.status, 200);
  ownerHeaders = new Headers({
    origin,
    cookie: login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });

  // Short-lived tokens exercise each installed client's real refresh implementation.
  await runtime.auth.api.adminUpdateOAuthResource({
    headers: ownerHeaders,
    params: { identifier: `${origin}/api/mcp` },
    body: { accessTokenTtl: 5 },
  });

  if (process.env.NARADA_TEST_CLIENT !== "claude") {
    console.log("Testing installed Codex OAuth and MCP...");
    const client = production
      ? undefined
      : await register("Codex local compatibility", [
          "http://127.0.0.1/callback",
        ]);
    const existing = JSON.parse(
      execFileSync("codex", ["mcp", "list", "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ) as { name: string; transport: { url?: string } }[];
    // CLI overrides only: preserve the user's config and disable unrelated connections in this process.
    codexArgs = existing.flatMap((s) => [
      "-c",
      `mcp_servers.${s.name}={${s.transport.url ? `url=${JSON.stringify(s.transport.url)}` : 'command="/usr/bin/false"'},enabled=false}`,
    ]);
    codexArgs.push(
      "-c",
      `mcp_servers.${name}={url=${JSON.stringify(`${origin}/api/mcp`)},oauth={${client ? `client_id=${JSON.stringify(client.client_id)},` : ""}callback_url="http://127.0.0.1/callback"}}`,
    );
    const process = child("codex", ["app-server", ...codexArgs]);
    const api = rpc(process);
    process.stderr.resume();
    await api.call("initialize", {
      clientInfo: { name: "narada-compatibility", version: "1" },
      capabilities: { experimentalApi: true },
    });
    api.notify("initialized");
    const results = [];
    for (const selected of [false, true]) {
      clientNetwork++;
      const auth = await api.call("mcpServer/oauth/login", {
        name,
        scopes: oauthScopes,
        timeoutSecs: 45,
      });
      await consent(auth.authorizationUrl, selected);
      const deadline = Date.now() + 10000;
      while (
        !api.notifications.some(
          (n) =>
            n.method === "mcpServer/oauthLogin/completed" &&
            n.params.loginId === auth.loginId,
        ) &&
        Date.now() < deadline
      )
        await new Promise((r) => setTimeout(r, 50));
      const completed = api.notifications.find(
        (n) =>
          n.method === "mcpServer/oauthLogin/completed" &&
          n.params.loginId === auth.loginId,
      );
      assert.equal(
        completed?.params.success,
        true,
        completed?.params.error ?? "OAuth completion missing",
      );
      await api.call("config/mcpServer/reload", null);
      const status = await api.call("mcpServerStatus/list", {
        serverName: name,
      });
      const server = status.data.find((s: any) => s.name === name);
      const toolNames = Object.values(server.tools)
        .map((t: any) => t.name)
        .sort();
      assert.deepEqual(toolNames, selected ? ["whoami"] : allTools);
      const acceptedScopes = traffic.findLast(
        (t) => t.method === "authorization_code",
      )!.scopes!;
      const refreshStart = traffic.length;
      await new Promise((r) => setTimeout(r, 6100));
      const refreshedStatus = await api.call("mcpServerStatus/list", {
        serverName: name,
      });
      assert.deepEqual(
        Object.values(
          refreshedStatus.data.find((s: any) => s.name === name).tools,
        )
          .map((t: any) => t.name)
          .sort(),
        toolNames,
      );
      const refreshed = traffic
        .slice(refreshStart)
        .find((t) => t.method === "refresh_token" && t.status === 200);
      assert.deepEqual(
        refreshed?.scopes?.slice().sort(),
        acceptedScopes.slice().sort(),
      );
      results.push({
        mode: selected ? "selected" : "all",
        tools: toolNames,
        refresh: true,
        revoked: true,
      });
      await revoke(
        client?.client_id ??
          traffic.findLast((t) => t.method === "authorization_code")!.clientId!,
      );
      const revoked = await api.call("mcpServerStatus/list", {
        serverName: name,
      });
      assert.equal(
        Object.keys(revoked.data.find((s: any) => s.name === name).tools)
          .length,
        0,
      );
    }
    report.codex = {
      version: execFileSync("codex", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
      results,
    };
    process.kill();
  }

  if (process.env.NARADA_TEST_CLIENT !== "codex") {
    console.log("Testing installed Claude Code OAuth and MCP...");
    const client = production
      ? undefined
      : await register("Claude Code local compatibility", [
          "http://localhost:3247/callback",
        ]);
    const env = (claudeEnv = { ...process.env, CLAUDE_CONFIG_DIR: directory });
    await run(
      "claude",
      [
        "mcp",
        "add",
        "--scope",
        "user",
        "--transport",
        "http",
        ...(client ? ["--client-id", client.client_id] : []),
        "--callback-port",
        "3247",
        name,
        `${origin}/api/mcp`,
      ],
      { cwd: directory, env },
    );
    const results = [];
    for (const selected of [false, true]) {
      clientNetwork++;
      const proc = child(
        "python3",
        [
          "-c",
          "import os,pty,sys; sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))",
          "claude",
          "mcp",
          "login",
          name,
          "--no-browser",
        ],
        env,
      );
      let output = "";
      const authorization = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Claude authorization URL timed out")),
          25000,
        );
        proc.stdout.on("data", (chunk) => {
          output += chunk.toString();
          const match = output.match(
            /(http:\/\/127\.0\.0\.1:\d+\/api\/auth\/oauth2\/authorize\?[^\s\x1b]+)(?:\r?\n|\x1b)/,
          );
          if (match) {
            clearTimeout(timeout);
            resolve(match[1]!);
          }
        });
        proc.once("exit", (code) => {
          clearTimeout(timeout);
          if (!output.includes("/authorize?"))
            reject(
              new Error(
                `Claude login exited before authorization (${code}): ${output.replace(/https?:\/\/\S+/g, "[URL]").slice(-1500)}`,
              ),
            );
        });
      });
      proc.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });
      const callback = await consent(await authorization, selected, true);
      const finished = new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Claude callback completion timed out")),
          25000,
        );
        proc.once("exit", (code) => {
          clearTimeout(timeout);
          resolve(code);
        });
      });
      proc.stdin.write(callback + "\n");
      assert.equal(await finished, 0);
      const { stdout: status } = await run("claude", ["mcp", "get", name], {
        cwd: directory,
        env,
        encoding: "utf8",
        timeout: 20000,
      });
      assert.match(status, /Connected/);
      const toolNames = traffic.findLast(
        (t) => t.method === "tools/list",
      )?.tools;
      assert.deepEqual(toolNames, selected ? ["whoami"] : allTools);
      const acceptedScopes = traffic.findLast(
        (t) => t.method === "authorization_code",
      )!.scopes!;
      const refreshStart = traffic.length;
      await new Promise((r) => setTimeout(r, 6100));
      const { stdout: refreshedStatus } = await run(
        "claude",
        ["mcp", "get", name],
        { cwd: directory, env, encoding: "utf8", timeout: 20000 },
      );
      assert.match(refreshedStatus, /Connected/);
      const refreshed = traffic
        .slice(refreshStart)
        .find((t) => t.method === "refresh_token" && t.status === 200);
      assert.deepEqual(
        refreshed?.scopes?.slice().sort(),
        acceptedScopes.slice().sort(),
      );
      results.push({
        mode: selected ? "selected" : "all",
        tools: toolNames,
        refresh: true,
        revoked: true,
      });
      await revoke(
        client?.client_id ??
          traffic.findLast((t) => t.method === "authorization_code")!.clientId!,
      );
      const { stdout: revokedStatus } = await run(
        "claude",
        ["mcp", "get", name],
        { cwd: directory, env, encoding: "utf8", timeout: 20000 },
      );
      assert.doesNotMatch(revokedStatus, /Connected/);
      assert.equal(
        traffic.findLast((t) => t.method === "initialize")?.status,
        401,
      );
      await run("claude", ["mcp", "logout", name], { cwd: directory, env });
    }
    report.claude = {
      version: execFileSync("claude", ["--version"], {
        encoding: "utf8",
      }).trim(),
      results,
    };
  }
  if (production)
    assert(
      traffic.filter((t) => t.method === "register" && t.status === 201)
        .length >= (process.env.NARADA_TEST_CLIENT ? 1 : 2),
    );
  console.log(JSON.stringify(report, null, 2));
  await writeFile(
    resolve(
      production
        ? ".local/mcp-production-client-results.json"
        : ".local/oauth-client-results.json",
    ),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        success: true,
        ...report,
        traffic,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    resolve(
      production
        ? ".local/mcp-production-client-results.json"
        : ".local/oauth-client-results.json",
    ),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        success: false,
        ...report,
        traffic,
      },
      null,
      2,
    ),
  );
  console.error(
    JSON.stringify({ compatibilityFailed: true, traffic }, null, 2),
  );
  throw error;
} finally {
  for (const process of children) process.kill();
  if (codexArgs.length)
    try {
      execFileSync("codex", ["mcp", "logout", name, ...codexArgs], {
        stdio: "ignore",
      });
    } catch {}
  if (claudeEnv)
    try {
      await run("claude", ["mcp", "logout", name], {
        cwd: directory,
        env: claudeEnv,
        timeout: 10000,
      });
    } catch {}
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  await runtime?.close();
  await rm(directory, { recursive: true, force: true });
}
