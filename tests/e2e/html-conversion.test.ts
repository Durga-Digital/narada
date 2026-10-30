import { readFile } from "node:fs/promises";
import { test, expect } from "../helpers/browser.js";

test("converts custom HTML into editable blocks with safe inline styling", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Broadcasts", exact: true }).click();
  const name = `Styled HTML ${Date.now()}`;
  const html = `<!doctype html><html><head>
    <style>body { background: red !important } @media(max-width:600px) { h1 { font-size: 20px } }</style>
    </head><body style="background:#eeeee7;font-family:Arial,sans-serif;margin:0">
    <div style="display:none;font-size:1px">Hidden inbox preview</div>
    <table role="presentation"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:600px;background:#f8f7f2;border-collapse:collapse">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #173f32">
        <h1 class="headline" id="imported-heading" style="font-family:Georgia,serif;font-size:38px;font-weight:normal;line-height:1.2;color:#173f32;margin:0 0 20px">An editable headline</h1>
        <p style="font-size:17px;line-height:27px;color:#334b3b">A paragraph with <span style="color:#b45309;font-weight:bold">styled text</span>.</p>
        <p><a href="https://example.com/product" style="display:inline-block;background:#173f32;color:#ffffff;padding:16px 22px;border-radius:6px;text-decoration:none">Explore the product</a></p>
        <p style="position:fixed;z-index:999999;inset:0;background:url(https://example.invalid/unsafe-css);color:rgb(180,83,9);--custom:red;transform:scale(10)" onclick="window.importExecuted=true">Safe text</p>
        <script>window.importExecuted=true</script>
      </td></tr>
    </table></td></tr></table></body></html>`;
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("example.invalid")) requests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const created = await page.request.post("/api/admin/broadcasts", {
    headers: { origin: new URL(page.url()).origin },
    data: { name, html, text: "An editable headline" },
  });
  expect(created.ok()).toBe(true);
  const record = await created.json();
  await page.reload();
  await page.getByRole("button", { name: "Broadcasts", exact: true }).click();
  await page.getByLabel("Search broadcasts").fill(name);
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
  await expect(page.getByLabel("Email HTML")).toHaveValue(html);
  await page
    .getByRole("button", { name: "Convert to blocks", exact: true })
    .click();

  const canvas = page.getByRole("textbox", {
    name: "Email message",
    exact: true,
  });
  const heading = canvas.getByRole("heading", { name: "An editable headline" });
  await expect(heading).toHaveCSS("color", "rgb(23, 63, 50)");
  await expect(heading).toHaveCSS("font-size", "38px");
  await expect(heading).toHaveCSS("font-family", "Georgia, serif");
  await expect(heading).toHaveCSS("text-align", "start");
  await expect(canvas.locator("td").last()).toHaveCSS("padding-left", "32px");
  await expect(canvas.getByText("styled text", { exact: true })).toHaveCSS(
    "color",
    "rgb(180, 83, 9)",
  );
  await expect(
    canvas.getByText("Hidden inbox preview", { exact: true }),
  ).not.toBeVisible();
  await expect(
    canvas.getByRole("link", { name: "Explore the product" }),
  ).toHaveAttribute("href", "https://example.com/product");
  const unsafe = canvas.getByText("Safe text", { exact: true });
  await expect(unsafe).not.toHaveCSS("position", "fixed");
  await expect(unsafe).toHaveCSS("background-image", "none");
  await expect(
    canvas.locator("script, style, [onclick], #imported-heading, .headline"),
  ).toHaveCount(0);
  expect(await page.evaluate(() => "importExecuted" in window)).toBe(false);

  // Editing the imported blocks must survive export and reopening, not merely
  // look styled in the initial DOM.
  await heading
    .locator("[data-node-view-content-react]")
    .fill("An editable headline updated");
  await expect(heading).toHaveText("An editable headline updated");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  const saved = await (
    await page.request.get(`/api/admin/broadcasts/${record.id}`)
  ).json();
  expect(saved.broadcast.draft.document.type).toBe("doc");
  expect(saved.broadcast.draft.html).toContain("An editable headline updated");
  expect(saved.broadcast.draft.html).toContain("font-size:38px");
  expect(saved.broadcast.draft.html).not.toContain("example.invalid");
  expect(saved.broadcast.draft.html).not.toContain("position:fixed");
  await page
    .getByRole("button", { name: "All broadcasts", exact: true })
    .click();
  await page.getByLabel("Search broadcasts").fill(name);
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
  await expect(
    canvas.getByRole("heading", { name: "An editable headline updated" }),
  ).toHaveCSS("color", "rgb(23, 63, 50)");
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
