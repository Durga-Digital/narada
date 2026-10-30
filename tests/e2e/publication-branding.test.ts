import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=",
  "base64",
);
test("brands a publication, previews safely, preserves conflicts and signs up from its public homepage", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(120000);
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_OWNER_PATH ?? ".local/owner.json",
      "utf8",
    ),
  );
  const stamp = Date.now(),
    name = `Field Notes ${stamp}`,
    slug = `field-notes-${stamp}`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Newsletters", exact: true }),
  ).toBeVisible();
  const pub = await page.evaluate(
    async ({ name, slug }) => {
      const post = async (path: string, body: unknown) => {
        const r = await fetch("/api/admin/" + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      };
      const p = await post("publications", {
        name,
        slug,
        description: "Thoughtful notes on building things that last.",
        author: "Studio editor",
        from: "hello@narada.test",
        organization: "Studio",
        postalAddress: "1 Test Street",
      });
      const active = await post(`publications/${p.id}/activate`, {
        revision: p.revision,
      });
      for (let n = 1; n <= 3; n++) {
        const issue = await post(`publications/${p.id}/issues`, {
          title: `A fresh perspective ${n}`,
          slug: `perspective-${n}`,
          subtitle: "Ideas worth carrying into the week.",
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "A note to our readers." }],
              },
            ],
          },
        });
        await post(`publications/${p.id}/issues/${issue.id}/publish`, {
          revision: issue.revision,
          channels: "web",
          confirmed: true,
        });
      }
      return active;
    },
    { name, slug },
  );
  await page.getByRole("button", { name: "Newsletters", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("tab", { name: "Website", exact: true }).click();
  await page.getByRole("radio", { name: /Editorial/ }).check();
  await page
    .getByLabel("Welcome message (optional)")
    .fill("A place to think slowly, share discoveries, and stay curious.");
  await page
    .getByLabel("Upload logo", { exact: true })
    .setInputFiles({ name: "studio.png", mimeType: "image/png", buffer: png });
  await expect(page.getByLabel("Logo description")).toBeVisible();
  await page.getByLabel("Logo description").fill("Studio logo");
  const preview = page.frameLocator(
    'iframe[title="Publication homepage preview"]',
  );
  await expect(preview.getByRole("img", { name: "Studio logo" })).toBeVisible();
  await expect
    .poll(() =>
      preview
        .getByRole("img", { name: "Studio logo" })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);
  await expect(
    preview.getByRole("button", { name: `Subscribe to ${name}` }),
  ).toBeDisabled();
  expect(await preview.locator("a[href]").count()).toBe(0);
  await page.getByRole("tab", { name: "Issues", exact: true }).click();
  await page.getByRole("tab", { name: "Website", exact: true }).click();
  await expect(page.getByLabel("Welcome message (optional)")).toHaveValue(
    "A place to think slowly, share discoveries, and stay curious.",
  );
  expect(await (await request.get(`/n/${slug}`)).text()).not.toContain(
    "Studio logo",
  );
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith("/branding"),
  );
  await page
    .getByRole("button", { name: "Save branding", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByText("Branding saved. Your public pages are up to date.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/branding-editor-desktop.png",
    fullPage: true,
  });
  const anonymous = await browser.newContext(),
    reader = await anonymous.newPage();
  await reader.goto(`/n/${slug}`);
  await expect(reader.locator("html")).toHaveAttribute(
    "data-theme",
    "editorial",
  );
  await expect(reader.getByRole("img", { name: "Studio logo" })).toBeVisible();
  await expect(reader.getByText("Latest issue", { exact: true })).toBeVisible();
  await expect(
    reader.getByRole("heading", { name: "Recent issues", exact: true }),
  ).toBeVisible();
  await reader.screenshot({
    path: ".local/branding-home-desktop.png",
    fullPage: true,
  });
  await reader.setViewportSize({ width: 390, height: 844 });
  expect(
    await reader.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await reader.screenshot({
    path: ".local/branding-home-mobile.png",
    fullPage: true,
  });
  await reader
    .getByLabel("Email", { exact: true })
    .fill(`branding-${stamp}@example.com`);
  await reader.getByRole("button", { name: `Subscribe to ${name}` }).click();
  await expect(
    reader.getByRole("heading", { name: "Check your email", exact: true }),
  ).toBeVisible();
  await expect(reader.locator("html")).toHaveAttribute(
    "data-theme",
    "editorial",
  );
  await page.getByRole("radio", { name: /Minimal/ }).check();
  await page
    .getByRole("button", { name: "Discard changes and reload" })
    .click();
  await expect(page.getByRole("radio", { name: /Editorial/ })).toBeChecked();
  // A stale base revision must preserve the user's edit and offer an explicit reload.
  await page.evaluate(async (id) => {
    const p = await (await fetch(`/api/admin/publications/${id}`)).json();
    const res = await fetch(`/api/admin/publications/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: { ...p.settings, description: "Changed elsewhere" },
        revision: p.revision,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
  }, pub.id);
  await page
    .getByLabel("Welcome message (optional)")
    .fill("Keep my unsaved work");
  await page
    .getByRole("button", { name: "Save branding", exact: true })
    .click();
  await expect(
    page
      .getByText("Resource changed; reload before continuing", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("Welcome message (optional)")).toHaveValue(
    "Keep my unsaved work",
  );
  await page
    .getByRole("button", { name: "Discard changes and reload" })
    .click();
  await expect(page.getByLabel("Welcome message (optional)")).toHaveValue(
    "A place to think slowly, share discoveries, and stay curious.",
  );
  await page.getByRole("button", { name: "Remove logo", exact: true }).click();
  await page
    .getByRole("button", { name: "Save branding", exact: true })
    .click();
  await expect(
    page.getByText("Branding saved. Your public pages are up to date.", {
      exact: true,
    }),
  ).toBeVisible();
  await reader.goto(`/n/${slug}`);
  await expect(reader.locator(".publication-logo")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Mobile", exact: true }).click();
  await expect(
    preview.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/branding-editor-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await anonymous.close();
});
