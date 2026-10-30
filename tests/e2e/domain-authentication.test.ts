import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
import type { Page } from "../helpers/browser.js";
async function signIn(page: Page) {
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Domains", exact: true }).click();
}
test("guides local DNS previews and captures a domain test through the queue", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  const name = `setup-${Date.now()}.example.com`;
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await page.getByLabel("Domain name").fill(name);
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Domain setup", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /1. DKIM/ })).toContainText(
    "Local preview",
  );
  await page.getByRole("tab", { name: /2. DMARC/ }).click();
  await page
    .getByRole("button", { name: "Copy DMARC TXT host", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `_dmarc.${name.replace(".example.com", "")}`,
  );
  await page
    .getByLabel("Aggregate report email (optional)")
    .fill("reports@example.com");
  await page
    .getByRole("button", { name: "Copy Proposed DMARC TXT value", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "v=DMARC1; p=none; rua=mailto:reports@example.com;",
  );
  await page.screenshot({
    path: ".local/domain-dmarc-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: /1. DKIM/ }).click();
  await page.getByRole("tab", { name: /2. DMARC/ }).click();
  await expect(
    page.getByLabel("Aggregate report email (optional)"),
  ).toHaveValue("reports@example.com");
  await page.getByRole("tab", { name: /3. MAIL FROM/ }).click();
  await page.getByLabel("MAIL FROM mode").selectOption("custom");
  await page
    .getByLabel("If the MX record fails")
    .selectOption("REJECT_MESSAGE");
  await page
    .getByRole("button", { name: "Save local preview", exact: true })
    .click();
  await expect(
    page.getByText(`Saved mode: bounce.${name}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("MX: Local preview · SPF: Local preview", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy MX host", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `bounce.${name.replace(".example.com", "")}`,
  );
  await page
    .getByRole("button", { name: "Copy TXT value", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "v=spf1 include:amazonses.com ~all",
  );
  await page
    .getByRole("button", { name: "Check verification", exact: true })
    .click();
  await expect(page.getByLabel("If the MX record fails")).toHaveValue(
    "REJECT_MESSAGE",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const steps = await page
    .getByRole("tablist", { name: "Domain setup steps" })
    .boundingBox();
  const content = await page.getByRole("tabpanel").boundingBox();
  expect(steps!.y + steps!.height).toBeLessThanOrEqual(content!.y);
  await page.screenshot({
    path: ".local/domain-mail-from-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: /4. Test email/ }).click();
  const to = `setup-${Date.now()}@example.com`;
  await page.getByLabel("Test inbox").fill(to);
  await page
    .getByRole("button", { name: "Send test email", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Test queued" }),
  ).toBeVisible();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
        );
        return (await response.json()).messages.length;
      },
      { timeout: 15000 },
    )
    .toBe(1);
  await page.screenshot({
    path: ".local/domain-test-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("distinguishes a verified identity from disabled DKIM and inherited DMARC", async ({
  page,
}) => {
  const domain = {
    pk: "DOMAIN#mail.example.com",
    sk: "META",
    name: "mail.example.com",
    local: false,
    verified: true,
    records: [],
    region: "us-east-1",
    authentication: {
      checkedAt: "2026-10-11T00:00:00Z",
      dkim: { status: "SUCCESS", signingEnabled: false },
      dmarc: {
        status: "found",
        name: "_dmarc.example.com",
        inherited: true,
        record: "v=DMARC1; p=reject; sp=quarantine; aspf=s",
        policy: "quarantine",
        alignment: { dkim: "r", spf: "s" },
        message: "Policy found.",
      },
      mailFrom: {
        domain: "bounce.mail.example.com",
        behavior: "REJECT_MESSAGE",
        status: "PENDING",
        mx: "missing",
        spf: "found",
        records: [
          {
            type: "MX",
            name: "bounce.mail.example.com",
            value: "10 feedback-smtp.us-east-1.amazonses.com",
          },
        ],
      },
    },
  };
  await page.route("**/api/admin/domains", (route) =>
    route.fulfill({ json: [domain] }),
  );
  await page.route("**/api/admin/domains/mail.example.com/dkim", (route) =>
    route.fulfill({
      json: {
        ...domain,
        authentication: {
          ...domain.authentication,
          dkim: { status: "SUCCESS", signingEnabled: true },
        },
      },
    }),
  );
  await signIn(page);
  await page
    .getByRole("button", { name: "mail.example.com", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: /1. DKIM/ })).toContainText(
    "Signing disabled",
  );
  await page
    .getByRole("button", { name: "Enable DKIM signing", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: /1. DKIM/ })).toContainText(
    "Signing enabled",
  );
  await page.getByRole("tab", { name: /2. DMARC/ }).click();
  await expect(
    page.getByText("Record found · inherited policy", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("_dmarc.example.com · Effective policy: quarantine", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /3. MAIL FROM/ }).click();
  await expect(
    page.getByText("MX: Missing · SPF: Record found", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("SES status: PENDING", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/domain-mail-from-aws.png",
    fullPage: true,
  });
});
