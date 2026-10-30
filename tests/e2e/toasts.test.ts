import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";

test("reports confirmed operations and failures in bottom-right toasts without background noise", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  const domain = {
    name: "toast.example.com",
    verified: true,
    local: true,
    region: "us-east-1",
    records: [],
  };
  let fail = false;
  await page.route("**/api/admin/domains", (route) =>
    route.fulfill({
      json: route.request().method() === "GET" ? [domain] : domain,
    }),
  );
  await page.route("**/api/admin/domains/toast.example.com/verify", (route) =>
    fail
      ? route.fulfill({ status: 502, body: "" })
      : route.fulfill({ json: domain }),
  );
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Domains", exact: true }).click();
  const toasts = page.locator("[data-sonner-toast]");
  await expect(
    page.getByRole("button", { name: domain.name, exact: true }),
  ).toBeVisible();
  await expect(toasts).toHaveCount(0);
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  await page.getByLabel("Domain name").fill(domain.name);
  await page.getByRole("button", { name: "Add domain", exact: true }).click();
  const added = toasts.filter({ hasText: "Domain added" });
  await expect(added).toBeVisible();
  await expect(
    page.getByRole("heading", { name: domain.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute(
    "data-x-position",
    "right",
  );
  await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute(
    "data-y-position",
    "bottom",
  );
  await expect(added).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: ".local/toast-success-desktop.png",
    animations: "disabled",
  });
  const bounds = await added.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThan(viewport.width / 2);
  expect(bounds!.y).toBeGreaterThan(viewport.height / 2);
  await added.getByRole("button", { name: "Close toast" }).click();
  await expect(toasts).toHaveCount(0);

  fail = true;
  await page.getByRole("button", { name: "Check verification" }).click();
  const error = toasts.filter({ hasText: "Action could not be completed" });
  await expect(error).toContainText("HTTP 502");
  await expect(error).toContainText("may already have been saved");
  await expect(toasts).toHaveCount(1);
  await expect(
    page.getByRole("status").filter({ hasText: "HTTP 502" }),
  ).toBeVisible();
  await error.getByRole("button", { name: "Close toast" }).click();
  await expect(toasts).toHaveCount(0);

  fail = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Check verification" }).click();
  const refreshed = toasts.filter({ hasText: "Domain status refreshed" });
  await expect(refreshed).toBeVisible();
  await expect(refreshed).toHaveCSS("opacity", "1");
  await expect
    .poll(async () => {
      const box = await refreshed.boundingBox();
      return box ? box.y + box.height : Infinity;
    })
    .toBeLessThanOrEqual(844);
  await page.screenshot({
    path: ".local/toast-success-mobile.png",
    animations: "disabled",
  });
  const mobile = await refreshed.boundingBox();
  expect(mobile!.x).toBeGreaterThanOrEqual(0);
  expect(mobile!.x + mobile!.width).toBeLessThanOrEqual(390);
  expect(mobile!.y + mobile!.height).toBeLessThanOrEqual(844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await refreshed.getByRole("button", { name: "Close toast" }).click();
  await expect(toasts).toHaveCount(0);

  // Clipboard rejection gets useful feedback and never reports success.
  await page.getByRole("tab", { name: /DMARC/ }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("denied")),
    });
  });
  await page
    .getByRole("button", { name: "Copy DMARC TXT host", exact: true })
    .click();
  await expect(toasts).toHaveCount(1);
  await expect(toasts).toContainText("Clipboard unavailable");
  await expect(toasts).not.toContainText("Copied to clipboard");
});
