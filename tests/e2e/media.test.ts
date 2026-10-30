import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=",
  "base64",
);
test("uploads and reuses images in issues and templates, with web video and email fallback", async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(120000);
  const stamp = Date.now(),
    name = `Media ${stamp}`,
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Player/thumbnail availability depends on YouTube. Verify our markup without calling it.
  await context.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Video player fixture</p>",
    }),
  );
  await context.route("https://i.ytimg.com/**", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Newsletters", exact: true }),
  ).toBeVisible();
  const publication = await page.evaluate(
    async ({ name, stamp }) => {
      const post = async (path: string, body: unknown) => {
        const r = await fetch("/api/admin/" + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      };
      const pub = await post("publications", {
        name,
        slug: `media-${stamp}`,
        from: "hello@narada.test",
        author: "Editor",
        organization: "Narada",
        postalAddress: "1 Test Street",
      });
      return post(`publications/${pub.id}/activate`, {
        revision: pub.revision,
      });
    },
    { name, stamp },
  );
  await page.getByRole("button", { name: "Newsletters", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/issues"),
  );
  await page.getByRole("button", { name: "New issue", exact: true }).click();
  const issue = await (await created).json();
  await page.getByRole("button", { name: "Image", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Image library" }),
  ).toBeVisible();
  await page.getByLabel("Upload image", { exact: true }).setInputFiles({
    name: `pixel-${stamp}.png`,
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByRole("button", { name: "Insert image", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Image description (alt text)")
    .fill("Our reusable image");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Email message",
    exact: true,
  });
  await expect(
    editor.getByRole("img", { name: "Our reusable image", exact: true }),
  ).toBeAttached();
  const src = await editor
    .getByRole("img", { name: "Our reusable image", exact: true })
    .getAttribute("src");
  expect(src).toMatch(/\/media\/[a-f0-9]{64}\.png$/);
  await expect
    .poll(() =>
      editor
        .locator("img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);
  await page.getByRole("button", { name: "YouTube", exact: true }).click();
  await page.getByLabel("YouTube URL").fill("https://youtu.be/dQw4w9WgXcQ");
  await page
    .getByLabel("Video title", { exact: true })
    .fill("Video demonstration");
  await page.getByRole("button", { name: "Insert video", exact: true }).click();
  await editor.locator("p").last().click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "https://youtu.be/dQw4w9WgXcQ");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  await expect(editor.locator("[data-youtube]")).toHaveCount(2);
  await page.getByRole("button", { name: "Save issue", exact: true }).click();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview saved issue", exact: true })
    .click();
  const web = page.frameLocator('iframe[title="Issue web preview"]');
  await expect(web.locator("iframe").first()).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  await page
    .getByRole("button", { name: "Email preview", exact: true })
    .click();
  const email = page.frameLocator('iframe[title="Issue email preview"]');
  await expect(email.locator("iframe")).toHaveCount(0);
  await expect(
    email.getByRole("img", { name: "Our reusable image", exact: true }),
  ).toHaveAttribute("src", src!);
  await expect
    .poll(() =>
      email
        .getByRole("img", { name: "Our reusable image", exact: true })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);
  await expect(
    email
      .getByRole("link", {
        name: "Watch Video demonstration on YouTube",
        exact: true,
      })
      .last(),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const recipient = `media-${stamp}@example.com`;
  await page.getByLabel("Test email address").fill(recipient);
  await page
    .getByRole("button", { name: "Send test email", exact: true })
    .click();
  await expect(
    page.getByText("Test email queued. The issue has not been distributed.", {
      exact: true,
    }),
  ).toBeVisible();
  let mailId = "";
  await expect
    .poll(
      async () => {
        const mailbox = await (
          await request.get("http://localhost:8025/api/v1/messages?limit=200")
        ).json();
        mailId =
          mailbox.messages.find(
            (message: { To: { Address: string }[]; ID: string }) =>
              message.To.some((to) => to.Address === recipient),
          )?.ID ?? "";
        return Boolean(mailId);
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const delivered = await (
    await request.get(`http://localhost:8025/api/v1/message/${mailId}`)
  ).json();
  expect(delivered.HTML).toContain(src);
  expect(delivered.HTML).toContain(
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  expect(delivered.HTML).not.toContain("<iframe");
  expect(delivered.Text).toContain(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  await page.getByRole("button", { name: /All issues$/ }).click();
  await page.getByRole("button", { name: /Untitled issue/ }).click();
  await expect(editor.locator("[data-youtube]")).toHaveCount(2);
  await expect(
    editor.getByRole("img", { name: "Our reusable image", exact: true }),
  ).toHaveAttribute("src", src!);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/media-editor-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const slug = await page.evaluate(
    async ({ publicationId, issueId }) => {
      const base = `/api/admin/publications/${publicationId}/issues/${issueId}`;
      const { issue } = await (await fetch(base)).json();
      const response = await fetch(base + "/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: issue.revision,
          channels: "web",
          confirmed: true,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      return issue.draft.slug;
    },
    { publicationId: publication.id, issueId: issue.id },
  );
  const publicPage = await context.newPage();
  await publicPage.goto(`/n/${publication.settings.slug}/p/${slug}`);
  await expect(
    publicPage.getByRole("img", { name: "Our reusable image", exact: true }),
  ).toHaveAttribute("src", src!);
  await expect(publicPage.locator("iframe").first()).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  await publicPage.close();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: "New template", exact: true }).click();
  await page
    .getByRole("button", { name: "Start with Welcome", exact: true })
    .click();
  await page
    .getByLabel("Template alias", { exact: true })
    .fill(`media-${stamp}`);
  await page
    .getByRole("button", { name: "Create template", exact: true })
    .click();
  await page.getByRole("button", { name: "Image", exact: true }).click();
  await page
    .getByRole("group", { name: "Saved images" })
    .getByRole("button")
    .filter({ has: page.locator(`img[src="${src}"]`) })
    .click();
  await page.getByLabel("Image description (alt text)").fill("Template image");
  await page.getByRole("button", { name: "Insert image", exact: true }).click();
  await page.getByRole("button", { name: "YouTube", exact: true }).click();
  await page.getByLabel("YouTube URL").fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByLabel("Video title", { exact: true }).fill("Template video");
  await page.getByRole("button", { name: "Insert video", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  const html = await page.getByLabel("Email HTML").inputValue();
  expect(html).toContain(src);
  expect(html).toContain("Template image");
  expect(html).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  expect(html).not.toContain("<iframe");
  await page
    .getByRole("button", { name: "Back to design", exact: true })
    .click();
  await expect(
    page
      .getByLabel("Email message", { exact: true })
      .getByRole("img", { name: "Template image", exact: true }),
  ).toHaveAttribute("src", src!);
  expect(errors).toEqual([]);
});
