# Safe retries and idempotency

Use one `Idempotency-Key` per **logical operation**, and reuse it with the same request when a connection fails or a response is lost. Use a new key for an intentional new operation. Neither the SDK nor dashboard automatically retries network requests. A timeout is not evidence that a mutation failed.

## Coverage

| Area                                                                                                                  | Retry behavior                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner dashboard send and domain test email                                                                            | Existing atomic email acceptance receipt, retained for 24 hours. Same key/content returns the same message ID with `replayed: true`. This fast path does not use the new management request coordinator.                                                                                                                  |
| Create segments/audiences, contacts, properties, topics, templates, broadcasts, forms, API keys and webhook endpoints | Resource and replay response commit atomically in DynamoDB. Contact/topic webhook jobs commit in that same transaction.                                                                                                                                                                                                   |
| Duplicate templates/broadcasts; create a broadcast from a template or form                                            | Same atomic creation mechanism, with a key scoped to the source action.                                                                                                                                                                                                                                                   |
| Publish templates/forms; launch or schedule broadcasts; template/broadcast test sends                                 | Terminal version/snapshot/message transaction includes the response receipt. Broadcast personalization snapshots may be staged before the final launch transaction.                                                                                                                                                       |
| Domain registration/verification, DKIM and MAIL FROM configuration                                                    | SES operations run under durable request ownership; the domain record, webhook jobs and response commit atomically afterward. SES cannot join the database transaction.                                                                                                                                                   |
| Other authenticated management mutations                                                                              | Includes updates, archive/close/cancel, delete/revoke, imports, membership, subscriptions, suppressions, settings, and manual webhook/form-processing retries. A durable owner prevents overlapping execution; successful responses are persisted for replay. An interruption after side effects requires reconciliation. |
| Public form submission                                                                                                | Existing `submissionId` contract: a stable ID per form response, stored with its digest and processing job. Do not substitute a fresh ID after a timeout. Confirmation and background processing retain their existing state/revision guards.                                                                             |
| SES events, workers, outbound webhooks                                                                                | Existing event/job IDs, revision checks and outbox behavior remain. Webhook receivers must deduplicate by event ID: network delivery is at least once. API idempotency does not promise exactly-once SES or HTTP delivery.                                                                                                |
| GET, previews, auth-provider routes, public preference/confirmation routes                                            | Outside the management header contract. Reads/previews do not create resources; authentication and public consent flows use their own tokens and state checks.                                                                                                                                                            |

MCP OAuth sends use [owner approval](SEND-APPROVALS.md): the request has its own replay receipt, and acceptance atomically consumes the approval with the message and execution receipt. Direct MCP sends return `approval_required`; API-key sends execute automatically. Forms, domains and webhooks also have shared public operations; API-key management remains owner-only. Automation CRUD is not implemented, so it is not advertised as supported.

## Management API contract

- Supported on authenticated `/api/v1/*` and `/api/admin/*` mutation routes (`POST`, `PUT`, `PATCH`, `DELETE`), except the separately handled email routes and previews above.
- Optional for compatibility. Without a key, existing behavior is unchanged; duplicate creates remain possible.
- Keys contain 1–128 printable ASCII characters, excluding spaces/control characters. Do not put secrets or personal details in a key.
- Management keys are scoped by authenticated API key ID or dashboard user ID, HTTP method and exact URL path. Retry using the same principal, method, path and query. A different API key is a different scope. API-key and owner/internal email acceptance retain the existing project-wide key namespace, including pre-approval-release receipts. MCP sends require approval: request keys are scoped to the requesting principal; acceptance uses a server-owned single-use approval identity. Historical direct-email receipts are not migrated into approval requests.
- JSON object key order is ignored recursively. Array order and value types matter. Omitted defaults versus explicitly supplied defaults are different requests. The query string must match exactly.
- Same key and different input: `409`, code `idempotency_conflict`.
- Same key while running: `409`, code `idempotency_in_progress`, `Retry-After: 1`. Retry with backoff and the **same key**.
- A successful management replay returns the original status and JSON body, with `Idempotency-Replayed: true`. The initial response has `false`. A replay is a historical result: GET the resource for its current state.
- Authentication, authorization and rate limits run before replay. Revoked keys cannot retrieve cached results.
- Completed management receipts expire logically 24 hours after success. DynamoDB TTL removes their storage asynchronously. Do not retry an old operation after this window: first reconcile its outcome.
- Validation failures before side effects release ownership. Database/provider failures with potentially committed side effects return `409`, code `idempotency_unknown`.

### Node SDK

SDK 0.3.0 adds an optional final `RequestOptions` argument to every mutation, including `idempotencyKey` and `signal`. Upgrade both the server and SDK together; older SDK methods may ignore extra JavaScript arguments. Previews remain read-only.

```ts
const options = { idempotencyKey: `customer-segment-${operationId}` };
const segment = await narada.segments.create(
  { name: "Customers", kind: "manual" },
  options,
);
// If the response was lost, repeat exactly that call with the SAME options.
```

```sh
curl --fail-with-body "$NARADA_BASE_URL/api/v1/segments" \
  -H "Authorization: Bearer $NARADA_API_KEY" \
  -H "Idempotency-Key: customer-segment-$OPERATION_ID" \
  -H 'Content-Type: application/json' \
  --data '{"name":"Customers","kind":"manual"}'
```

Generate/persist the operation ID in the consuming app before the first request. Do not generate it inside each retry attempt. For email hooks, preserve the existing deadline, durable acceptance requirement and no-fallback-on-unknown policy.

### Dashboard

The shared dashboard API client supplies keys for mutations and coalesces simultaneous identical requests. An explicitly retried unconfirmed request uses its previous key, including after reload in the same tab. Session storage contains only request hashes, random keys and creation times, never request bodies or credentials. If storage is unavailable, this protection survives only while the page remains open. A confirmed success clears the key so a new deliberate action is allowed. Unconfirmed operations older than 23 hours require review rather than silently generating a new key. Avoid switching tabs or clearing browser storage to work around an uncertain operation.

## Activity lookup

For tracked mutations, use the new `operations.get`/`operations.lookup` API, SDK methods or MCP tools to inspect status and resource references after a lost response. The owner Activity page exposes the same metadata. Replay still uses the original mutation, key and arguments. A saved success can be returned immediately after a lost database acknowledgement when a consistent receipt read confirms it. See [Activity and operation recovery](ACTIVITY.md).

## Uncertain operations and recovery

Database-only create/version/message transactions store both the mutation and replay response atomically. If the transaction committed but its acknowledgement was lost, the same key recovers the saved response. If it is not possible to establish whether a write happened, the coordinator fails closed.

Imports and other multi-step operations cannot be made atomic merely by adding a header. An import can update some contacts before interruption; SES configuration is also external to DynamoDB. For these cases:

1. Do **not** send the operation with a fresh key or switch providers.
2. Inspect `idempotency_unknown` metadata logs using the operation ID returned in the error. Logs identify the `MUTATION#...` receipt key, without logging the request body or raw idempotency key.
3. Inspect that receipt and reconcile the affected resource, import members, message or provider state. A completed receipt can still be replayed even if the first caller received an error.
4. A pending receipt has no TTL and is never automatically stolen. Its `busyUntil` is only an indication of whether the original request may still be running, **not** a lease that authorizes another execution.
5. Only after the original invocation has finished and an operator has established what actually happened may the caller deliberately start a new operation. For a partially applied import, review the memberships and consent state first. Preserve the uncertain receipt as evidence; do not delete it merely to make a retry succeed.

The two-minute in-progress indication exceeds the current API Lambda timeout. Revisit it if that timeout is raised, but do not add automatic ownership takeover. An unresolved receipt may need manual reconciliation; the app does not currently offer an automatic repair button.

## Storage, security and implementation

Receipts use the existing application table. No new AWS service, provisioned capacity or CloudWatch polling is required. Key namespaces and request digests are hashed; request bodies are not stored in the receipt. Completed response snapshots are compressed and AES-256-GCM encrypted using a purpose-separated key derived from `BETTER_AUTH_SECRET`, authenticated against the receipt's database key. This permits retrying one-time API-key/webhook-secret creation without storing another plaintext credential. Email acceptance/test receipts contain message IDs only, not sent HTML/text, links or codes.

Receipt access remains server-side. Keep `BETTER_AUTH_SECRET` stable through the replay window: rotating it makes older encrypted receipts unreadable, and the server fails closed rather than executing them again. DynamoDB/backup access remains privileged, and the normal backup/retention policies still apply.

`packages/core/src/idempotency.ts` owns request reservation, encryption and completion. `apps/api/src/idempotency.ts` runs after authentication. `mutationJson` and `commitMutation` connect terminal resource transactions to the response. Other mutations use guarded completion, with `Store` tracking whether a write was attempted. New external side effects must call `markMutation()` immediately before contacting the provider; new create paths should use an atomic result commit. Do not wrap workers in the HTTP coordinator or move email acceptance behind it.

Management mutations with keys incur a receipt read, reservation transaction and completion write (usually combined with the resource transaction). Existing `/emails` acceptance keeps its current database-call count. The SDK does not retry automatically, and no deployment or npm publication is implied by adding these APIs.
