import { beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { emailInput, type Message } from "@narada/core/model";
let runtime: Awaited<ReturnType<typeof initialize>>;
beforeAll(async () => {
  process.env.APP_TABLE = `${process.env.NARADA_TEST_PREFIX}-app`;
  process.env.AUTH_TABLE = `${process.env.NARADA_TEST_PREFIX}-auth`;
  runtime = await initialize(
    `.local/${process.env.NARADA_TEST_PREFIX}-owner.json`,
  );
});
it("acknowledges only after the durable transaction and retains idempotent replay", async () => {
  const original = runtime.store.transaction.bind(runtime.store);
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const transaction = vi
    .spyOn(runtime.store, "transaction")
    .mockImplementationOnce(async (items) => {
      await gate;
      return original(items);
    });
  const input = emailInput.parse({
    from: "hello@narada.test",
    to: `${randomUUID()}@example.com`,
    subject: "Durable acceptance",
    text: "Test",
  });
  const idem = randomUUID();
  let settled = false;
  const pending = runtime.service
    .accept(input, "default", idem)
    .then((value) => {
      settled = true;
      return value;
    });
  try {
    await vi.waitFor(() => expect(transaction).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    unblock();
    const accepted = await pending;
    expect(
      (await runtime.store.get<Message>(`MSG#${accepted.id}`))?.status,
    ).toBe("queued");
    expect(await runtime.service.accept(input, "default", idem)).toEqual({
      id: accepted.id,
      replayed: true,
    });
    await expect(
      runtime.service.accept({ ...input, subject: "Changed" }, "default", idem),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    unblock();
    await pending;
    transaction.mockRestore();
  }
});
it("correlates automatic API sends without logging email content or credentials", async () => {
  const key = await runtime.service.createKey(
    "Submission timing test",
    "sending",
    "narada.test",
  );
  const app = createApp(runtime),
    secret = `magic-secret-${randomUUID()}`,
    idem = `private-idem-${randomUUID()}`;
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const response = await app.request(
      "http://localhost/api/v1/emails",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.token}`,
          "content-type": "application/json",
          "idempotency-key": idem,
        },
        body: JSON.stringify({
          from: "hello@narada.test",
          to: "private-recipient@example.com",
          subject: "Private subject",
          text: `https://example.com/sign-in?token=${secret}`,
        }),
      },
      {
        lambdaContext: { awsRequestId: "lambda-test" },
        requestContext: { requestId: "gateway-test" },
      },
    );
    expect(response.status).toBe(202);
    const result = await response.json();
    const events = log.mock.calls.map(([entry]) => JSON.parse(String(entry)));
    const event = events.find((event) => event.event === "email_submission");
    expect(event).toMatchObject({
      status: 202,
      awsRequestId: "lambda-test",
      gatewayRequestId: "gateway-test",
      requestId: response.headers.get("x-request-id"),
    });
    expect(result).toMatchObject({ id: expect.any(String), replayed: false });
    expect(event.messageId).toBe(result.id);
    const serialized = JSON.stringify(events);
    for (const value of [
      secret,
      key.token,
      idem,
      "Private subject",
      "private-recipient@example.com",
      "hello@narada.test",
    ])
      expect(serialized).not.toContain(value);
    const unauthorized = await app.request("http://localhost/api/v1/emails", {
      method: "POST",
      body: "{}",
    });
    expect(unauthorized.status).toBe(401);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 401,
    });
  } finally {
    log.mockRestore();
  }
});
it("still rejects removed domains, suppressed recipients and paused sending after batched eligibility reads", async () => {
  const domain = `removed-${randomUUID()}.test`,
    to = `${randomUUID()}@example.com`;
  await runtime.store.put({
    pk: `DOMAIN#${domain}`,
    sk: "META",
    name: domain,
    verified: true,
    removedAt: new Date().toISOString(),
  });
  const input = emailInput.parse({
    from: `hello@${domain}`,
    to,
    subject: "Eligibility",
    text: "Test",
  });
  await expect(runtime.service.accept(input, "default")).rejects.toMatchObject({
    status: 422,
  });
  await runtime.store.put({ pk: `SUPPRESS#${to}`, sk: "META" });
  await expect(
    runtime.service.accept({ ...input, from: "hello@narada.test" }, "default"),
  ).rejects.toMatchObject({ status: 422 });
  const previous = await runtime.store.get("SETTINGS");
  await runtime.store.put({
    ...previous,
    pk: "SETTINGS",
    sk: "META",
    paused: true,
  });
  try {
    await expect(
      runtime.service.accept(
        {
          ...input,
          from: "hello@narada.test",
          to: [`${randomUUID()}@example.com`],
        },
        "default",
      ),
    ).rejects.toMatchObject({ status: 503 });
  } finally {
    if (previous) await runtime.store.put(previous);
    else await runtime.store.remove("SETTINGS");
  }
});
