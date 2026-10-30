import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";

test("owner manages password and recovery sender through Profile on desktop and mobile", async ({
  page,
}) => {
  // Password mutations must never run against the shared development owner.
  test.skip(
    !process.env.NARADA_TEST_OWNER_FILE,
    "Requires an isolated owner fixture",
  );
  const owner = JSON.parse(
    await readFile(process.env.NARADA_TEST_OWNER_FILE!, "utf8"),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?page=profile");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Profile", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Security", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "Two-factor authentication" }),
  ).toBeVisible();

  const newPassword = "Browser-new-password-strong-123";
  await page
    .getByLabel("Current password", { exact: true })
    .fill(owner.password);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(newPassword + "different");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByText("Your new passwords don’t match.", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(newPassword);
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByText(
      "Password changed. Use your new password the next time you sign in.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue(
    "",
  );
  await page.getByLabel("Recovery sending domain").selectOption("narada.test");
  await expect(
    page.getByRole("button", { name: "Send reset link", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Save recovery sender", exact: true })
    .click();
  await expect(
    page.getByText("Recovery sender saved", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByLabel("Recovery sending domain")).toHaveValue(
    "narada.test",
  );
  await page
    .getByRole("button", { name: "Send reset link", exact: true })
    .click();
  await expect(
    page.getByText(/Reset link requested\. Check your inbox/),
  ).toBeVisible();
  await page.screenshot({ path: ".local/profile-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Profile", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/profile-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Navigation", exact: false }).click();
  await expect(
    page.getByRole("button", { name: "Profile", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("button", { name: "Forgot your password?", exact: true })
    .click();
  await page.getByLabel("Email address").fill(owner.email);
  await page
    .getByRole("button", { name: "Send reset link", exact: true })
    .click();
  await expect(
    page.getByText(/If that account exists, a reset link is on its way/),
  ).toBeVisible();

  const mailpit = process.env.MAILPIT_URL ?? "http://localhost:8025";
  const mailbox = await (
    await page.request.get(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${owner.email}`)}`,
    )
  ).json();
  expect(mailbox.messages).toHaveLength(2);
  const message = await (
    await page.request.get(
      `${mailpit}/api/v1/message/${mailbox.messages[0].ID}`,
    )
  ).json();
  expect(message.From.Address).toBe("security@narada.test");
  expect(message.To.map((to: { Address: string }) => to.Address)).toEqual([
    owner.email,
  ]);
  const resetLink = message.Text.match(/https?:\/\/\S+/)[0];
  await page.goto(resetLink);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Set password", exact: true }).click();
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByLabel("Recovery sending domain")).toHaveValue(
    "narada.test",
  );
  expect(errors).toEqual([]);
});
