import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { formStarters } from "@narada/core/form-content";
test("subscribes to lifecycle events and displays persisted delivery attempts", async ({
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
  await page.getByRole("button", { name: "Webhooks", exact: true }).click();
  await page.getByRole("button", { name: "Add webhook", exact: true }).click();
  await page.getByRole("button", { name: "Use local test receiver" }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByLabel("Search events").fill("form.response.completed");
  await page.getByRole("checkbox", { name: /form.response.completed/ }).check();
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/webhooks") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add endpoint", exact: true }).click();
  const endpoint = await (await created).json();
  const headers = { origin: "http://localhost:5173" };
  let formId: string | undefined;
  try {
    await expect(page.getByLabel("Webhook signing secret")).toBeVisible();
    const response = await page.request.post("/api/admin/forms", {
      headers,
      data: {
        ...formStarters.feedback,
        name: `Webhook browser ${randomUUID()}`,
      },
    });
    expect(response.status()).toBe(201);
    const form = await response.json();
    formId = form.id;
    const published = await page.request.post(
      `/api/admin/forms/${form.id}/publish`,
      { headers, data: { revision: 0 } },
    );
    expect(published.ok()).toBe(true);
    const submission = await page.request.post(
      `/api/forms/${form.id}/responses`,
      {
        headers,
        data: {
          submissionId: randomUUID(),
          version: 1,
          answers: { rating: 5, feedback: "Private response" },
        },
      },
    );
    expect(submission.status()).toBe(201);
    const history = page.getByRole("region", {
      name: "Webhook delivery history",
    });
    let deliveryId = "";
    await expect
      .poll(
        async () => {
          const deliveries = await (
            await page.request.get("/api/admin/webhooks/deliveries")
          ).json();
          deliveryId =
            deliveries.data.find(
              (row: { id: string; endpointId: string }) =>
                row.endpointId === endpoint.id,
            )?.id ?? "";
          return !!deliveryId;
        },
        { timeout: 45000 },
      )
      .toBe(true);
    const ownDelivery = history.getByTestId(`webhook-delivery-${deliveryId}`);
    await expect(
      ownDelivery.getByText("Delivered · 1 attempts · HTTP 200"),
    ).toBeVisible({ timeout: 45000 });
    await ownDelivery.getByRole("button", { name: "View attempts" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Attempt 1 · succeeded · HTTP 200"),
    ).toBeVisible();
    await expect(dialog).toContainText("Event ID:");
    await expect(dialog).not.toContainText("Private response");
    await page.screenshot({
      path: ".local/lifecycle-delivery-history.png",
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.reload();
    await page.getByRole("button", { name: "Webhooks", exact: true }).click();
    await expect(
      ownDelivery.getByText("Delivered · 1 attempts · HTTP 200"),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete(`/api/admin/webhooks/${endpoint.id}`, {
      headers,
    });
    if (formId)
      await page.request.post(`/api/admin/forms/${formId}/close`, {
        headers,
        data: { revision: 1 },
      });
  }
});
