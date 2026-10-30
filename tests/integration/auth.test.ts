import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { GrantStore } from "@narada/core/oauth-grants";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { createAuth } from "@narada/core/auth";
let app: ReturnType<typeof createApp>;
let owner: { email: string; password: string };
let cookie = "";
let runtime: Awaited<ReturnType<typeof initialize>>;
const origin = "http://localhost:5173";
const fixture = `narada-auth-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${fixture}.json`;
const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
const testNetwork = Math.floor(Math.random() * 250);
let requestNumber = 0;
const request = (path: string, body?: unknown, session = cookie) =>
  app.request(`http://localhost:5173${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      origin,
      "x-forwarded-for": `203.0.${testNetwork}.${++requestNumber}`,
      cookie: session,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
beforeAll(async () => {
  vi.stubEnv("APP_TABLE", fixture + "-app");
  vi.stubEnv("AUTH_TABLE", fixture + "-auth");
  vi.stubEnv("BETTER_AUTH_URL", origin);
  runtime = await initialize(credentials);
  app = createApp(runtime);
  owner = JSON.parse(await readFile(credentials, "utf8"));
});
afterAll(async () => {
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
describe("real Better Auth with DynamoDB", () => {
  it("blocks public signup and anonymous administration", async () => {
    expect((await request("/api/admin/overview")).status).toBe(401);
    expect((await request("/api/admin/settings/ses")).status).toBe(401);
    expect((await request("/api/admin/settings")).status).toBe(401);
    expect((await request("/api/admin/metrics")).status).toBe(401);
    const response = await request("/api/auth/sign-up/email", {
      ...owner,
      name: "Intruder",
      email: "intruder@example.com",
    });
    expect(response.ok).toBe(false);
  });
  it("creates a session, authorizes administration, and rejects foreign origins", async () => {
    const response = await request("/api/auth/sign-in/email", owner);
    expect(response.status).toBe(200);
    cookie = cookies(response);
    expect(cookie).toContain("session_token");
    expect((await request("/api/admin/overview")).status).toBe(200);
    const ses = await request("/api/admin/settings/ses");
    expect(ses.status).toBe(200);
    expect(await ses.json()).toMatchObject({
      mode: "local",
      account: null,
      delivery: null,
    });
    const settings = await request("/api/admin/settings");
    expect(settings.status).toBe(200);
    expect(await settings.json()).toMatchObject({
      mode: "local",
      paused: expect.any(Boolean),
    });
    expect((await request("/api/admin/metrics?days=1")).status).toBe(200);
    expect((await request("/api/admin/metrics?days=99999")).status).toBe(400);
    expect(
      (
        await request("/api/admin/webhooks", {
          url: "http://localhost:3001/api/dev/webhook-receiver",
          events: ["email.opened"],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/admin/webhooks", {
          url: "http://localhost:3001/api/dev/webhook-receiver",
          events: [],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/admin/webhooks", {
          url: "http://localhost:5173/",
          events: ["email.delivered"],
        })
      ).status,
    ).toBe(400);
    const bad = await app.request(`${origin}/api/admin/keys`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Evil" }),
    });
    expect(bad.status).toBe(403);
  });
  it("normalizes domain names and preserves their creation date across verification", async () => {
    const name = `domains-${randomUUID()}.example.com`;
    const response = await request("/api/admin/domains", {
      name: `  ${name.toUpperCase()}  `,
    });
    expect(response.status).toBe(201);
    const domain = await response.json();
    expect(domain).toMatchObject({
      name,
      local: true,
      region: runtime.config.AWS_REGION,
    });
    expect(domain.createdAt).toEqual(expect.any(String));
    expect(domain.checkedAt).toEqual(expect.any(String));
    const checked = await request(`/api/admin/domains/${name}/verify`, {});
    expect(checked.status).toBe(200);
    expect((await checked.json()).createdAt).toBe(domain.createdAt);
    const duplicate = await request("/api/admin/domains", { name });
    expect((await duplicate.json()).createdAt).toBe(domain.createdAt);
    expect(
      (await request("/api/admin/domains", { name: "mail-.example.com" }))
        .status,
    ).toBe(400);
    await runtime.store.remove(`DOMAIN#${name}`);
  });
  it("enforces atomic uniqueness for parallel account creation", async () => {
    const auth = createAuth(runtime.config, runtime.store, true);
    const body = {
      email: `${randomUUID()}@example.com`,
      password: "A-long-test-password-123",
      name: "Concurrency",
    };
    const results = await Promise.allSettled([
      auth.api.signUpEmail({ body }),
      auth.api.signUpEmail({ body }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("enrolls TOTP and requires a second factor at sign in", async () => {
    const auth = createAuth(runtime.config, runtime.store, true);
    const account = {
      email: `${randomUUID()}@example.com`,
      password: "Test-password-strong-123",
    };
    await auth.api.signUpEmail({ body: { ...account, name: "MFA Test" } });
    let response = await request("/api/auth/sign-in/email", account, "");
    const session = cookies(response);
    response = await request(
      "/api/auth/two-factor/enable",
      { password: account.password },
      session,
    );
    expect(response.status).toBe(200);
    const enrollment = (await response.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(enrollment.backupCodes.length).toBeGreaterThan(0);
    const code = totp(new URL(enrollment.totpURI).searchParams.get("secret")!);
    response = await request(
      "/api/auth/two-factor/verify-totp",
      { code },
      session,
    );
    expect(response.status).toBe(200);
    response = await request("/api/auth/sign-in/email", account, "");
    expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
    response = await request(
      "/api/auth/two-factor/verify-backup-code",
      { code: enrollment.backupCodes[0] },
      cookies(response),
    );
    expect(response.status).toBe(200);
  });
  it("sends a local password reset and consumes the token only once", async () => {
    const account = {
      email: `reset-${randomUUID()}@example.com`,
      password: "Before-password-strong-123",
    };
    const registered = await createAuth(
      runtime.config,
      runtime.store,
      true,
    ).api.signUpEmail({
      body: { ...account, name: "Reset Test" },
    });
    const grants = new GrantStore(runtime.store, origin + "/api/mcp"),
      clientId = randomUUID();
    const reference = await grants.reference(registered.user.id, clientId, [
      "narada:forms:read",
    ]);
    const response = await request("/api/auth/request-password-reset", {
      email: account.email,
      redirectTo: origin,
    });
    expect(response.status).toBe(200);
    const mailbox = (await (
      await fetch(
        `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${account.email}`)}`,
      )
    ).json()) as { messages: { ID: string }[] };
    expect(mailbox.messages.length).toBeGreaterThan(0);
    const message = (await (
      await fetch(`${mailpit}/api/v1/message/${mailbox.messages[0]!.ID}`)
    ).json()) as { Text: string };
    const resetLink = message.Text.match(/https?:\/\/\S+/)![0];
    const redirect = await app.request(resetLink);
    const target = redirect.headers.get("location")!;
    const token = new URL(target).searchParams.get("token");
    expect(token).toBeTruthy();
    const body = { token, newPassword: "After-password-strong-456" };
    expect((await request("/api/auth/reset-password", body)).status).toBe(200);
    expect((await request("/api/auth/reset-password", body)).ok).toBe(false);
    expect(
      await grants.active(reference, registered.user.id, clientId),
    ).toBeUndefined();
    expect(
      (
        await request(
          "/api/auth/sign-in/email",
          { ...account, password: body.newPassword },
          "",
        )
      ).status,
    ).toBe(200);
  });
});
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.toUpperCase().replace(/=+$/, ""))
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1]! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}
