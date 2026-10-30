import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
test("authors About, collections and curated navigation with private previews and mobile reading", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_OWNER_PATH ?? ".local/owner.json",
      "utf8",
    ),
  );
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Newsletters", exact: true }),
  ).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const post = async (path: string, body: unknown) => {
      const res = await fetch(`/api/admin/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    };
    let pub = await post("publications", {
      name: `Site Notes ${Date.now()}`,
      slug: `site-${Date.now()}`,
      from: "hello@narada.test",
      organization: "Studio",
      postalAddress: "1 Test Street",
    });
    pub = await post(`publications/${pub.id}/activate`, {
      revision: pub.revision,
    });
    const issue = await post(`publications/${pub.id}/issues`, {
      title: "A thoughtful letter",
      slug: "thoughtful",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "A letter for our readers" }],
          },
        ],
      },
    });
    await post(`publications/${pub.id}/issues/${issue.id}/publish`, {
      revision: issue.revision,
      channels: "web",
      confirmed: true,
    });
    return { pub, issue };
  });
  await page.getByRole("button", { name: "Newsletters", exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(fixture.pub.settings.name) })
    .click();
  await page.getByRole("tab", { name: "Collections", exact: true }).click();
  await page.getByLabel("Collection name", { exact: true }).fill("Deep Dives");
  await page.getByLabel("Collection slug", { exact: true }).fill("deep-dives");
  await page
    .getByLabel("Collection description", { exact: true })
    .fill("Careful research and practical advice.");
  await page
    .getByRole("button", { name: "Create collection", exact: true })
    .click();
  await expect(
    page.getByText("Collection saved to the website. No email was sent."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Issues", exact: true }).click();
  await page.getByRole("button", { name: /A thoughtful letter/ }).click();
  await page.getByText("Editorial collections", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Deep Dives" }).check();
  await page
    .getByRole("button", { name: "Save issue collections", exact: true })
    .click();
  await expect(
    page.getByText("Collections saved. No email was sent."),
  ).toBeVisible();
  await page.getByRole("button", { name: /All issues/ }).click();
  await page
    .getByLabel("Filter by collection", { exact: true })
    .selectOption({ label: "Deep Dives" });
  await expect(
    page.getByRole("button", { name: /A thoughtful letter/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Website", exact: true }).click();
  await page.getByRole("button", { name: "About", exact: true }).click();
  await page
    .getByLabel("About page title", { exact: true })
    .fill("About Site Notes");
  await page
    .getByRole("region", { name: "About content", exact: true })
    .locator('[contenteditable="true"]')
    .fill("We explain engineering through thoughtful research.");
  await page
    .getByRole("button", { name: "Save About draft", exact: true })
    .click();
  await expect(
    page.getByText("Draft saved. The public About page has not changed."),
  ).toBeVisible();
  const reader = await context.newPage();
  const initial = await reader.goto(`/n/${fixture.pub.settings.slug}/about`);
  expect(initial?.status()).toBe(404);
  await page
    .getByRole("button", { name: "Preview About", exact: true })
    .click();
  await expect(page.getByTitle("About preview", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Publish About", exact: true })
    .click();
  await expect(
    page.getByText("About is live. No email was sent."),
  ).toBeVisible();
  await reader.reload();
  await expect(
    reader.getByRole("heading", { name: "About Site Notes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "About content", exact: true })
    .locator('[contenteditable="true"]')
    .fill("PRIVATE NEXT REVISION");
  await page
    .getByRole("button", { name: "Save About draft", exact: true })
    .click();
  await expect(
    page.getByText("Draft saved. The public About page has not changed."),
  ).toBeVisible();
  await reader.reload();
  await expect(reader.getByText("PRIVATE NEXT REVISION")).toHaveCount(0);
  await page.getByRole("button", { name: "Navigation", exact: true }).click();
  await page
    .getByRole("button", { name: "Add navigation link", exact: true })
    .click();
  await page.getByLabel("Link 3 label", { exact: true }).fill("About");
  await page
    .getByLabel("Link 3 destination", { exact: true })
    .selectOption("about");
  await page
    .getByRole("button", { name: "Add navigation link", exact: true })
    .click();
  await page.getByLabel("Link 4 label", { exact: true }).fill("Research");
  await page
    .getByLabel("Link 4 destination", { exact: true })
    .selectOption({ label: "Deep Dives" });
  await page.getByRole("button", { name: "Homepage", exact: true }).click();
  await page
    .getByLabel("Featured issue", { exact: true })
    .selectOption({ label: "A thoughtful letter" });
  await page
    .getByLabel("Homepage collection 1", { exact: true })
    .selectOption({ label: "Deep Dives" });
  await page
    .getByRole("button", { name: "Save website draft", exact: true })
    .click();
  await expect(
    page.getByText(
      "Website draft saved. Publish to update navigation and homepage together.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Publish website", exact: true })
    .click();
  await expect(
    page.getByText("Website changes are live. No email was sent."),
  ).toBeVisible();
  await reader.goto(`/n/${fixture.pub.settings.slug}`);
  await expect(
    reader.getByRole("link", { name: "View all Deep Dives →" }),
  ).toBeVisible();
  await reader
    .getByRole("navigation", { name: "Publication navigation", exact: true })
    .getByRole("link", { name: "Research" })
    .click();
  await expect(
    reader.getByRole("heading", { name: "Deep Dives", exact: true }),
  ).toBeVisible();
  await expect(
    reader.getByRole("link", { name: "A thoughtful letter", exact: true }),
  ).toBeVisible();
  await reader.setViewportSize({ width: 390, height: 844 });
  await reader.getByText("Menu", { exact: true }).click();
  await reader
    .getByRole("navigation", { name: "Mobile publication navigation" })
    .getByRole("link", { name: "About", exact: true })
    .click();
  await expect(
    reader.getByRole("heading", { name: "About Site Notes" }),
  ).toBeVisible();
  expect(
    await reader.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await reader.screenshot({
    path: ".local/publication-site-mobile.png",
    fullPage: true,
  });
  await page.screenshot({
    path: ".local/publication-site-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Collections", exact: true }).click();
  await page.getByRole("button", { name: /Deep Dives.*active/ }).click();
  await page
    .getByRole("button", { name: "Archive collection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Deep Dives.*archived/ }),
  ).toBeVisible();
  const gone = await reader.goto(
    `/n/${fixture.pub.settings.slug}/c/deep-dives`,
  );
  expect(gone?.status()).toBe(404);
  await reader.close();
});
