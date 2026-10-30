import { describe, it, expect, vi } from "vitest";
import { Narada, NaradaError } from "../../packages/sdk/src/index.js";
import { page } from "../../apps/api/src/public-pagination.js";
import {
  examples,
  snippet,
} from "../../apps/web/src/features/api-reference/examples.js";
const client = (transport: typeof fetch) =>
  new Narada({
    baseUrl: "http://localhost:3001/",
    apiKey: "na_test",
    fetch: transport,
  });
describe("Node SDK transport", () => {
  it("encodes identifiers, sends bearer credentials, and preserves the send alias", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(JSON.stringify({ ok: true })),
      );
    await client(transport).contacts.get("alex+tag@example.com");
    expect(transport.mock.calls[0]?.[0]).toBe(
      "http://localhost:3001/api/v1/contacts/alex%2Btag%40example.com",
    );
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: { authorization: "Bearer na_test" },
      redirect: "error",
    });
    await client(transport).send(
      {
        from: "hello@example.com",
        to: "a@example.com",
        subject: "Hello",
        text: "Hello",
      },
      { idempotencyKey: "welcome-1" },
    );
    expect(transport.mock.calls[1]?.[1]).toMatchObject({
      headers: { "idempotency-key": "welcome-1" },
    });
  });
  it("adds membership without consent and patches only named properties", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("{}"));
    const sdk = client(transport);
    await sdk.segments.addContact("segment-id", "alex+tag@example.com");
    expect(transport.mock.calls[0]).toEqual([
      "http://localhost:3001/api/v1/segments/segment-id/contacts/alex%2Btag%40example.com",
      expect.objectContaining({ method: "POST", body: undefined }),
    ]);
    await sdk.contacts.patchProperties("alex+tag@example.com", {
      revision: 4,
      properties: { app_user_id: null },
    });
    expect(transport.mock.calls[1]).toEqual([
      "http://localhost:3001/api/v1/contacts/alex%2Btag%40example.com/properties",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          revision: 4,
          properties: { app_user_id: null },
        }),
      }),
    ]);
  });
  it("distinguishes topic opt-out from global unsubscribe without consent payloads", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{"ok":true}'));
    const sdk = client(transport);
    await sdk.contacts.unsubscribeTopic("alex+tag@example.com", "topic/id");
    await sdk.contacts.unsubscribe("alex+tag@example.com");
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:3001/api/v1/contacts/alex%2Btag%40example.com/topics/topic%2Fid/unsubscribe",
      "http://localhost:3001/api/v1/contacts/alex%2Btag%40example.com/unsubscribe",
    ]);
    for (const [, init] of transport.mock.calls) {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeUndefined();
    }
  });
  it("exposes structured HTTP errors and never retries writes", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Changed",
          code: "conflict",
          requestId: "r1",
          operationId: "op1",
        }),
        { status: 409, headers: { "retry-after": "5" } },
      ),
    );
    await expect(
      client(transport).broadcasts.send("id", { revision: 0, confirmed: true }),
    ).rejects.toMatchObject({
      name: "NaradaError",
      status: 409,
      code: "conflict",
      requestId: "r1",
      operationId: "op1",
      retryAfter: 5,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("handles non-JSON responses and network failures without exposing response bodies", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<h1>private upstream text</h1>", { status: 502 }),
      );
    await expect(client(transport).topics.list()).rejects.toBeInstanceOf(
      NaradaError,
    );
    transport.mockRejectedValueOnce(new TypeError("Network failed"));
    await expect(
      client(transport).topics.create({ name: "News" }),
    ).rejects.toThrow("Network failed");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("passes an abort signal and rejects unsafe base URLs", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_, init) => {
        init?.signal?.throwIfAborted();
        return new Response("{}");
      });
    await expect(
      client(transport).emails.send(
        {
          from: "a@example.com",
          to: "b@example.com",
          subject: "Hi",
          text: "Hi",
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(
      () =>
        new Narada({ apiKey: "a", baseUrl: "https://user:pass@example.com" }),
    ).toThrow();
  });
});
it("paginates bounded collections by identity and rejects cross-resource cursors", () => {
  const rows = [{ id: "b" }, { id: "a" }, { id: "c" }];
  const first = page(rows, "topics", { limit: "2" }, (v) => v.id);
  expect(first.data.map((v) => v.id)).toEqual(["a", "b"]);
  expect(
    page(rows, "topics", { cursor: first.nextCursor! }, (v) => v.id).data,
  ).toEqual([{ id: "c" }]);
  expect(() =>
    page(rows, "properties", { cursor: first.nextCursor! }, (v) => v.id),
  ).toThrow("Invalid pagination cursor");
  expect(() => page(rows, "topics", { limit: "0" }, (v) => v.id)).toThrow();
});
it("generates Node examples for real SDK methods and safely quoted cURL JSON", () => {
  const sdk = client(vi.fn());
  for (const example of Object.values(examples).flat()) {
    const [resource, method] = example.call.split(".");
    expect(typeof (sdk as any)[resource!][method!]).toBe("function");
    const curl = snippet(example, "cURL", "http://localhost:5173");
    expect(curl).toContain("Authorization: Bearer $NARADA_API_KEY");
    expect(curl).toContain(`/api/v1${example.path}`);
  }
  expect(
    snippet(
      { ...examples.Contacts[0]!, body: { name: "O'Reilly" } },
      "cURL",
      "http://localhost",
    ),
  ).toContain(`O'"'"'Reilly`);
});
it("passes idempotency options for resource creation, actions, updates and deletes", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ id: "test" }));
  const sdk = client(transport),
    options = { idempotencyKey: "operation-1" };
  await sdk.segments.create({ name: "Customers", kind: "manual" }, options);
  await sdk.topics.create({ name: "News" }, options);
  await sdk.contacts.create({ email: "a@example.com" }, options);
  await sdk.contactProperties.create(
    { key: "company", type: "string" },
    options,
  );
  await sdk.broadcasts.create({ name: "News" }, options);
  await sdk.broadcasts.duplicate("id", options);
  await sdk.broadcasts.cancel("id", options);
  await sdk.broadcasts.send("id", { revision: 0, confirmed: true }, options);
  await sdk.templates.publish("id", { revision: 0 }, options);
  await sdk.segments.update(
    "id",
    { segment: { name: "Updated", kind: "manual" }, revision: 0 },
    options,
  );
  await sdk.segments.removeContact("id", "a@example.com", options);
  for (const [, init] of transport.mock.calls)
    expect(init?.headers).toMatchObject({ "idempotency-key": "operation-1" });
  expect(transport.mock.calls[5]?.[1]?.body).toBeUndefined();
});
