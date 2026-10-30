import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
test("creates scoped keys, reveals once, filters, tracks use, and confirms revocation", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "API keys", exact: true }).click();
  await page
    .getByRole("button", { name: "Create API key", exact: true })
    .click();
  const name = `Keys UX ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await expect(page.getByLabel("Permission", { exact: true })).toHaveValue(
    "sending",
  );
  await page.getByLabel("Permission", { exact: true }).selectOption("full");
  await expect(page.getByLabel("Domain", { exact: true })).toBeDisabled();
  await page.getByLabel("Permission", { exact: true }).selectOption("sending");
  await page.getByLabel("Domain", { exact: true }).selectOption("narada.test");
  await page.screenshot({ path: ".local/keys-create-desktop.png" });
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const token = await page.getByLabel("New API key").inputValue();
  const notifications = page.locator("[data-sonner-toast]");
  await expect(
    notifications.filter({ hasText: "API key created" }),
  ).toBeVisible();
  expect(await notifications.allTextContents()).not.toContain(token);
  await page.getByRole("button", { name: "Copy API key", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);
  await expect(
    notifications.filter({ hasText: "Copied to clipboard" }),
  ).toBeVisible();
  expect((await notifications.allTextContents()).join(" ")).not.toContain(
    token,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("New API key")).toBeVisible();
  await page
    .getByRole("button", { name: "I have saved it", exact: true })
    .click();
  await expect(page.getByLabel("New API key")).toHaveCount(0);
  await page.getByLabel("Search API keys").fill(name);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("narada.test");
  await expect(row).toContainText("No activity yet");
  const keys = await (await page.request.get("/api/admin/keys")).json();
  const own = keys.find((k: { name: string }) => k.name === name);
  expect(own).not.toHaveProperty("hash");
  expect(own).not.toHaveProperty("token");
  expect(own).not.toHaveProperty("pk");
  const lookup = await page.request.get("/api/v1/emails/not-found", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(lookup.status()).toBe(404);
  await page.getByRole("button", { name: "Refresh keys" }).click();
  await expect(row).toContainText("Just now");
  await row.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await expect(page.getByLabel("Domain", { exact: true })).toHaveValue(
    "narada.test",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toContainText("Sending access");
  await row.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await page.getByLabel("Permission", { exact: true }).selectOption("scoped");
  await expect(
    page.getByRole("checkbox", {
      name: "Send emails and read delivery status",
    }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "Create contacts only" }).check();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/keys-edit-scopes-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("New API key")).toHaveCount(0);
  await expect(row).toContainText("contacts:create");
  await expect(row).toContainText("narada.test");
  await page.getByRole("button", { name: "Refresh keys" }).click();
  await expect(row).toContainText("contacts:create");
  const address = `signup-${Date.now()}@example.com`;
  const createContact = await page.request.post("/api/v1/contacts", {
    headers: { authorization: `Bearer ${token}` },
    data: { email: address, name: "Signup User" },
  });
  expect(createContact.status()).toBe(201);
  expect(
    (
      await page.request.get(
        `/api/v1/contacts/${encodeURIComponent(address)}`,
        { headers: { authorization: `Bearer ${token}` } },
      )
    ).status(),
  ).toBe(403);
  await row.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Create contacts only" }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "Create contacts only" }).uncheck();
  await page
    .getByRole("checkbox", { name: "Send emails and read delivery status" })
    .uncheck();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Permission", { exact: true }).selectOption("sending");
  await page.getByLabel("Domain", { exact: true }).selectOption("narada.test");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(row).toContainText("Sending access");
  expect(
    (
      await page.request.post("/api/v1/contacts", {
        headers: { authorization: `Bearer ${token}` },
        data: { email: `removed-${Date.now()}@example.com` },
      })
    ).status(),
  ).toBe(403);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByLabel("Search API keys").fill(name);
  await page.getByLabel("Filter key permission").selectOption("full");
  await expect(
    page.getByText("No matching API keys", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter key permission").selectOption("sending");
  await page.screenshot({
    path: ".local/keys-list-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/keys-list-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await row
    .getByRole("button", { name: `Revoke ${name}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toContainText("Active");
  await row
    .getByRole("button", { name: `Revoke ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Revoke key", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Confirmation name").fill("incorrect");
  await expect(
    page.getByRole("button", { name: "Revoke key", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Confirmation name").fill(name);
  await page.getByRole("button", { name: "Revoke key", exact: true }).click();
  await expect(
    row.getByRole("button", { name: `Delete ${name}`, exact: true }),
  ).toBeEnabled();
  await expect(
    row.getByRole("button", { name: `Edit ${name}`, exact: true }),
  ).toHaveCount(0);
  const revoked = await page.request.get("/api/v1/emails/not-found", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(revoked.status()).toBe(401);
  await row
    .getByRole("button", { name: `Delete ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete key", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toBeVisible();
  await row
    .getByRole("button", { name: `Delete ${name}`, exact: true })
    .click();
  await page.getByLabel("Confirmation name").fill(name);
  await page.screenshot({ path: ".local/key-delete-mobile.png" });
  await page.getByRole("button", { name: "Delete key", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh keys" }).click();
  await expect(row).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create API key", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("A new application");
  await page.getByLabel("Permission", { exact: true }).selectOption("scoped");
  await expect(
    page.getByRole("checkbox", {
      name: "Send emails and read delivery status",
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Create key", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: "Create contacts only" }).check();
  await expect(
    page.getByRole("button", { name: "Create key", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: ".local/keys-create-mobile.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(errors).toEqual([]);
});
