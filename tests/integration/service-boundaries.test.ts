import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { initialize } from "../../scripts/local.js";
import type { Runtime } from "@narada/core/runtime";
import { formStarters } from "@narada/core/form-content";
import { contactKey, topicPreferenceKey } from "@narada/core/audience-model";
import { hash } from "@narada/core/model";
import { broadcastMessageId } from "@narada/core/broadcast-model";

let runtime: Runtime;
const id = randomUUID();
const appTable = `narada-boundaries-test-${id}`,
  authTable = `narada-boundaries-auth-${id}`;
const credentials = `.local/boundaries-test-${id}.json`;
beforeAll(async () => {
  process.env.APP_TABLE = appTable;
  process.env.AUTH_TABLE = authTable;
  runtime = await initialize(credentials);
  await runtime.store.put({
    pk: "WEBHOOK#test",
    sk: "META",
    scope: "webhooks",
    sort: "test",
    id: "test",
    events: ["contact.created", "contact.updated", "contact.topics.updated"],
  });
});
afterAll(async () => {
  try {
    if (runtime)
      await Promise.all(
        [appTable, authTable].map((TableName) =>
          runtime.store.client.send(new DeleteTableCommand({ TableName })),
        ),
      );
  } finally {
    await rm(credentials, { force: true });
  }
});

async function signup() {
  const topic = await runtime.contacts.saveTopic({
    name: `News ${randomUUID()}`,
  });
  const email = `${randomUUID()}@example.com`;
  const form = await runtime.forms.create({
    ...formStarters.signup,
    syncContacts: true,
    topicId: topic.id,
    from: "hello@narada.test",
  });
  await runtime.forms.publish(form.id, 0);
  const submissionId = randomUUID();
  await runtime.forms.submit(form.id, {
    submissionId,
    version: 1,
    answers: { name: "New reader", email, consent: true },
  });
  let row = await runtime.forms.response(hash(`${form.id}:${submissionId}`));
  await runtime.forms.confirm(runtime.forms.token(row));
  row = await runtime.forms.response(row.id);
  const content = (await runtime.forms.version(form.id, 1)).content;
  return { topic, email, row, content };
}
async function jobs(responseId: string) {
  return (await runtime.store.list("webhookAttempts", 1000)).filter((row) =>
    JSON.stringify(row.payload).includes(responseId),
  );
}

it("rolls back profile, form state, and webhook jobs when an opt-out races signup, then retries without resubscribing", async () => {
  const f = await signup();
  const original = runtime.subscriptions.prepareSignup.bind(
    runtime.subscriptions,
  );
  const prepare = vi
    .spyOn(runtime.subscriptions, "prepareSignup")
    .mockImplementationOnce(async (input) => {
      const writes = await original(input);
      await runtime.store.put({
        pk: topicPreferenceKey(f.topic.id, f.email),
        sk: "META",
        subscribed: false,
        source: "Concurrent opt-out",
      });
      return writes;
    });
  try {
    await expect(runtime.forms.sync(f.row, f.content)).rejects.toMatchObject({
      name: "TransactionCanceledException",
    });
  } finally {
    prepare.mockRestore();
  }
  expect(await runtime.store.get(contactKey(f.email))).toBeUndefined();
  expect((await runtime.forms.response(f.row.id)).syncedAt).toBeUndefined();
  expect(await jobs(f.row.id)).toEqual([]);
  const saved = await runtime.forms.sync(
    await runtime.forms.response(f.row.id),
    f.content,
  );
  expect(saved.syncedAt).toBeTruthy();
  expect(await runtime.contacts.contact(f.email)).toMatchObject({
    name: "New reader",
  });
  expect(
    await runtime.store.get(topicPreferenceKey(f.topic.id, f.email)),
  ).toMatchObject({ subscribed: false });
  expect(await jobs(f.row.id)).toHaveLength(1);
  await runtime.forms.sync(saved, f.content);
  expect(await jobs(f.row.id)).toHaveLength(1);
});

it("commits profile, signup consent and both webhook events together exactly once", async () => {
  const f = await signup();
  const saved = await runtime.forms.sync(f.row, f.content);
  expect(
    await runtime.store.get(topicPreferenceKey(f.topic.id, f.email)),
  ).toMatchObject({ subscribed: true, updatedAt: f.row.verifiedAt });
  expect(await jobs(f.row.id)).toHaveLength(2);
  await runtime.forms.sync(saved, f.content);
  expect(await jobs(f.row.id)).toHaveLength(2);
});

it("does not overwrite a concurrent profile edit or partially commit its prepared consent", async () => {
  const f = await signup();
  const existing = await runtime.contacts.createContact({
    email: f.email,
    name: "Original",
    first_name: "Keep",
  });
  const original = runtime.contacts.prepareVerifiedProfile.bind(
    runtime.contacts,
  );
  const prepare = vi
    .spyOn(runtime.contacts, "prepareVerifiedProfile")
    .mockImplementationOnce(async (input) => {
      const writes = await original(input);
      await runtime.contacts.updateContact(
        f.email,
        {
          name: "Concurrent edit",
          first_name: "Keep",
          last_name: "",
          properties: {},
        },
        existing.revision,
      );
      return writes;
    });
  try {
    await expect(runtime.forms.sync(f.row, f.content)).rejects.toMatchObject({
      name: "TransactionCanceledException",
    });
  } finally {
    prepare.mockRestore();
  }
  expect(await runtime.contacts.contact(f.email)).toMatchObject({
    name: "Concurrent edit",
    first_name: "Keep",
  });
  expect(
    await runtime.store.get(topicPreferenceKey(f.topic.id, f.email)),
  ).toBeUndefined();
  expect((await runtime.forms.response(f.row.id)).syncedAt).toBeUndefined();
  expect(await jobs(f.row.id)).toHaveLength(0);
});

it("uses the same policy for broadcast preview and fresh pre-delivery preferences", async () => {
  const f = await signup();
  await runtime.forms.sync(f.row, f.content);
  const audience = await runtime.contacts.createSegment({
    name: "Readers",
    kind: "manual",
  });
  await runtime.contacts.addMember(audience.id, f.email);
  const broadcast = await runtime.broadcasts.create({
    name: "Issue",
    audienceId: audience.id,
    topicId: f.topic.id,
    from: "hello@narada.test",
    subject: "News",
    text: "Hello",
    organization: "Narada",
    postalAddress: "1 Test Street",
  });
  expect((await runtime.broadcasts.preview(broadcast.id)).eligible).toBe(1);
  await runtime.broadcasts.start(broadcast.id, 0);
  await runtime.broadcasts.run(broadcast.id);
  await runtime.subscriptions.unsubscribeAll(f.email);
  const send = vi.spyOn(runtime.transport, "send");
  try {
    await runtime.service.send(broadcastMessageId(broadcast.id, f.email));
    expect(send).not.toHaveBeenCalled();
  } finally {
    send.mockRestore();
  }
  expect((await runtime.broadcasts.results(broadcast.id)).counts.failed).toBe(
    1,
  );
  expect((await runtime.broadcasts.preview(broadcast.id)).eligible).toBe(0);
});
