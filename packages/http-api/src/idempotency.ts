import { randomUUID } from "node:crypto";
import type { ActivityContext } from "@narada/core/activity-records";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, Next } from "hono";
import type { Store } from "@narada/core/store";
import {
  MutationReceipt,
  type MutationCommit,
  type ResponseReceipt,
} from "@narada/core/idempotency";

const current = new AsyncLocalStorage<MutationReceipt>();
const snapshot = async (response: Response): Promise<ResponseReceipt> => ({
  body: await response.clone().text(),
  status: response.status,
  contentType: response.headers.get("content-type") ?? "application/json",
});
const restore = (response: ResponseReceipt) =>
  new Response(response.status === 204 ? null : response.body, {
    status: response.status,
    headers: {
      "content-type": response.contentType,
      "cache-control": "no-store",
      "idempotency-replayed": "true",
    },
  });

export async function idempotency(
  c: Context,
  next: Next,
  store: Store,
  principal: string,
  authorizeReplay?: (
    body: unknown,
    activity?: ActivityContext,
  ) => void | Promise<void>,
  activity?: ActivityContext,
) {
  const key =
    c.req.header("idempotency-key") ?? (activity ? randomUUID() : undefined);
  if (
    key === undefined ||
    !["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)
  )
    return next();
  // Email acceptance already atomically records its receipt. Keep its latency/contract unchanged.
  if (
    ["/api/admin/send", "/api/v1/emails"].includes(c.req.path) ||
    /\/domains\/[^/]+\/test$/.test(c.req.path) ||
    /\/preview$/.test(c.req.path)
  )
    return next();
  const raw = await c.req.text();
  const result = await MutationReceipt.acquire(
    store,
    principal,
    `${c.req.method} ${c.req.path}`,
    key,
    {
      body: raw ? JSON.parse(raw) : null,
      query: new URL(c.req.url).search,
    },
    activity,
  );
  c.header("Cache-Control", "no-store");
  if ("replay" in result) {
    await authorizeReplay?.(JSON.parse(result.replay.body), result.activity);
    c.res = restore(result.replay);
    c.header("x-operation-id", result.operationId);
    c.header("operation-location", `/api/v1/operations/${result.operationId}`);
    return;
  }
  const receipt = result.receipt!;
  c.header("Idempotency-Replayed", "false");
  c.header("x-operation-id", receipt.record.operationId);
  c.header(
    "operation-location",
    `/api/v1/operations/${receipt.record.operationId}`,
  );
  try {
    await current.run(receipt, () =>
      receipt.run(async () => {
        await next();
        if (receipt.completed) {
          // The mutation and response already committed atomically, even if response construction failed.
          c.res = new Response(receipt.completed.body, {
            status: receipt.completed.status,
            headers: {
              "content-type": receipt.completed.contentType,
              "cache-control": "no-store",
              "idempotency-replayed": "false",
              "x-operation-id": receipt.record.operationId,
              "operation-location": `/api/v1/operations/${receipt.record.operationId}`,
              "x-request-id":
                activity?.requestId ??
                c.res.headers.get("x-request-id") ??
                randomUUID(),
            },
          });
        } else if (c.res.ok) await receipt.commit([], await snapshot(c.res));
        else {
          await receipt.failed();
          const recovered = receipt.getCompleted();
          if (recovered) {
            c.res = restore(recovered);
            c.header("idempotency-replayed", "true");
            c.header("x-operation-id", receipt.record.operationId);
            c.header(
              "operation-location",
              `/api/v1/operations/${receipt.record.operationId}`,
            );
          }
          if (receipt.uncertain) throw receipt.unknownError();
        }
      }),
    );
  } catch (error) {
    await receipt.failed();
    if (receipt.completed) {
      c.res = restore(receipt.completed);
      c.header("idempotency-replayed", "true");
      c.header("x-operation-id", receipt.record.operationId);
      return;
    }
    if (receipt.uncertain) throw receipt.unknownError();
    throw error;
  }
}

/** Couples a resource's terminal transaction with the exact HTTP success response. */
export async function mutationJson<T>(
  c: Context,
  operation: (commit?: MutationCommit) => Promise<T>,
  render: (value: T) => unknown = (value) => value,
  status: 200 | 201 | 202 = 200,
) {
  const receipt = current.getStore();
  const commit: MutationCommit | undefined = receipt
    ? async (items, result) => {
        await receipt.commit(items, {
          body: JSON.stringify(render(result as unknown as T)),
          status,
          contentType: "application/json",
        });
        return result;
      }
    : undefined;
  return c.json(await operation(commit).then(render), status);
}
