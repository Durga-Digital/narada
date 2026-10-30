import { test, expect, type APIRequestContext } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
test.use({ actionTimeout: 10000 });
test("saves metadata edits on an existing source-mode broadcast", async ({
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

  const original = {
    name: `Source metadata ${Date.now()}`,
    subject: "Original subject",
    from: "Original <hello@narada.test>",
    replyTo: "original@example.com",
    organization: "Original organization",
    postalAddress: "1 Original Street",
    html: '<h1 style="color:#234567">Preserve this source</h1>',
    text: "Preserve this plain text",
  };
  const response = await page.request.post("/api/admin/broadcasts", {
    headers: { origin: new URL(page.url()).origin },
    data: original,
  });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  await page.reload();
  await page.getByRole("button", { name: "Broadcasts", exact: true }).click();
  await page.getByLabel("Search broadcasts").fill(original.name);
  await page
    .getByRole("button", { name: `Open ${original.name}`, exact: true })
    .click();
  await expect(page.getByLabel("Email HTML")).toHaveValue(original.html);

  // First save changes only metadata; a second also edits the source body.
  for (const editBody of [false, true]) {
    const edited = {
      name: `${original.name} ${editBody ? "second" : "first"} edit`,
      subject: editBody ? "Second subject" : "Updated subject",
      from: "Updated <updates@narada.test>",
      replyTo: editBody ? "" : "updated@example.com",
      organization: "Updated organization",
      postalAddress: "2 Updated Street\nSydney NSW 2000",
      html: editBody ? "<p>Updated source</p>" : original.html,
      text: editBody ? "Updated plain text" : original.text,
    };
    await page.getByLabel("Broadcast name").fill(edited.name);
    await page.getByLabel("Subject", { exact: true }).fill(edited.subject);
    await page.getByLabel("From", { exact: true }).fill(edited.from);
    await page.getByLabel("Reply-To (optional)").fill(edited.replyTo);
    await page
      .getByLabel("Organization", { exact: true })
      .fill(edited.organization);
    await page.getByLabel("Postal address").fill(edited.postalAddress);
    if (editBody) {
      await page.getByLabel("Email HTML").fill(edited.html);
      await page.getByLabel("Message text").fill(edited.text);
    }
    const savedResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/admin/broadcasts/${created.id}`) &&
        r.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const saved = await savedResponse;
    expect(saved.ok()).toBe(true);
    expect(saved.request().postDataJSON().draft).toMatchObject(edited);
    await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
    const persisted = await page.request.get(
      `/api/admin/broadcasts/${created.id}`,
    );
    expect(persisted.ok()).toBe(true);
    expect((await persisted.json()).broadcast.draft).toMatchObject(edited);
    await expect(page.getByLabel("Broadcast name")).toHaveValue(edited.name);
    await expect(page.getByLabel("From", { exact: true })).toHaveValue(
      edited.from,
    );
    await expect(page.getByLabel("Postal address")).toHaveValue(
      edited.postalAddress,
    );

    await page
      .getByRole("button", { name: "All broadcasts", exact: true })
      .click();
    await page.getByLabel("Search broadcasts").fill(edited.name);
    await page
      .getByRole("button", { name: `Open ${edited.name}`, exact: true })
      .click();
    await expect(page.getByLabel("Organization", { exact: true })).toHaveValue(
      edited.organization,
    );
    await expect(page.getByLabel("Reply-To (optional)")).toHaveValue(
      edited.replyTo,
    );
    await expect(page.getByLabel("Email HTML")).toHaveValue(edited.html);
    await expect(page.getByLabel("Message text")).toHaveValue(edited.text);
  }
});

test("imports an audience, tests and sends a broadcast, unsubscribes, schedules and cancels", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  const stamp = Date.now();
  const audienceName = `Broadcast audience ${stamp}`,
    name = `Product update ${stamp}`,
    first = `broadcast-a-${stamp}@example.com`,
    second = `broadcast-b-${stamp}@example.com`,
    tester = `broadcast-test-${stamp}@example.com`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Audience", exact: true }).click();
  await page
    .getByRole("button", { name: "Create audience", exact: true })
    .click();
  await page.getByLabel("Audience name").fill(audienceName);
  await page
    .getByRole("button", { name: "Create audience", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Add contacts");
  await page
    .getByLabel("Email addresses or CSV")
    .fill(`email,name\n${first},Alex\n${second},Sam`);
  await page.getByLabel("Consent source").fill("Local test newsletter signup");
  await page.getByRole("checkbox", { name: /These contacts opted in/ }).check();
  await page
    .getByRole("button", { name: "Import contacts", exact: true })
    .click();
  await expect(
    page.getByText("2 contacts added.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: first })).toContainText(
    "List consent",
  );
  await page
    .getByLabel("Search contacts")
    .fill(`missing@example.com; ${first}`);
  await expect(page.getByRole("row").filter({ hasText: first })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: second })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: first, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Local test newsletter signup",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export filtered contacts" }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!, "utf8")).toContain(first);
  await page.getByLabel("Search contacts").fill("");
  await page.screenshot({
    path: ".local/audience-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/audience-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Broadcasts", exact: true }).click();
  await page
    .getByRole("button", { name: "Create broadcast", exact: true })
    .click();
  await page.getByLabel("Broadcast name").fill(name);
  await page
    .getByLabel("From", { exact: true })
    .fill("Narada <hello@narada.test>");
  await page
    .getByLabel("Audience", { exact: true })
    .selectOption({ label: `${audienceName} (2)` });
  await page.getByLabel("Subject", { exact: true }).fill(name);
  const canvas = page.getByRole("textbox", {
    name: "Email message",
    exact: true,
  });
  await page.getByLabel("Page background").fill("#f0f4ed");
  await page.getByLabel("Reply-To (optional)").fill("reply@example.com");
  await canvas.click();
  await canvas.pressSequentially("/");
  await expect(page.getByText("Title", { exact: true })).toBeVisible();
  await page.getByText("Title", { exact: true }).click();
  await canvas.pressSequentially("A small update");
  await canvas.press("Enter");
  await canvas.pressSequentially("For everyone who subscribed.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "All broadcasts", exact: true })
    .click();
  await page.getByLabel("Search broadcasts").fill(name);
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Email message" }).locator("h1"),
  ).toHaveText("A small update");
  await expect(page.getByLabel("Page background")).toHaveValue("#f0f4ed");
  await page.screenshot({ path: ".local/editor-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/editor-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Organization", { exact: true }).fill("Narada Test");
  await page.getByLabel("Postal address").fill("1 Example Street, Test City");
  await page.getByLabel("Test recipient").fill(tester);
  await page
    .getByRole("button", { name: "Send test email", exact: true })
    .click();
  await expect(
    page.getByText("Test email queued.", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(async () => (await messages(request, tester)).length, {
      timeout: 15000,
    })
    .toBe(1);
  expect((await messages(request, first)).length).toBe(0);
  await page
    .getByRole("button", { name: "Review & send", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("2 eligible recipients");
  await expect(
    page
      .frameLocator('iframe[title="Broadcast email preview"]')
      .getByText("Unsubscribe from this audience"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send to 2 recipients", exact: true })
    .click();
  await expect
    .poll(async () => (await messages(request, first)).length, {
      timeout: 20000,
    })
    .toBe(1);
  await expect
    .poll(async () => (await messages(request, second)).length, {
      timeout: 20000,
    })
    .toBe(1);
  await expect(page.getByRole("row").filter({ hasText: first })).toContainText(
    "captured",
    { timeout: 20000 },
  );
  const message = (await messages(request, first))[0]!;
  const full = await (
    await request.get(`http://localhost:8025/api/v1/message/${message.ID}`)
  ).json();
  expect(full.HTML).toContain("#f0f4ed");
  expect(full.HTML).toContain("A small update");
  expect(full.Text).toContain("For everyone who subscribed.");
  const url = String(full.Text).match(/Unsubscribe: (https?:\/\/\S+)/)![1]!;
  const headers = await request.get(
    `http://localhost:8025/api/v1/message/${message.ID}/headers`,
  );
  expect(headers.ok()).toBe(true);
  const headerText = await headers.text();
  expect(headerText).toContain("List-Unsubscribe");
  expect(headerText).toContain("reply@example.com");
  expect((await request.get(url)).ok()).toBe(true);
  expect(
    (
      await request.post(url, { form: { "List-Unsubscribe": "One-Click" } })
    ).ok(),
  ).toBe(true);
  await expect(page.getByText("completed", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "All broadcasts", exact: true })
    .click();
  await page.getByLabel("Search broadcasts").fill(name);
  await page.screenshot({
    path: ".local/broadcasts-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/broadcasts-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("button", { name: `Duplicate ${name}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review & send", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("1 eligible recipients");
  const future = new Date(Date.now() + 15 * 60000);
  future.setMinutes(future.getMinutes() - future.getTimezoneOffset());
  await page
    .getByLabel("Schedule (optional)")
    .fill(future.toISOString().slice(0, 16));
  await page
    .getByRole("button", { name: "Schedule broadcast", exact: true })
    .click();
  await expect(
    page.getByText("Scheduled for ", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel broadcast", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(
    page.getByText("cancelled", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Audience", exact: true }).click();
  await page
    .getByLabel("Filter by audience")
    .selectOption({ label: audienceName });
  await page.getByLabel("Filter by list consent").selectOption("unsubscribed");
  await expect(page.getByRole("row").filter({ hasText: first })).toContainText(
    "No list consent",
  );
  await expect(page.getByRole("row").filter({ hasText: second })).toHaveCount(
    0,
  );
  // Source-only drafts remain editable without conversion to the block model.
  await page.getByRole("button", { name: "Broadcasts", exact: true }).click();
  await page
    .getByRole("button", { name: "Create broadcast", exact: true })
    .click();
  const sourceName = `Source draft ${stamp}`;
  await page.getByLabel("Broadcast name").fill(sourceName);
  await page.getByRole("button", { name: "Edit source", exact: true }).click();
  await page
    .getByLabel("Email HTML")
    .fill('<h1 style="color:#234567">Source preserved</h1>');
  await page.getByLabel("Message text").fill("Source preserved");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "All broadcasts", exact: true })
    .click();
  await page.getByLabel("Search broadcasts").fill(sourceName);
  await page
    .getByRole("button", { name: `Open ${sourceName}`, exact: true })
    .click();
  await expect(page.getByLabel("Email HTML")).toHaveValue(
    '<h1 style="color:#234567">Source preserved</h1>',
  );
  await expect(page.getByLabel("Message text")).toHaveValue("Source preserved");
  expect(errors).toEqual([]);
});
async function messages(
  request: APIRequestContext,
  to: string,
): Promise<{ ID: string }[]> {
  const response = await request.get(
    `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
  );
  return (await response.json()).messages;
}
