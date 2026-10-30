import { expect, test } from "../helpers/browser.js";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`form transitions preserve focus and answers with motion preference ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    let submissions = 0;
    await page.route(
      "**/api/forms/11111111-1111-4111-8111-111111111111**",
      (route) => {
        if (route.request().method() === "POST") {
          submissions++;
          return route.fulfill({ json: { success: true } });
        }
        return route.fulfill({
          json: {
            version: 1,
            content: {
              name: "A little about you",
              description: "Let’s start a conversation.",
              brand: "Narada Studio",
              color: "#345d37",
              thankYou: "Thanks for sharing.",
              questions: [
                {
                  id: "name",
                  type: "text",
                  label: "What’s your name?",
                  description: "",
                  required: true,
                  property: "",
                  options: [],
                },
                {
                  id: "rating",
                  type: "rating",
                  label: "How was your experience?",
                  description: "",
                  required: true,
                  property: "",
                  options: [],
                },
              ],
            },
          },
        });
      },
    );
    await page.goto("/forms/11111111-1111-4111-8111-111111111111");
    await page.getByRole("button", { name: "Let’s begin" }).click();
    const heading = page.getByRole("heading");
    await expect(heading).toHaveText("What’s your name?");
    await expect(heading).toBeFocused();
    const input = page.getByRole("textbox", { name: "What’s your name?" });
    await input.fill("Ada");
    await expect(input).toBeFocused();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    if (reducedMotion === "no-preference") {
      // The outgoing panel stays for its exit animation, but cannot receive input.
      await expect(page.locator(".narada-form-step[inert]")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
    await expect(heading).toHaveText("How was your experience?");
    await expect(heading).toBeFocused();
    await expect(page.locator(".narada-form-step")).toHaveAttribute(
      "data-direction",
      "forward",
    );
    await page.getByRole("button", { name: "Previous question" }).click();
    await expect(heading).toHaveText("What’s your name?");
    await expect(heading).toBeFocused();
    await expect(input).toHaveValue("Ada");
    await expect(page.locator(".narada-form-step")).toHaveAttribute(
      "data-direction",
      "backward",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(heading).toHaveText("How was your experience?");
    if (reducedMotion === "reduce") {
      await expect(page.locator(".narada-form-step")).toHaveCSS(
        "transform",
        "none",
      );
      await expect(page.locator(".narada-form-step")).toHaveCSS("opacity", "1");
    }
    await page.getByRole("radio", { name: "5", exact: true }).check();
    await expect(heading).toHaveText("Ready to send?");
    await expect(heading).toBeFocused();
    expect(submissions).toBe(0);
    await page.getByRole("button", { name: "Submit response" }).click();
    await expect(heading).toHaveText("You’re all set.");
    await expect(heading).toBeFocused();
    expect(submissions).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
