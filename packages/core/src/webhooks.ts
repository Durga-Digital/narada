import { commitMutation, type MutationCommit } from "./idempotency.js";
import { createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError, type Entity } from "./model.js";
import { conditional, type Store } from "./store.js";
import { ProductPagination } from "./product-pagination.js";

export function publicAddress(address: string) {
  if (isIP(address) !== 4) return false; // Conservative: resolve usable public IPv4 only for v1.
  const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
  return (
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a >= 1 &&
    a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113) &&
    !(a === 169 && b === 254)
  );
}
export function signWebhook(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
) {
  return createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest("hex");
}
export async function validateWebhookUrl(value: string, local: boolean) {
  const url = new URL(value);
  if (url.username || url.password || url.hash)
    throw new AppError(400, "Invalid webhook URL");
  if (
    local &&
    url.origin === "http://localhost:3001" &&
    url.pathname === "/api/dev/webhook-receiver"
  )
    return;
  if (url.protocol !== "https:" || (url.port && url.port !== "443"))
    throw new AppError(400, "Webhooks require HTTPS on port 443");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new AppError(400, "Webhook must resolve to public IPv4 addresses");
}
const live = (row: Entity) =>
  !row.ttl || Number(row.ttl) > Math.floor(Date.now() / 1000);
export function deliveryView(row: Entity) {
  const payload = row.payload as
    { id?: string; type?: string; created_at?: string } | undefined;
  return {
    id: row.id,
    endpointId: row.endpointId,
    state: row.state,
    attempts: row.attempts,
    cycleAttempts: row.cycleAttempts ?? row.attempts,
    payload: payload
      ? { id: payload.id, type: payload.type, created_at: payload.created_at }
      : undefined,
    createdAt: row.createdAt ?? row.sort,
    completedAt: row.completedAt,
    lastStatus: row.lastStatus,
    error: row.error,
    nextAttemptAt:
      row.state === "webhook" ? (row.availableAt ?? row.due) : undefined,
    expiresAt: row.ttl
      ? new Date(Number(row.ttl) * 1000).toISOString()
      : undefined,
  };
}
export async function listDeliveries(store: Store, input: unknown) {
  const page = await new ProductPagination(store).records<Entity>(
    "webhookAttempts",
    "HOOKJOB#",
    input,
    live,
  );
  return { ...page, data: page.data.map(deliveryView) };
}
export async function deliveryHistory(
  store: Store,
  id: string,
  input: unknown,
) {
  const job = await store.get(`HOOKJOB#${id}`);
  if (!job || !live(job)) throw new AppError(404, "Webhook delivery not found");
  const page = await new ProductPagination(store).records<Entity>(
    `webhookHistory#${id}`,
    "HOOKATTEMPT#",
    input,
    live,
  );
  return {
    delivery: deliveryView(job),
    ...page,
    data: page.data.map((row) => ({
      id: `${id}:${row.attempt}`,
      attempt: row.attempt,
      outcome: row.outcome,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      status: row.status,
      error: row.error,
    })),
  };
}
export async function retryWebhook(
  store: Store,
  id: string,
  commit?: MutationCommit,
) {
  const job = await store.get(`HOOKJOB#${id}`);
  if (!job || !live(job)) throw new AppError(404, "Webhook delivery not found");
  if (job.state !== "failed")
    throw new AppError(409, "Only failed webhook deliveries can be retried");
  if (!(await store.get(`WEBHOOK#${job.endpointId}`)))
    throw new AppError(409, "The webhook endpoint was removed");
  try {
    return await commitMutation(
      store,
      [
        {
          ConditionCheck: {
            TableName: store.config.APP_TABLE,
            Key: { pk: `WEBHOOK#${job.endpointId}`, sk: "META" },
            ConditionExpression: "attribute_exists(pk)",
          },
        },
        {
          Update: {
            TableName: store.config.APP_TABLE,
            Key: { pk: job.pk, sk: "META" },
            ConditionExpression: "#state = :failed AND attempts = :attempts",
            UpdateExpression:
              "SET #state = :queued, cycleAttempts = :zero, due = :now, availableAt = :now, #error = :empty REMOVE completedAt, lastStatus",
            ExpressionAttributeNames: { "#state": "state", "#error": "error" },
            ExpressionAttributeValues: {
              ":failed": "failed",
              ":attempts": job.attempts,
              ":queued": "webhook",
              ":zero": 0,
              ":now": Date.now(),
              ":empty": "",
            },
          },
        },
      ],
      { ok: true },
      commit,
    );
  } catch (e) {
    if (conditional(e))
      throw new AppError(
        409,
        "Webhook delivery changed; refresh before retrying",
      );
    throw e;
  }
}

/** Both the result and its immutable attempt history are fenced by this worker's claim. */
async function finishAttempt(
  store: Store,
  job: Entity,
  outcome: "succeeded" | "failed" | "unknown" | "cancelled",
  status?: number,
  error = "",
) {
  const now = Date.now(),
    exhausted = Number(job.cycleAttempts ?? job.attempts) >= 6;
  const terminal =
    outcome === "succeeded" || outcome === "cancelled" || exhausted;
  const state =
    outcome === "succeeded"
      ? "complete"
      : outcome === "cancelled"
        ? "cancelled"
        : exhausted
          ? "failed"
          : "webhook";
  const delay =
    outcome === "unknown"
      ? 0
      : Math.min(
          3600000,
          1000 * 2 ** Number(job.cycleAttempts ?? job.attempts),
        );
  const writes: Parameters<Store["transaction"]>[0] = [
    {
      Update: {
        TableName: store.config.APP_TABLE,
        Key: { pk: job.pk, sk: "META" },
        ConditionExpression: job.runToken
          ? "#state = :running AND runToken = :token"
          : "#state = :running AND attribute_not_exists(runToken) AND attempts = :attempts AND due = :oldDue",
        UpdateExpression:
          "SET #state = :state, due = :due, availableAt = :due, #error = :error" +
          (status !== undefined ? ", lastStatus = :status" : "") +
          (terminal ? ", completedAt = :at" : "") +
          " REMOVE runToken, leaseExpiresAt" +
          (status === undefined ? ", lastStatus" : "") +
          (!terminal ? ", completedAt" : ""),
        ExpressionAttributeNames: { "#state": "state", "#error": "error" },
        ExpressionAttributeValues: {
          ":running": "webhook-running",
          ":state": state,
          ":due": now + delay,
          ":error": error,
          ...(job.runToken
            ? { ":token": job.runToken }
            : { ":attempts": job.attempts, ":oldDue": job.due }),
          ...(status !== undefined ? { ":status": status } : {}),
          ...(terminal ? { ":at": new Date(now).toISOString() } : {}),
        },
      },
    },
  ];
  if (job.runToken)
    writes.push({
      Update: {
        TableName: store.config.APP_TABLE,
        Key: { pk: `HOOKATTEMPT#${job.runToken}`, sk: "META" },
        ConditionExpression: "attribute_exists(pk) AND outcome = :running",
        UpdateExpression:
          "SET outcome = :outcome, finishedAt = :at, #error = :error" +
          (status !== undefined ? ", #status = :status" : ""),
        ExpressionAttributeNames: {
          "#error": "error",
          ...(status !== undefined ? { "#status": "status" } : {}),
        },
        ExpressionAttributeValues: {
          ":running": "running",
          ":outcome": outcome,
          ":at": new Date(now).toISOString(),
          ":error": error,
          ...(status !== undefined ? { ":status": status } : {}),
        },
      },
    });
  try {
    await store.transaction(writes);
  } catch (e) {
    if (!conditional(e)) throw e;
  }
}

export async function recoverWebhook(store: Store, id: string) {
  // byState is eventually consistent; never reclaim a newer lease from a stale index row.
  const job = await store.get(`HOOKJOB#${id}`);
  if (
    !job ||
    job.state !== "webhook-running" ||
    Number(job.leaseExpiresAt ?? job.due) > Date.now()
  )
    return;
  await finishAttempt(
    store,
    job,
    "unknown",
    undefined,
    "Worker lease expired; receiver may have accepted this event",
  );
}

export async function sendWebhook(store: Store, id: string, local: boolean) {
  const old = await store.get<Entity>(`HOOKJOB#${id}`),
    now = Date.now();
  if (
    !old ||
    !live(old) ||
    old.state !== "webhook" ||
    Number(old.availableAt ?? 0) > now
  )
    return;
  const runToken = randomUUID(),
    attempt = Number(old.attempts) + 1;
  const job: Entity = {
    ...old,
    runToken,
    attempts: attempt,
    cycleAttempts: Number(old.cycleAttempts ?? old.attempts) + 1,
  };
  try {
    await store.transaction([
      {
        Update: {
          TableName: store.config.APP_TABLE,
          Key: { pk: old.pk, sk: "META" },
          ConditionExpression:
            "#state = :queued AND attempts = :previous AND (attribute_not_exists(availableAt) OR availableAt <= :now)",
          UpdateExpression:
            "SET #state = :running, attempts = :attempt, cycleAttempts = :cycle, runToken = :token, due = :due, leaseExpiresAt = :due",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":queued": "webhook",
            ":previous": old.attempts,
            ":now": now,
            ":running": "webhook-running",
            ":attempt": attempt,
            ":cycle": job.cycleAttempts,
            ":token": runToken,
            ":due": now + 30000,
          },
        },
      },
      store.create({
        pk: `HOOKATTEMPT#${runToken}`,
        sk: "META",
        scope: `webhookHistory#${id}`,
        sort: `${String(attempt).padStart(12, "0")}#${runToken}`,
        id: runToken,
        attempt,
        outcome: "running",
        startedAt: new Date(now).toISOString(),
        ttl: old.ttl ?? Math.floor(now / 1000) + 30 * 86400,
      }),
    ]);
  } catch (e) {
    if (conditional(e)) return;
    throw e;
  }
  const endpoint = await store.get<Entity>(`WEBHOOK#${job.endpointId}`);
  if (!endpoint) {
    await finishAttempt(store, job, "cancelled", undefined, "Endpoint removed");
    return;
  }
  let status: number | undefined,
    error = "";
  try {
    const url = String(endpoint.url);
    await validateWebhookUrl(url, local);
    const payload = job.payload as { id: string },
      body = JSON.stringify(payload),
      timestamp = String(Math.floor(Date.now() / 1000));
    status = await postPinned(
      url,
      body,
      {
        "content-type": "application/json",
        "webhook-id": payload.id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1=${signWebhook(String(endpoint.secret), payload.id, timestamp, body)}`,
      },
      local,
    );
    if (status < 200 || status >= 300) error = `HTTP ${status}`;
  } catch {
    error = "Destination validation, connection or timeout failure";
  }
  // Storage failures must not turn an accepted HTTP response into a fabricated receiver failure.
  await finishAttempt(
    store,
    job,
    error ? "failed" : "succeeded",
    status,
    error,
  );
}
async function postPinned(
  url: string,
  body: string,
  headers: Record<string, string>,
  local: boolean,
): Promise<number> {
  const { request: httpsRequest } = await import("node:https");
  const { request: httpRequest } = await import("node:http");
  const parsed = new URL(url);
  const localReceiver =
    local &&
    parsed.origin === "http://localhost:3001" &&
    parsed.pathname === "/api/dev/webhook-receiver";
  return new Promise((resolve, reject) => {
    const req = (localReceiver ? httpRequest : httpsRequest)(
      parsed,
      {
        method: "POST",
        headers,
        timeout: 10000,
        lookup: (hostname, opts, cb) => {
          if (localReceiver) {
            if (opts.all) cb(null, [{ address: "127.0.0.1", family: 4 }]);
            else cb(null, "127.0.0.1", 4);
            return;
          }
          lookup(hostname, { all: true })
            .then((records) => {
              const allowed = records.filter((a) =>
                localReceiver
                  ? ["127.0.0.1", "::1"].includes(a.address)
                  : publicAddress(a.address),
              );
              if (
                !allowed.length ||
                (!localReceiver && allowed.length !== records.length)
              )
                return cb(new Error("Unsafe webhook destination"), "");
              if (opts.all) cb(null, allowed);
              else cb(null, allowed[0]!.address, allowed[0]!.family);
            })
            .catch((e) => cb(e, ""));
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 500);
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new Error("Webhook timeout")),
      10000,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(new Error("Webhook timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
