import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
test.use({ actionTimeout: 15000 });
test("creates a publication, confirms a reader, publishes an issue, corrects its archive and honors unsubscribe", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(180000);
  const stamp = Date.now(),
    name = `Studio ${stamp}`,
    slug = `studio-${stamp}`,
    email = `newsletter-${stamp}@example.com`;
  const owner = JSON.parse(
      await readFile(
        process.env.NARADA_TEST_OWNER_PATH ?? ".local/owner.json",
        "utf8",
      ),
    ),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Newsletters", exact: true }).click();
  await expect(
    page.getByLabel("Publication name", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Create publication", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Create a publication" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Create publication", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Create publication", exact: true })
    .click();
  await page.getByLabel("Publication name", { exact: true }).fill(name);
  await page.getByLabel("Publication URL slug").fill(slug);
  await page
    .getByRole("button", { name: "Create publication", exact: true })
    .click();
  await page.getByRole("button", { name: "Set up publication" }).click();
  await expect(
    page.getByRole("tab", { name: "Settings", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "Domain", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "Collections", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "Website", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Collections", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Domain", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tabpanel", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Sender email", { exact: true })
    .fill("hello@narada.test");
  await page.getByLabel("Organization", { exact: true }).fill("Studio");
  await page.getByLabel("Postal address").fill("1 Test Street");
  await page.getByLabel("Author display name").fill("Studio editor");
  const savedSettings = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes("/publications/"),
  );
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  expect((await savedSettings).status()).toBe(200);
  await page.getByRole("button", { name: "Preview saved branding" }).click();
  await expect(
    page
      .frameLocator('iframe[title="Publication branding preview"]')
      .getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  expect((await request.get(`http://localhost:5173/n/${slug}`)).status()).toBe(
    404,
  );
  await page.getByRole("button", { name: "Save and activate" }).click();
  await expect(
    page.getByRole("link", { name: "Subscribe page", exact: true }),
  ).toBeVisible();
  const anonymous = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    reader = await anonymous.newPage();
  await reader.goto(`http://localhost:5173/n/${slug}/subscribe`);
  await reader.getByLabel("Email", { exact: true }).fill(email);
  await reader.getByLabel("Name (optional)").fill("Newsletter reader");
  await reader.getByRole("button", { name: `Subscribe to ${name}` }).click();
  await expect(
    reader.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  let mailId = "";
  await expect
    .poll(
      async () => {
        const mailbox = await (
          await request.get(
            `${process.env.NARADA_TEST_MAIL_URL ?? "http://localhost:8025"}/api/v1/messages?limit=200`,
          )
        ).json();
        mailId =
          mailbox.messages.find(
            (m: { ID: string; Subject: string; To: { Address: string }[] }) =>
              m.Subject.startsWith("Confirm your response:") &&
              m.To.some((to) => to.Address === email),
          )?.ID ?? "";
        return !!mailId;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  const confirmation = await (
    await request.get(
      `${process.env.NARADA_TEST_MAIL_URL ?? "http://localhost:8025"}/api/v1/message/${mailId}`,
    )
  ).json();
  const link = confirmation.Text.match(
    /http:\/\/localhost:5173\/n\/[^\s]+\/confirm\?token=\S+/,
  )?.[0];
  expect(link).toBeTruthy();
  await reader.goto(link);
  expect(
    (
      await page.request.get(`/api/admin/contacts/${encodeURIComponent(email)}`)
    ).status(),
  ).toBe(404);
  await reader.getByRole("button", { name: "Confirm subscription" }).click();
  await expect(
    reader.getByRole("heading", { name: "Subscribed", exact: true }),
  ).toBeVisible();
  expect(
    await reader.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: "Subscribers", exact: true }).click();
  await expect(
    page.getByText("1 confirmed subscriptions · 1 eligible for delivery"),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Issues", exact: true }).click();
  await page.getByRole("button", { name: "New issue", exact: true }).click();
  await page.getByLabel("Issue title").fill(`Welcome ${stamp}`);
  await page.getByLabel("Issue URL slug").fill("welcome");
  const editor = page.getByRole("textbox", { name: "Email message" });
  await expect(editor).toBeVisible();
  await editor.fill("A first letter to our readers.");
  await editor.press("ControlOrMeta+a");
  const formatting = page.getByRole("group", { name: "Issue formatting" });
  await formatting.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(
    formatting.getByRole("button", { name: "Bold", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await formatting.getByRole("button", { name: "Add or edit link" }).click();
  await page.getByLabel("Link URL").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Apply link" }).click();
  await expect(
    page.getByText("Use an https, http or mailto link.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Link URL").fill("https://example.com/studio");
  await page.getByRole("button", { name: "Apply link" }).click();
  await expect(editor.locator("a strong")).toHaveText(
    "A first letter to our readers.",
  );
  await page.getByLabel("Text style", { exact: true }).selectOption("2");
  await expect(editor.locator("h2")).toHaveText(
    "A first letter to our readers.",
  );
  // Click the trailing paragraph to begin a new block after formatting the selection.
  await editor.locator("p").last().click();
  await formatting
    .getByRole("button", { name: "Bullet list", exact: true })
    .click();
  await editor.pressSequentially("This week in the studio.");
  await expect(editor.locator("li")).toContainText("This week in the studio.");
  await editor.press("Enter");
  await editor.press("Enter");
  await editor.pressSequentially("/");
  await expect(page.getByText("Quote", { exact: true })).toBeVisible();
  await expect(page.getByText("2 columns", { exact: true })).not.toBeVisible();
  await page.getByText("Quote", { exact: true }).click();
  await expect(editor).toBeFocused();
  await editor.pressSequentially("Make room for new ideas.");
  await expect(editor.locator("blockquote")).toHaveText(
    "Make room for new ideas.",
  );
  await expect(editor.locator("h2")).toHaveText(
    "A first letter to our readers.",
  );
  await page.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All issues", exact: false }).click();
  await page
    .getByRole("button", { name: new RegExp(`Welcome ${stamp}`) })
    .click();
  await expect(editor.locator("h2 a strong")).toHaveText(
    "A first letter to our readers.",
  );
  await expect(editor.locator("blockquote")).toHaveText(
    "Make room for new ideas.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/newsletter-editor-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Subtitle").fill("Notes from the studio");
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Test email address").fill(email);
  await page
    .getByRole("button", { name: "Send test email", exact: true })
    .click();
  await expect(
    page.getByText("Test email queued. The issue has not been distributed.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await request.get(`http://localhost:5173/n/${slug}/p/welcome`)).status(),
  ).toBe(404);
  await page
    .getByRole("button", { name: "Review and publish", exact: true })
    .click();
  await expect(page.getByText(/1 eligible recipients/)).toBeVisible();
  await page.getByRole("button", { name: "Publish now", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "View public issue" }),
  ).toBeVisible();
  await reader.goto(`http://localhost:5173/n/${slug}/archive`);
  await reader
    .getByRole("link", { name: `Welcome ${stamp}`, exact: true })
    .click();
  await expect(
    reader.getByRole("heading", { name: `Welcome ${stamp}`, exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByText("A first letter to our readers.", { exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole("heading", {
      level: 2,
      name: "A first letter to our readers.",
    }),
  ).toBeVisible();
  await expect(
    reader.getByRole("link", { name: "A first letter to our readers." }),
  ).toHaveAttribute("href", "https://example.com/studio");
  await expect(reader.locator("blockquote")).toHaveText(
    "Make room for new ideas.",
  );
  await reader.screenshot({
    path: ".local/newsletter-public-mobile.png",
    fullPage: true,
  });
  await page.screenshot({
    path: ".local/newsletter-editor.png",
    fullPage: true,
  });
  let issueMail = "";
  await expect
    .poll(
      async () => {
        const mailbox = await (
          await request.get(
            `${process.env.NARADA_TEST_MAIL_URL ?? "http://localhost:8025"}/api/v1/messages?limit=200`,
          )
        ).json();
        const found = mailbox.messages.filter(
          (m: { ID: string; Subject: string; To: { Address: string }[] }) =>
            m.Subject === `Welcome ${stamp}` &&
            m.To.some((to) => to.Address === email),
        );
        issueMail = found[0]?.ID ?? "";
        return found.length;
      },
      { timeout: 30000 },
    )
    .toBe(1);
  await page.getByLabel("Issue title").fill(`Corrected ${stamp}`);
  await page
    .getByRole("button", { name: "Review web correction", exact: true })
    .click();
  const correctionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/publish") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Publish web correction", exact: true })
    .click();
  expect((await correctionResponse).status()).toBe(202);
  await reader.reload();
  await expect(
    reader.getByRole("heading", { name: `Corrected ${stamp}`, exact: true }),
  ).toBeVisible();
  const captured = await (
      await request.get(
        `${process.env.NARADA_TEST_MAIL_URL ?? "http://localhost:8025"}/api/v1/message/${issueMail}`,
      )
    ).json(),
    unsubscribe = captured.Text.match(/Unsubscribe: (\S+)/)?.[1];
  expect(unsubscribe).toBeTruthy();
  await reader.goto(unsubscribe);
  await reader
    .getByRole("button", { name: /Unsubscribe/i })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Duplicate issue", exact: true })
    .click();
  await page.getByRole("tab", { name: "Subscribers", exact: true }).click();
  await expect(
    page.getByText("0 confirmed subscriptions · 0 eligible for delivery"),
  ).toBeVisible();
  await page.getByRole("button", { name: email, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Contact preferences", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "Issues", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Issues", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page
      .getByRole("button", { name: new RegExp(`Corrected ${stamp}`) })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/newsletter-publication.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Archive publication", exact: true })
    .click();
  await expect(
    page.getByText("archived publication", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "All publications", exact: false })
    .click();
  await expect(
    page.getByRole("button", { name: new RegExp(name) }),
  ).not.toBeVisible();
  await page.getByLabel("Show publications").selectOption("archived");
  await expect(
    page.getByRole("button", { name: new RegExp(name) }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/newsletter-library.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/newsletter-library-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(
    page.getByRole("button", { name: "New issue", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
  await anonymous.close();
});
