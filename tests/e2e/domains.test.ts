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
test("adds a local domain through guided setup, opens details, and filters the list", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await page.getByLabel("Domain name").fill("https://example.com");
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "without https://" }),
  ).toBeVisible();
  const name = `browser-${Date.now()}.example.com`;
  await page.getByLabel("Domain name").fill(` ${name.toUpperCase()} `);
  await expect(page.getByText(`hello@${name}`, { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".local/domains-add-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your local domain is ready" }),
  ).toBeVisible();
  await expect(page.getByText("Local only", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check verification" }).click();
  await expect(page.getByRole("status")).toContainText(
    "No AWS verification was performed",
  );
  await page.getByRole("button", { name: "All domains", exact: true }).click();
  await page.getByLabel("Search domains").fill(name);
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(1);
  await page.getByLabel("Filter domain status").selectOption("verified");
  await expect(
    page.getByText("No matching domains", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.screenshot({
    path: ".local/domains-list-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/domains-list-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await page.screenshot({
    path: ".local/domains-add-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("renders SES DNS records, copies exact values, and reports pending and verified states", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const records = Array.from({ length: 3 }, (_, i) => ({
    type: "CNAME",
    name: `token${i}._domainkey.mail.example.com`,
    value: `token${i}.dkim.amazonses.com`,
  }));
  const domain = {
    pk: "DOMAIN#mail.example.com",
    sk: "META",
    name: "mail.example.com",
    verified: false,
    local: false,
    region: "ap-southeast-2",
    createdAt: "2026-10-01T00:00:00Z",
    records,
  };
  let checks = 0;
  await page.route("**/api/admin/domains", (route) =>
    route.fulfill({ json: [domain] }),
  );
  await page.route("**/api/admin/domains/mail.example.com/verify", (route) => {
    checks++;
    return route.fulfill({
      json: {
        ...domain,
        verified: checks > 1,
        checkedAt: new Date().toISOString(),
      },
    });
  });
  await signIn(page);
  await page.getByRole("button", { name: domain.name, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "DNS records", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Copy Value for record 1", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    records[0]!.value,
  );
  await expect(
    page.getByLabel("DNS zone (domain in your DNS provider)"),
  ).toHaveValue("example.com");
  await page
    .getByRole("button", { name: "Copy CNAME 1 host", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "token0._domainkey.mail",
  );
  await page
    .getByRole("button", { name: "Copy all records", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    records
      .map((r, i) => `token${i}._domainkey.mail\t${r.type}\t${r.value}`)
      .join("\n"),
  );
  await page
    .getByLabel("DNS zone (domain in your DNS provider)")
    .fill("mail.example.com");
  await page
    .getByRole("button", { name: "Copy CNAME 1 host", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "token0._domainkey",
  );
  await page
    .getByLabel("DNS zone (domain in your DNS provider)")
    .fill("other.com");
  await expect(
    page.getByRole("button", { name: "Copy all records", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Copy CNAME 1 host", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("DNS name format").selectOption("full");
  await page
    .getByRole("button", { name: "Copy all records", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    records.map((r) => `${r.name}\t${r.type}\t${r.value}`).join("\n"),
  );
  await page.getByRole("button", { name: "Check verification" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "not verified" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/domains-dns-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Check verification" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/domains-dns-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("recovers from an empty response and removes a domain with exact-name confirmation", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/admin/domains", async (route) => {
    if (fail && route.request().method() === "GET") {
      await route.fulfill({ status: 502, body: "" });
    } else await route.continue();
  });
  await signIn(page);
  await expect(page.getByRole("status")).toContainText("HTTP 502");
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("HTTP 502", { exact: false })).toHaveCount(0);
  const name = `remove-ui-${Date.now()}.example.com`;
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await page.getByLabel("Domain name").fill(name);
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Remove domain", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "SES identities and DNS records are retained",
  );
  await expect(
    dialog.getByRole("button", { name: "Remove domain", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Confirmation name").fill("wrong");
  await expect(
    dialog.getByRole("button", { name: "Remove domain", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Remove domain", exact: true })
    .click();
  await page.getByLabel("Confirmation name").fill(name);
  await page.screenshot({ path: ".local/domain-remove-desktop.png" });
  await dialog
    .getByRole("button", { name: "Remove domain", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Domains.", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search domains").fill(name);
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Domains", exact: true }).click();
  await page.getByLabel("Search domains").fill(name);
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
});
