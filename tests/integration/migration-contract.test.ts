import { approvedOperation } from "../helpers/approved-operation.js";
import { beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { EmailService } from "@narada/core/service";
import { TemplateService } from "@narada/core/templates";
import { Narada } from "../../packages/sdk/src/index.js";
import {
  contactKey,
  marketingKey,
  topicPreferenceKey,
} from "@narada/core/audience-model";
import { unsubscribeKey } from "@narada/core/broadcast-model";
import type { Message } from "@narada/core/model";

let runtime: Awaited<ReturnType<typeof initialize>>;
let app: ReturnType<typeof createApp>;
let cookie: string;
const origin = "http://localhost:5173";
const sdk = (token: string) =>
  new Narada({
    baseUrl: origin,
    apiKey: token,
    fetch: async (input, init) => app.request(new Request(input, init)),
  });
beforeAll(async () => {
  const prefix = process.env.NARADA_TEST_PREFIX ?? "narada-integration";
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(
    process.env.NARADA_TEST_PREFIX
      ? `.local/${prefix}-owner.json`
      : ".local/test-owner.json",
  );
  vi.spyOn(runtime.queues, "send").mockResolvedValue();
  app = createApp(runtime);
  const owner = JSON.parse(
    await readFile(
      process.env.NARADA_TEST_PREFIX
        ? `.local/${prefix}-owner.json`
        : ".local/test-owner.json",
      "utf8",
    ),
  );
  const response = await app.request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(owner),
  });
  expect(response.status).toBe(200);
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
});
it("round-trips tags and priority through SDK, storage, worker, status and dashboard without exposing bodies", async () => {
  const key = await runtime.service.createKey(
    "Migration send",
    "sending",
    "narada.test",
  );
  const client = sdk(key.token),
    recipient = `${randomUUID()}@example.com`;
  const tags = {
    source: "audit-request",
    tier: "premium",
    tag: "enquiry",
    urgency: "urgent",
  };
  const body = {
    from: "hello@narada.test",
    to: recipient,
    subject: "Audit request",
    text: "private body",
    tags,
    priority: "high" as const,
  };
  const idempotencyKey = randomUUID();
  const result = await approvedOperation(
    runtime,
    client,
    { operation: "emails.send", input: { body: body } },
    { idempotencyKey },
  );
  expect(
    await approvedOperation(
      runtime,
      client,
      {
        operation: "emails.send",
        input: {
          body: {
            ...body,
            tags: Object.fromEntries(Object.entries(tags).reverse()),
          },
        },
      },
      { idempotencyKey },
    ),
  ).toMatchObject({ id: result.id, replayed: false });
  for (const patch of [
    { tags: { ...tags, urgency: "normal" } },
    { priority: "normal" as const },
  ])
    await expect(
      approvedOperation(
        runtime,
        client,
        { operation: "emails.send", input: { body: { ...body, ...patch } } },
        { idempotencyKey },
      ),
    ).rejects.toMatchObject({ status: 409 });
  const send = vi.fn(async () => ({ id: "provider-id", captured: true }));
  const worker = new EmailService(
    runtime.config,
    runtime.store,
    runtime.queues,
    { send },
  );
  await worker.send(result.id);
  expect(send.mock.calls[0]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tags, priority: "high" }),
    ]),
  );
  const stored = (await runtime.store.get<Message>(`MSG#${result.id}`))!;
  expect(stored.input).toMatchObject({ tags, priority: "high" });
  expect(stored.input.text).toBeUndefined();
  expect(await client.emails.get(result.id)).toMatchObject({
    tags,
    priority: "high",
    status: "captured",
  });
  for (const path of [`messages/${result.id}`, "overview"]) {
    const response = await app.request(`${origin}/api/admin/${path}`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    const message =
      path === "overview"
        ? data.messages.find((m: { id: string }) => m.id === result.id)
        : data;
    expect(message.input).toMatchObject({ tags, priority: "high" });
    expect(JSON.stringify(data)).not.toContain("private body");
  }
  expect(await runtime.store.get(contactKey(recipient))).toBeUndefined();
  const legacy = await approvedOperation(runtime, client, {
    operation: "emails.send",
    input: {
      body: {
        from: body.from,
        to: recipient,
        subject: "Legacy",
        text: "Test",
      },
    },
  });
  expect(await client.emails.get(legacy.id)).toMatchObject({
    tags: {},
    priority: "normal",
  });
  const templates = new TemplateService(runtime.store);
  const template = await templates.create({
    alias: `audit-${randomUUID()}`,
    name: "Audit",
    subject: "Audit",
    text: "Private template body",
  });
  await templates.publish(template.id, template.revision);
  const templated = await approvedOperation(runtime, client, {
    operation: "emails.send",
    input: {
      body: {
        from: body.from,
        to: recipient,
        template: { id: template.id },
        tags,
        priority: "high",
      },
    },
  });
  expect(await client.emails.get(templated.id)).toMatchObject({
    tags,
    priority: "high",
  });
});
it("creates scoped keys through the dashboard and separates profile, membership, sending and subscription permissions", async () => {
  const response = await app.request(`${origin}/api/admin/keys`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Contact sync",
      permission: "scoped",
      scopes: ["contacts:write"],
    }),
  });
  expect(response.status).toBe(201);
  const key = await response.json();
  expect(key.scopes).toEqual(["contacts:write"]);
  const contacts = sdk(key.token);
  const membershipKey = await runtime.service.createKey(
    "Membership",
    "scoped",
    undefined,
    ["segments:members"],
  );
  const members = sdk(membershipKey.token);
  const email = `${randomUUID()}@example.com`,
    directory = runtime.broadcasts.directory;
  const segment = await directory.createSegment({
    name: "Audit contacts",
    kind: "manual",
  });
  const topic = await directory.saveTopic({ name: "News" });
  const contact = await contacts.contacts.create({ email, name: "Alex" });
  expect((await contacts.contacts.get(email)).contact.revision).toBe(0);
  await contacts.contacts.update(email, {
    revision: contact.revision,
    contact: {
      name: "Updated",
      first_name: "Alex",
      last_name: "",
      properties: {},
    },
  });
  expect(
    await runtime.store.get(topicPreferenceKey(topic.id, email)),
  ).toBeUndefined();
  await expect(contacts.contacts.list()).rejects.toMatchObject({ status: 403 });
  await expect(
    approvedOperation(runtime, contacts, {
      operation: "emails.send",
      input: {
        body: {
          from: "hello@narada.test",
          to: email,
          subject: "No",
          text: "No",
        },
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(contacts.emails.get(randomUUID())).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    contacts.contacts.subscribe(email, topic.id, {
      subscribed: true,
      source: "Signup",
      confirmed: true,
    }),
  ).rejects.toMatchObject({ status: 403 });
  const consent = {
    consentSource: "Explicit newsletter opt-in",
    consentConfirmed: true as const,
  };
  await expect(
    contacts.segments.addContact(segment.id, email),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    members.contacts.create({ email: `${randomUUID()}@example.com` }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    members.segments.import(segment.id, { csv: `email\n${email}`, ...consent }),
  ).rejects.toMatchObject({ status: 403 });
  const invalid = await app.request(
    `${origin}/api/v1/segments/${segment.id}/contacts/${encodeURIComponent(email)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${membershipKey.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ consentSource: "Enquiry" }),
    },
  );
  expect(invalid.status).toBe(400);
  expect((await directory.audience(segment.id)).contacts).toHaveLength(0);
  for (const pk of [marketingKey(email), unsubscribeKey(segment.id, email)])
    await runtime.store.put({ pk, sk: "META", marker: "preserve" });
  await directory.subscribe(email, topic.id, false, "User preference");
  const member = await members.segments.addContact(segment.id, email);
  expect(member).toMatchObject({ email, addedAt: expect.any(String) });
  expect(member).not.toHaveProperty("consentSource");
  expect(await members.segments.addContact(segment.id, email)).toEqual(member);
  expect((await directory.audience(segment.id)).contacts).toHaveLength(1);
  expect(
    await runtime.store.get(topicPreferenceKey(topic.id, email)),
  ).toMatchObject({ subscribed: false });
  for (const pk of [marketingKey(email), unsubscribeKey(segment.id, email)])
    expect(await runtime.store.get(pk)).toMatchObject({ marker: "preserve" });
  const dynamic = await directory.createSegment({
    name: "Dynamic",
    kind: "dynamic",
    rules: [{ property: "email", operator: "is_set" }],
  });
  await expect(
    members.segments.addContact(dynamic.id, email),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    members.segments.addContact(segment.id, `${randomUUID()}@example.com`),
  ).rejects.toMatchObject({ status: 404 });
  await members.segments.removeContact(segment.id, email);
  expect((await directory.audience(segment.id)).contacts).toHaveLength(0);
  expect(await directory.contact(email)).toMatchObject({ name: "Updated" });
  const combined = await runtime.service.createKey(
    "Combined",
    "scoped",
    "narada.test",
    ["emails:send", "contacts:write", "segments:members"],
  );
  expect(await sdk(combined.token).contacts.get(email)).toHaveProperty(
    "contact",
  );
  await expect(
    approvedOperation(runtime, sdk(combined.token), {
      operation: "emails.send",
      input: {
        body: {
          from: "hello@other.test",
          to: email,
          subject: "No",
          text: "No",
        },
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await runtime.store.patch(
    (await runtime.service.authenticate(key.token)).pk,
    { revoked: true },
  );
  await expect(contacts.contacts.get(email)).rejects.toMatchObject({
    status: 401,
  });
});
