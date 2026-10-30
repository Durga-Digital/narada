import { beforeAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { EmailService } from "@narada/core/service";
import { BroadcastService } from "@narada/core/broadcasts";
import {
  unsubscribeToken,
  unsubscribeKey,
  broadcastMessageId,
  type Broadcast,
} from "@narada/core/broadcast-model";
import { emailInput, type Message } from "@narada/core/model";
import { createApp } from "../../apps/api/src/app.js";
import type { Runtime } from "@narada/core/runtime";
import type { Queues } from "@narada/core/queue";
let runtime: Runtime, emails: EmailService, broadcasts: BroadcastService;
const send = vi.fn(async () => ({ id: randomUUID(), captured: true }));
beforeAll(async () => {
  const prefix = process.env.NARADA_TEST_PREFIX ?? "narada-integration";
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(
    process.env.NARADA_TEST_PREFIX
      ? `.local/${prefix}-owner.json`
      : ".local/test-owner.json",
  );
  emails = new EmailService(
    runtime.config,
    runtime.store,
    { send: vi.fn() } as unknown as Queues,
    { send },
  );
  broadcasts = new BroadcastService(runtime.config, runtime.store, emails);
});
async function fixture(count = 2) {
  const audience = await broadcasts.createAudience(`Test ${randomUUID()}`);
  const recipients = Array.from(
    { length: count },
    () => `${randomUUID()}@example.com`,
  );
  await broadcasts.importAudience(
    audience.id,
    recipients.join("\n"),
    "Explicit newsletter signup",
  );
  const broadcast = await broadcasts.create({
    name: "News",
    audienceId: audience.id,
    from: "hello@narada.test",
    subject: "Monthly update",
    text: "Hello subscribers",
    organization: "Narada Test",
    postalAddress: "1 Test Street",
  });
  return { audience, recipients, broadcast };
}
it("freezes audience membership and deduplicates concurrent launch and expansion", async () => {
  const f = await fixture();
  const attempts = await Promise.allSettled([
    broadcasts.start(f.broadcast.id, 0),
    broadcasts.start(f.broadcast.id, 0),
  ]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  await broadcasts.importAudience(
    f.audience.id,
    "later@example.com",
    "Later consent",
  );
  await Promise.all([
    broadcasts.run(f.broadcast.id),
    broadcasts.run(f.broadcast.id),
  ]);
  await broadcasts.run(f.broadcast.id);
  const result = await broadcasts.results(f.broadcast.id);
  expect(result.recipients).toHaveLength(2);
  expect(new Set(result.recipients.map((r) => r.messageId)).size).toBe(2);
  send.mockClear();
  for (const r of result.recipients) await emails.send(r.messageId);
  await broadcasts.run(f.broadcast.id);
  expect(send).toHaveBeenCalledTimes(2);
  expect((await broadcasts.get(f.broadcast.id)).status).toBe("completed");
  expect(send.mock.calls[0]?.length).toBe(3);
});
it("excludes suppressed and unsubscribed contacts and does not resubscribe imports", async () => {
  const f = await fixture(3);
  await runtime.store.put({ pk: `SUPPRESS#${f.recipients[0]}`, sk: "META" });
  await broadcasts.unsubscribe(
    unsubscribeToken(
      runtime.config.BETTER_AUTH_SECRET,
      f.audience.id,
      f.recipients[1]!,
    ),
  );
  await broadcasts.importAudience(
    f.audience.id,
    f.recipients.join("\n"),
    "Another import",
  );
  expect((await broadcasts.preview(f.broadcast.id)).eligible).toBe(1);
  await broadcasts.start(f.broadcast.id, 0);
  expect((await broadcasts.get(f.broadcast.id)).total).toBe(1);
});
it("honors unsubscribe after expansion without blocking transactional messages", async () => {
  const f = await fixture(1);
  await broadcasts.start(f.broadcast.id, 0);
  await broadcasts.run(f.broadcast.id);
  await broadcasts.unsubscribe(
    unsubscribeToken(
      runtime.config.BETTER_AUTH_SECRET,
      f.audience.id,
      f.recipients[0]!,
    ),
  );
  send.mockClear();
  await emails.send(broadcastMessageId(f.broadcast.id, f.recipients[0]!));
  expect(send).not.toHaveBeenCalled();
  expect((await broadcasts.results(f.broadcast.id)).counts.failed).toBe(1);
  const transactional = await emails.accept(
    emailInput.parse({
      from: "hello@narada.test",
      to: f.recipients[0],
      subject: "Receipt",
      text: "Thank you",
    }),
    "default",
  );
  await emails.send(transactional.id);
  expect(send).toHaveBeenCalledTimes(1);
});
it("does not expand scheduled work early and cancellation stops queued recipients", async () => {
  const f = await fixture(1);
  await broadcasts.start(f.broadcast.id, 0, Date.now() + 60000);
  await broadcasts.run(f.broadcast.id);
  expect((await broadcasts.results(f.broadcast.id)).counts.pending).toBe(1);
  await runtime.store.patch(f.broadcast.pk, { scheduledAt: Date.now() - 1 });
  await broadcasts.run(f.broadcast.id);
  await broadcasts.cancel(f.broadcast.id);
  send.mockClear();
  await emails.send(broadcastMessageId(f.broadcast.id, f.recipients[0]!));
  expect(send).not.toHaveBeenCalled();
  expect((await broadcasts.get(f.broadcast.id)).status).toBe("cancelled");
});
it("uses revision guards and makes launched drafts immutable", async () => {
  const f = await fixture();
  await broadcasts.update(
    f.broadcast.id,
    { ...f.broadcast.draft, subject: "Changed" },
    0,
  );
  await expect(broadcasts.start(f.broadcast.id, 0)).rejects.toMatchObject({
    status: 409,
  });
  await broadcasts.start(f.broadcast.id, 1);
  await expect(
    broadcasts.update(f.broadcast.id, f.broadcast.draft, 2),
  ).rejects.toMatchObject({ status: 409 });
});
it("sends a test without launching or modifying the audience", async () => {
  const f = await fixture();
  const test = await broadcasts.test(f.broadcast.id, "test@example.com");
  const message = await runtime.store.get<Message>(`MSG#${test.id}`);
  expect(message?.input.subject).toBe("[Test] Monthly update");
  expect(message?.broadcast).toBeUndefined();
  expect((await broadcasts.get(f.broadcast.id)).status).toBe("draft");
});
it("does not unsubscribe on GET, accepts RFC 8058 POST without login, and rejects forged tokens", async () => {
  const f = await fixture(1);
  const app = createApp({ ...runtime, broadcasts });
  const token = unsubscribeToken(
    runtime.config.BETTER_AUTH_SECRET,
    f.audience.id,
    f.recipients[0]!,
  );
  expect((await app.request(`/api/unsubscribe/${token}`)).status).toBe(200);
  expect(
    await runtime.store.get(unsubscribeKey(f.audience.id, f.recipients[0]!)),
  ).toBeUndefined();
  expect(
    (
      await app.request(`/api/unsubscribe/${token}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      })
    ).status,
  ).toBe(200);
  expect(
    await runtime.store.get(unsubscribeKey(f.audience.id, f.recipients[0]!)),
  ).toBeTruthy();
  expect((await app.request("/api/unsubscribe/forged")).status).toBe(400);
  expect((await app.request("/api/admin/broadcasts")).status).toBe(401);
});
it("cancellation wins while expansion is in flight", async () => {
  const f = await fixture();
  await broadcasts.start(f.broadcast.id, 0);
  const original = emails.accept.bind(emails);
  const spy = vi
    .spyOn(emails, "accept")
    .mockImplementationOnce(async (...args) => {
      const accepted = await original(...args);
      await broadcasts.cancel(f.broadcast.id);
      return accepted;
    });
  await broadcasts.run(f.broadcast.id);
  spy.mockRestore();
  const state = await broadcasts.get(f.broadcast.id);
  expect(state.status).toBe("cancelled");
  expect(state.state).toBe("complete");
});
it("deduplicates the contact directory while retaining independent list subscriptions", async () => {
  const first = await broadcasts.createAudience("Directory first");
  const second = await broadcasts.createAudience("Directory second");
  const email = `${randomUUID()}@example.com`;
  await broadcasts.importAudience(first.id, `${email},Alex`, "First signup");
  await broadcasts.importAudience(second.id, `${email},Alex`, "Second signup");
  await broadcasts.unsubscribe(
    unsubscribeToken(runtime.config.BETTER_AUTH_SECRET, first.id, email),
  );
  const directory = await broadcasts.contacts();
  const matches = directory.contacts.filter((c) => c.email === email);
  expect(matches).toHaveLength(1);
  expect(matches[0]!.memberships).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        audienceId: first.id,
        subscribed: false,
        consentSource: "First signup",
      }),
      expect.objectContaining({
        audienceId: second.id,
        subscribed: true,
        consentSource: "Second signup",
      }),
    ]),
  );
  const app = createApp(runtime);
  expect((await app.request("/api/admin/contacts")).status).toBe(401);
});
it("persists editor JSON and forwards rendered content and reply-to without altering the blocks", async () => {
  const f = await fixture(1);
  const document = {
    type: "doc" as const,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Rich content" }] },
    ],
  };
  const draft = {
    ...f.broadcast.draft,
    document,
    html: '<p style="color:#123456">Rich content</p>',
    text: "Rich content",
    replyTo: "reply@example.com",
  };
  await broadcasts.update(f.broadcast.id, draft, 0);
  expect((await broadcasts.get(f.broadcast.id)).draft.document).toEqual(
    document,
  );
  await broadcasts.test(f.broadcast.id, f.recipients[0]!);
  await broadcasts.start(f.broadcast.id, 1);
  await broadcasts.run(f.broadcast.id);
  const message = await runtime.store.get<Message>(
    `MSG#${broadcastMessageId(f.broadcast.id, f.recipients[0]!)}`,
  );
  expect(message!.input.reply_to).toBe("reply@example.com");
  expect(message!.input.html).toContain(draft.html);
  expect(message!.input.text).toContain("Rich content");
});
