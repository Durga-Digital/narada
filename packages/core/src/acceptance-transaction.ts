import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { Store } from "./store.js";

function onlyTransactionConflicts(error: unknown) {
  if (
    !(error instanceof Error) ||
    error.name !== "TransactionCanceledException"
  )
    return false;
  const reasons = (
    error as Error & { CancellationReasons?: { Code?: string }[] }
  ).CancellationReasons;
  return (
    !!reasons?.length &&
    reasons.some((r) => r.Code === "TransactionConflict") &&
    reasons.every((r) => r.Code === "None" || r.Code === "TransactionConflict")
  );
}

/** Retry only confirmed, fully cancelled conflicts; never retry an ambiguous transport failure here. */
export async function acceptanceTransaction(
  store: Pick<Store, "transaction">,
  items: NonNullable<TransactWriteCommandInput["TransactItems"]>,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await store.transaction(items);
      return;
    } catch (error) {
      if (attempt >= 2 || !onlyTransactionConflicts(error)) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 20 * 2 ** attempt + Math.random() * 20),
      );
    }
  }
}
