import { beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { EmailService } from "@narada/core/service";
import { BroadcastService } from "@narada/core/broadcasts";
import { Narada } from "../../packages/sdk/src/index.js";
import {
  marketingKey,
  segmentConsentKey,
  topicPreferenceKey,
} from "@narada/core/audience-model";
import {
  broadcastMessageId,
  unsubscribeKey,
  type Audience,
} from "@narada/core/broadcast-model";
import { hash, type Entity } from "@narada/core/model";

let runtime: Awaited<ReturnType<typeof initialize>>;
let app: ReturnType<typeof createApp>;
let client: Narada;
let token: string;
const transport = {
  send: vi.fn(async () => ({ id: randomUUID(), captured: true })),
};
const origin = "http://localhost:5173";
const sdk = (key: string) =>
  new Narada({
    baseUrl: origin,
    apiKey: key,
    fetch: async (input, init) => app.request(new Request(input, init)),
  });
beforeAll(async () => {
  const prefix = process.env.NARADA_TEST_PREFIX ?? "narada-membership";
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(`.local/${prefix}-owner.json`);
  // Keep test work out of the shared local worker queues.
  vi.spyOn(runtime.queues, "send").mockResolvedValue();
  runtime.service = new EmailService(
    runtime.config,
    runtime.store,
    runtime.queues,
    transport,
  );
  runtime.broadcasts = new BroadcastService(
    runtime.config,
    runtime.store,
    runtime.service,
  );
  app = createApp(runtime);
  token = (await runtime.service.createKey("Membership acceptance", "full"))
    .token;
  client = sdk(token);
});
const directory = () => runtime.broadcasts.directory;
async function fixture() {
  const email = `${randomUUID()}@example.com`;
  await client.contacts.create({ email, name: "Alex", first_name: "Alex" });
  const segment = await client.segments.create({
    name: "Example App users",
    kind: "manual",
  });
  return { email, segment };
}
async function draft(segmentId: string, topicId?: string) {
  return client.broadcasts.create({
    name: "Promotion",
    audienceId: segmentId,
    topicId,
    from: "hello@narada.test",
    subject: "News",
    text: "Hello",
    organization: "Test",
    postalAddress: "1 Test Street",
  });
}
it("onboards without consent, deduplicates concurrent adds, blocks marketing, and sends transactional mail", async () => {
  const { email, segment } = await fixture();
  const additions = await Promise.all(
    Array.from({ length: 4 }, () =>
      client.segments.addContact(segment.id, email),
    ),
  );
  for (const member of additions) expect(member).toEqual(additions[0]);
  expect(additions[0]).toEqual({
    email,
    name: "Alex",
    addedAt: expect.any(String),
  });
  expect((await client.segments.contacts(segment.id)).data).toHaveLength(1);
  expect((await directory().audience(segment.id)).total).toBe(1);
  expect(
    await runtime.store.get(segmentConsentKey(segment.id, email)),
  ).toBeUndefined();
  const broadcast = await draft(segment.id);
  expect((await client.broadcasts.preview(broadcast.id)).eligible).toBe(0);
  await expect(
    client.broadcasts.send(broadcast.id, { revision: 0, confirmed: true }),
  ).rejects.toMatchObject({ status: 422 });
  const topic = await client.topics.create({ name: "Product updates" });
  const topical = await draft(segment.id, topic.id);
  expect((await client.broadcasts.preview(topical.id)).eligible).toBe(0);
  transport.send.mockClear();
  const message = await client.emails.send({
    from: "hello@narada.test",
    to: email,
    subject: "Sign in",
    text: "Your sign-in link",
  });
  await runtime.service.send(message.id);
  expect(transport.send).toHaveBeenCalledTimes(1);
  await client.contacts.subscribe(email, topic.id, {
    subscribed: true,
    source: "Separate explicit opt-in",
    confirmed: true,
  });
  expect((await client.broadcasts.preview(topical.id)).eligible).toBe(1);
  expect((await client.broadcasts.preview(broadcast.id)).eligible).toBe(0);
});
it("accepts an empty HTTP request but rejects consent assertions, malformed JSON, missing contacts and dynamic membership", async () => {
  const { email, segment } = await fixture();
  const path = `/api/v1/segments/${segment.id}/contacts/${encodeURIComponent(email)}`;
  const request = (body?: string) =>
    app.request(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body,
    });
  expect((await request()).status).toBe(200);
  expect(
    (
      await request(
        JSON.stringify({ consentConfirmed: true, consentSource: "Signup" }),
      )
    ).status,
  ).toBe(400);
  expect((await request("{")).status).toBe(400);
  await expect(
    client.segments.addContact(segment.id, `${randomUUID()}@example.com`),
  ).rejects.toMatchObject({ status: 404 });
  const dynamic = await client.segments.create({
    name: "Dynamic",
    kind: "dynamic",
    rules: [{ property: "email", operator: "equals", value: email }],
  });
  await expect(
    client.segments.addContact(dynamic.id, email),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    client.segments.removeContact(dynamic.id, email),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    (await client.segments.contacts(dynamic.id)).data[0],
  ).not.toHaveProperty("consentSource");
  expect(
    await runtime.store.get(segmentConsentKey(dynamic.id, email)),
  ).toBeUndefined();
});
it("preserves consent, both topic preferences, unsubscribes and suppression through add/remove/re-add", async () => {
  const { email, segment } = await fixture();
  const records: Entity[] = [
    {
      pk: segmentConsentKey(segment.id, email),
      sk: "META",
      subscribed: true,
      source: "Prior permission",
      updatedAt: "2026-01-01",
    },
    {
      pk: topicPreferenceKey(randomUUID(), email),
      sk: "META",
      subscribed: true,
      source: "Other app",
    },
    {
      pk: topicPreferenceKey(randomUUID(), email),
      sk: "META",
      subscribed: false,
      source: "Opted out",
    },
    {
      pk: unsubscribeKey(segment.id, email),
      sk: "META",
      createdAt: "2026-01-02",
    },
    { pk: marketingKey(email), sk: "META", createdAt: "2026-01-03" },
    { pk: `SUPPRESS#${email}`, sk: "META", reason: "complaint" },
  ];
  for (const row of records) await runtime.store.put(row);
  await client.segments.addContact(segment.id, email);
  await client.segments.addContact(segment.id, email);
  await Promise.all([
    client.segments.removeContact(segment.id, email),
    client.segments.removeContact(segment.id, email),
  ]);
  await client.segments.removeContact(segment.id, email);
  expect((await directory().audience(segment.id)).total).toBe(0);
  await client.segments.addContact(segment.id, email);
  for (const row of records)
    expect(await runtime.store.get(row.pk)).toEqual(row);
  const broadcast = await draft(segment.id);
  expect((await client.broadcasts.preview(broadcast.id)).eligible).toBe(0);
});
it.each(["membership", "topic", "list consent", "suppression"])(
  "rechecks %s before a queued marketing send",
  async (reason) => {
    const { email, segment } = await fixture();
    await client.segments.addContact(segment.id, email);
    const topic = await client.topics.create({ name: "News" });
    await client.contacts.subscribe(email, topic.id, {
      subscribed: true,
      source: "Explicit opt-in",
      confirmed: true,
    });
    if (reason === "list consent")
      await directory().recordListConsent(
        segment.id,
        email,
        "Historical permission",
        new Date().toISOString(),
      );
    const broadcast = await draft(
      segment.id,
      reason === "list consent" ? undefined : topic.id,
    );
    await client.broadcasts.send(broadcast.id, {
      revision: 0,
      confirmed: true,
    });
    await runtime.broadcasts.run(broadcast.id);
    if (reason === "membership")
      await client.segments.removeContact(segment.id, email);
    if (reason === "topic")
      await client.contacts.subscribe(email, topic.id, {
        subscribed: false,
        source: "Opted out",
        confirmed: true,
      });
    if (reason === "list consent")
      await runtime.store.patch(segmentConsentKey(segment.id, email), {
        subscribed: false,
      });
    if (reason === "suppression")
      await runtime.store.put({ pk: `SUPPRESS#${email}`, sk: "META" });
    transport.send.mockClear();
    await runtime.service.send(broadcastMessageId(broadcast.id, email));
    expect(transport.send).not.toHaveBeenCalled();
    expect((await runtime.broadcasts.results(broadcast.id)).counts.failed).toBe(
      1,
    );
  },
);
it("cleans up only Example App membership and named properties, rejecting stale or unauthorized updates", async () => {
  const { email, segment } = await fixture();
  const other = await client.segments.create({
    name: "Other app",
    kind: "manual",
  });
  for (const key of ["app_user_id", "other_app_id"]) {
    if (!(await runtime.store.get(`PROPERTY#${key}`)))
      await client.contactProperties.create({ key, type: "string" });
  }
  await client.contacts.patchProperties(email, {
    revision: 0,
    properties: { app_user_id: "j-1", other_app_id: "o-1" },
  });
  await client.segments.addContact(segment.id, email);
  await client.segments.addContact(other.id, email);
  const topic = await client.topics.create({ name: "Other app news" });
  await client.contacts.subscribe(email, topic.id, {
    subscribed: true,
    source: "Other app opt-in",
    confirmed: true,
  });
  const before = await runtime.store.get(topicPreferenceKey(topic.id, email));
  const otherBefore = await client.segments.contacts(other.id);
  const memberKey = await runtime.service.createKey(
    "Only membership",
    "scoped",
    undefined,
    ["segments:members"],
  );
  await expect(
    sdk(memberKey.token).contacts.patchProperties(email, {
      revision: 1,
      properties: { app_user_id: null },
    }),
  ).rejects.toMatchObject({ status: 403 });
  const contactKey = await runtime.service.createKey(
    "Profile updates",
    "scoped",
    undefined,
    ["contacts:write"],
  );
  const profiles = sdk(contactKey.token);
  await profiles.contacts.patchProperties(email, {
    revision: 1,
    properties: { other_app_id: "o-2" },
  });
  await expect(
    profiles.contacts.patchProperties(email, {
      revision: 1,
      properties: { app_user_id: null },
    }),
  ).rejects.toMatchObject({ status: 409 });
  await client.segments.removeContact(segment.id, email);
  const { contact } = await profiles.contacts.get(email);
  const updated = await profiles.contacts.patchProperties(email, {
    revision: contact.revision,
    properties: { app_user_id: null },
  });
  expect(updated).toMatchObject({
    name: "Alex",
    first_name: "Alex",
    properties: { other_app_id: "o-2" },
  });
  expect(updated.properties).not.toHaveProperty("app_user_id");
  expect(await client.segments.contacts(other.id)).toEqual(otherBefore);
  expect(await runtime.store.get(topicPreferenceKey(topic.id, email))).toEqual(
    before,
  );
  expect((await client.segments.contacts(segment.id)).data).toHaveLength(0);
  const again = await profiles.contacts.patchProperties(email, {
    revision: updated.revision,
    properties: { app_user_id: null },
  });
  expect(again.properties).toEqual(updated.properties);
  await expect(
    profiles.contacts.patchProperties(email, {
      revision: again.revision,
      properties: { name: null },
    }),
  ).rejects.toMatchObject({ status: 400 });
});
it("migrates historical list consent once without overwriting negative preferences", async () => {
  for (const version of [1, 2]) {
    const id = randomUUID(),
      email = `${randomUUID()}@example.com`,
      at = "2026-01-01T00:00:00.000Z";
    const member = {
      email,
      name: "Legacy",
      consentSource: "Original opt-in",
      consentedAt: at,
    };
    const legacy: Audience = {
      pk: `AUDIENCE#${id}`,
      sk: "META",
      scope: "audiences",
      sort: at,
      id,
      name: "Legacy list",
      kind: "manual",
      schemaVersion: version,
      contacts: version === 1 ? [member] : [],
      total: 1,
      revision: 0,
      createdAt: at,
      updatedAt: at,
    };
    await runtime.store.put(legacy);
    if (version === 2)
      await runtime.store.put({
        pk: legacy.pk,
        sk: `CONTACT#${hash(email)}`,
        ...member,
      });
    await runtime.store.put({ pk: unsubscribeKey(id, email), sk: "META" });
    await Promise.all([
      directory().migrate(legacy),
      directory().migrate(legacy),
    ]);
    expect(await runtime.store.get(segmentConsentKey(id, email))).toMatchObject(
      { subscribed: true, source: member.consentSource, updatedAt: at },
    );
    expect(
      (await runtime.broadcasts.audienceDetail(id)).contacts[0]!.subscribed,
    ).toBe(false);
    await runtime.store.patch(segmentConsentKey(id, email), {
      subscribed: false,
    });
    await directory().migrate(legacy);
    expect(
      (await runtime.store.get(segmentConsentKey(id, email)))!.subscribed,
    ).toBe(false);
    expect((await runtime.store.get(legacy.pk))!.schemaVersion).toBe(3);
  }
});
it("opts out of one app's topic without affecting shared memberships, other apps, or transactional mail", async () => {
  const { email, segment } = await fixture();
  const other = await client.segments.create({
    name: "Other app",
    kind: "manual",
  });
  const topic = await client.topics.create({ name: "Example App marketing" });
  const otherTopic = await client.topics.create({
    name: "Other app marketing",
  });
  await client.segments.addContact(segment.id, email);
  await client.segments.addContact(other.id, email);
  for (const id of [topic.id, otherTopic.id])
    await client.contacts.subscribe(email, id, {
      subscribed: true,
      source: "Explicit opt-in",
      confirmed: true,
    });
  const profileBefore = (await client.contacts.get(email)).contact;
  const otherPreference = await runtime.store.get(
    topicPreferenceKey(otherTopic.id, email),
  );
  const memberships = await Promise.all([
    client.segments.contacts(segment.id),
    client.segments.contacts(other.id),
  ]);
  const promotion = await draft(segment.id, topic.id);
  const otherPromotion = await draft(other.id, otherTopic.id);
  await client.broadcasts.send(promotion.id, { revision: 0, confirmed: true });
  await runtime.broadcasts.run(promotion.id);
  const key = await runtime.service.createKey(
    "Topic opt-out",
    "scoped",
    undefined,
    ["contacts:subscriptions"],
  );
  const subscriptions = sdk(key.token);
  await subscriptions.contacts.unsubscribeTopic(email, topic.id);
  await subscriptions.contacts.unsubscribeTopic(email, topic.id);
  expect(
    await runtime.store.get(topicPreferenceKey(topic.id, email)),
  ).toMatchObject({ subscribed: false, source: "API topic unsubscribe" });
  expect(
    await runtime.store.get(topicPreferenceKey(otherTopic.id, email)),
  ).toEqual(otherPreference);
  expect((await client.contacts.get(email)).contact).toEqual(profileBefore);
  expect(
    await Promise.all([
      client.segments.contacts(segment.id),
      client.segments.contacts(other.id),
    ]),
  ).toEqual(memberships);
  expect(await runtime.store.get(marketingKey(email))).toBeUndefined();
  expect(await runtime.store.get(`SUPPRESS#${email}`)).toBeUndefined();
  const nextPromotion = await draft(segment.id, topic.id);
  expect((await client.broadcasts.preview(nextPromotion.id)).eligible).toBe(0);
  expect((await client.broadcasts.preview(otherPromotion.id)).eligible).toBe(1);
  transport.send.mockClear();
  await runtime.service.send(broadcastMessageId(promotion.id, email));
  expect(transport.send).not.toHaveBeenCalled();
  const signIn = await client.emails.send({
    from: "hello@narada.test",
    to: email,
    subject: "Sign in",
    text: "Your sign-in link",
  });
  await runtime.service.send(signIn.id);
  expect(transport.send).toHaveBeenCalledTimes(1);
  await subscriptions.contacts.unsubscribe(email);
  expect((await client.broadcasts.preview(otherPromotion.id)).eligible).toBe(0);
  expect(
    await runtime.store.get(topicPreferenceKey(otherTopic.id, email)),
  ).toEqual(otherPreference);
});
it("allows opt-out of an archived, never-subscribed topic while preserving suppression and enforcing access", async () => {
  const { email } = await fixture();
  const topic = await client.topics.create({ name: "Archived", active: false });
  const suppression = {
    pk: `SUPPRESS#${email}`,
    sk: "META",
    reason: "complaint",
  };
  await runtime.store.put(suppression);
  const key = await runtime.service.createKey(
    "Membership only",
    "scoped",
    undefined,
    ["segments:members"],
  );
  await expect(
    sdk(key.token).contacts.unsubscribeTopic(email, topic.id),
  ).rejects.toMatchObject({ status: 403 });
  await client.contacts.unsubscribeTopic(email, topic.id);
  expect(
    await runtime.store.get(topicPreferenceKey(topic.id, email)),
  ).toMatchObject({ subscribed: false });
  expect(await runtime.store.get(suppression.pk)).toEqual(suppression);
  await expect(
    client.contacts.unsubscribeTopic(email, randomUUID()),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    client.contacts.unsubscribeTopic(`${randomUUID()}@example.com`, topic.id),
  ).rejects.toMatchObject({ status: 404 });
});
