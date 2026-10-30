import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
import type { PublicationDomainResult } from "@narada/contracts/types";

test("guides domain setup, activation and retained disconnect cleanup on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
  const publication = await page.evaluate(async () => {
    const response = await fetch("/api/admin/publications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `Domain studio ${Date.now()}`,
        slug: `domain-studio-${Date.now()}`,
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  const defaultUrl = `http://localhost:5173/n/${publication.settings.slug}`;
  let saved: PublicationDomainResult = {
    domain: null,
    defaultUrl,
    preferredUrl: defaultUrl,
  };
  // UI lifecycle fixture. Real authorization, transactions, provider recovery and reader
  // flows run against isolated DynamoDB in publication-domains.test.ts (integration).
  await page.route(
    new RegExp(
      `/api/admin/publications/${publication.id}/domain(?:/[^?]+)?(?:\\?.*)?$`,
    ),
    async (route) => {
      const request = route.request(),
        action = new URL(request.url()).pathname.split("/").at(-1);
      if (request.method() === "PUT") {
        const input = request.postDataJSON();
        saved.domain = {
          id: "browser-domain",
          publicationId: publication.id,
          hostname: input.hostname,
          revision: 1,
          state: "awaiting_ownership",
          records: [
            {
              purpose: "ownership",
              type: "TXT",
              name: `_narada.${input.hostname}`,
              shortName: "_narada.news",
              value: "narada=browser-proof",
              status: "pending",
            },
          ],
          certificate: { status: "not_requested" },
          routing: "not_created",
          defaultUrl,
          preferredUrl: defaultUrl,
        };
      } else if (request.method() === "POST" && saved.domain) {
        expect(request.postDataJSON().revision).toBe(saved.domain.revision);
        saved.domain.revision++;
        if (action === "check") {
          saved.domain.state = "ready";
          saved.domain.certificate.status = "issued";
          saved.domain.routing = "deployed";
          saved.domain.records = saved.domain.records.map((r) => ({
            ...r,
            status: "verified",
          }));
          saved.domain.records.push(
            {
              purpose: "certificate",
              type: "CNAME",
              name: "_acm.news.example.com",
              shortName: "_acm.news",
              value: "_test.acm-validations.aws",
              status: "verified",
            },
            {
              purpose: "website",
              type: "CNAME",
              name: "news.example.com",
              shortName: "news",
              value: "test.cloudfront.net",
              status: "verified",
            },
          );
        } else if (action === "activate") {
          saved.domain.state = "active";
          saved.preferredUrl = saved.domain.preferredUrl =
            "https://news.example.com";
        } else if (action === "disconnect") {
          saved.domain.state = "disconnecting";
          saved.preferredUrl = saved.domain.preferredUrl = defaultUrl;
          saved.domain.message =
            "Hosting is disabled and retained. Remove the website DNS record and wait for propagation to finish cleanup.";
        }
      }
      await route.fulfill({
        status: request.method() === "GET" ? 200 : 202,
        contentType: "application/json",
        body: JSON.stringify(saved),
      });
    },
  );
  await page.getByRole("button", { name: "Newsletters", exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(publication.settings.name) })
    .click();
  await page.getByRole("tab", { name: "Domain", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connect a custom subdomain" }),
  ).toBeVisible();
  await page.getByLabel("Website subdomain").fill("news.example.com");
  await page
    .getByRole("button", { name: "Connect subdomain", exact: true })
    .click();
  await expect(
    page.getByText("narada=browser-proof", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Activate custom address" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "/tmp/narada-domain-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Check DNS and HTTPS" }).click();
  await expect(
    page.getByText("test.cloudfront.net", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Activate custom address" }).click();
  await expect(
    page.getByRole("link", { name: "Open publication" }),
  ).toHaveAttribute("href", "https://news.example.com");
  await page
    .getByRole("button", { name: "Disconnect domain", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Disconnect news.example.com?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm disconnect" }).click();
  await expect(
    page.getByText(/Hosting is disabled and retained/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect subdomain", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/narada-domain-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
