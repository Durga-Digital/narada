import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
test("organizes settings into accessible tabs and preserves sending, recipient and security controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const ses = page.getByRole("tab", { name: "Amazon SES", exact: true });
  await expect(ses).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "You're working locally" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Account status and quotas are not applicable in local mode.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Two-factor authentication" }),
  ).not.toBeVisible();
  await page.screenshot({
    path: ".local/settings-desktop.png",
    fullPage: true,
  });
  await ses.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Sending", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const initial = await (await page.request.get("/api/admin/settings")).json();
  try {
    await page
      .getByRole("button", {
        name: initial.paused ? "Resume sending" : "Pause sending",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      initial.paused ? "Sending resumed." : "Sending paused.",
    );
    expect(
      (await (await page.request.get("/api/admin/settings")).json()).paused,
    ).toBe(!initial.paused);
    await page
      .getByRole("button", {
        name: initial.paused ? "Pause sending" : "Resume sending",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      initial.paused ? "Sending paused." : "Sending resumed.",
    );
  } finally {
    await page.request.post("/api/admin/settings", {
      headers: { origin: "http://localhost:5173" },
      data: { paused: initial.paused },
    });
  }
  await page.getByRole("tab", { name: "Recipients", exact: true }).click();
  const email = `settings-${Date.now()}@example.com`;
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Suppress address", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Address suppressed");
  await page.getByLabel("Search suppressed recipients").fill(email);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: `Remove suppression for ${email}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Suppression removed");
  await expect(
    page.getByText("No recipients match your search."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Security", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Two-factor authentication" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recovery email", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Amazon SES", "Sending", "Recipients"])
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/settings-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});
