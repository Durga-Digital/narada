import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
test("shows persisted operation details and recovery guidance in owner activity", async ({
  page,
}) => {
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_OWNER_FILE ?? ".local/owner.json",
      "utf8",
    ),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Activity", exact: true }),
  ).toBeVisible();
  const key = randomUUID();
  const response = await page.request.post("/api/admin/publications", {
    headers: { origin: "http://localhost:5173", "idempotency-key": key },
    data: {
      name: "Activity browser fixture",
      slug: `activity-${key}`,
      from: "hello@narada.test",
    },
  });
  expect(response.status()).toBe(201);
  const publication = await response.json(),
    id = response.headers()["x-operation-id"]!;
  expect(id).toBeTruthy();
  try {
    await page.goto(`/?page=activity&operationId=${id}`);
    const details = page.getByRole("region", { name: "Operation details" });
    await expect(
      details.getByText("publications.create · succeeded", { exact: true }),
    ).toBeVisible();
    await expect(details.getByText(id, { exact: true })).toBeVisible();
    await expect(details).toContainText("without repeating the work");
    await expect(details).toContainText(publication.id);
    await page
      .getByRole("button", { name: "Refresh activity", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: `View operation ${id}`, exact: true }),
    ).toBeVisible();
    await page.getByLabel("Operation ID", { exact: true }).fill("invalid-id");
    await page
      .getByRole("button", { name: "Find operation", exact: true })
      .click();
    await expect(page.getByText(/Invalid UUID/)).toBeVisible();
    expect(errors).toEqual([]);
    await page.getByLabel("Operation ID", { exact: true }).fill(id);
    await page
      .getByRole("button", { name: "Find operation", exact: true })
      .click();
    await expect(details).toBeVisible();
    await page.screenshot({
      path: ".local/activity-screen.png",
      fullPage: true,
    });
  } finally {
    const current = await page.request.get(
      `/api/admin/publications/${publication.id}`,
    );
    const data = await current.json();
    await page.request.post(
      `/api/admin/publications/${publication.id}/archive`,
      {
        headers: {
          origin: "http://localhost:5173",
          "idempotency-key": randomUUID(),
        },
        data: { revision: data.revision },
      },
    );
  }
});
