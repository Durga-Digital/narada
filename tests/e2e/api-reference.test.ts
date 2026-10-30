import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
test("shows contextual API examples, copies cURL, and creates a scoped key", async ({
  page,
  context,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_OWNER_FILE ?? ".local/owner.json",
      "utf8",
    ),
  );
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Broadcasts", exact: true }).click();
  await page
    .getByRole("button", { name: "Broadcasts API", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Broadcasts API" }),
  ).toBeVisible();
  await expect(dialog.locator("pre").first()).toContainText(
    "narada.broadcasts.create",
  );
  await dialog.getByRole("button", { name: "cURL", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Copy Create", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "/api/v1/broadcasts",
  );
  await page.screenshot({
    path: ".local/api-panel-desktop.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Audience", exact: true }).click();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page
    .getByRole("button", { name: "Properties API", exact: true })
    .click();
  await expect(dialog.locator("pre").first()).toContainText(
    "narada.contactProperties.create",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("heading", { name: "Properties API" }),
  ).toBeVisible();
  await expect
    .poll(async () => Math.round((await dialog.boundingBox())!.height))
    .toBe(844);
  await page.screenshot({
    path: ".local/api-panel-mobile.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("button", { name: "API reference", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "API resources" })
    .getByRole("button", { name: "Topics", exact: true })
    .click();
  await expect(page.locator("pre").first()).toContainText(
    "narada.topics.create",
  );
  await page.getByRole("button", { name: "API keys", exact: true }).click();
  await page
    .getByRole("button", { name: "Create API key", exact: true })
    .click();
  const name = `API e2e ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Permission", { exact: true }).selectOption("full");
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const token = await page.getByLabel("New API key").inputValue();
  await page
    .getByRole("button", { name: "I have saved it", exact: true })
    .click();
  expect(
    (
      await request.get("/api/v1/topics", {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(200);
  const row = page
    .getByRole("row")
    .filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toContainText("Full access");
  await row
    .getByRole("button", { name: `Revoke ${name}`, exact: true })
    .click();
  await page.getByLabel("Confirmation name").fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Revoke key", exact: true })
    .click();
  await expect(row).toContainText("Revoked");
  expect(
    (
      await request.get("/api/v1/topics", {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(401);
  expect(errors).toEqual([]);
});
