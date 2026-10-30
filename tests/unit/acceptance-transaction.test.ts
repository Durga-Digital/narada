import { describe, it, expect, vi } from "vitest";
import { acceptanceTransaction } from "@narada/core/acceptance-transaction";
const cancelled = (codes: string[]) =>
  Object.assign(new Error("cancelled"), {
    name: "TransactionCanceledException",
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
describe("acceptance transaction conflict recovery", () => {
  it("retries a fully cancelled conflict with the same writes", async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(cancelled(["None", "TransactionConflict"]))
      .mockResolvedValue({});
    const items = [{ Put: { TableName: "test", Item: { pk: "message" } } }];
    await acceptanceTransaction({ transaction }, items);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction.mock.calls.every(([writes]) => writes === items)).toBe(
      true,
    );
  });
  it.each([
    cancelled(["ConditionalCheckFailed", "TransactionConflict"]),
    cancelled(["ProvisionedThroughputExceeded"]),
    Object.assign(new Error("socket closed"), { name: "TimeoutError" }),
    Object.assign(new Error("cancelled"), {
      name: "TransactionCanceledException",
    }),
  ])(
    "does not retry ambiguous failures or failed conditions",
    async (error) => {
      const transaction = vi.fn().mockRejectedValue(error);
      await expect(acceptanceTransaction({ transaction }, [])).rejects.toBe(
        error,
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    },
  );
  it("bounds conflict retries", async () => {
    const error = cancelled(["TransactionConflict"]),
      transaction = vi.fn().mockRejectedValue(error);
    await expect(acceptanceTransaction({ transaction }, [])).rejects.toBe(
      error,
    );
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
