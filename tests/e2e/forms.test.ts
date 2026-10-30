import { test, expect, type Page } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
async function login(page: Page) {
  const owner = JSON.parse(await readFile(".local/owner.json", "utf8"));
  await page.goto("/");
  await page.getByLabel("Email address").fill(owner.email);
  await page.getByLabel("Password", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good things, delivered." }),
  ).toBeVisible();
  const navigation = page.getByRole("button", { name: /^Navigation/ });
  if (await navigation.isVisible()) await navigation.click();
  await page.getByRole("button", { name: "Forms", exact: true }).click();
}
test("builds and publishes a signup, confirms a public response, updates contacts, sends receipt and creates an invitation", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now(),
    email = `forms-e2e-${stamp}@example.com`;
  await login(page);
  await expect(
    page.getByText("Loading forms…", { exact: true }),
  ).not.toBeVisible();
  await page.screenshot({ path: ".local/forms-library.png", fullPage: true });
  const topicResponse = await page.request.post("/api/admin/topics", {
    headers: { origin: "http://localhost:5173" },
    data: { name: `Form signup ${stamp}`, visibility: "public", active: true },
  });
  expect(topicResponse.ok()).toBe(true);
  const topic = await topicResponse.json();
  const audienceResponse = await page.request.post("/api/admin/segments", {
    headers: { origin: "http://localhost:5173" },
    data: { name: `Form audience ${stamp}`, kind: "manual" },
  });
  expect(audienceResponse.ok()).toBe(true);
  const audience = await audienceResponse.json();
  await page.getByRole("button", { name: /Create signup form/ }).click();
  await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue(
    "What’s your name?",
  );
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .last()
    .click();
  await page.getByLabel("Form name", { exact: true }).fill(`Signup ${stamp}`);
  await page.getByLabel("Brand name").fill("Narada Studio");
  await page.getByLabel("Save verified respondents to Contacts").check();
  await page.getByLabel("Send a response acknowledgment").check();
  await page.getByLabel("Sender email").fill("hello@narada.test");
  await page.getByLabel("Signup topic").selectOption(topic.id);
  await page.getByLabel("Audience destination").selectOption(audience.id);
  await expect(page.getByTestId("form-save-status")).toHaveText(
    "All changes saved",
  );
  await page.screenshot({
    path: ".local/forms-audience-settings.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Publish form", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published version 1.");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.screenshot({ path: ".local/forms-preview.png", fullPage: true });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const url = await page.getByLabel("Public form link").inputValue();
  const id = url.split("/").at(-1)!;
  expect(
    (await (await page.request.get(`/api/admin/forms/${id}`)).json()).draft
      .audienceId,
  ).toBe(audience.id);
  const anonymous = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const respondent = await anonymous.newPage();
  respondent.on("pageerror", (e) => errors.push(e.message));
  await respondent.goto(url);
  await expect(
    respondent.getByRole("heading", { name: `Signup ${stamp}` }),
  ).toBeVisible();
  await respondent.getByRole("button", { name: "Let’s begin" }).click();
  await respondent
    .getByRole("textbox", { name: "What’s your name?" })
    .fill("Ada Reader");
  await respondent
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await respondent
    .getByRole("textbox", { name: "What’s your email address?" })
    .fill(email);
  await respondent
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(respondent.getByRole("checkbox")).not.toBeChecked();
  await respondent.getByRole("checkbox").check();
  await respondent.screenshot({
    path: ".local/forms-mobile.png",
    fullPage: true,
  });
  expect(
    await respondent.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await respondent
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await respondent
    .getByRole("button", { name: "Submit response", exact: true })
    .click();
  await expect(
    respondent.getByRole("heading", { name: "You’re all set." }),
  ).toBeVisible();
  let mailId = "";
  await expect
    .poll(
      async () => {
        const mailbox = await (
          await request.get("http://localhost:8025/api/v1/messages?limit=200")
        ).json();
        mailId =
          mailbox.messages.find(
            (m: { ID: string; Subject: string; To: { Address: string }[] }) =>
              m.Subject.startsWith("Confirm your response:") &&
              m.To.some((to) => to.Address === email),
          )?.ID ?? "";
        return !!mailId;
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const captured = await (
    await request.get(`http://localhost:8025/api/v1/message/${mailId}`)
  ).json();
  const link = captured.Text.match(
    /http:\/\/localhost:5173\/forms\/confirm\?token=\S+/,
  )?.[0];
  expect(link).toBeTruthy();
  const before = await page.request.get(
    `/api/admin/contacts/${encodeURIComponent(email)}`,
  );
  expect(before.status()).toBe(404);
  expect(
    (
      await (
        await page.request.get(`/api/admin/audiences/${audience.id}`)
      ).json()
    ).contacts,
  ).toHaveLength(0);
  await respondent.goto(link);
  await expect(
    respondent.getByRole("button", { name: "Confirm email", exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.get(`/api/admin/contacts/${encodeURIComponent(email)}`)
    ).status(),
  ).toBe(404);
  await respondent
    .getByRole("button", { name: "Confirm email", exact: true })
    .click();
  await expect(
    respondent.getByRole("heading", { name: "Email confirmed." }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await page.request.get(
            `/api/admin/contacts/${encodeURIComponent(email)}`,
          )
        ).status(),
      { timeout: 20000 },
    )
    .toBe(200);
  const details = await (
    await page.request.get(`/api/admin/contacts/${encodeURIComponent(email)}`)
  ).json();
  expect(details.contact.name).toBe("Ada Reader");
  const members = await (
    await page.request.get(`/api/admin/audiences/${audience.id}`)
  ).json();
  expect(members.contacts).toEqual([
    expect.objectContaining({ email, name: "Ada Reader" }),
  ]);
  expect(
    details.topics.find((t: { id: string }) => t.id === topic.id).subscribed,
  ).toBe(true);
  await expect
    .poll(
      async () => {
        const mailbox = await (
          await request.get("http://localhost:8025/api/v1/messages?limit=200")
        ).json();
        return mailbox.messages.some(
          (m: { Subject: string; To: { Address: string }[] }) =>
            m.Subject.startsWith("Response received:") &&
            m.To.some((to) => to.Address === email),
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "Responses", exact: true }).click();
  await page.getByRole("button", { name: email, exact: true }).click();
  await expect(page.getByText("Ada Reader", { exact: true })).toBeVisible();
  await expect(page.getByText(/Contact saved:/)).toBeVisible();
  await page.screenshot({ path: ".local/forms-response.png", fullPage: true });
  const exported = await page.request.get(`/api/admin/forms/${id}/export`);
  expect(await exported.text()).toContain("Ada Reader");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page
    .getByRole("button", { name: "Create broadcast invitation", exact: true })
    .click();
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(
    `Signup ${stamp}`,
  );
  await expect(
    page.getByRole("button", { name: "All forms", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await anonymous.close();
});
test("collects anonymous feedback, keeps a published version stable, and closes a form", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.getByRole("button", { name: /Create feedback form/ }).click();
  await page.getByRole("button", { name: "Publish form", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published version 1.");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const url = await page.getByLabel("Public form link").inputValue();
  const context = await browser.newContext();
  const respondent = await context.newPage();
  await respondent.goto(url);
  await respondent.getByRole("button", { name: "Let’s begin" }).click();
  await respondent.getByRole("radio", { name: "5", exact: true }).check();
  await respondent
    .getByRole("textbox", { name: "What could we do better?" })
    .fill("A helpful first version.");
  await respondent
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await respondent.getByRole("button", { name: "Skip", exact: true }).click();
  await respondent
    .getByRole("button", { name: "Submit response", exact: true })
    .click();
  await expect(
    respondent.getByRole("heading", { name: "You’re all set." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page
    .getByLabel("Question 1", { exact: true })
    .fill("Changed only in draft");
  await expect(page.getByTestId("form-save-status")).toHaveText(
    "All changes saved",
  );
  await respondent.reload();
  await respondent.getByRole("button", { name: "Let’s begin" }).click();
  await expect(
    respondent.getByRole("heading", { name: "How was your experience?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Responses", exact: true }).click();
  await page
    .getByRole("button", { name: "Anonymous response", exact: true })
    .click();
  await expect(
    page.getByText("A helpful first version.", { exact: true }),
  ).toBeVisible();
  const formId = url.split("/").at(-1)!;
  for (let i = 0; i < 6; i++) {
    const submitted = await page.request.post(
      `/api/forms/${formId}/responses`,
      {
        headers: { origin: "http://localhost:5173" },
        data: {
          version: 1,
          submissionId: crypto.randomUUID(),
          answers: { rating: 4, feedback: `Export page check ${i}` },
        },
      },
    );
    expect(submitted.status()).toBe(201);
  }
  await page.getByRole("button", { name: "← Responses", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export all CSV", exact: true })
    .click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("A helpful first version.");
  for (let i = 0; i < 6; i++) expect(csv).toContain(`Export page check ${i}`);
  expect(csv.match(/response_id,submitted_at/g)).toHaveLength(1);
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Close form", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Form closed.");
  await respondent.reload();
  await expect(respondent.getByRole("status")).toContainText(
    "not accepting responses",
  );
  await context.close();
});
test("builds an intake with reordered choice questions and collects a response", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.getByRole("button", { name: /Create client intake form/ }).click();
  await page
    .getByRole("button", {
      name: "Type / or click to add a block…",
      exact: true,
    })
    .click();
  await page.getByRole("combobox", { name: "Search blocks" }).fill("/multiple");
  await page.getByRole("combobox", { name: "Search blocks" }).press("Enter");
  await page
    .getByLabel("Question 5", { exact: true })
    .fill("How did you find us?");
  await page
    .getByLabel("Choice 1 for question 5", { exact: true })
    .fill("A friend");
  await page
    .getByLabel("Choice 2 for question 5", { exact: true })
    .fill("Search");
  await page
    .getByRole("group", { name: "Question block 5", exact: true })
    .getByRole("button", { name: "Add option", exact: true })
    .click();
  await page
    .getByLabel("Choice 3 for question 5", { exact: true })
    .fill("Social media");
  await page
    .getByRole("group", { name: "Question block 5", exact: true })
    .getByRole("button", { name: "Move question up", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Question block 4", exact: true })
    .getByRole("button", { name: "Move question down", exact: true })
    .click();
  await page.getByRole("button", { name: "Publish form", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published version 1.");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const context = await browser.newContext();
  const respondent = await context.newPage();
  await respondent.goto(await page.getByLabel("Public form link").inputValue());
  await respondent.getByRole("button", { name: "Let’s begin" }).click();
  await respondent
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(respondent.getByRole("alert")).toContainText("Please answer");
  await respondent
    .getByRole("textbox", { name: "What’s your name?" })
    .fill("Intake Client");
  await respondent.keyboard.press("Enter");
  await respondent
    .getByRole("textbox", { name: "Where can we reach you?" })
    .fill(`intake-${Date.now()}@example.com`);
  await respondent
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await respondent
    .getByRole("textbox", { name: "What would you like help with?" })
    .fill("A new website for our studio.");
  await respondent
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await respondent
    .getByRole("radio", { name: "Within a month", exact: true })
    .check();
  await respondent
    .getByRole("radio", { name: "A friend", exact: true })
    .check();
  await respondent
    .getByRole("button", { name: "Submit response", exact: true })
    .click();
  await expect(
    respondent.getByRole("heading", { name: "You’re all set." }),
  ).toBeVisible();
  await context.close();
});
test("edits a document with slash insertion, block settings, duplicate, undo, drag and save", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: /Create feedback form/ }).click();
  await page
    .getByLabel("Form title", { exact: true })
    .fill(`Document builder ${Date.now()}`);
  await page
    .getByLabel("Form introduction")
    .fill("We would love to hear from you.");
  await page
    .getByRole("button", {
      name: "Insert block before question 2",
      exact: true,
    })
    .click();
  const search = page.getByRole("combobox", { name: "Search blocks" });
  await search.fill("/short");
  await search.press("Enter");
  await page
    .getByLabel("Question 2", { exact: true })
    .fill("What should we call you?");
  await page
    .getByLabel("Help text for question 2", { exact: true })
    .fill("Your preferred name is fine.");
  let block = page.getByRole("group", {
    name: "Question block 2",
    exact: true,
  });
  await block.locator("summary").click();
  await block
    .getByLabel("Save answer to contact property")
    .selectOption("first_name");
  await block
    .getByRole("button", { name: "Duplicate question", exact: true })
    .click();
  await expect(page.getByLabel("Question 3", { exact: true })).toHaveValue(
    "What should we call you?",
  );
  await page
    .getByRole("group", { name: "Question block 3", exact: true })
    .getByRole("button", { name: "Remove question", exact: true })
    .click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Question 3", { exact: true })).toHaveValue(
    "What should we call you?",
  );
  await page
    .getByRole("group", { name: "Question block 3", exact: true })
    .getByRole("button", { name: "Remove question", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Drag question 2 to reorder", exact: true })
    .dragTo(
      page.getByRole("button", {
        name: "Insert block before question 1",
        exact: true,
      }),
    );
  await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue(
    "What should we call you?",
  );
  await expect(page.getByLabel("Question 2", { exact: true })).toHaveValue(
    "How was your experience?",
  );
  await page
    .getByRole("button", {
      name: "Type / or click to add a block…",
      exact: true,
    })
    .click();
  await search.fill("/email");
  await expect(
    page.getByText("No matching blocks.", { exact: false }),
  ).toBeVisible();
  await search.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "Type / or click to add a block…",
      exact: true,
    }),
  ).toBeFocused();
  await expect(page.getByTestId("form-save-status")).toHaveText(
    "All changes saved",
  );
  // Editing tabs must preserve the complete document and its stable question identities.
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Let’s begin", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "What should we call you?",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.screenshot({
    path: ".local/forms-block-builder.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/forms-block-builder-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue(
    "What should we call you?",
  );
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`builder preserves input identity and focus through animated edits (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await login(page);
    await page.getByRole("button", { name: /Create feedback form/ }).click();
    const first = page.getByLabel("Question 1", { exact: true });
    const id = await first.getAttribute("data-question-id");
    const field = page.locator(`[data-question-id="${id}"]`);
    const row = page.locator(".form-block-motion").filter({ has: field });
    const originalInput = await field.elementHandle();
    await field.fill("A question that stays with its block");
    await expect(field).toBeFocused();
    await expect(row).toHaveCSS("transform", "none");
    const duringMove = await row
      .getByRole("button", { name: "Move question down", exact: true })
      .evaluate(async (button) => {
        const row = button.closest(".form-block-motion")!;
        (button as HTMLButtonElement).click();
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return getComputedStyle(row).transform;
      });
    if (reducedMotion === "no-preference") expect(duringMove).not.toBe("none");
    else expect(duringMove).toBe("none");
    await expect(field).toHaveAttribute("aria-label", "Question 2");
    await expect(field).toBeFocused();
    expect(
      await originalInput!.evaluate(
        (input) => input.isConnected && input === document.activeElement,
      ),
    ).toBe(true);
    await expect(row).toHaveCSS("transform", "none");
    await row
      .getByRole("button", { name: "Duplicate question", exact: true })
      .click();
    const copy = page.getByLabel("Question 3", { exact: true });
    await expect(copy).toHaveValue("A question that stays with its block");
    await expect(copy).toBeFocused();
    const copyId = await copy.getAttribute("data-question-id");
    await page
      .getByRole("group", { name: "Question block 3", exact: true })
      .getByRole("button", { name: "Remove question" })
      .click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(copy).toHaveAttribute("data-question-id", copyId!);
    await expect(copy).toBeFocused();
    await expect(page.locator(".form-block-motion[inert]")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("group", { name: "Question block 3", exact: true })
      .getByRole("button", { name: "Move question up" })
      .click();
    await expect(
      page.locator(`[data-question-id="${copyId}"]`),
    ).toHaveAttribute("aria-label", "Question 2");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test.describe("live block dragging", () => {
  test.use({ hasTouch: true });
  for (const input of ["mouse", "touch"] as const) {
    test(`blocks make room before release and cancellation restores the order (${input})`, async ({
      page,
    }) => {
      await page.setViewportSize(
        input === "touch"
          ? { width: 390, height: 844 }
          : { width: 1280, height: 1000 },
      );
      if (input === "touch")
        await page.emulateMedia({ reducedMotion: "reduce" });
      await login(page);
      await page.getByRole("button", { name: /Create feedback form/ }).click();
      const firstId = await page
        .getByLabel("Question 1", { exact: true })
        .getAttribute("data-question-id");
      const secondId = await page
        .getByLabel("Question 2", { exact: true })
        .getAttribute("data-question-id");
      const firstField = page.locator(`[data-question-id="${firstId}"]`);
      const secondField = page.locator(`[data-question-id="${secondId}"]`);
      const secondInput = await secondField.elementHandle();
      const cdp =
        input === "touch" ? await page.context().newCDPSession(page) : null;
      async function press(x: number, y: number) {
        if (cdp)
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y, id: 1 }],
          });
        else {
          await page.mouse.move(x, y);
          await page.mouse.down();
        }
      }
      async function move(x: number, from: number, to: number) {
        for (let i = 1; i <= 12; i++) {
          const y = from + ((to - from) * i) / 12;
          if (cdp)
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x, y, id: 1 }],
            });
          else await page.mouse.move(x, y);
          await page.evaluate(() => new Promise(requestAnimationFrame));
        }
      }
      async function release() {
        if (cdp)
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        else await page.mouse.up();
      }
      await firstField.evaluate((el) =>
        el.closest(".form-block-motion")!.scrollIntoView({ block: "start" }),
      );
      const firstBefore = (await firstField.boundingBox())!.y;
      const handle = page.getByRole("button", {
        name: "Drag question 2 to reorder",
        exact: true,
      });
      const from = (await handle.boundingBox())!;
      const top = (await page
        .getByRole("button", {
          name: "Drag question 1 to reorder",
          exact: true,
        })
        .boundingBox())!;
      const x = from.x + from.width / 2,
        y = from.y + from.height / 2;
      await press(x, y);
      await move(x, y, top.y + top.height / 2);
      // This assertion runs with the pointer still held: the gap is live, not drop-only.
      await expect(secondField).toHaveAttribute("aria-label", "Question 1");
      await expect(
        page.locator(".form-block-motion[data-dragging]"),
      ).toHaveCount(1);
      await expect
        .poll(async () => (await firstField.boundingBox())!.y)
        .toBeGreaterThan(firstBefore + 50);
      await page.screenshot({ path: `.local/forms-live-drag-${input}.png` });
      await release();
      await expect(
        page.locator(".form-block-motion[data-dragging]"),
      ).toHaveCount(0);
      await expect(secondField).toBeFocused();
      expect(await secondInput!.evaluate((el) => el.isConnected)).toBe(true);
      await expect(secondField).toHaveValue("What could we do better?");
      await expect(
        page.locator(".form-block-motion").filter({ has: secondField }),
      ).toHaveCSS("transform", "none");
      await secondField.evaluate((el) =>
        el.closest(".form-block-motion")!.scrollIntoView({ block: "start" }),
      );
      const current = (await page
        .getByRole("button", {
          name: "Drag question 1 to reorder",
          exact: true,
        })
        .boundingBox())!;
      const destination = (await firstField.boundingBox())!;
      await press(
        current.x + current.width / 2,
        current.y + current.height / 2,
      );
      await move(
        current.x + current.width / 2,
        current.y + current.height / 2,
        destination.y + 100,
      );
      await expect(secondField).not.toHaveAttribute("aria-label", "Question 1");
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchCancel",
          touchPoints: [],
        });
      else {
        await page.keyboard.press("Escape");
        await release();
      }
      await expect(secondField).toHaveAttribute("aria-label", "Question 1");
      await expect(
        page.locator(".form-block-motion[data-dragging]"),
      ).toHaveCount(0);
      await expect(page.getByTestId("form-save-status")).toHaveText(
        "All changes saved",
      );
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.getByRole("button", { name: "Build", exact: true }).click();
      await expect(
        page.getByLabel("Question 1", { exact: true }),
      ).toHaveAttribute("data-question-id", secondId!);
      await expect(
        page.getByLabel("Question 2", { exact: true }),
      ).toHaveAttribute("data-question-id", firstId!);
      if (cdp) await cdp.detach();
    });
  }
});

test.describe("drag edge scrolling", () => {
  test.use({ hasTouch: true });
  for (const input of ["mouse", "touch"] as const) {
    test(`scrolls continuously with a stationary ${input} pointer and stops outside the edges`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: input === "touch" ? 390 : 1280,
        height: 900,
      });
      await login(page);
      await page.getByRole("button", { name: /Create feedback form/ }).click();
      for (let i = 0; i < 7; i++) {
        await page
          .getByRole("group", { name: "Question block 1", exact: true })
          .getByRole("button", { name: "Duplicate question" })
          .click();
      }
      const field = page.getByLabel("Question 1", { exact: true });
      const id = await field.getAttribute("data-question-id");
      const stable = page.locator(`[data-question-id="${id}"]`);
      await field.evaluate((el) =>
        el.closest(".form-block-motion")!.scrollIntoView({ block: "start" }),
      );
      const handle = page
        .locator(".form-block-motion")
        .filter({ has: stable })
        .locator(".form-drag-handle");
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const cdp =
        input === "touch" ? await page.context().newCDPSession(page) : null;
      let pointerY = box.y + box.height / 2;
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y: pointerY, id: 1 }],
        });
      else {
        await page.mouse.move(x, pointerY);
        await page.mouse.down();
      }
      async function moveTo(y: number) {
        const from = pointerY;
        for (let i = 1; i <= 20; i++) {
          pointerY = from + ((y - from) * i) / 20;
          if (cdp)
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x, y: pointerY, id: 1 }],
            });
          else await page.mouse.move(x, pointerY);
          await page.evaluate(() => new Promise(requestAnimationFrame));
        }
      }
      const start = await page.evaluate(() => scrollY);
      await moveTo(880);
      await expect(page.locator(".form-drag-scroll-bottom")).toBeVisible();
      // No pointer events while these polls run: holding still must keep scrolling.
      await expect
        .poll(() => page.evaluate(() => scrollY))
        .toBeGreaterThan(start + 600);
      const midway = await page.evaluate(() => scrollY);
      await expect
        .poll(() => page.evaluate(() => scrollY))
        .toBeGreaterThan(midway + 180);
      expect(
        Number((await stable.getAttribute("aria-label"))!.split(" ")[1]),
      ).toBeGreaterThan(3);
      expect(
        Math.abs((await handle.boundingBox())!.y + box.height / 2 - 880),
      ).toBeLessThan(45);
      await page.screenshot({ path: `.local/forms-edge-scroll-${input}.png` });
      await moveTo(450);
      await page.waitForTimeout(120);
      const paused = await page.evaluate(() => scrollY);
      await page.waitForTimeout(350);
      expect(await page.evaluate(() => scrollY)).toBe(paused);
      await moveTo(20);
      await expect(page.locator(".form-drag-scroll-top")).toBeVisible();
      const reverse = await page.evaluate(() => scrollY);
      await expect
        .poll(() => page.evaluate(() => scrollY))
        .toBeLessThan(reverse - 180);
      if (cdp)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      else {
        await page.keyboard.press("Escape");
        await page.mouse.up();
      }
      await expect(page.locator(".form-drag-scroll-hints")).toHaveCount(0);
      await expect(
        page.locator(".form-block-motion[data-dragging]"),
      ).toHaveCount(0);
      await page.waitForTimeout(120);
      const stopped = await page.evaluate(() => scrollY);
      await page.waitForTimeout(350);
      expect(await page.evaluate(() => scrollY)).toBe(stopped);
      if (input === "mouse")
        await expect(stable).toHaveAttribute("aria-label", "Question 1");
      await expect(stable).toHaveValue("How was your experience?");
      if (cdp) await cdp.detach();
    });
  }
});
