import { expect, it, vi } from "vitest";
import { createRuntime } from "@narada/runtime-aws";
import { loadConfig } from "@narada/core/config";
import { messageContentInput } from "@narada/core/message-content";
import { draftInput } from "@narada/core/broadcast-model";
import { templateInput } from "@narada/core/template-model";

it("wires one shared set of services and preserves the dispatcher compatibility entrypoint", async () => {
  const runtime = createRuntime(
    loadConfig({ BETTER_AUTH_SECRET: "x".repeat(40) }),
  );
  expect(runtime.forms.directory).toBe(runtime.contacts);
  expect(runtime.broadcasts.directory).toBe(runtime.contacts);
  for (const consumer of [
    runtime.forms,
    runtime.broadcasts,
    runtime.contacts,
    runtime.service,
  ])
    expect(consumer.subscriptions).toBe(runtime.subscriptions);
  expect(runtime.templates.store).toBe(runtime.store);
  expect(runtime.service.dispatcher).toBe(runtime.dispatcher);
  const dispatch = vi.spyOn(runtime.dispatcher, "dispatch").mockResolvedValue();
  await runtime.service.dispatch();
  expect(dispatch).toHaveBeenCalledTimes(1);
  dispatch.mockRestore();
});
it("keeps shared content independent of recipient and sending settings", () => {
  const content = {
    document: { type: "doc", content: [{ type: "paragraph" }] },
    html: "<p>Hello</p>",
    text: "Hello",
  };
  expect(messageContentInput.parse(content)).toEqual(content);
  expect(draftInput.parse({ name: "Issue", ...content })).toMatchObject(
    content,
  );
  expect(templateInput.parse({ name: "Template", ...content })).toMatchObject(
    content,
  );
  expect(
    messageContentInput.safeParse({ ...content, audienceId: "private" })
      .success,
  ).toBe(false);
  expect(
    messageContentInput.safeParse({ ...content, unsubscribeUrl: "secret" })
      .success,
  ).toBe(false);
});
it.each([
  { text: "x".repeat(30001) },
  { html: "x".repeat(50001) },
  { document: { type: "doc", content: [{ text: "x".repeat(100001) }] } },
])("preserves content limits across templates and broadcasts", (content) => {
  expect(messageContentInput.safeParse(content).success).toBe(false);
  expect(draftInput.safeParse({ name: "Issue", ...content }).success).toBe(
    false,
  );
  expect(
    templateInput.safeParse({ name: "Template", ...content }).success,
  ).toBe(false);
});
