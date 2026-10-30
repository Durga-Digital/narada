import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostedApprovals } from "../../scripts/hosted-approvals.js";

test("automatic sending and optional owner review survive a lost response for every API key type", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const origin = "http://localhost:5173";
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_OWNER_FILE ?? ".local/owner.json",
      "utf8",
    ),
  );
  const login = await context.request.post(origin + "/api/auth/sign-in/email", {
    headers: { origin },
    data: owner,
  });
  expect(login.status()).toBe(200);
  const cookie = (await context.cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  async function request(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) {
    return fetch(origin + path, {
      method,
      headers: { cookie, origin, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function json(path: string, body?: unknown, method?: string) {
    const response = await request(path, body, method);
    expect(response.ok, `${path}: ${response.status}`).toBe(true);
    return response.json();
  }
  const report: any = { cleanup: [] };
  const check = hostedApprovals({
    stage: "staging",
    origin,
    name: `local-review-${randomUUID()}`,
    domain: "narada.test",
    context,
    report,
    pass: async () => {},
    json,
    request,
  });
  try {
    await check.apiKeys();
    expect(new Set(report.approvals.messages).size).toBe(10);
    await page.goto("/?page=approvals");
    await expect(
      page.getByRole("heading", { name: "Send approvals", exact: true }),
    ).toBeVisible();
  } finally {
    await check.cleanup();
    expect(
      report.cleanup.some(
        (r: any) => r.revoked === false || r.rejected === false,
      ),
    ).toBe(false);
  }
});
