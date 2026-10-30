import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
test.use({ actionTimeout: 10000 });
test("manages properties, dynamic segments, topic consent and personalized broadcasts", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const stamp = Date.now(),
    key = `city_${stamp}`,
    topic = `Market updates ${stamp}`,
    audience = `Customers ${stamp}`,
    segment = `Sydney ${stamp}`,
    name = `Personalized ${stamp}`,
    first = `parity-${stamp}@example.com`,
    second = `parity-other-${stamp}@example.com`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Audience", exact: true }).click();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  await page.getByLabel("Property key", { exact: true }).fill(key);
  await page.getByLabel("Fallback value").fill("your city");
  await page
    .getByRole("button", { name: "Save property", exact: true })
    .click();
  await expect(page.getByRole("row").filter({ hasText: key })).toContainText(
    "your city",
  );
  await page.screenshot({
    path: ".local/properties-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await page.getByRole("button", { name: "Create topic", exact: true }).click();
  await page.getByLabel("Topic name").fill(topic);
  await page.getByLabel("Topic description").fill("News about the market");
  await page.getByRole("button", { name: "Save topic", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: topic })).toContainText(
    "Requires opt-in",
  );
  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  await page
    .getByRole("button", { name: "Create audience", exact: true })
    .click();
  await page.getByLabel("Audience name").fill(audience);
  await page
    .getByRole("button", { name: "Create audience", exact: true })
    .click();
  await page
    .getByLabel("Email addresses or CSV")
    .fill(
      `email,name,first_name,${key}\n${first},Alex,Alex,Sydney\n${second},Sam,Sam,Melbourne`,
    );
  await page.getByRole("checkbox", { name: topic, exact: true }).check();
  await page
    .getByLabel("Consent source", { exact: true })
    .fill("Market signup form");
  await page.getByRole("checkbox", { name: /These contacts opted in/ }).check();
  await page
    .getByRole("button", { name: "Import contacts", exact: true })
    .click();
  await expect(
    page.getByText("2 contacts added.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: first, exact: true }).click();
  await expect(page.getByLabel(key, { exact: true })).toHaveValue("Sydney");
  await expect(
    page.getByRole("checkbox", { name: topic, exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Segments", exact: true }).click();
  await page
    .getByRole("button", { name: "Create segment", exact: true })
    .click();
  await page.getByLabel("Segment name").fill(segment);
  await page.getByLabel("Segment type").selectOption("dynamic");
  await page.getByLabel("Rule 1 property").selectOption({ label: key });
  await page.getByLabel("Rule 1 operator").selectOption("equals");
  await page.getByLabel("Rule 1 value").fill("Sydney");
  await page.getByRole("button", { name: "Save segment", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: segment }),
  ).toContainText("dynamic");
  await page.getByRole("button", { name: segment, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(first);
  await expect(page.getByRole("dialog")).not.toContainText(second);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({
    path: ".local/segments-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Broadcasts", exact: true }).click();
  await page
    .getByRole("button", { name: "Create broadcast", exact: true })
    .click();
  await page.getByLabel("Broadcast name").fill(name);
  await page.getByLabel("From", { exact: true }).fill("hello@narada.test");
  await page
    .getByLabel("Audience", { exact: true })
    .selectOption({ label: `${segment} (1)` });
  await page.getByLabel("Subscription topic").selectOption({ label: topic });
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Hi {{contact.first_name}}");
  const canvas = page.getByRole("textbox", {
    name: "Email message",
    exact: true,
  });
  await canvas.click();
  await canvas.pressSequentially("Hello ");
  await page
    .getByLabel("Insert contact property")
    .selectOption({ label: "first_name" });
  await canvas.pressSequentially(", news from ");
  await page.getByLabel("Insert contact property").selectOption({ label: key });
  await page.getByLabel("Organization", { exact: true }).fill("Narada Test");
  await page.getByLabel("Postal address").fill("1 Test Street");
  await page
    .getByRole("button", { name: "Review & send", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("1 eligible recipients");
  await expect(
    page
      .frameLocator('iframe[title="Broadcast email preview"]')
      .getByText("Hello Alex, news from Sydney", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send to 1 recipients", exact: true })
    .click();
  let messageId = "";
  await expect
    .poll(
      async () => {
        const result = await (
          await request.get(
            `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${first}`)}`,
          )
        ).json();
        messageId = result.messages?.[0]?.ID ?? "";
        return result.messages?.length ?? 0;
      },
      { timeout: 20000 },
    )
    .toBe(1);
  const mail = await (
    await request.get(`http://localhost:8025/api/v1/message/${messageId}`)
  ).json();
  expect(mail.Subject).toBe("Hi Alex");
  expect(mail.Text).toContain("Sydney");
  expect(mail.HTML).not.toContain("{{contact.");
  const url = String(mail.Text).match(
    /Manage preferences: (https?:\/\/\S+)/,
  )![1]!;
  const preferences = await page.context().newPage();
  await preferences.goto(url);
  await expect(
    preferences.getByRole("heading", { name: "Email preferences" }),
  ).toBeVisible();
  await preferences
    .getByRole("checkbox", { name: new RegExp(topic) })
    .uncheck();
  await preferences
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(
    preferences.getByRole("heading", { name: "Preferences saved." }),
  ).toBeVisible();
  await preferences.close();
  await page.getByRole("button", { name: "Audience", exact: true }).click();
  await page.getByLabel("Search contacts").fill(first);
  await page.getByRole("button", { name: first, exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: topic, exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: topic })).toBeVisible();
  await page.screenshot({ path: ".local/topics-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/topics-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});
