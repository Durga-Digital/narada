# Activity and operation recovery

The Activity page records supported mutations from the public API, MCP and matching dashboard product routes. It starts at rollout: it does not reconstruct older activity. Connected apps links to a client's activity, including disconnected clients. [Lifecycle webhooks](WEBHOOKS.md#lifecycle-semantics) are also deployed. The [audience/campaign MCP increment](CAMPAIGN-MCP.md) adds shared handlers and atomic result receipts for single-step edits, subscriptions, membership changes and broadcast cancellation. Multi-step CSV imports retain unknown-outcome fencing on interruption. The [send approval queue](SEND-APPROVALS.md) links owner-reviewed sends to this activity history.

## Find an operation

The owner can open **Activity**, inspect recent operations or paste an operation ID. Direct dashboard links use `/?page=activity&operationId=<id>`; Connected apps uses `/?page=activity&clientId=<client-id>`.

API and MCP callers require the new **`narada:operations:read`** permission. Existing OAuth grants do not gain it automatically: reconnect and explicitly select it. Existing legacy full/scoped/sending API keys retain their old capability ceiling. Use an operation key with this scope and the relevant product permissions. Agents and keys see only their own operations, and must still hold the original operation's permissions (including conditional channel/integration scopes) and access to historical and current resources. Owner sessions can inspect the workspace. There is no delegated cross-client activity permission in this increment.

| API                                        | SDK                               | MCP                 |
| ------------------------------------------ | --------------------------------- | ------------------- |
| `GET /api/v1/operations?limit=20&cursor=…` | `narada.operations.list(options)` | `operations_list`   |
| `GET /api/v1/operations/:id`               | `narada.operations.get(id)`       | `operations_get`    |
| `POST /api/v1/operations/lookup`           | `narada.operations.lookup(input)` | `operations_lookup` |

Lookup accepts `{ operation, idempotencyKey, params? }`. `operation` is the catalog ID, for example `publications.update`. For REST, include the original path parameters, for example `{ id: publicationId }`; issue operations also need `issueId`. MCP receipt namespaces use the operation ID directly and do not need path parameters. Lookup is a read and creates no new operation. It does not accept an arbitrary URL or execute the original operation.

Mutation HTTP responses include `X-Operation-Id` and `Operation-Location`, including replays. MCP mutations expose the same correlation in result `_meta`, leaving the canonical product output unchanged. Idempotency errors include `operationId` when known; the SDK exposes it on `NaradaError`. MCP clients can call `operations_get` using that ID. The REST location requires API-key authentication, not an OAuth bearer token.

Lists contain at most 20 entries, newest first, with opaque cursors bound to the caller's indexed collection. Filtering rechecks current authorization after consistent primary reads. A bounded page can be empty and still have a cursor; follow until `null`. Owner HTTP routes live at `/api/admin/operations` and also accept a `clientId` list filter.

## Recover a lost response

Persist a retry key and the exact intended arguments before submitting a mutation. If the response is lost:

1. Look up the original operation using its catalog ID and retry key, or get its status by operation ID if received.
2. A `succeeded` operation with `recovery: replay_available` has a saved result. Repeat the **original mutation with the same key and arguments** to recover that result. Lookup itself returns metadata and resource references, not private receipt bodies.
3. `running` means the request may still be executing. Wait and retry with the same key; do not choose a new key. A safely rejected execution is `failed` and can be retried with the original key.
4. `unknown` with `recovery: reconcile` requires inspecting the resources/provider outcome. There is no automatic takeover, resubmission or repair button. Pending/uncertain receipt ownership remains intact.
5. `expired` means the 24-hour replay window ended. Reconcile the resource before starting new work. `no_retry_key` means this REST request omitted a retry key; inspect its resource before repeating it.

A 404 is **not evidence that no work happened**: the operation may predate rollout, its metadata may have expired, or the lookup key/path/principal may differ. Management operations have distinct API-key namespaces; direct transactional email retains project-scoped receipts, and activity lookup still checks the original caller. OAuth uses stable installation/user/client identity across refresh and reconnect. Revoked tokens cannot access status or replay. Fresh consent never makes old tokens valid.

```ts
const retryKey = crypto.randomUUID(); // persist with the original input
const input = {
  name: "Studio notes",
  slug: "studio-notes",
  from: "hello@example.com",
};
await narada.publications.create(input, { idempotencyKey: retryKey });

// After a lost response, using the same authenticated operation key:
const operation = await narada.operations.lookup({
  operation: "publications.create",
  idempotencyKey: retryKey,
});
if (operation.recovery === "replay_available") {
  const original = await narada.publications.create(input, {
    idempotencyKey: retryKey,
  });
}
```

## Acceptance versus asynchronous work

`status` describes the mutation request: `running`, `succeeded`, `failed` or `unknown`. A succeeded launch records durable acceptance; it does not assert recipient delivery. `work` separately projects current statuses from the existing publication, broadcast, message or form-response records. Scheduled publication acceptance can therefore be `succeeded` while its work is `pending`, and later `cancelled`. The original activity remains associated with the exact accepted job rather than a later revision of the resource. Missing/expired job records report `unavailable`, never an invented success.

Publication release and broadcast completion do not prove email delivery. Inspect the existing issue delivery/recipient APIs when that is needed. Revocation blocks new requests; explicitly cancel accepted scheduled work through its product operation.

## Durability, privacy and limits

The existing application table and `byScope` index hold activity metadata and an owner-list pointer. Own-client/key collections are indexed separately. Reservation and the initial activity are written together; terminal mutations using `MutationCommit` atomically write resource changes, the encrypted receipt and final activity. Guarded multi-step mutations preserve uncertain ownership when side effects may have occurred. A consistent receipt read recovers a committed result even if the database acknowledgement was lost.

Owner/internal direct email acceptance appends activity to its existing acceptance transaction without another reservation or database read and preserves its project-wide email idempotency contract. Machine-client email now uses an approval request and a single-use owner acceptance receipt. Replays point to the original actor's record; a different key cannot read another actor's activity.

Records contain verified actor/client/grant IDs, operation and request IDs, timestamps, resource references, authorization facts, result revision and job references. They do not contain request bodies, raw retry keys, tokens, credentials, email content, form answers or recipient lists. Status responses do not expose internal storage keys, job IDs or encrypted receipt bodies.

Successful and safely failed activity expires after `ACTIVITY_RETENTION_DAYS` (default 90, 1–3650 supported). Expiry is enforced on reads independently of DynamoDB TTL deletion. Unresolved records have no TTL. The receipt replay window stays 24 hours. Retention can outlive the underlying delivery record; that work then becomes unavailable.

History covers the current catalog's mutation routes, all MCP mutations, matching dashboard routes and direct email acceptance. Optional-key REST requests are tracked with a server operation ID but retain their existing behavior: a separate unkeyed submission is new work. Reads, rejected authentication, pre-execution authorization/schema failures, account security, and uncatalogued owner-only administration are outside this mutation ledger. Existing operational logs remain separate. No old grants, keys or receipts are migrated or expanded, and no new AWS service/index is required.

## Approved sends

[Send approval](SEND-APPROVALS.md) requests and executions are separate operations. `approvals.request` success means a pending review exists. The approval record links to the target operation ID after owner acceptance; its metadata records the requesting client and deciding owner. The target execution is attributed to the original client. Approval `succeeded` means acceptance committed, not that delivery succeeded. Use approval lookup after a lost owner response; do not create a replacement request for an uncertain send.

## Custom publication subdomains

See [publication subdomains](PUBLICATION-DOMAINS.md) for the five shared management operations, dedicated domain-write consent, DNS/HTTPS setup, asynchronous recovery and default-address fallback. The local implementation includes dashboard, API, SDK and MCP coverage; deployment and SDK publication are separate release steps. DNS-provider writes remain an operator action.
