import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { recoverySenderSchema } from "@narada/contracts/owner-security";
import { resolveRecoverySender } from "@narada/core/recovery-sender";

const origin = "http://localhost:5173";
const fixture = `narada-recovery-${randomUUID().slice(0, 8)}`;
const credentials = `.local/${fixture}.json`;
const path = "/api/admin/profile/recovery-sender";
const domain = "recovery.example.com";
const saveKey = randomUUID();
let runtime: Awaited<ReturnType<typeof initialize>>;
let app: ReturnType<typeof createApp>;
let owner: { email: string; password: string };
let cookie = "";
let n = 0;
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
function request(
  url: string,
  body?: unknown,
  method = body ? "POST" : "GET",
  session = cookie,
  extra = {},
) {
  return app.request(`${origin}${url}`, {
    method,
    headers: {
      origin,
      cookie: session,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${++n}`,
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeAll(async () => {
  vi.stubEnv("APP_TABLE", `${fixture}-app`);
  vi.stubEnv("AUTH_TABLE", `${fixture}-auth`);
  vi.stubEnv("OWNER_EMAIL", `${fixture}@example.net`);
  vi.stubEnv("BETTER_AUTH_URL", origin);
  runtime = await initialize(credentials);
  app = createApp(runtime);
  owner = JSON.parse(await readFile(credentials, "utf8"));
  cookie = cookies(await request("/api/auth/sign-in/email", owner));
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

it("requires an owner session and matching origin; full API keys cannot access profile security", async () => {
  expect((await request(path, undefined, "GET", "")).status).toBe(401);
  expect((await request(path, { domain, revision: 0 }, "PUT", "")).status).toBe(
    401,
  );
  expect(
    (
      await request(path, { domain, revision: 0 }, "PUT", cookie, {
        origin: "https://evil.example",
      })
    ).status,
  ).toBe(403);
  const created = await request("/api/admin/keys", {
    name: "Recovery exclusion",
    permission: "full",
  });
  expect(created.status).toBe(201);
  const { token } = await created.json();
  expect(
    (
      await request(path, undefined, "GET", "", {
        authorization: `Bearer ${token}`,
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await request("/api/v1/profile/recovery-sender", undefined, "GET", "", {
        authorization: `Bearer ${token}`,
      })
    ).status,
  ).toBe(404);
});

it("preserves deployment senders until a verified domain is selected; validates canonical schemas", async () => {
  const initial = recoverySenderSchema.parse(
    await (await request(path)).json(),
  );
  expect(initial).toMatchObject({
    source: "deployment",
    from: runtime.config.AUTH_FROM,
    revision: 0,
  });
  expect(await resolveRecoverySender(runtime.store)).toBe(
    runtime.config.AUTH_FROM,
  );
  expect((await request(path, { domain, revision: 0 }, "PUT")).status).toBe(
    400,
  );
  await request("/api/admin/domains", { name: domain });
  await runtime.store.patch(`DOMAIN#${domain}`, { verified: false });
  expect((await request(path, { domain, revision: 0 }, "PUT")).status).toBe(
    400,
  );
  await runtime.store.patch(`DOMAIN#${domain}`, { verified: true });
  const key = saveKey;
  const update = () =>
    request(path, { domain, revision: 0 }, "PUT", cookie, {
      "idempotency-key": key,
    });
  const response = await update();
  expect(response.status).toBe(200);
  const saved = recoverySenderSchema.parse(await response.json());
  expect(saved).toEqual({
    domain,
    from: `Narada <security@${domain}>`,
    source: "profile",
    available: true,
    revision: 1,
  });
  const replay = await update();
  expect(replay.headers.get("idempotency-replayed")).toBe("true");
  expect(await replay.json()).toEqual(saved);
  expect((await request(path, { domain, revision: 0 }, "PUT")).status).toBe(
    409,
  );
  expect(
    (
      await request(
        path,
        { domain, revision: 1, email: "intruder@example.com" },
        "PUT",
      )
    ).status,
  ).toBe(400);
});

it("does not silently fall back when a saved domain is removed, unverified or registered again", async () => {
  await runtime.store.patch(`DOMAIN#${domain}`, { verified: false });
  expect(
    (
      await request(path, { domain, revision: 0 }, "PUT", cookie, {
        "idempotency-key": saveKey,
      })
    ).status,
  ).toBe(409);
  const failed = await request(
    "/api/auth/request-password-reset",
    { email: owner.email, redirectTo: origin },
    "POST",
    "",
  );
  const unknown = await request(
    "/api/auth/request-password-reset",
    { email: "unknown@example.net", redirectTo: origin },
    "POST",
    "",
  );
  expect(failed.status).toBe(unknown.status);
  expect(await failed.json()).toEqual(await unknown.json());
  await expect(resolveRecoverySender(runtime.store)).rejects.toMatchObject({
    status: 409,
  });
  expect(await (await request(path)).json()).toMatchObject({
    available: false,
  });
  await runtime.store.patch(`DOMAIN#${domain}`, {
    verified: true,
    removedAt: new Date().toISOString(),
  });
  await expect(resolveRecoverySender(runtime.store)).rejects.toMatchObject({
    status: 409,
  });
  await request("/api/admin/domains", { name: domain });
  await expect(resolveRecoverySender(runtime.store)).rejects.toMatchObject({
    status: 409,
  });
  expect((await request(path, { domain, revision: 1 }, "PUT")).status).toBe(
    200,
  );
  expect(await resolveRecoverySender(runtime.store)).toBe(
    `Narada <security@${domain}>`,
  );
});

it("changes the password only with the current password and revokes other browser sessions", async () => {
  const other = cookies(await request("/api/auth/sign-in/email", owner));
  const newPassword = "New-owner-password-strong-456";
  expect(
    (
      await request("/api/auth/change-password", {
        currentPassword: "incorrect-password",
        newPassword,
        revokeOtherSessions: true,
      })
    ).ok,
  ).toBe(false);
  const changed = await request("/api/auth/change-password", {
    currentPassword: owner.password,
    newPassword,
    revokeOtherSessions: true,
  });
  expect(changed.status).toBe(200);
  cookie = cookies(changed) || cookie;
  expect((await request(path, undefined, "GET", other)).status).toBe(401);
  expect((await request(path)).status).toBe(200);
  expect((await request("/api/auth/sign-in/email", owner, "POST", "")).ok).toBe(
    false,
  );
  owner.password = newPassword;
  expect(
    (await request("/api/auth/sign-in/email", owner, "POST", "")).status,
  ).toBe(200);
});

it("uses the saved sender for signed-in and forgot-password requests, and consumes reset tokens once", async () => {
  const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
  for (const session of [cookie, ""]) {
    const response = await request(
      "/api/auth/request-password-reset",
      { email: owner.email, redirectTo: origin },
      "POST",
      session,
    );
    expect(response.status).toBe(200);
  }
  const mailbox = (await (
    await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${owner.email}`)}`,
    )
  ).json()) as { messages: { ID: string }[] };
  expect(mailbox.messages).toHaveLength(2);
  for (const item of mailbox.messages) {
    const mail = (await (
      await fetch(`${mailpit}/api/v1/message/${item.ID}`)
    ).json()) as {
      From: { Address: string };
      To: { Address: string }[];
      Text: string;
    };
    expect(mail.From.Address).toBe(`security@${domain}`);
    expect(mail.To.map((to) => to.Address)).toEqual([owner.email]);
  }
  const mail = (await (
    await fetch(`${mailpit}/api/v1/message/${mailbox.messages[0]!.ID}`)
  ).json()) as { Text: string };
  const link = mail.Text.match(/https?:\/\/\S+/)![0];
  const redirect = await app.request(link);
  const token = new URL(redirect.headers.get("location")!).searchParams.get(
    "token",
  );
  expect(token).toBeTruthy();
  const body = { token, newPassword: "Recovered-owner-password-789" };
  expect(
    (await request("/api/auth/reset-password", body, "POST", "")).status,
  ).toBe(200);
  expect((await request("/api/auth/reset-password", body, "POST", "")).ok).toBe(
    false,
  );
  expect((await request(path)).status).toBe(401);
  expect((await request("/api/auth/sign-in/email", owner, "POST", "")).ok).toBe(
    false,
  );
  expect(
    (
      await request(
        "/api/auth/sign-in/email",
        { ...owner, password: body.newPassword },
        "POST",
        "",
      )
    ).status,
  ).toBe(200);
});
