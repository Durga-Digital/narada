import { beforeAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { EmailService } from "@narada/core/service";
import { ContactService } from "@narada/core/contacts";
import { readMetrics } from "@narada/core/metrics";
import { emailInput, hash, type Message } from "@narada/core/model";
import { webhookJobs } from "@narada/core/event-outbox";
let runtime: Awaited<ReturnType<typeof initialize>>;
beforeAll(async () => {
  const prefix = process.env.NARADA_TEST_PREFIX ?? "narada-integration";
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  runtime = await initialize(
    process.env.NARADA_TEST_PREFIX
      ? `.local/${prefix}-owner.json`
      : ".local/test-owner.json",
  );
});
it("aggregates idempotent sends and unique recipient outcomes, scoped by domain and acceptance date", async () => {
  const { store, config, queues } = runtime;
  const domain = `${randomUUID()}.test`;
  await store.put({ pk: `DOMAIN#${domain}`, sk: "META", verified: true });
  const service = new EmailService(config, store, queues, {
    send: async () => ({ id: "local", captured: true }),
  });
  const input = emailInput.parse({
    from: `hello@${domain}`,
    to: ["a@example.com", "b@example.com"],
    subject: "Metrics",
    text: "Test",
  });
  // These recipients may be suppressed by unrelated fixtures.
  input.to = [`a-${randomUUID()}@example.com`, `b-${randomUUID()}@example.com`];
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 3 }, () => service.accept(input, "default", key)),
  );
  expect(new Set(results.map((r) => r.id)).size).toBe(1);
  const id = results[0]!.id;
  await service.send(id);
  const delivered = {
    id: randomUUID(),
    type: "delivered" as const,
    at: new Date().toISOString(),
    recipients: [input.to[0]!],
  };
  await Promise.all([
    service.event(id, delivered),
    service.event(id, delivered),
  ]);
  await service.event(id, {
    ...delivered,
    id: randomUUID(),
    recipients: [...input.to, input.to[0]!, "outsider@example.com"],
  });
  await service.event(id, {
    ...delivered,
    id: randomUUID(),
    type: "bounced",
    permanent: false,
    recipients: [input.to[1]!],
  });
  const metrics = await readMetrics(store, 2, domain);
  expect(metrics.totals).toMatchObject({
    accepted: 2,
    captured: 2,
    submitted: 0,
    delivered: 2,
    bounced: 1,
  });
  expect(metrics.domains).toHaveLength(1);
  expect(metrics.days[0]!.counts.accepted).toBe(0);
  expect(metrics.days[1]!.counts.delivered).toBe(2);
  expect((await store.get<Message>(`MSG#${id}`))?.events).toHaveLength(3);
  expect(await store.get(`SUPPRESS#${input.to[1]}`)).toBeUndefined();
  // Aggregates survive raw message deletion / TTL expiry.
  await store.remove(`MSG#${id}`);
  expect((await readMetrics(store, 1, domain)).totals.delivered).toBe(2);
});
it("creates durable jobs only for subscribed events and rolls them back with rejected mutations", async () => {
  const { store } = runtime;
  const id = randomUUID();
  const endpoint = {
    pk: `WEBHOOK#${id}`,
    sk: "META",
    id,
    scope: "webhooks",
    sort: id,
    url: "http://localhost:3001/api/dev/webhook-receiver",
    secret: "test",
    events: ["contact.created", "topic.created", "contact.topics.updated"],
  };
  await store.put(endpoint);
  try {
    await expect
      .poll(async () =>
        (await store.list("webhooks", 5)).some((e) => e.id === id),
      )
      .toBe(true);
    const contacts = new ContactService(store);
    const email = `${randomUUID()}@example.com`;
    await contacts.createContact({ email });
    const jobs = await store.list("webhookAttempts", 1000);
    const job = jobs.find(
      (j) =>
        j.endpointId === id &&
        (j.payload as { data: { email: string } }).data.email === email,
    );
    expect(job?.state).toBe("webhook");
    const before = jobs.filter((j) => j.endpointId === id).length;
    await expect(contacts.createContact({ email })).rejects.toMatchObject({
      status: 409,
    });
    await contacts.updateContact(
      email,
      { name: "Updated", first_name: "", last_name: "", properties: {} },
      0,
    );
    expect(
      (await store.list("webhookAttempts", 1000)).filter(
        (j) => j.endpointId === id,
      ),
    ).toHaveLength(before);
    const fakeEvent = {
      id: randomUUID(),
      type: "contact.created" as const,
      created_at: new Date().toISOString(),
      data: { email },
    };
    await expect(
      store.transaction([
        store.create({ pk: `WEBHOOK#${id}`, sk: "META" }),
        ...(await webhookJobs(store, fakeEvent, [endpoint])),
      ]),
    ).rejects.toThrow();
    expect(
      await store.get(`HOOKJOB#${hash(`${fakeEvent.id}:${id}`)}`),
    ).toBeUndefined();
  } finally {
    await store.remove(endpoint.pk);
  }
});
