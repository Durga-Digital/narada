import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
test("selects webhook events, edits subscriptions, and fetches metrics without polling", async ({
  page,
}) => {
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Webhooks", exact: true }).click();
  await page.getByRole("button", { name: "Add webhook", exact: true }).click();
  await page.getByRole("button", { name: "Use local test receiver" }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add endpoint", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Search events").fill("contact.created");
  await page.getByRole("checkbox", { name: /contact.created/ }).check();
  await page.screenshot({ path: ".local/webhook-events.png", fullPage: true });
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/webhooks") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add endpoint", exact: true }).click();
  const endpoint = await (await response).json();
  expect(endpoint.events).toEqual(["contact.created"]);
  try {
    await expect(page.getByLabel("Webhook signing secret")).toBeVisible();
    // Locate the endpoint by its unique event selection (other local fixtures may share the receiver URL).
    const cards = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("contact.created", { exact: true }) });
    await cards.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Search events").fill("email.bounced");
    await page.getByRole("checkbox", { name: /email.bounced/ }).check();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await (await page.request.get("/api/admin/webhooks")).json();
    expect(
      saved.endpoints.find((e: { id: string }) => e.id === endpoint.id).events,
    ).toEqual(["contact.created", "email.bounced"]);
    expect(
      saved.endpoints.find((e: { id: string }) => e.id === endpoint.id).secret,
    ).toBeUndefined();
  } finally {
    await page.request.delete(`/api/admin/webhooks/${endpoint.id}`, {
      headers: { origin: "http://localhost:5173" },
    });
  }
  let metricRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/admin/metrics")) metricRequests++;
  });
  await page.getByRole("button", { name: "Metrics", exact: true }).click();
  await expect(
    page.getByText("Local development", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /by acceptance date/ }),
  ).toBeVisible();
  const initial = metricRequests;
  await page.clock.install();
  await page.clock.fastForward(60_000);
  expect(metricRequests).toBe(initial);
  await page.getByLabel("Metrics period").selectOption("7");
  expect(metricRequests).toBe(initial);
  await page
    .getByRole("button", { name: "Fetch metrics", exact: true })
    .click();
  await expect.poll(() => metricRequests).toBe(initial + 1);
  await expect(
    page.getByRole("button", { name: "Fetch metrics", exact: true }),
  ).toBeEnabled();
  await page.getByText("View daily values", { exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Acceptance date (UTC)" }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".local/metrics-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/metrics-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
