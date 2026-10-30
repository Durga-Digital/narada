import { expect, test } from "../helpers/browser.js";

test("option selection advances once, preserves answers, and cancels pending navigation", async ({
  page,
}) => {
  await page.route(
    "**/api/forms/11111111-1111-4111-8111-111111111111",
    (route) =>
      route.fulfill({
        json: {
          version: 1,
          content: {
            name: "Tell us what you think",
            description: "A few questions to help us improve.",
            brand: "Narada Studio",
            color: "#345d37",
            thankYou: "Thanks for sharing.",
            questions: [
              {
                id: "rating",
                type: "rating",
                label: "How was your experience?",
                description: "",
                required: true,
                options: [],
                property: "",
              },
              {
                id: "choice",
                type: "choice",
                label: "What stood out to you?",
                description: "We’d love to know what made a difference.",
                required: true,
                options: [
                  "The personal attention",
                  "How simple everything felt",
                  "The thoughtful details",
                ],
                property: "",
              },
              {
                id: "consent",
                type: "consent",
                label: "Keep me in the loop with occasional news and updates.",
                description: "",
                required: false,
                options: [],
                property: "",
              },
            ],
          },
        },
      }),
  );
  // Isolate navigation timers; the Motion lifecycle has its own browser coverage.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto("/forms/11111111-1111-4111-8111-111111111111");
  await page.getByRole("button", { name: "Let’s begin" }).click();
  const heading = page.getByRole("heading");
  const rating = (value: string) =>
    page.getByRole("radio", { name: value, exact: true });
  await expect(rating("5")).not.toBeChecked();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Please answer");
  await heading.focus();
  await page.keyboard.press("5");
  await expect(rating("5")).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(heading).toHaveText("How was your experience?");
  await page.keyboard.press("ArrowLeft");
  await expect(rating("4")).toBeChecked();
  await page.clock.runFor(200);
  // Changing the answer restarts the delay instead of queuing another advance.
  await expect(heading).toHaveText("How was your experience?");
  await page.clock.runFor(200);
  await expect(heading).toHaveText("What stood out to you?");
  await expect(heading).toBeFocused();
  await page.keyboard.press("b");
  await expect(
    page.getByRole("radio", {
      name: "How simple everything felt",
      exact: true,
    }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Previous question" }).click();
  await page.clock.runFor(500);
  await expect(heading).toHaveText("How was your experience?");
  await expect(rating("4")).toBeChecked();
  // Clicking the saved answer works even though its value hasn't changed.
  await rating("4").click();
  await page.clock.runFor(400);
  await expect(heading).toHaveText("What stood out to you?");
  await page.keyboard.press("b");
  await page.keyboard.press("Enter");
  await page.clock.runFor(500);
  await expect(heading).toHaveText("Would you like to stay in touch?");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await page.clock.runFor(500);
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(heading).toHaveText("Would you like to stay in touch?");
  await page.getByRole("button", { name: "Previous question" }).click();
  await page.getByRole("button", { name: "Previous question" }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await rating("5").evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(44);
  await rating("5").check();
  await page.clock.runFor(400);
  await expect(heading).toHaveText("What stood out to you?");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("radio", { name: "The thoughtful details", exact: true })
    .check();
  expect(
    await page
      .locator(".narada-form-choice")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.clock.runFor(400);
  await expect(heading).toHaveText("Would you like to stay in touch?");
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.clock.runFor(500);
  await expect(heading).toHaveText("Ready to send?");
  await expect(
    page.getByText("The thoughtful details", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Yes", { exact: true })).toBeVisible();
});
