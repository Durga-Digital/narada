import { expect, it, vi } from "vitest";
import { ProductPagination } from "@narada/core/product-pagination";
import type { Store } from "@narada/core/store";
import type { Entity } from "@narada/core/model";
const config = { BETTER_AUTH_SECRET: "pagination-test-secret" };
const row = (id: number) => ({
  pk: `FORM#${id}`,
  sk: "META",
  scope: "forms",
  sort: String(id),
  id: String(id),
});
it("rechecks fresh primary records instead of authorizing stale GSI projections", async () => {
  const indexed = { ...row(1), from: "allowed.test" },
    current = { ...indexed, from: "excluded.test" };
  const store = {
    config,
    listPage: vi.fn().mockResolvedValue({ items: [indexed] }),
    getMany: vi.fn().mockResolvedValue([current]),
  } as unknown as Store;
  const page = await new ProductPagination(store).records(
    "forms",
    "FORM#",
    {},
    (r) => r.from === "allowed.test",
  );
  expect(page).toEqual({ data: [], nextCursor: null });
  expect(store.getMany).toHaveBeenCalledWith([indexed.pk]);
});
it("bounds filtered scan work and continues without skipping allowed records", async () => {
  const rows = Array.from({ length: 13 }, (_, i) => row(i));
  const store = {
    config,
    listPage: vi.fn(async (_scope: string, limit: number, cursor?: Entity) => {
      const start = cursor ? Number(cursor.id ?? cursor.sort) + 1 : 0,
        items = rows.slice(start, start + limit),
        last = items.at(-1);
      return {
        items,
        cursor:
          last && start + limit < rows.length
            ? { pk: last.pk, sk: last.sk, scope: last.scope, sort: last.sort }
            : undefined,
      };
    }),
    getMany: vi.fn(async (keys: string[]) =>
      rows.filter((r) => keys.includes(r.pk)),
    ),
  } as unknown as Store;
  const pagination = new ProductPagination(store);
  const allowed = (r: Entity) => Number(r.id) >= 11;
  const first = await pagination.records(
    "forms",
    "FORM#",
    { limit: 1 },
    allowed,
  );
  expect(first.data).toEqual([]);
  expect(first.nextCursor).toBeTruthy();
  expect(store.listPage).toHaveBeenCalledTimes(10);
  const second = await pagination.records(
    "forms",
    "FORM#",
    { limit: 1, cursor: first.nextCursor },
    allowed,
  );
  expect(second.data.map((r) => r.id)).toEqual(["11"]);
  const third = await pagination.records(
    "forms",
    "FORM#",
    { limit: 1, cursor: second.nextCursor },
    allowed,
  );
  expect(third.data.map((r) => r.id)).toEqual(["12"]);
  expect(third.nextCursor).toBeNull();
  await expect(
    pagination.records(
      "publications",
      "PUBLICATION#",
      { cursor: first.nextCursor },
      () => true,
    ),
  ).rejects.toMatchObject({ status: 400 });
});
