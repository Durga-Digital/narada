// Opt-in hosted verification. Requires an explicit stage and uses isolated test drafts.
import assert from "node:assert/strict";
import {
  approvalScopes,
  hostedApprovals,
  toolValue,
} from "./hosted-approvals.js";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  spawn,
  execFile,
  execFileSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { chromium } from "@playwright/test";
import { deploymentConfig } from "./deployment-config.js";
import { oauthScopes, mcpOperations, mcpToolName } from "@narada/contracts/mcp";

const { values } = parseArgs({
  options: {
    stage: { type: "string" },
    approvals: { type: "boolean", default: false },
    "allow-production-approval-tests": { type: "boolean", default: false },
    client: { type: "string", default: "both" },
  },
  strict: true,
});
assert(values.stage, "Pass --stage staging or --stage production explicitly");
const target = deploymentConfig({ stage: values.stage }, process.env);
assert(["both", "codex", "claude"].includes(values.client!));
const stage = target.stage;
if (values.approvals)
  assert(
    stage === "staging" || values["allow-production-approval-tests"],
    "Production simulator sends require --allow-production-approval-tests",
  );
let approvalChecks: ReturnType<typeof hostedApprovals> | undefined;
const suffix = `${target.account}-${target.region}-${stage}`;
const outputs = JSON.parse(
  await readFile(`.local/deploy-${suffix}.json`, "utf8"),
)[`Narada-${stage}`];
const origin = new URL(outputs.Url).origin;
assert(origin.startsWith("https://"));
const owner = JSON.parse(
  await readFile(`.local/aws-owner-${suffix}.json`, "utf8"),
);
assert.equal(owner.email, target.ownerEmail);
await mkdir(".local", { recursive: true });
const directory = await mkdtemp(resolve(`.local/mcp-${stage}-`));
const name = `narada-${stage}-${randomUUID().slice(0, 8)}`;
const reportPath = `.local/mcp-${stage}-${name}.json`;
const report: any = {
  origin,
  stage,
  startedAt: new Date().toISOString(),
  checks: [],
  clientSelection: values.client,
  clients: {},
  fixtures: [],
  cleanup: [],
};
const run = promisify(execFile),
  children: ChildProcessWithoutNullStreams[] = [];
const clients = new Map<string, string>();
const clientScopes = new Map<string, string[]>();
let cookie = "",
  codexArgs: string[] = [],
  claudeEnv: NodeJS.ProcessEnv | undefined;
let allowed: any, excluded: any, domain: string;
const selectedScopes = [
  "openid",
  "offline_access",
  "narada:identity:read",
  "narada:capabilities:read",
  "narada:forms:read",
  "narada:publications:read",
  "narada:publications:write",
  "narada:issues:read",
  "narada:issues:write",
];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function save() {
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
}
async function pass(check: string) {
  report.checks.push(check);
  console.log("PASS", check);
  await save();
}
async function request(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined
        ? {}
        : {
            "content-type": "application/json",
            "idempotency-key": randomUUID(),
          }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  return r;
}
async function json(path: string, body?: unknown, method?: string) {
  const r = await request(path, body, method);
  assert(
    r.ok,
    `${method ?? "request"} ${path} status ${r.status}: ${(await r.clone().text()).slice(0, 300)}`,
  );
  return r.json();
}
async function connection(clientId: string) {
  const page = await context.newPage();
  try {
    await page.goto(origin + "/oauth/connections");
    for (let i = 0; i < 20; i++) {
      const article = page
        .locator("article")
        .filter({ has: page.locator("code", { hasText: clientId }) });
      if (await article.count()) {
        if (!(await article.locator("[data-revoke]").count())) return null;
        const reference = await article
          .locator("[data-revoke]")
          .getAttribute("data-revoke");
        return reference;
      }
      const next = page.getByRole("link", { name: "Next page", exact: true });
      if (!(await next.count())) return null;
      await next.click();
    }
    throw Error("Connection inventory exceeded test bound");
  } finally {
    await page.close();
  }
}
async function connectionCard(
  page: import("@playwright/test").Page,
  clientId: string,
) {
  await page.goto(origin + "/?page=profile");
  const card = page
    .getByRole("article")
    .filter({ hasText: `Client ID: ${clientId}` });
  for (let i = 0; i < 50; i++) {
    await page
      .getByRole("button", { name: "Refresh apps", exact: true })
      .waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent?.includes("Refresh apps") && !b.disabled,
      ),
    );
    if (await card.count()) return card;
    const next = page.getByRole("button", { name: "Next apps", exact: true });
    assert(
      (await next.count()) && (await next.isEnabled()),
      "Connected app must be visible in the dashboard",
    );
    await next.click();
  }
  throw Error("Connection inventory exceeded test bound");
}
async function revoke(clientId: string, dashboard = true) {
  const reference = await connection(clientId);
  if (!reference) return;
  if (!dashboard) {
    await json(`/oauth/connections/${reference}/revoke`, {});
    return;
  }
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const card = await connectionCard(page, clientId);
    await card.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Disconnect app", exact: true })
      .click();
    await card.getByText("Disconnected", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("page"), "profile");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await pass(
      "Connected Apps: in-dashboard mobile disconnect persisted without leaving Profile",
    );
  } finally {
    await page.close();
  }
}
async function consent(
  url: string,
  selected: boolean,
  intercept = false,
  approvalMode = false,
) {
  assert.equal(new URL(url).origin, origin);
  const params = new URL(url).searchParams,
    clientId = params.get("client_id")!,
    redirect = params.get("redirect_uri")!;
  clients.set(clientId, redirect);
  clientScopes.set(
    clientId,
    (params.get("scope") ?? oauthScopes.join(" ")).split(" "),
  );
  await save();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  let callback = "";
  if (intercept)
    await page.route(`${redirect}**`, async (route) => {
      callback = route.request().url();
      await route.fulfill({ body: "Returned to client" });
    });
  try {
    await page.goto(url);
    await page
      .getByRole("heading", { name: "Connect an app", exact: true })
      .waitFor();
    if (selected) {
      await page.getByLabel("Choose permissions", { exact: true }).check();
      for (const scope of oauthScopes.filter(
        (s) => !(approvalMode ? approvalScopes : selectedScopes).includes(s),
      )) {
        const checkbox = page.locator(`[name=scope][value="${scope}"]`);
        if (await checkbox.count()) await checkbox.uncheck();
      }
      for (const [dimension, id, label] of [
        ...(!approvalMode
          ? [["publicationIds", allowed.id, "publications"]]
          : []),
        ["senderDomains", domain, "domains"],
      ]) {
        const field = page.locator(`[data-dimension=${dimension}]`);
        await field.getByLabel(`Selected ${label}`, { exact: true }).check();
        for (
          let i = 0;
          i < 20 && !(await field.locator(`input[value="${id}"]`).count());
          i++
        ) {
          const button = field.locator("[data-more]");
          await button.click();
          await page.waitForFunction(
            (key) =>
              !document
                .querySelector(`[data-dimension=${key}] [data-more]`)
                ?.hasAttribute("disabled"),
            dimension,
          );
        }
        await field.locator(`input[value="${id}"]`).check();
      }
    }
    const consentResponse = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/oauth/consent" &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Authorize connection", exact: true })
      .click();
    const accepted = await consentResponse;
    if (!accepted.ok())
      throw new Error(
        `Consent POST ${accepted.status()}: ${(await accepted.text()).slice(0, 400)}`,
      );
    await page.waitForURL(`${redirect}**`);
    return { clientId, callback, redirect };
  } catch (error) {
    const failedQuery = new URL(page.url()).searchParams;
    const diagnostic = {
      clientPresent: !!failedQuery.get("client_id"),
      unsupportedScopes: (failedQuery.get("scope") ?? "")
        .split(" ")
        .filter((s) => s && !oauthScopes.includes(s)),
      resources: failedQuery.getAll("resource"),
    };
    throw new Error(
      `Consent parameters ${JSON.stringify(diagnostic)}. Consent failed (${error instanceof Error ? error.message.split("\n")[0] : "unknown"}); alert: ${await page
        .locator("#error")
        .textContent()
        .catch(
          () => "",
        )}; at ${new URL(page.url()).pathname}: ${(await page.locator("body").innerText()).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 600)}`,
      { cause: error },
    );
  } finally {
    await page.close();
  }
}
function child(command: string, args: string[], env = process.env) {
  const proc = spawn(command, args, { cwd: directory, env, stdio: "pipe" });
  children.push(proc);
  return proc;
}
function rpc(proc: ChildProcessWithoutNullStreams) {
  let id = 0;
  const pending = new Map<number, any>(),
    notifications: any[] = [];
  createInterface({ input: proc.stdout }).on("line", (line) => {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(data.id);
    if (waiter) {
      pending.delete(data.id);
      data.error
        ? waiter.reject(Error(JSON.stringify(data.error)))
        : waiter.resolve(data.result);
    } else notifications.push(data);
  });
  proc.on("exit", () => {
    for (const waiter of pending.values())
      waiter.reject(Error("Client exited"));
    pending.clear();
  });
  return {
    notifications,
    notify: (method: string) =>
      proc.stdin.write(JSON.stringify({ method }) + "\n"),
    call: (method: string, params: unknown) =>
      new Promise<any>((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(Error(`Timeout: ${method}`));
        }, 45000);
        pending.set(requestId, {
          resolve: (v: any) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e: Error) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        proc.stdin.write(
          JSON.stringify({ id: requestId, method, params }) + "\n",
        );
      }),
  };
}
async function checkResources(
  call: (name: string, args?: any) => Promise<any>,
) {
  const value = (r: any) => {
    assert(!r.isError, JSON.stringify(r));
    return r.structuredContent ?? JSON.parse(r.content[0].text);
  };
  const guide = value(await call("integration_guide", {}));
  assert.equal(guide.mcpUrl, origin + "/api/mcp");
  assert.match(
    guide.markdown,
    /MCP cannot create, retrieve or approve credentials/,
  );
  const matches = value(
    await call("resources_search", {
      query: { kind: "publications", text: name },
    }),
  );
  assert.deepEqual(
    matches.data.map((r: any) => r.id),
    [allowed.id],
  );
  const hidden = await call("resources_search", {
    query: { kind: "domains", text: domain },
  });
  assert(hidden.isError);
  assert.equal(JSON.parse(hidden.content[0].text).status, 403);
  const forms = value(await call("forms_list", {}));
  assert.deepEqual(
    forms.data.map((r: any) => r.id),
    [allowed.formId],
  );
  assert.equal(
    value(await call("forms_get", { params: { id: allowed.formId } })).id,
    allowed.formId,
  );
  assert.deepEqual(
    value(await call("publications_list", {})).data.map((r: any) => r.id),
    [allowed.id],
  );
  for (const [tool, args] of [
    ["forms_get", { params: { id: excluded.formId } }],
    ["publications_get", { params: { id: excluded.id } }],
    ["issues_list", { params: { id: excluded.id } }],
  ] as const) {
    const denied = await call(tool, args);
    assert(denied.isError);
    assert.equal(JSON.parse(denied.content[0].text).status, 403);
  }
  const current = value(
    await call("publications_get", { params: { id: allowed.id } }),
  );
  const args = {
    params: { id: allowed.id },
    body: {
      revision: current.revision,
      settings: {
        ...current.settings,
        name: `${name} allowed ${randomUUID().slice(0, 6)}`,
      },
    },
    idempotencyKey: randomUUID(),
  };
  const created = value(await call("publications_update", args));
  assert.deepEqual(value(await call("publications_update", args)), created);
  const senderDenied = await call("publications_update", {
    ...args,
    body: {
      revision: created.revision,
      settings: { ...created.settings, from: "outside@example.invalid" },
    },
    idempotencyKey: randomUUID(),
  });
  assert(senderDenied.isError);
  assert.equal(JSON.parse(senderDenied.content[0].text).status, 403);

  const denied = await call("issues_publish", {
    params: { id: allowed.id, issueId: created.id },
    body: { revision: created.revision, channels: "email", confirmed: true },
    idempotencyKey: randomUUID(),
  }).catch(() => ({ isError: true }));
  assert(denied.isError);
  return created.id;
}
async function rawFlow(clientId: string, label: string) {
  const requested = clientScopes.get(clientId) ?? oauthScopes;
  const expectedScopes = selectedScopes.filter((s) => requested.includes(s));
  const redirect = clients.get(clientId)!,
    verifier = randomBytes(32).toString("base64url");
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: requested.join(" "),
    state: randomUUID(),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: origin + "/api/mcp",
  });
  const flow = await consent(
    origin + "/api/auth/oauth2/authorize?" + q,
    true,
    true,
  );
  const exchange = async (body: Record<string, string>) =>
    fetch(origin + "/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(30000),
    });
  const tokenResponse = await exchange({
    grant_type: "authorization_code",
    client_id: clientId,
    code: new URL(flow.callback).searchParams.get("code")!,
    code_verifier: verifier,
    redirect_uri: redirect,
    resource: origin + "/api/mcp",
  });
  assert.equal(tokenResponse.status, 200);
  let tokens = await tokenResponse.json();
  assert.deepEqual(
    tokens.scope.split(" ").sort(),
    expectedScopes.slice().sort(),
  );
  const oldAccess = tokens.access_token,
    oldRefresh = tokens.refresh_token;
  async function mcp(access: string, method: string, params: any = {}) {
    const r = await fetch(origin + "/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(30000),
    });
    assert(r.headers.get("via")?.includes("cloudfront"));
    assert.equal(r.headers.get("cache-control"), "no-store");
    const text = await r.text();
    const data = JSON.parse(
      text.startsWith("event:") || text.startsWith("data:")
        ? text
            .split("\n")
            .find((l) => l.startsWith("data: "))!
            .slice(6)
        : text,
    );
    return { r, data };
  }
  const call = async (name: string, args: any = {}) => {
    const { r, data } = await mcp(tokens.access_token, "tools/call", {
      name,
      arguments: args,
    });
    assert.equal(r.status, 200);
    return data.result ?? { isError: true };
  };
  const guideResource = await mcp(tokens.access_token, "resources/read", {
    uri: "narada://guides/project-integration",
  });
  assert.equal(guideResource.r.status, 200);
  assert.match(
    guideResource.data.result.contents[0].text,
    /owner creates a Sending API key/,
  );
  const prompt = await mcp(tokens.access_token, "prompts/get", {
    name: "migrate_from_resend",
  });
  assert.equal(prompt.r.status, 200);
  assert.match(
    prompt.data.result.messages[0].content.text,
    /Preserve Resend's records/,
  );
  await checkResources(call);
  await pass(
    label + ": onboarding guide/resource/prompt and restricted resource search",
  );
  await pass(
    label +
      ": HTTPS lists, direct IDs, selected resources, draft mutation/replay and omitted send denied",
  );
  const refreshed = await exchange({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: tokens.refresh_token,
    resource: origin + "/api/mcp",
  });
  assert.equal(refreshed.status, 200);
  tokens = await refreshed.json();
  assert.deepEqual(
    tokens.scope.split(" ").sort(),
    expectedScopes.slice().sort(),
  );
  assert.deepEqual(
    (await call("forms_list")).structuredContent.data.map((r: any) => r.id),
    [allowed.formId],
  );
  await pass(
    label + ": refresh preserves selected scopes and resource restrictions",
  );
  const reference = await connection(clientId);
  assert(reference);
  const manage = await context.newPage();
  try {
    const card = await connectionCard(manage, clientId);
    await card
      .getByRole("button", { name: "Manage access", exact: true })
      .click();
    const dialog = manage.getByRole("dialog");
    await dialog
      .getByLabel("Create and edit issues", { exact: true })
      .uncheck();
    const forms = dialog.getByRole("group", { name: "forms", exact: true });
    await forms.getByLabel("Selected forms", { exact: true }).check();
    const allowedForm = await json(`/api/admin/forms/${allowed.formId}`);
    const choice = forms.getByLabel(allowedForm.draft.name, { exact: true });
    for (let n = 0; n < 50; n++) {
      await forms
        .getByRole("status")
        .filter({ hasText: "Loading forms" })
        .waitFor({ state: "hidden" });
      if (await choice.count()) break;
      const more = forms.getByRole("button", {
        name: "Load more forms",
        exact: true,
      });
      assert(
        await more.count(),
        "Allowed form must be available in the native resource picker",
      );
      await more.click();
    }
    await choice.check();
    await dialog
      .getByRole("button", { name: "Save access", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(new URL(manage.url()).searchParams.get("page"), "profile");
    await pass(
      label +
        ": Connected Apps reduces scopes and preserves selected resources inside Profile",
    );
  } finally {
    await manage.close();
  }
  const list = await mcp(tokens.access_token, "tools/list");
  assert(!list.data.result.tools.some((t: any) => t.name === "issues_create"));
  assert(
    !list.data.result.tools.some((t: any) => t.name === "publications_list"),
  );
  assert.deepEqual(
    (await call("forms_list")).structuredContent.data.map((r: any) => r.id),
    [allowed.formId],
  );
  const excludedForm = await call("forms_get", {
    params: { id: excluded.formId },
  });
  assert(excludedForm.isError);
  await pass(
    label +
      ": live scope/form restrictions apply to existing JWT; unsupported publication/form combination fails closed",
  );
  await revoke(clientId);
  assert.equal((await mcp(tokens.access_token, "tools/list")).r.status, 401);
  assert.equal((await mcp(oldAccess, "tools/list")).r.status, 401);
  assert.equal(
    (
      await exchange({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: tokens.refresh_token,
        resource: origin + "/api/mcp",
      })
    ).status,
    400,
  );
  // A new accepted generation must never reactivate either old token family.
  const nextVerifier = randomBytes(32).toString("base64url");
  q.set(
    "code_challenge",
    createHash("sha256").update(nextVerifier).digest("base64url"),
  );
  q.set("state", randomUUID());
  await consent(origin + "/api/auth/oauth2/authorize?" + q, true, true);
  assert.equal((await mcp(oldAccess, "tools/list")).r.status, 401);
  assert.equal(
    (
      await exchange({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: oldRefresh,
        resource: origin + "/api/mcp",
      })
    ).status,
    400,
  );
  await revoke(clientId);
  await pass(label + ": access/refresh revocation persists across reconnect");
}

async function rawApprovalFlow(
  clientId: string,
  label: string,
  earlierPending?: string,
) {
  assert(approvalChecks);
  const redirect = clients.get(clientId)!;
  const requestedApprovalScopes = approvalScopes.filter((s) =>
    (clientScopes.get(clientId) ?? oauthScopes).includes(s),
  );
  async function authorize() {
    const verifier = randomBytes(32).toString("base64url");
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: requestedApprovalScopes.join(" "),
      state: randomUUID(),
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource: origin + "/api/mcp",
    });
    const flow = await consent(
      origin + "/api/auth/oauth2/authorize?" + q,
      true,
      true,
      true,
    );
    const response = await token({
      grant_type: "authorization_code",
      client_id: clientId,
      code: new URL(flow.callback).searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: redirect,
      resource: origin + "/api/mcp",
    });
    assert.equal(response.status, 200);
    const tokens = await response.json();
    assert.deepEqual(
      tokens.scope.split(" ").sort(),
      [...requestedApprovalScopes].sort(),
    );
    return tokens;
  }
  async function token(body: Record<string, string>) {
    return fetch(origin + "/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(30000),
    });
  }
  async function mcp(access: string, method: string, params: any = {}) {
    const r = await fetch(origin + "/api/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${access}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(30000),
    });
    assert(r.headers.get("via")?.includes("cloudfront"));
    assert.equal(r.headers.get("cache-control"), "no-store");
    const text = await r.text();
    return {
      r,
      data: JSON.parse(
        text.startsWith("event:") || text.startsWith("data:")
          ? text
              .split("\n")
              .find((l) => l.startsWith("data: "))!
              .slice(6)
          : text,
      ),
    };
  }
  const tokens = await authorize();
  if (earlierPending)
    await approvalChecks.assertRevoked(
      earlierPending,
      label + " after reconnect",
    );
  const call = async (name: string, args: any = {}) => {
    const { r, data } = await mcp(tokens.access_token, "tools/call", {
      name,
      arguments: args,
    });
    assert.equal(r.status, 200);
    assert(data.result);
    return data.result;
  };
  const tools = (
    await mcp(tokens.access_token, "tools/list")
  ).data.result.tools.map((v: any) => v.name);
  assert(tools.includes("emails_send") && tools.includes("approvals_request"));
  assert(
    !tools.includes("broadcasts_send") && !tools.includes("sending_update"),
  );
  const outside = await call("approvals_request", {
    body: {
      operation: "emails.send",
      input: {
        body: {
          from: "outside@example.invalid",
          to: "success@simulator.amazonses.com",
          subject: "Denied",
          text: "Denied",
        },
      },
    },
    idempotencyKey: randomUUID(),
  });
  assert(outside.isError);
  assert.equal(JSON.parse(outside.content[0].text).status, 403);
  const pending = await approvalChecks.exercise(call, label);
  const refresh = await token({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: tokens.refresh_token,
    resource: origin + "/api/mcp",
  });
  assert.equal(refresh.status, 200);
  const refreshed = await refresh.json();
  assert.deepEqual(
    refreshed.scope.split(" ").sort(),
    [...requestedApprovalScopes].sort(),
  );
  assert.equal(
    toolValue(
      (
        await mcp(refreshed.access_token, "tools/call", {
          name: "approvals_get",
          arguments: { params: { id: pending } },
        })
      ).data.result,
    ).id,
    pending,
  );
  await revoke(clientId);
  for (const access of [tokens.access_token, refreshed.access_token])
    assert.equal((await mcp(access, "tools/list")).r.status, 401);
  await approvalChecks.assertRevoked(pending, label);
  await authorize();
  await approvalChecks.assertRevoked(pending, label + " after reconnect");
  assert.equal((await mcp(tokens.access_token, "tools/list")).r.status, 401);
  assert.equal(
    (
      await token({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshed.refresh_token,
        resource: origin + "/api/mcp",
      })
    ).status,
    400,
  );
  await revoke(clientId);
  await pass(
    label +
      ": selected send scopes/domain restrictions, refresh and revoked tokens/approvals remain invalid after reconnect",
  );
}

try {
  for (const path of [
    "/.well-known/oauth-protected-resource/api/mcp",
    "/.well-known/oauth-authorization-server/api/auth",
  ]) {
    const r = await request(path);
    assert.equal(r.status, 200);
    assert(r.headers.get("via")?.includes("cloudfront"));
    const data = await r.json();
    if (data.resource) assert.equal(data.resource, origin + "/api/mcp");
    else assert.equal(data.issuer, origin + "/api/auth");
    assert(!/Hit from cloudfront/i.test(r.headers.get("x-cache") ?? ""));
  }
  const anonymous = await request("/api/mcp", {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });
  assert.equal(anonymous.status, 401);
  assert(
    anonymous.headers
      .get("www-authenticate")
      ?.includes(origin + "/.well-known/oauth-protected-resource/api/mcp"),
  );
  await pass(
    "CloudFront HTTPS discovery, issuer/resource binding and challenge",
  );
  const login = await request("/api/auth/sign-in/email", owner);
  assert.equal(login.status, 200);
  const loginData = await login.json();
  assert(
    !loginData.twoFactorRedirect,
    "Owner MFA requires interactive completion",
  );
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert(cookie);
  assert(
    login.headers
      .getSetCookie()
      .some(
        (c) =>
          c.includes("session_token") &&
          c.includes("Secure") &&
          c.includes("HttpOnly"),
      ),
  );
  await context.addCookies(
    cookie.split("; ").map((c) => {
      const i = c.indexOf("=");
      return {
        name: c.slice(0, i),
        value: c.slice(i + 1),
        url: origin,
        secure: true,
        httpOnly: true,
        sameSite: "Lax" as const,
      };
    }),
  );
  const domains = await json("/api/admin/domains");
  domain = domains.find((d: any) => d.verified && !d.removedAt)?.name;
  assert(
    domain,
    `${stage} requires an existing verified domain for isolated drafts`,
  );
  for (const label of ["allowed", "excluded"]) {
    const pub = await json("/api/admin/publications", {
      name: `${name} ${label}`,
      slug: `${name}-${label}`,
      from: `MCP verification <hello@${domain}>`,
      organization: `Narada ${stage} verification`,
      postalAddress: "Private test fixture",
    });
    report.fixtures.push({ id: pub.id, formId: pub.formId, label });
    if (label === "allowed") allowed = pub;
    else excluded = pub;
    await save();
  }
  await pass("Isolated private draft publications created");
  if (values.approvals) {
    approvalChecks = hostedApprovals({
      allowProduction: values["allow-production-approval-tests"],
      stage,
      origin,
      name,
      domain,
      context,
      report,
      pass,
      json,
      request,
    });
    if (values.client === "both") {
      await approvalChecks.apiKeys();
      await approvalChecks.sdk();
    }
  }
  if (values.client !== "claude") {
    const existing = JSON.parse(
      execFileSync("codex", ["mcp", "list", "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    codexArgs = existing.flatMap((s: any) => [
      "-c",
      `mcp_servers.${s.name}={${s.transport.url ? `url=${JSON.stringify(s.transport.url)}` : 'command="/usr/bin/false"'},enabled=false}`,
    ]);
    codexArgs.push(
      "-c",
      `mcp_servers.${name}={url=${JSON.stringify(origin + "/api/mcp")},oauth={callback_url="http://127.0.0.1/callback"}}`,
    );
    const codex = child("codex", ["app-server", ...codexArgs]);
    codex.stderr.resume();
    const api = rpc(codex);
    await api.call("initialize", {
      clientInfo: { name: `narada-${stage}-verification`, version: "1" },
      capabilities: { experimentalApi: true },
    });
    api.notify("initialized");
    report.clients.codex = {
      version: execFileSync("codex", ["--version"], {
        encoding: "utf8",
      }).trim(),
      modes: [],
    };
    for (const selected of [false, true]) {
      const auth = await api.call("mcpServer/oauth/login", {
        name,
        scopes: oauthScopes,
        timeoutSecs: 120,
      });
      const flow = await consent(auth.authorizationUrl, selected);
      for (
        let n = 0;
        n < 200 &&
        !api.notifications.some(
          (v) =>
            v.method === "mcpServer/oauthLogin/completed" &&
            v.params.loginId === auth.loginId,
        );
        n++
      )
        await pause(50);
      assert(
        api.notifications.some(
          (v) =>
            v.method === "mcpServer/oauthLogin/completed" &&
            v.params.loginId === auth.loginId &&
            v.params.success,
        ),
      );
      await api.call("config/mcpServer/reload", null);
      const status = await api.call("mcpServerStatus/list", {
        serverName: name,
      });
      const tools = Object.values(
        status.data.find((s: any) => s.name === name).tools,
      ).map((t: any) => t.name);
      assert(tools.includes("forms_list"));
      if (!selected) assert.equal(tools.length, mcpOperations.length);
      else {
        assert(!tools.includes("issues_publish"));
        assert(!tools.includes("forms_create"));
      }
      if (!selected) {
        assert(tools.includes("domains_create"));
        assert(tools.includes("domains_mailFrom_update"));
        assert(tools.includes("domains_dkim_enable"));
        assert(
          !tools.some((tool: string) => /keys.*create|credentials/.test(tool)),
        );
        const thread = await api.call("thread/start", {
          cwd: directory,
          ephemeral: true,
        });
        const guide = toolValue(
          await api.call("mcpServer/tool/call", {
            threadId: thread.thread.id,
            server: name,
            tool: "integration_guide",
            arguments: {},
          }),
        );
        assert.equal(guide.mcpUrl, origin + "/api/mcp");
        const diagnostic = toolValue(
          await api.call("mcpServer/tool/call", {
            threadId: thread.thread.id,
            server: name,
            tool: "domains_get",
            arguments: { params: { name: domain } },
          }),
        );
        assert.equal(diagnostic.name, domain);
        assert.equal(typeof diagnostic.revision, "number");
        assert(Array.isArray(diagnostic.records));
        await pass(
          "Codex: native onboarding guide, sender DNS diagnostics and explicit setup-tool discovery",
        );
      }
      if (selected) {
        const thread = await api.call("thread/start", {
          cwd: directory,
          ephemeral: true,
        });
        await checkResources((tool, args) =>
          api.call("mcpServer/tool/call", {
            threadId: thread.thread.id,
            server: name,
            tool,
            arguments: args,
          }),
        );
        await pass(
          "Codex: real MCP tool calls enforce selected resources and retry keys",
        );
      }
      await revoke(flow.clientId);
      const revoked = await api.call("mcpServerStatus/list", {
        serverName: name,
      });
      assert.equal(
        Object.keys(revoked.data.find((s: any) => s.name === name).tools)
          .length,
        0,
      );
      report.clients.codex.modes.push({
        selected,
        toolCount: tools.length,
        revoked: true,
      });
      await pass(
        `Codex: ${selected ? "selected" : "all"} consent and revocation over HTTPS`,
      );
      if (selected) await rawFlow(flow.clientId, "Codex grant protocol checks");
    }
    if (approvalChecks) {
      const auth = await api.call("mcpServer/oauth/login", {
        name,
        scopes: approvalScopes,
        timeoutSecs: 120,
      });
      const flow = await consent(auth.authorizationUrl, true, false, true);
      for (
        let n = 0;
        n < 200 &&
        !api.notifications.some(
          (v) =>
            v.method === "mcpServer/oauthLogin/completed" &&
            v.params.loginId === auth.loginId &&
            v.params.success,
        );
        n++
      )
        await pause(50);
      await api.call("config/mcpServer/reload", null);
      const thread = await api.call("thread/start", {
        cwd: directory,
        ephemeral: true,
      });
      const pending = await approvalChecks.exercise(
        (tool, args) =>
          api.call("mcpServer/tool/call", {
            threadId: thread.thread.id,
            server: name,
            tool,
            arguments: args,
          }),
        "Codex native MCP approval",
      );
      await revoke(flow.clientId);
      await approvalChecks.assertRevoked(pending, "Codex native MCP");
      await rawApprovalFlow(flow.clientId, "Codex grant protocol", pending);
    }
    codex.kill();
  }
  if (values.client !== "codex") {
    claudeEnv = { ...process.env, CLAUDE_CONFIG_DIR: directory };
    await run(
      "claude",
      [
        "mcp",
        "add",
        "--scope",
        "user",
        "--transport",
        "http",
        "--callback-port",
        "3247",
        name,
        origin + "/api/mcp",
      ],
      { cwd: directory, env: claudeEnv },
    );
    report.clients.claude = {
      version: execFileSync("claude", ["--version"], {
        encoding: "utf8",
      }).trim(),
      modes: [],
    };
    for (const mode of values.approvals
      ? ["all", "selected", "approval"]
      : ["all", "selected"]) {
      const selected = mode !== "all";
      const proc = child(
        "python3",
        [
          "-c",
          "import os,pty,sys,select,time,signal\npid,fd=pty.fork()\nif pid==0:\n    os.execvp(sys.argv[1],sys.argv[1:])\ndeadline=time.monotonic()+180\nwhile True:\n    done,status=os.waitpid(pid,os.WNOHANG)\n    if done:\n        sys.exit(os.waitstatus_to_exitcode(status))\n    if time.monotonic()>deadline:\n        os.kill(pid,signal.SIGTERM)\n        sys.exit(124)\n    readable,_,_=select.select([fd,sys.stdin.fileno()],[],[],0.2)\n    for source in readable:\n        try:\n            data=os.read(source,65536)\n            if data: os.write(sys.stdout.fileno() if source==fd else fd,data)\n        except OSError:\n            pass\n",
          "claude",
          "mcp",
          "login",
          name,
          "--no-browser",
        ],
        claudeEnv,
      );
      const finished = new Promise<number | null>((resolve) =>
        proc.once("exit", resolve),
      );
      let output = "";
      const authorization = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Claude authorization timed out")),
          45000,
        );
        proc.stdout.on("data", (chunk) => {
          output += chunk.toString();
          const match = output.match(
            /(https:\/\/[^\s\x1b]+\/api\/auth\/oauth2\/authorize\?[^\s\x1b]+)(?:\r?\n|\x1b)/,
          );
          if (match) {
            clearTimeout(timer);
            resolve(match[1]!);
          }
        });
        proc.once("exit", (code) => {
          clearTimeout(timer);
          if (!output.includes("/authorize?"))
            reject(
              Error(
                `Claude authorization failed (${code}): ${output.replace(/https?:\/\/\S+/g, "[URL]").slice(-600)}`,
              ),
            );
        });
      });
      proc.stderr.resume();
      const flow = await consent(
        await authorization,
        selected,
        true,
        mode === "approval",
      );
      proc.stdin.write(flow.callback + "\n");
      assert.equal(await finished, 0);
      const status = await run("claude", ["mcp", "get", name], {
        cwd: directory,
        env: claudeEnv,
        timeout: 45000,
      });
      assert.match(status.stdout, /Connected/);
      if (mode === "approval")
        await rawApprovalFlow(flow.clientId, "Claude Code grant protocol");
      await revoke(flow.clientId);
      const revoked = await run("claude", ["mcp", "get", name], {
        cwd: directory,
        env: claudeEnv,
        timeout: 45000,
      });
      assert.doesNotMatch(revoked.stdout, /Connected/);
      report.clients.claude.modes.push({
        selected,
        mode,
        connected: true,
        revoked: true,
      });
      await pass(`Claude Code: ${mode} consent and revocation over HTTPS`);
      if (mode === "selected")
        await rawFlow(flow.clientId, "Claude grant protocol checks");
      await run("claude", ["mcp", "logout", name], {
        cwd: directory,
        env: claudeEnv,
      });
    }
  }
  if (approvalChecks)
    await approvalChecks.audit(
      outputs.ApplicationTable,
      target.profile,
      target.region,
    );
  report.success = true;
} catch (error) {
  report.success = false;
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  for (const proc of children) proc.kill();
  if (approvalChecks) await approvalChecks.cleanup();
  for (const clientId of clients.keys())
    try {
      await revoke(clientId, false);
      report.cleanup.push({ clientId, revoked: true });
    } catch {
      report.cleanup.push({ clientId, revoked: false });
    }
  for (const fixture of report.fixtures)
    try {
      const pub = await json(`/api/admin/publications/${fixture.id}`);
      if (pub.status !== "archived")
        await json(`/api/admin/publications/${fixture.id}/archive`, {
          revision: pub.revision,
        });
      report.cleanup.push({ publicationId: fixture.id, archived: true });
    } catch {
      report.cleanup.push({ publicationId: fixture.id, archived: false });
    }
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
  if (cookie)
    try {
      await json("/api/auth/sign-out", {});
    } catch {}
  await browser.close();
  await rm(directory, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await save();
  if (
    report.cleanup.some(
      (entry: any) =>
        entry.revoked === false ||
        entry.archived === false ||
        entry.rejected === false,
    )
  ) {
    report.success = false;
    report.error ??=
      "Hosted verification cleanup incomplete; inspect report fixture IDs";
    process.exitCode = 1;
    await save();
  }
  console.log(`${stage} MCP report: ${reportPath}`);
}
