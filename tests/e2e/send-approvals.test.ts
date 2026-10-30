import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
test("owner reviews the exact message, approves once, and rejects another request", async ({
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
    page.getByRole("button", { name: "Send approvals", exact: true }),
  ).toBeVisible();
  const headers = { origin: "http://localhost:5173" },
    suffix = randomUUID();
  const name = `Approval browser ${suffix}`;
  const keyResponse = await page.request.post("/api/admin/keys", {
    headers,
    data: {
      name,
      permission: "operations",
      operationAccess: {
        scopes: [
          "narada:approvals:request",
          "narada:approvals:read",
          "narada:emails:send",
          "narada:emails:read",
        ],
        resources: {},
      },
    },
  });
  expect(keyResponse.status()).toBe(201);
  const key = await keyResponse.json();
  const to = `review-${suffix}@example.com`;
  try {
    for (const approve of [true, false]) {
      const created = await page.request.post("/api/v1/approvals", {
        headers: {
          authorization: `Bearer ${key.token}`,
          "idempotency-key": randomUUID(),
        },
        data: {
          operation: "emails.send",
          input: {
            body: {
              from: "hello@narada.test",
              to,
              subject: "Review this browser message",
              html: "<p>Only the approved content</p>",
              text: "Only the approved content",
              priority: "high",
              tags: { source: "agent" },
              expires_in: 600,
            },
          },
        },
      });
      expect(created.status()).toBe(201);
      const approval = await created.json();
      await page.goto(`/?page=approvals&approvalId=${approval.id}`);
      const review = page.getByRole("region", { name: "Send review" });
      await expect(review).toContainText("emails.send · pending");
      await expect(review).toContainText(to);
      await expect(review).toContainText("high");
      await expect(review).toContainText("600 seconds after acceptance");
      await expect(review).toContainText("Review this browser message");
      await expect(
        page
          .frameLocator('iframe[title="Approved message preview"]')
          .getByText("Only the approved content"),
      ).toBeVisible();
      expect(
        await page
          .locator('iframe[title="Approved message preview"]')
          .getAttribute("sandbox"),
      ).toBe("");
      if (approve) {
        await page
          .locator('iframe[title="Approved message preview"]')
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: ".local/send-approval-review.png",
          fullPage: true,
        });
      }
      await review
        .getByRole("button", {
          name: approve ? "Approve and send" : "Reject",
          exact: true,
        })
        .click();
      await expect(review).toContainText(
        `emails.send · ${approve ? "succeeded" : "rejected"}`,
      );
      await expect(
        review.getByRole("button", { name: "Approve and send" }),
      ).toHaveCount(0);
      if (approve) {
        await expect(review).toContainText("Message ID:");
        await expect(
          review.getByRole("link", { name: "View operation activity" }),
        ).toBeVisible();
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await page.request.post(`/api/admin/keys/${key.id}/revoke`, {
      headers,
      data: { confirmation: name },
    });
  }
});
