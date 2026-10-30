import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";

test("copies an environment-specific agent handoff without fetching keys or sending email", async ({
  page,
  context,
}) => {
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_OWNER_FILE ?? ".local/owner.json",
      "utf8",
    ),
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const sensitiveRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/admin/keys") ||
      request.method() === "POST"
    )
      sensitiveRequests.push(request.url());
  });
  await page
    .getByRole("button", { name: "Integrate an app", exact: true })
    .click();
  const prompt = page.getByLabel("Integration prompt", { exact: true });
  await expect(prompt).toHaveValue(/replacing Resend/);
  const origin = new URL(page.url()).origin;
  await expect(page.getByLabel("Narada base URL")).toHaveValue(origin);
  await page
    .getByLabel("Sender address (optional)")
    .fill("Example <hello@example.com>");
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(await prompt.inputValue());
  expect(copied).toContain(`NARADA_BASE_URL=${origin}`);
  expect(copied).toContain('NARADA_FROM="Example <hello@example.com>"');
  expect(copied).not.toContain(owner.password);
  await expect(
    page.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Integration type").selectOption("new");
  await expect(prompt).not.toHaveValue(/Resend migration/);
  await expect(prompt).toHaveValue(/New integration/);
  await expect(
    page.getByRole("button", { name: "Copy prompt", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/integration-guide-desktop.png" });

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: async () => {
        throw new Error("Clipboard denied");
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Copy prompt", exact: true }).click();
  await expect(
    page.getByText(
      "Could not copy. Select the prompt below and copy it manually.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(prompt).toBeEditable({ editable: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await prompt.scrollIntoViewIfNeeded();
  await expect(prompt).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: ".local/integration-guide-mobile.png" });
  expect(sensitiveRequests).toEqual([]);
});
