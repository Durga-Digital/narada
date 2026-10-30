import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { deploymentConfig } from "./deployment-config.js";
import { customDomainConfig } from "../infrastructure/custom-domain.js";

const { values } = parseArgs({
  options: {
    stage: { type: "string" },
    region: { type: "string" },
    public: { type: "boolean", default: false },
  },
  strict: true,
});
const target = deploymentConfig(values, process.env);
const suffix = `${target.account}-${target.region}-${target.stage}`;
const outputs = JSON.parse(
  await readFile(`.local/deploy-${suffix}.json`, "utf8"),
)[`Narada-${target.stage}`];
const url = new URL(outputs.Url);
const customDomain = customDomainConfig(process.env, target.account);
assert(
  url.protocol === "https:" &&
    (customDomain
      ? url.origin === customDomain.origin
      : /^[a-z0-9]+\.cloudfront\.net$/.test(url.hostname)) &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password &&
    !url.port,
  "Expected the configured custom domain or deployed CloudFront HTTPS origin",
);
const origin = url.origin;
let cookie = "";
async function request(path: string, body?: unknown, authenticated = true) {
  return fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      origin,
      ...(authenticated && cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const homepage = await request("/");
assert.equal(homepage.status, 200, "Frontend must load");
const html = await homepage.text();
const script = html.match(/src="(\/assets\/[^"<>]+\.js)"/);
assert(script, "Frontend must reference its bundled JavaScript");
assert.equal(
  (await request(script[1]!)).status,
  200,
  "Frontend JavaScript must load",
);
const health = await request("/api/health");
assert.equal(health.status, 200, "API health must load");
assert.deepEqual(await health.json(), { ok: true, mode: "aws" });
assert.equal(
  (await request("/api/admin/settings", undefined, false)).status,
  401,
  "Anonymous admin access must be rejected",
);
if (values.public) {
  console.log(
    `${target.stage}: frontend, JavaScript, API health, and anonymous access checks passed. Email delivery and owner authentication were not tested.`,
  );
  process.exit(0);
}
const owner = JSON.parse(
  await readFile(`.local/aws-owner-${suffix}.json`, "utf8"),
);
assert.equal(owner.email, target.ownerEmail);
try {
  const login = await request("/api/auth/sign-in/email", owner, false);
  assert.equal(
    login.status,
    200,
    "Owner sign-in must succeed; saved bootstrap credentials may no longer match after a password change",
  );
  const cookies = login.headers.getSetCookie();
  assert(
    cookies.some(
      (c) =>
        c.includes("session_token") &&
        /;\s*Secure/i.test(c) &&
        /;\s*HttpOnly/i.test(c),
    ),
    "Session cookie must be secure and HttpOnly",
  );
  cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const settings = await request("/api/admin/settings");
  assert.equal(
    settings.status,
    200,
    "Authenticated administration must succeed",
  );
  const settingsData = await settings.json();
  assert.equal(settingsData.mode, "aws");
  assert.equal(settingsData.region, target.region);
  for (const path of [
    "/api/admin/domains",
    "/api/admin/keys",
    "/api/admin/overview",
    "/api/admin/metrics?days=1",
    "/api/admin/settings/ses",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} must succeed`);
    await response.json();
  }
  const logout = await request("/api/auth/sign-out", {});
  assert.equal(logout.status, 200, "Smoke-test session must be signed out");
  cookie = "";
  const report = {
    stage: target.stage,
    account: target.account,
    region: target.region,
    url: origin,
    checkedAt: new Date().toISOString(),
    passed: [
      "frontend",
      "javascript",
      "api-health",
      "anonymous-access-blocked",
      "owner-login",
      "secure-cookie",
      "admin-reads",
      "ses-status",
      "owner-logout",
    ],
    emailDeliveryValidated: false,
  };
  await writeFile(
    `.local/smoke-${suffix}.json`,
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (cookie) {
    const logout = await request("/api/auth/sign-out", {});
    assert.equal(logout.status, 200, "Smoke-test session must be signed out");
  }
}
