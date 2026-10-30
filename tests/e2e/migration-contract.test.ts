import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";

test("filters email tags, displays details, and creates a narrow contact-sync key", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const owner = JSON.parse(
    await readFile(process.env.NARADA_E2E_OWNER ?? ".local/owner.json", "utf8"),
  );
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "API keys", exact: true }),
  ).toBeVisible();
  const marker = `Audit ${Date.now()}`;
  for (const tier of ["premium", "standard"]) {
    const response = await page.request.post("/api/admin/send", {
      headers: { origin: "http://localhost:5173" },
      data: {
        from: "hello@narada.test",
        to: "audit@example.com",
        subject: `${marker} ${tier}`,
        text: "Synthetic local test",
        tags: {
          source: "audit-request",
          tier,
          tag: "enquiry",
          urgency: tier === "premium" ? "urgent" : "normal",
        },
        priority: tier === "premium" ? "high" : "normal",
      },
    });
    expect(response.status()).toBe(202);
  }
  await page.getByRole("button", { name: "Emails", exact: true }).click();
  await page.getByLabel("Search emails").fill(marker);
  await expect(page.getByRole("row").filter({ hasText: marker })).toHaveCount(
    2,
  );
  await page.getByLabel("Filter emails by tag key").selectOption("tier");
  await page.getByLabel("Filter emails by tag value").selectOption("premium");
  await expect(page.getByRole("row").filter({ hasText: marker })).toHaveCount(
    1,
  );
  const row = page.getByRole("row").filter({ hasText: `${marker} premium` });
  await row.getByRole("button", { name: "Details" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("audit-request", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("high", { exact: true })).toBeVisible();
  await expect(dialog.getByText("premium", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".local/migration-tags-details.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Filter emails by tag key")).toBeVisible();
  await page.screenshot({ path: ".local/migration-tags-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "API keys", exact: true }).click();
  await page
    .getByRole("button", { name: "Create API key", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(marker);
  await page.getByLabel("Permission", { exact: true }).selectOption("scoped");
  await expect(
    page.getByRole("button", { name: "Create key", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Create, retrieve, and update individual contacts")
    .check();
  await page.getByLabel("Add and remove manual segment members").check();
  await expect(page.getByLabel("Domain", { exact: true })).toBeDisabled();
  await page.screenshot({ path: ".local/migration-scoped-key.png" });
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const token = await page.getByLabel("New API key").inputValue();
  const response = await page.request.get("/api/v1/emails/no-access", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(403);
  await page
    .getByRole("button", { name: "I have saved it", exact: true })
    .click();
  await page.getByLabel("Search API keys").fill(marker);
  await page.getByLabel("Filter key permission").selectOption("scoped");
  await expect(page.getByRole("row").filter({ hasText: marker })).toContainText(
    "contacts:write, segments:members",
  );
  expect(errors).toEqual([]);
});
