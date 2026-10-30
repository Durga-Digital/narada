import { expect, test, type Page } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";

async function createForm(page: Page) {
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Forms", exact: true }).click();
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/forms") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Create feedback form/ }).click();
  const record = await (await created).json();
  await expect(page.getByLabel("Question 1", { exact: true })).toBeVisible();
  return record;
}
const saved = (page: Page) =>
  expect(page.getByTestId("form-save-status")).toHaveText("All changes saved");

test("autosaves unfinished fields, validates publication, and flushes edits before leaving", async ({
  page,
}) => {
  const form = await createForm(page);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Form title", { exact: true }).fill("");
  await page.getByLabel("Question 1", { exact: true }).fill("");
  await page.getByLabel("Completion message").fill("");
  await saved(page);
  const remote = await (
    await page.request.get(`/api/admin/forms/${form.id}`)
  ).json();
  expect(remote.draft.name).toBe("");
  expect(remote.draft.questions[0].label).toBe("");
  await page.getByRole("button", { name: "Publish form", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Too small");
  expect((await page.request.get(`/api/forms/${form.id}`)).status()).toBe(404);
  const title = `Autosaved form ${Date.now()}`;
  await page.getByLabel("Form title", { exact: true }).fill(title);
  await page
    .getByLabel("Question 1", { exact: true })
    .fill("How was your experience?");
  await page.getByLabel("Completion message").fill("Thanks for sharing.");
  await page.getByRole("button", { name: "← Forms", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByLabel("Form title", { exact: true })).toHaveValue(
    title,
  );
  await expect(page.getByLabel("Completion message")).toHaveValue(
    "Thanks for sharing.",
  );
  await saved(page);
});

test("queues newer edits without replacing focused inputs and publishes the latest saved revision", async ({
  page,
}) => {
  const form = await createForm(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: { revision: number; draft: { name: string } }[] = [];
  await page.route(`**/api/admin/forms/${form.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (writes.length === 1) await gate;
    await route.fulfill({ response });
  });
  const title = page.getByLabel("Form title", { exact: true });
  await title.fill("First autosaved title");
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByTestId("form-save-status")).toHaveText("Saving…");
  await title.fill("Newer title typed while saving");
  await expect(title).toBeFocused();
  await expect(title).toBeEnabled();
  await page.waitForTimeout(1100);
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "Publish form", exact: true }).click();
  release();
  await expect(page.getByRole("status")).toContainText("Published version 1.");
  expect(writes.map((write) => write.revision)).toEqual([0, 1]);
  expect(writes[1]!.draft.name).toBe("Newer title typed while saving");
  await expect(title).toHaveValue("Newer title typed while saving");
  const published = await (
    await page.request.get(`/api/forms/${form.id}`)
  ).json();
  expect(published.content.name).toBe("Newer title typed while saving");
  await saved(page);
});

test("retains failed edits, retries safely, and recognizes a successful save with a lost response", async ({
  page,
}) => {
  const form = await createForm(page);
  let mode: "failure" | "lost" | "normal" = "failure";
  let writes = 0;
  await page.route(`**/api/admin/forms/${form.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    if (mode === "failure")
      return route.fulfill({
        status: 503,
        json: { error: "Temporarily offline" },
      });
    if (mode === "lost") {
      await route.fetch();
      return route.abort("failed");
    }
    return route.continue();
  });
  const title = page.getByLabel("Form title", { exact: true });
  await title.fill("Keep these edits");
  await expect(page.getByRole("alert")).toContainText("Temporarily offline");
  await expect(title).toHaveValue("Keep these edits");
  await expect(page.getByTestId("form-save-status")).toHaveText(
    "Changes not saved",
  );
  mode = "normal";
  await page.getByRole("button", { name: "Retry saving" }).click();
  await saved(page);
  mode = "lost";
  await title.fill("Saved despite lost response");
  await saved(page);
  expect(writes).toBe(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/admin/forms/${form.id}`)).json()).draft
      .name,
  ).toBe("Saved despite lost response");
});

test("does not overwrite a competing edit until a conflict choice is made", async ({
  page,
}) => {
  const form = await createForm(page);
  await page.request.put(`/api/admin/forms/${form.id}`, {
    headers: { origin: "http://localhost:5173" },
    data: {
      revision: 0,
      draft: { ...form.draft, name: "Another editor's draft" },
    },
  });
  const title = page.getByLabel("Form title", { exact: true });
  await title.fill("My competing edit");
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(title).toHaveValue("My competing edit");
  expect(
    (await (await page.request.get(`/api/admin/forms/${form.id}`)).json()).draft
      .name,
  ).toBe("Another editor's draft");
  await page.getByRole("button", { name: "Keep my edits" }).click();
  await saved(page);
  const current = await (
    await page.request.get(`/api/admin/forms/${form.id}`)
  ).json();
  expect(current.draft.name).toBe("My competing edit");
  await page.request.put(`/api/admin/forms/${form.id}`, {
    headers: { origin: "http://localhost:5173" },
    data: {
      revision: current.revision,
      draft: { ...current.draft, name: "Latest shared draft" },
    },
  });
  await title.fill("An edit to discard");
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await page.getByRole("button", { name: "Use saved draft" }).click();
  await expect(title).toHaveValue("Latest shared draft");
  await saved(page);
});
