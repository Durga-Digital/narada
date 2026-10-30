import { approvedOperation } from "../helpers/approved-operation.js";
import { beforeAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import type { Runtime } from "@narada/core/runtime";
import { Narada } from "../../packages/sdk/src/index.js";
import { contactKey, topicPreferenceKey } from "@narada/core/audience-model";
let runtime: Runtime,
  app: ReturnType<typeof createApp>,
  sdk: Narada,
  token: string;
const transport: typeof fetch = async (input, init) =>
  app.request(new Request(input, init));
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
  token = (await runtime.service.createKey("SDK full", "full")).token;
  sdk = new Narada({
    baseUrl: "http://localhost:3001",
    apiKey: token,
    fetch: transport,
  });
});
it("restricts new management APIs to full keys, keeps legacy permissions and admin sessions separate", async () => {
  const key = await runtime.service.createKey("Legacy sending");
  const restricted = new Narada({
    baseUrl: "http://localhost:3001",
    apiKey: key.token,
    fetch: transport,
  });
  await expect(restricted.contacts.list()).rejects.toMatchObject({
    status: 403,
    code: "forbidden",
  });
  await expect(restricted.emails.get(randomUUID())).rejects.toMatchObject({
    status: 404,
  });
  expect((await app.request("/api/v1/topics")).status).toBe(401);
  expect(
    (
      await app.request("/api/admin/topics", {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status,
  ).toBe(401);
  const row = await runtime.service.authenticate(key.token);
  const { permission, ...legacy } = row;
  await runtime.store.put(legacy);
  await expect(restricted.topics.list()).rejects.toMatchObject({ status: 403 });
  await runtime.store.patch(row.pk, { revoked: true });
  await expect(restricted.emails.get(randomUUID())).rejects.toMatchObject({
    status: 401,
  });
});
it("runs a typed SDK workflow through authenticated APIs with personalization, consent and revisions", async () => {
  const suffix = randomUUID(),
    email = `sdk+${suffix}@example.com`,
    key = `sdk_${suffix.slice(0, 8)}`;
  const prop = await sdk.contactProperties.create({
    key,
    type: "string",
    fallback: "Friend",
  });
  const topic = await sdk.topics.create({ name: `SDK ${suffix}` });
  await sdk.contactProperties.update(key, {
    property: { key, type: "string", fallback: "Everyone" },
    revision: prop.revision,
  });
  expect((await sdk.contactProperties.get(key)).fallback).toBe("Everyone");
  await expect(
    sdk.contactProperties.update(key, {
      property: { key, type: "string" },
      revision: prop.revision,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await sdk.topics.update(topic.id, {
    topic: { name: topic.name, description: "SDK topic", active: true },
    revision: topic.revision,
  });
  expect((await sdk.topics.get(topic.id)).description).toBe("SDK topic");
  const segment = await sdk.segments.create({
    name: `SDK ${suffix}`,
    kind: "manual",
  });
  const contact = await sdk.contacts.create({
    email,
    first_name: "Alex",
    properties: { [key]: "Team" },
  });
  await sdk.segments.update(segment.id, {
    segment: { name: "SDK renamed", kind: "manual" },
    revision: segment.revision,
  });
  expect((await sdk.segments.get(segment.id)).name).toBe("SDK renamed");
  await sdk.contacts.update(email, {
    contact: {
      name: "Alex Updated",
      first_name: "Alex",
      last_name: "",
      properties: contact.properties,
    },
    revision: contact.revision,
  });
  expect((await sdk.contacts.get(email)).contact.name).toBe("Alex Updated");
  expect(contact).not.toHaveProperty("pk");
  expect(topic).not.toHaveProperty("scope");
  expect(prop).not.toHaveProperty("sort");
  expect(
    (await sdk.contacts.get(email)).topics.find((t) => t.id === topic.id)
      ?.subscribed,
  ).toBe(false);
  await sdk.segments.import(segment.id, {
    csv: `email,first_name\n${email},Alex`,
    consentSource: "Explicit signup",
    consentConfirmed: true,
    topicIds: [topic.id],
  });
  expect((await sdk.segments.contacts(segment.id)).data).toHaveLength(1);
  expect(
    (await sdk.contacts.get(email)).topics.find((t) => t.id === topic.id)
      ?.subscribed,
  ).toBe(true);
  const draft = await sdk.broadcasts.create({
    name: "SDK news",
    audienceId: segment.id,
    topicId: topic.id,
    from: "hello@narada.test",
    subject: "Hi {{contact.first_name}}",
    text: `Welcome {{contact.${key}}}`,
    organization: "Narada",
    postalAddress: "1 Test Street",
  });
  expect(draft).not.toHaveProperty("state");
  expect(draft).not.toHaveProperty("runToken");
  expect(await sdk.broadcasts.preview(draft.id, email)).toMatchObject({
    subject: "Hi Alex",
    eligible: 1,
  });
  const updated = await sdk.broadcasts.update(draft.id, {
    draft: { ...draft.draft, name: "Updated SDK" },
    revision: draft.revision,
  });
  await expect(
    sdk.broadcasts.update(draft.id, {
      draft: draft.draft,
      revision: draft.revision,
    }),
  ).rejects.toMatchObject({ status: 409, code: "conflict" });
  const launched = await approvedOperation(runtime, sdk, {
    operation: "broadcasts.send",
    input: {
      params: { id: draft.id },
      body: {
        revision: updated.revision,
        confirmed: true,
        scheduledAt: Date.now() + 3600000,
      },
    },
  });
  expect(launched.status).toBe("scheduled");
  expect((await sdk.broadcasts.recipients(draft.id)).data[0]?.email).toBe(
    email,
  );
  await expect(
    approvedOperation(runtime, sdk, {
      operation: "broadcasts.send",
      input: {
        params: { id: draft.id },
        body: {
          revision: updated.revision,
          confirmed: true,
        },
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await sdk.broadcasts.cancel(draft.id)).status).toBe("cancelled");
  expect((await sdk.broadcasts.duplicate(draft.id)).status).toBe("draft");
  await sdk.contacts.subscribe(email, topic.id, {
    subscribed: false,
    source: "Subscriber preference",
    confirmed: true,
  });
  await sdk.segments.import(segment.id, {
    csv: email,
    consentSource: "Reimport",
    consentConfirmed: true,
    topicIds: [topic.id],
  });
  expect(
    (await sdk.contacts.get(email)).topics.find((t) => t.id === topic.id)
      ?.subscribed,
  ).toBe(false);
  await sdk.contacts.unsubscribe(email);
  expect((await sdk.contacts.get(email)).unsubscribedAll).toBe(true);
  await sdk.segments.removeContact(segment.id, email);
  expect((await sdk.segments.contacts(segment.id)).data).toEqual([]);
  expect(await runtime.store.get(contactKey(email))).toBeTruthy();
  expect(
    (await runtime.store.get(topicPreferenceKey(topic.id, email)))?.subscribed,
  ).toBe(false);
  // Keep topic/property fixtures below the installation's limits on repeated test runs.
  await runtime.store.remove(`TOPIC#${topic.id}`);
  await runtime.store.remove(`PROPERTY#${prop.key}`);
});
it("paginates collections and broadcast storage without leaking storage keys", async () => {
  const first = await sdk.broadcasts.list({ limit: 1 });
  expect(first.data).toHaveLength(1);
  expect(first.nextCursor).toBeTruthy();
  const next = await sdk.broadcasts.list({
    limit: 1,
    cursor: first.nextCursor!,
  });
  expect(next.data[0]?.id).not.toBe(first.data[0]?.id);
  await expect(
    sdk.topics.list({ cursor: first.nextCursor! }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(sdk.contacts.list({ limit: 101 })).rejects.toMatchObject({
    status: 400,
  });
  await expect(sdk.contacts.create({ email: "invalid" })).rejects.toMatchObject(
    { status: 400 },
  );
  const response = await app.request("/api/v1/no-such-resource", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(404);
  expect((await response.json()).requestId).toBeTruthy();
});
it("returns actionable rate-limit errors", async () => {
  const key = await runtime.service.createKey("Rate limit", "full");
  // Exhaust the same bucket atomically without making 120 application requests.
  const { hash } = await import("@narada/core/model");
  const bucket = Math.floor(Date.now() / 1000 / 60);
  await runtime.store.put({
    pk: `RATE#${hash(`api:${key.id}`)}#60#${bucket}`,
    sk: "META",
    count: 120,
    ttl: Math.floor(Date.now() / 1000) + 120,
  });
  const response = await app.request("/api/v1/topics", {
    headers: { authorization: `Bearer ${key.token}` },
  });
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(await response.json()).toMatchObject({
    code: "rate_limited",
    requestId: expect.any(String),
  });
});
