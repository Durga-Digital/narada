import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=",
  "base64",
);
test("brands fixed layouts, distinguishes archive, filters issues and deletes a draft", async ({
  page,
}) => {
  test.setTimeout(120000);
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_OWNER_PATH ?? ".local/owner.json",
      "utf8",
    ),
  );
  const name = `Design Notes ${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Newsletters", exact: true }),
  ).toBeVisible();
  const pub = await page.evaluate(async (name) => {
    const post = async (path: string, body: unknown) => {
      const r = await fetch("/api/admin/" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    };
    let p = await post("publications", {
      name,
      slug: `design-${Date.now()}`,
      description: "Thoughtful ideas for the week ahead.",
      from: "hello@narada.test",
      organization: "Studio",
      postalAddress: "1 Test Street",
      author: "The Studio",
    });
    p = await post(`publications/${p.id}/activate`, { revision: p.revision });
    for (const [slug, title] of [
      ["public", "The shape of a good idea"],
      ["draft", "Unpublished notes"],
    ]) {
      const i = await post(`publications/${p.id}/issues`, {
        slug,
        title,
        subtitle: "Small observations, lasting possibilities.",
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "A thoughtful note to our readers." },
              ],
            },
          ],
        },
      });
      if (slug === "public")
        await post(`publications/${p.id}/issues/${i.id}/publish`, {
          revision: i.revision,
          channels: "web",
          confirmed: true,
        });
    }
    return p;
  }, name);
  await page.getByRole("button", { name: "Newsletters", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Unpublished notes/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /The shape of a good idea/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Unpublished notes/ }).click();
  await page.getByText("Issue cover image", { exact: true }).click();
  await page
    .getByLabel("Upload issue cover", { exact: true })
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByLabel("Issue cover description", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Issue cover description", { exact: true })
    .fill("A quiet horizon");
  await page.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete draft", exact: true }).click();
  await page.getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Issue editor" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete draft permanently", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Issues", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Unpublished notes/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Published", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /The shape of a good idea/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete draft", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Website", exact: true }).click();
  await page
    .getByLabel("Homepage layout", { exact: true })
    .selectOption("grid");
  await page
    .getByLabel("Signup heading", { exact: true })
    .fill("Good ideas, every Friday");
  await page
    .getByLabel("Signup description", { exact: true })
    .fill("One thoughtful letter. No noise.");
  await page
    .getByLabel("Signup button text", { exact: true })
    .fill("Count me in");
  await page.getByLabel("Ask for an optional name", { exact: true }).uncheck();
  await page.getByLabel("Upload wordmark", { exact: true }).setInputFiles({
    name: "wordmark.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByLabel("Wordmark description", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Wordmark description", { exact: true })
    .fill("Design Notes wordmark");
  await page
    .getByLabel("Upload homepage cover", { exact: true })
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByLabel("Homepage cover description", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save branding", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save branding", exact: true }),
  ).toBeDisabled();
  await page.goto(`/n/${pub.settings.slug}`);
  await expect(page.locator(".layout-grid")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Good ideas, every Friday" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Count me in" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Name (optional)" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Design Notes wordmark" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/branding-v2-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/branding-v2-mobile.png",
    fullPage: true,
  });
  await page.getByText("Menu", { exact: true }).click();
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Archive", exact: true }),
  ).toBeVisible();
  await page.getByText("Menu", { exact: true }).click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good ideas, every Friday" }),
  ).toBeVisible();
});
