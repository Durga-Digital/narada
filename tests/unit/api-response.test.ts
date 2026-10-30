import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../apps/web/src/lib/api.js";
afterEach(() => vi.unstubAllGlobals());
it("handles no-content success without attempting JSON parsing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
  await expect(
    api("keys/id", { confirmation: "Example" }, "DELETE"),
  ).resolves.toBeUndefined();
});
it("explains empty and non-JSON responses without retrying mutations", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await expect(api("domains", { name: "example.com" })).rejects.toThrow(
    "may already have been saved",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(
    new Response("<html>Bad Gateway</html>", { status: 502 }),
  );
  await expect(api("domains")).rejects.toThrow("HTTP 502");
  fetch.mockResolvedValue(new Response("", { status: 200 }));
  await expect(api("domains")).rejects.toThrow("incomplete response");
});
it("preserves useful API validation errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: "Type the exact name to confirm" },
          { status: 400 },
        ),
      ),
  );
  await expect(api("keys/id", {}, "DELETE")).rejects.toThrow(
    "Type the exact name to confirm",
  );
});
it("keeps a mutation key after a timeout and allocates a new one after confirmed success", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Network failed"))
    .mockResolvedValue(Response.json({ id: "saved" }));
  vi.stubGlobal("fetch", fetch);
  const body = { name: crypto.randomUUID(), kind: "manual" };
  await expect(api("segments", body)).rejects.toThrow("Network failed");
  await expect(api("segments", body)).resolves.toEqual({ id: "saved" });
  const first = fetch.mock.calls[0]![1].headers["Idempotency-Key"];
  expect(fetch.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(first);
  fetch.mockResolvedValue(Response.json({ id: "next" }));
  await api("segments", body);
  expect(fetch.mock.calls[2]![1].headers["Idempotency-Key"]).not.toBe(first);
});
it("coalesces simultaneous dashboard mutations and preserves keys on an unknown outcome", async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const body = { name: crypto.randomUUID(), kind: "manual" };
  const first = api("segments", body),
    second = api("segments", body);
  const results = Promise.allSettled([first, second]);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  resolve(
    Response.json(
      { code: "idempotency_unknown", error: "Reconcile first" },
      { status: 409 },
    ),
  );
  expect((await results).every((r) => r.status === "rejected")).toBe(true);
  fetch.mockResolvedValue(Response.json({ id: "resolved" }));
  await api("segments", body);
  expect(fetch.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(
    fetch.mock.calls[0]![1].headers["Idempotency-Key"],
  );
});
