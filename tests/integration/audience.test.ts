import { beforeAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { EmailService } from "@narada/core/service";
import { BroadcastService } from "@narada/core/broadcasts";
import { createApp } from "../../apps/api/src/app.js";
import {
  unsubscribeKey,
  unsubscribeToken,
  broadcastMessageId,
  type Audience,
} from "@narada/core/broadcast-model";
import {
  contactKey,
  marketingKey,
  topicPreferenceKey,
  type PropertyDefinition,
} from "@narada/core/audience-model";
import type { Runtime } from "@narada/core/runtime";
import type { Message } from "@narada/core/model";
import type { Queues } from "@narada/core/queue";
let runtime: Runtime, broadcasts: BroadcastService;
const transport = {
  send: vi.fn(async () => ({ id: randomUUID(), captured: true })),
};
beforeAll(async () => {
  const prefix = process.env.NARADA_TEST_PREFIX ?? "narada-integration";
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(
    process.env.NARADA_TEST_PREFIX
      ? `.local/${prefix}-owner.json`
      : ".local/test-owner.json",
  );
  broadcasts = new BroadcastService(
    runtime.config,
    runtime.store,
    new EmailService(
      runtime.config,
      runtime.store,
      { send: vi.fn() } as unknown as Queues,
      transport,
    ),
  );
  for (const data of [
    { key: "parity_city", type: "string" as const, fallback: "your city" },
    { key: "parity_score", type: "number" as const, fallback: 0 },
  ]) {
    const current = await runtime.store.get<PropertyDefinition>(
      `PROPERTY#${data.key}`,
    );
    await broadcasts.directory.saveProperty(data, current?.revision);
  }
});
async function fixture() {
  const id = randomUUID(),
    topic = await broadcasts.directory.saveTopic({
      name: `Topic ${id}`,
      visibility: "public",
    });
  const audience = await broadcasts.createAudience(`Manual ${id}`),
    first = `${id}@example.com`,
    second = `${randomUUID()}@example.com`;
  await broadcasts.importAudience(
    audience.id,
    `email,name,first_name,parity_city,parity_score\n${first},Alex,Alex,Sydney,42\n${second},Sam,Sam,Melbourne,10`,
    "Explicit signup",
    [topic.id],
  );
  const broadcast = await broadcasts.create({
    name: "Personalized",
    audienceId: audience.id,
    topicId: topic.id,
    from: "hello@narada.test",
    subject: "Hi {{contact.first_name}}",
    text: "News for {{contact.parity_city}}",
    organization: "Narada",
    postalAddress: "1 Test Street",
  });
  return { topic, audience, first, second, broadcast };
}
it("migrates old lists idempotently without overwriting shared data or unsubscribes", async () => {
  const id = randomUUID(),
    email = `${id}@example.com`,
    now = new Date().toISOString();
  const legacy: Audience = {
    pk: `AUDIENCE#${id}`,
    sk: "META",
    scope: "audiences",
    sort: now,
    id,
    name: "Legacy",
    contacts: [
      {
        email,
        name: "Legacy name",
        consentedAt: now,
        consentSource: "Legacy consent",
      },
    ],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  await runtime.store.put(legacy);
  await runtime.store.put({ pk: unsubscribeKey(id, email), sk: "META" });
  await Promise.all([
    broadcasts.directory.migrate(legacy),
    broadcasts.directory.migrate(legacy),
  ]);
  const contact = await broadcasts.directory.contact(email);
  await broadcasts.directory.updateContact(
    email,
    { name: "Updated", first_name: "A", last_name: "", properties: {} },
    contact.revision,
  );
  await broadcasts.directory.migrate(
    (await runtime.store.get<Audience>(legacy.pk))!,
  );
  expect((await broadcasts.directory.contact(email)).name).toBe("Updated");
  expect((await broadcasts.audienceDetail(id)).contacts[0]!.subscribed).toBe(
    false,
  );
  expect(await runtime.store.children(legacy.pk, "CONTACT#")).toHaveLength(1);
  expect((await runtime.store.get(legacy.pk))!.schemaVersion).toBe(3);
});
it("shares profiles across segments, validates CSV fields, and removes membership without deleting consent", async () => {
  const f = await fixture(),
    other = await broadcasts.createAudience("Second list");
  await broadcasts.importAudience(
    other.id,
    `${f.first},Different name`,
    "Another signup",
  );
  expect((await broadcasts.directory.contact(f.first)).name).toBe("Alex");
  await expect(
    broadcasts.importAudience(
      other.id,
      `email,unknown\n${f.second},value`,
      "Signup",
    ),
  ).rejects.toThrow(/Create the property/);
  await broadcasts.unsubscribe(
    unsubscribeToken(runtime.config.BETTER_AUTH_SECRET, other.id, f.first),
  );
  await broadcasts.directory.removeMember(other.id, f.first);
  await broadcasts.importAudience(other.id, f.first, "Reimport signup");
  expect(
    (await broadcasts.audienceDetail(other.id)).contacts[0]!.subscribed,
  ).toBe(false);
});
it("targets dynamic rules and topic consent and freezes personalized values", async () => {
  const f = await fixture();
  const segment = await broadcasts.directory.createSegment({
    name: "High score",
    kind: "dynamic",
    match: "all",
    rules: [
      { property: "email", operator: "equals", value: f.first },
      { property: "parity_score", operator: "greater_than", value: 20 },
    ],
  });
  const updated = await broadcasts.update(
    f.broadcast.id,
    { ...f.broadcast.draft, audienceId: segment.id },
    0,
  );
  expect((await broadcasts.preview(updated.id)).eligible).toBe(1);
  await broadcasts.start(updated.id, updated.revision);
  const contact = await broadcasts.directory.contact(f.first);
  await broadcasts.directory.updateContact(
    f.first,
    {
      name: contact.name,
      first_name: "Changed",
      last_name: "",
      properties: { parity_city: "Perth", parity_score: 1 },
    },
    contact.revision,
  );
  await broadcasts.run(updated.id);
  const message = await runtime.store.get<Message>(
    `MSG#${broadcastMessageId(updated.id, f.first)}`,
  );
  expect(message!.input.subject).toBe("Hi Alex");
  expect(message!.input.text).toContain("Sydney");
  expect((await broadcasts.audience(segment.id)).contacts).toHaveLength(0);
});
it("honors late topic and global unsubscribes and preserves opt-outs on import", async () => {
  const f = await fixture();
  await broadcasts.start(f.broadcast.id, 0);
  await broadcasts.run(f.broadcast.id);
  await broadcasts.unsubscribe(
    unsubscribeToken(
      runtime.config.BETTER_AUTH_SECRET,
      f.audience.id,
      f.first,
      f.topic.id,
    ),
  );
  await broadcasts.importAudience(f.audience.id, f.first, "Reimport signup", [
    f.topic.id,
  ]);
  expect(
    (await runtime.store.get(topicPreferenceKey(f.topic.id, f.first)))!
      .subscribed,
  ).toBe(false);
  await runtime.store.put({ pk: marketingKey(f.second), sk: "META" });
  transport.send.mockClear();
  for (const email of [f.first, f.second])
    await broadcasts.emails.send(broadcastMessageId(f.broadcast.id, email));
  expect(transport.send).not.toHaveBeenCalled();
  expect((await broadcasts.results(f.broadcast.id)).counts.failed).toBe(2);
  await broadcasts.emails.accept(
    {
      from: "hello@narada.test",
      to: [f.first],
      subject: "Receipt",
      text: "Transactional",
      expires_in: 3600,
    },
    "default",
  );
});
it("requires dynamic topic consent and rejects missing personalization before launch", async () => {
  const f = await fixture();
  const bad = await broadcasts.create({
    ...f.broadcast.draft,
    text: "{{contact.last_name}}",
  });
  await expect(broadcasts.start(bad.id, 0)).rejects.toThrow(
    /Missing last_name/,
  );
  expect((await broadcasts.get(bad.id)).status).toBe("draft");
  const segment = await broadcasts.directory.createSegment({
    name: "No topic",
    kind: "dynamic",
    rules: [{ property: "email", operator: "equals", value: f.first }],
  });
  const noTopic = await broadcasts.create({
    ...f.broadcast.draft,
    audienceId: segment.id,
    topicId: undefined,
  });
  await expect(broadcasts.start(noTopic.id, 0)).rejects.toThrow(
    /Choose a topic/,
  );
});
it("serves signed preferences, hides unrelated private topics, and GET never unsubscribes", async () => {
  const f = await fixture(),
    secret = await broadcasts.directory.saveTopic({
      name: `Private ${randomUUID()}`,
      visibility: "private",
    });
  const app = createApp(runtime),
    path = `/api/unsubscribe/${unsubscribeToken(runtime.config.BETTER_AUTH_SECRET, f.audience.id, f.first, f.topic.id)}`;
  const page = await app.request(`${path}?preferences=1`);
  expect(page.status).toBe(200);
  expect(await page.text()).not.toContain(secret.name);
  expect(
    (await runtime.store.get(topicPreferenceKey(f.topic.id, f.first)))!
      .subscribed,
  ).toBe(true);
  const post = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      action: "preferences",
      [`topic_${secret.id}`]: "on",
    }).toString(),
  });
  expect(post.status).toBe(200);
  expect(
    await runtime.store.get(topicPreferenceKey(secret.id, f.first)),
  ).toBeUndefined();
  expect(
    (await runtime.store.get(topicPreferenceKey(f.topic.id, f.first)))!
      .subscribed,
  ).toBe(false);
  const oneClick = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
  expect(oneClick.status).toBe(200);
  expect((await app.request(path + "forged")).status).toBe(400);
  for (const route of [
    "properties",
    "topics",
    "segments",
    `contacts/${f.first}`,
  ])
    expect((await app.request(`/api/admin/${route}`)).status).toBe(401);
});
it("rejects stale edits, wrong property types, and archived topics", async () => {
  const f = await fixture(),
    contact = await broadcasts.directory.contact(f.first);
  await expect(
    broadcasts.directory.updateContact(
      f.first,
      {
        name: "A",
        first_name: "A",
        last_name: "",
        properties: { parity_score: "bad" },
      },
      contact.revision,
    ),
  ).rejects.toThrow();
  await expect(
    broadcasts.directory.updateContact(
      f.first,
      { name: "A", first_name: "A", last_name: "", properties: {} },
      contact.revision + 1,
    ),
  ).rejects.toThrow(/changed/);
  await broadcasts.directory.saveTopic(
    { name: f.topic.name, visibility: "public", active: false },
    f.topic.id,
    f.topic.revision,
  );
  await expect(broadcasts.start(f.broadcast.id, 0)).rejects.toThrow(/archived/);
});
