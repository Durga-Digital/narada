import { test, expect } from "../helpers/browser.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { localEnv } from "../../scripts/local.js";
import { createRuntime } from "@narada/runtime-aws";
import { GrantStore } from "@narada/core/oauth-grants";

test("owner narrows and disconnects apps inside Profile on desktop and mobile", async ({
  page,
  context,
}) => {
  const origin = "http://localhost:5173";
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_OWNER_FILE ?? ".local/owner.json",
      "utf8",
    ),
  );
  const login = await context.request.post(origin + "/api/auth/sign-in/email", {
    headers: { origin },
    data: owner,
  });
  expect(login.status()).toBe(200);
  const { user } = await login.json();
  await localEnv();
  const runtime = createRuntime();
  expect(runtime.config.NARADA_MODE).toBe("local");
  const grants = new GrantStore(runtime.store, origin + "/api/mcp");
  const clientId = `Dashboard connection ${randomUUID()}`;
  const reference = await grants.reference(
    user.id,
    clientId,
    ["narada:forms:read", "narada:forms:write"],
    {},
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/?page=profile");
    await expect(
      page.getByRole("heading", { name: "Connected apps", exact: true }),
    ).toBeVisible();
    const card = page.getByRole("article", { name: clientId, exact: true });
    // Other local fixtures may span multiple pages.
    for (let n = 0; n < 100 && !(await card.count()); n++) {
      await expect(
        page.getByRole("button", { name: "Refresh apps" }),
      ).toBeEnabled();
      if (await card.count()) break;
      await page.getByRole("button", { name: "Next apps" }).click();
    }
    await card.getByRole("button", { name: "Manage access" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("group", { name: "Permissions", exact: true }),
    ).toBeVisible();
    const checkboxes = dialog
      .getByRole("group", { name: "Permissions", exact: true })
      .getByRole("checkbox");
    await checkboxes.nth(1).uncheck();
    await dialog
      .getByLabel("Selected sending domains", { exact: true })
      .check();
    await dialog.getByLabel("narada.test", { exact: true }).check();
    await dialog
      .getByRole("button", { name: "Save access", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(new URL(page.url()).searchParams.get("page")).toBe("profile");
    const narrowed = await grants.forOwner(reference, user.id);
    expect(narrowed?.scopes).toEqual(["narada:forms:read"]);
    expect(narrowed?.resources).toEqual({ senderDomains: ["narada.test"] });
    await page.setViewportSize({ width: 390, height: 844 });
    await card.getByRole("button", { name: "Manage access" }).click();
    await expect(
      dialog.getByLabel("All sending domains", { exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByLabel("narada.test", { exact: true }),
    ).toBeChecked();
    await expect(dialog.getByRole("checkbox")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await card.getByRole("button", { name: "Disconnect", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Disconnect app", exact: true })
      .click();
    await expect(card.getByText("Disconnected", { exact: true })).toBeVisible();
    expect((await grants.forOwner(reference, user.id))?.active).toBe(false);
    expect(new URL(page.url()).searchParams.get("page")).toBe("profile");
    expect(errors).toEqual([]);
  } finally {
    await grants.change(reference, user.id, clientId);
    await runtime.store.remove(`OAUTH_GRANT#${reference.split(".")[0]}`);
  }
});
