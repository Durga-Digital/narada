import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
test("creates reusable templates, tests locally, publishes versions and starts a broadcast", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const stamp = Date.now(),
    alias = `welcome-${stamp}`,
    recipient = `template-${stamp}@example.com`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: "New template", exact: true }).click();
  await page
    .getByRole("button", { name: "Start with Welcome", exact: true })
    .click();
  await page.screenshot({
    path: ".local/template-gallery.png",
    fullPage: false,
  });
  await page.getByLabel("Template alias", { exact: true }).fill(alias);
  await page
    .getByRole("button", { name: "Create template", exact: true })
    .click();
  await expect(page.getByLabel("Email message", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email message", { exact: true })).toContainText(
    "Welcome aboard.",
  );
  await expect(page.getByLabel("Email HTML")).not.toBeVisible();
  await page.screenshot({ path: ".local/template-design.png", fullPage: true });
  // Switching workspaces must keep unsaved block edits mounted.
  await page.getByLabel("Email message", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A personal welcome from our team.");
  await page
    .getByRole("button", { name: "Preview & test", exact: true })
    .click();
  await page.getByLabel("Sample first_name").fill("Alex");
  await page
    .getByRole("button", { name: "Preview draft", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Template email preview"]')
      .getByText("Hi Alex,", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  await expect(page.locator("pre")).toContainText("Hi Alex,");
  await page.getByRole("button", { name: "Plain text", exact: true }).click();
  await expect(page.locator("pre")).toContainText("Your account is ready.");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page
    .getByRole("button", { name: "Mobile preview", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Template email preview"]')
      .getByText("A personal welcome from our team."),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await page
            .locator('iframe[title="Template email preview"]')
            .boundingBox()
        )?.width,
    )
    .toBe(375);
  await page.screenshot({
    path: ".local/template-preview.png",
    fullPage: true,
  });
  await page.getByLabel("Test sender").fill("hello@narada.test");
  await page.getByLabel("Test recipient").fill(recipient);
  await page
    .getByRole("button", { name: "Send template test", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Test email queued");
  let messageId = "";
  await expect
    .poll(
      async () => {
        const data = await (
          await request.get("http://localhost:8025/api/v1/messages?limit=100")
        ).json();
        const message = data.messages.find(
          (m: { ID: string; To: { Address: string }[] }) =>
            m.To.some((to) => to.Address === recipient),
        );
        messageId = message?.ID ?? "";
        return !!message;
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const captured = await (
    await request.get(`http://localhost:8025/api/v1/message/${messageId}`)
  ).json();
  expect(captured.HTML).toContain("Hi Alex,");
  expect(captured.Text).toContain("Hi Alex,");
  await page
    .getByRole("button", { name: "Publish template", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Published version 1.");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Changed {{vars.first_name}}");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Preview & test", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preview published", exact: true })
    .click();
  await expect(
    page.getByText("Subject: Welcome, Alex", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Templates", exact: true }).click();
  await page.getByLabel("Search templates").fill(alias);
  await expect(
    page.getByRole("button", { name: "Open template Welcome", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/templates-library.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open template Welcome", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open template Welcome", exact: true })
    .click();
  await expect(page.getByLabel("Email message", { exact: true })).toContainText(
    "A personal welcome from our team.",
  );
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await page
    .getByRole("button", { name: "Back to design", exact: true })
    .click();
  await expect(page.getByLabel("Message padding (px)")).toHaveValue("32");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/template-editor-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "← Templates", exact: true }).click();
  await page.getByRole("button", { name: "New template", exact: true }).click();
  await page
    .getByRole("button", { name: "Start with Product update", exact: true })
    .click();
  await page
    .getByLabel("Template alias", { exact: true })
    .fill(`update-${stamp}`);
  await page
    .getByRole("button", { name: "Create template", exact: true })
    .click();
  await expect(page.getByLabel("Email message", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Publish template", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Published version 1.");
  await page
    .getByRole("navigation", { name: "Template workspace" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use in broadcast", exact: true })
    .click();
  await expect(page.getByLabel("Email message", { exact: true })).toContainText(
    "Something new for you",
  );
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(
    "News from our team",
  );
  await page
    .getByRole("button", { name: "Save as template", exact: true })
    .click();
  await page
    .getByLabel("Template alias", { exact: true })
    .fill(`reused-${stamp}`);
  await page
    .getByRole("button", { name: "Create reusable template", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Reusable draft created in Templates.",
  );
  await page
    .getByRole("button", { name: "All templates", exact: true })
    .click();
  await expect(page.getByLabel("Search templates")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/templates-mobile.png",
    fullPage: false,
  });
  expect(errors).toEqual([]);
});

test("opens legacy starters as blocks and preserves imported HTML until conversion", async ({
  page,
}) => {
  const { starters } =
    await import("../../apps/web/src/features/templates/starters.js");
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  const stamp = Date.now();
  const legacy = await page.request.post("/api/admin/templates", {
    headers: { origin: "http://localhost:5173" },
    data: {
      ...starters.welcome,
      document: undefined,
      name: `Legacy ${stamp}`,
      alias: `legacy-${stamp}`,
    },
  });
  expect(legacy.ok()).toBe(true);
  const html =
    '<html><body style="background:#ffeedd"><table role="presentation"><tr><td style="padding:17px"><h1>Custom imported design</h1><p>Keep my exact markup.</p></td></tr></table></body></html>';
  const imported = await page.request.post("/api/admin/templates", {
    headers: { origin: "http://localhost:5173" },
    data: {
      name: `Imported ${stamp}`,
      alias: `imported-${stamp}`,
      subject: "Custom email",
      html,
      text: "Keep my exact plain text.",
    },
  });
  expect(imported.ok()).toBe(true);
  const record = await imported.json();
  await page.reload();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page
    .getByRole("button", { name: `Open template Legacy ${stamp}`, exact: true })
    .click();
  await expect(page.getByLabel("Email message", { exact: true })).toContainText(
    "Welcome aboard.",
  );
  await page.getByRole("button", { name: "← Templates", exact: true }).click();
  await page
    .getByRole("button", {
      name: `Open template Imported ${stamp}`,
      exact: true,
    })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Imported template preview"]')
      .getByRole("heading", { name: "Custom imported design" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email HTML")).not.toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  let saved = await (
    await page.request.get(`/api/admin/templates/${record.id}`)
  ).json();
  expect(saved.draft.html).toBe(html);
  expect(saved.draft.text).toBe("Keep my exact plain text.");
  expect(saved.draft.document).toBeUndefined();
  await page.getByRole("button", { name: "Edit HTML", exact: true }).click();
  await expect(page.getByLabel("Email HTML")).toHaveValue(html);
  await page
    .getByRole("button", { name: "Convert to blocks", exact: true })
    .click();
  await expect(page.getByLabel("Email message", { exact: true })).toContainText(
    "Custom imported design",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  saved = await (
    await page.request.get(`/api/admin/templates/${record.id}`)
  ).json();
  expect(saved.draft.document.type).toBe("doc");
});
