import { approvedOperation } from "../helpers/approved-operation.js";
import { beforeAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import type { Runtime } from "@narada/core/runtime";
import { Narada } from "../../packages/sdk/src/index.js";
import type { Message } from "@narada/core/model";
let runtime: Runtime, sdk: Narada, app: ReturnType<typeof createApp>;
beforeAll(async () => {
  const prefix = process.env.NARADA_TEST_PREFIX ?? "narada-integration";
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(
    process.env.NARADA_TEST_PREFIX
      ? `.local/${prefix}-owner.json`
      : ".local/test-owner.json",
  );
  app = createApp(runtime);
  const key = await runtime.service.createKey("Templates SDK", "full");
  sdk = new Narada({
    baseUrl: "http://localhost:3001",
    apiKey: key.token,
    fetch: async (input, init) => app.request(new Request(input, init)),
  });
});
const draft = {
  name: "Welcome",
  kind: "transactional" as const,
  subject: "Hi {{vars.name}}",
  html: "<p>Hi {{vars.name}}</p>",
  text: "Hi {{vars.name}}",
  variables: [{ key: "name", type: "string" as const, fallback: "Friend" }],
};
it("publishes immutable versions and resolves template sends without changing queued content", async () => {
  const alias = `welcome-${randomUUID()}`,
    t = await sdk.templates.create({ alias, ...draft });
  await expect(
    approvedOperation(runtime, sdk, {
      operation: "emails.send",
      input: {
        body: {
          from: "hello@narada.test",
          to: "sdk@example.com",
          template: { id: alias },
        },
      },
    }),
  ).rejects.toMatchObject({ status: 422 });
  const published = await sdk.templates.publish(t.id, { revision: t.revision });
  expect(published.publishedVersion).toBe(1);
  const sending = (await runtime.service.createKey("Template sender")).token;
  const sendClient = new Narada({
    baseUrl: "http://localhost:3001",
    apiKey: sending,
    fetch: async (input, init) => app.request(new Request(input, init)),
  });
  await expect(sendClient.templates.get(alias)).rejects.toMatchObject({
    status: 403,
  });
  const send = () =>
    approvedOperation(
      runtime,
      sendClient,
      {
        operation: "emails.send",
        input: {
          body: {
            from: "hello@narada.test",
            to: "sdk@example.com",
            template: { id: alias, version: 1, variables: { name: "Alex <3" } },
          },
        },
      },
      { idempotencyKey: alias },
    );
  const result = await send();
  expect((await send()).replayed).toBe(false);
  const message = await runtime.store.get<Message>(`MSG#${result.id}`);
  expect(message?.input.html).toContain("Alex &lt;3");
  const edited = await sdk.templates.update(alias, {
    draft: { ...draft, subject: "Changed {{vars.name}}" },
    revision: published.revision,
  });
  expect(edited.hasUnpublishedChanges).toBe(true);
  expect((await sdk.templates.preview(alias, { version: 1 })).subject).toBe(
    "Hi Friend",
  );
  const newer = await sdk.templates.publish(alias, {
    revision: edited.revision,
  });
  expect(newer.publishedVersion).toBe(2);
  expect((await sdk.templates.preview(alias, { version: 1 })).subject).toBe(
    "Hi Friend",
  );
  expect((await sdk.templates.preview(alias, { version: 2 })).subject).toBe(
    "Changed Friend",
  );
  expect((await send()).id).toBe(result.id);
  expect(
    (await runtime.store.get<Message>(`MSG#${result.id}`))?.input.subject,
  ).toBe("Hi Alex <3");
  const archived = await sdk.templates.archive(alias, {
    archived: true,
    revision: newer.revision,
  });
  await expect(send()).rejects.toMatchObject({ status: 422 });
  await sdk.templates.archive(alias, {
    archived: false,
    revision: archived.revision,
  });
  expect((await send()).replayed).toBe(false);
});
it("prevents duplicate aliases, lost updates, concurrent publications and mixed email content", async () => {
  const alias = `conflict-${randomUUID()}`,
    t = await sdk.templates.create({ ...draft, alias });
  await expect(sdk.templates.create({ ...draft, alias })).rejects.toMatchObject(
    { status: 409 },
  );
  const publications = await Promise.allSettled([
    sdk.templates.publish(alias, { revision: 0 }),
    sdk.templates.publish(alias, { revision: 0 }),
  ]);
  expect(publications.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(
    sdk.templates.update(alias, { draft, revision: 0 }),
  ).rejects.toMatchObject({ status: 409 });
  const auth = (await runtime.service.createKey("strict input")).token;
  const response = await app.request("/api/v1/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${auth}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: "hello@narada.test",
      to: "x@example.com",
      template: { id: alias },
      html: "override",
    }),
  });
  expect(response.status).toBe(400);
  await expect(
    sdk.templates.preview(t.id, { variables: { name: "\r\nBad header" } }),
  ).rejects.toMatchObject({ status: 422 });
});
it("copies published broadcast templates into independent drafts and preserves compatibility", async () => {
  const t = await sdk.templates.create({
    alias: `news-${randomUUID()}`,
    name: "News",
    kind: "broadcast",
    subject: "Hi {{contact.first_name}}",
    text: "News for {{contact.email}}",
  });
  const p = await sdk.templates.publish(t.id, { revision: 0 });
  const broadcast = await sdk.templates.createBroadcast(t.id, {
    name: "Independent news",
  });
  expect(broadcast.draft.text).toBe("News for {{contact.email}}");
  const edited = await sdk.templates.update(t.id, {
    draft: {
      name: "Edited news",
      kind: "broadcast",
      subject: "New",
      text: "New content",
    },
    revision: p.revision,
  });
  await sdk.templates.publish(t.id, { revision: edited.revision });
  expect((await sdk.broadcasts.get(broadcast.id)).draft.text).toBe(
    "News for {{contact.email}}",
  );
  const copy = await sdk.templates.duplicate(t.id, {
    alias: `copy-${randomUUID()}`,
  });
  expect(copy.status).toBe("draft");
  expect(copy.publishedVersion).toBeUndefined();
  await expect(
    approvedOperation(runtime, sdk, {
      operation: "emails.send",
      input: {
        body: {
          from: "hello@narada.test",
          to: "x@example.com",
          template: { id: t.id },
        },
      },
    }),
  ).rejects.toMatchObject({ status: 422 });
  const list = await sdk.templates.list({ limit: 1 });
  expect(list.data[0]).not.toHaveProperty("pk");
  expect(list.nextCursor).toBeTruthy();
  const next = await sdk.templates.list({ limit: 1, cursor: list.nextCursor! });
  expect(next.data[0]?.id).not.toBe(list.data[0]?.id);
});
