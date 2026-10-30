import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
test("owner signs in, sends an email, sees capture and bounce protection", async ({
  page,
  request,
}) => {
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  const stamp = Date.now();
  const recipient = `browser-${stamp}@example.com`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good things, delivered." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Webhooks", exact: true }).click();
  await page.getByRole("button", { name: "Add webhook", exact: true }).click();
  await page
    .getByLabel("Endpoint URL")
    .fill("http://localhost:3001/api/dev/webhook-receiver");
  const endpointResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/webhooks") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add endpoint", exact: true }).click();
  const ownEndpoint = await (await endpointResponse).json();
  const signingSecret = await page
    .getByLabel("Webhook signing secret")
    .inputValue();
  await page.getByRole("button", { name: "Emails", exact: true }).click();
  await page
    .getByRole("button", { name: "Send an email", exact: true })
    .click();
  await page.getByLabel("To", { exact: true }).fill(recipient);
  await page
    .getByLabel("Subject", { exact: true })
    .fill(`Browser test ${stamp}`);
  await page
    .getByLabel("Message", { exact: true })
    .fill("A message from the real local dashboard.");
  await page.getByRole("button", { name: "Send email", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: recipient });
  await expect(row).toContainText("captured", { timeout: 20000 });
  const mail = await request.get(
    `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
  );
  expect((await mail.json()).messages.length).toBeGreaterThan(0);
  await row.getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Simulate bounced" }).click();
  await expect(page.getByRole("dialog")).toContainText("bounced", {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/admin/webhook-captures");
        const captures = await response.json();
        return captures.some(
          (c: { payload: { data: { recipients: string[] } } }) =>
            c.payload.data.recipients?.includes(recipient),
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const captures = await (
    await page.request.get("/api/admin/webhook-captures")
  ).json();
  const capture = captures.find(
    (c: { payload: { data: { recipients: string[] } } }) =>
      c.payload.data.recipients?.includes(recipient),
  );
  const signature = createHmac("sha256", signingSecret)
    .update(
      `${capture.payload.id}.${capture.headers.timestamp}.${JSON.stringify(capture.payload)}`,
    )
    .digest("hex");
  expect(capture.headers.signature).toBe(`v1=${signature}`);
  if (ownEndpoint)
    await page.request.delete(`/api/admin/webhooks/${ownEndpoint.id}`, {
      headers: { origin: "http://localhost:5173" },
    });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Recipients", exact: true }).click();
  await expect(page.getByText(recipient, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "API keys", exact: true }).click();
  await page
    .getByRole("button", { name: "Create API key", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill(`Browser ${stamp}`);
  await page.getByRole("button", { name: "Create key", exact: true }).click();
  const token = await page.getByLabel("New API key").inputValue();
  await page
    .getByRole("button", { name: "I have saved it", exact: true })
    .click();
  expect(token).toMatch(/^na_/);
  const api = await request.post("/api/v1/emails", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      from: "hello@narada.test",
      to: recipient,
      subject: "Blocked",
      text: "No",
    },
  });
  expect(api.status()).toBe(422);
  expect((await api.json()).error).toContain("Recipient is suppressed");
  const automatic = await request.post("/api/v1/emails", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      from: "hello@narada.test",
      to: `automatic-${stamp}@example.com`,
      subject: "Automatic API send",
      text: "No MCP approval required",
    },
  });
  expect(automatic.status()).toBe(202);
  expect(await automatic.json()).toHaveProperty("id");
  await page.getByRole("button", { name: "Emails", exact: true }).click();
  await page.screenshot({
    path: ".local/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/dashboard-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
