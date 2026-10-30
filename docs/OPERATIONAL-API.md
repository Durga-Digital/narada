# Operational API and MCP

Deployed to **staging and production** on 2026-10-24. Twenty shared operations cover sending status and controls, metrics, domain diagnostics, suppressions, and webhook management. REST uses operation API keys, MCP uses Better Auth OAuth, and the SDK exposes the same contracts. The current MCP adapter has 104 tools before permission filtering. See [MCP connection instructions](MCP.md) and [operation-key provisioning](PRODUCT-API.md).

## Operations and permissions

All paths below start with `/api/v1`. Scope names have the prefix `narada:`. MCP names replace dots in operation IDs with underscores, for example `sending_get` and `webhooks_deliveries_retry`. Input envelopes use `params`, `query`, and `body`; schemas and descriptions come from the shared catalog. `GET /api/v1/capabilities` and `/api/v1/openapi.json` expose the operations currently allowed to the key.

| Operation                   | HTTP route                            | Required scope        |
| --------------------------- | ------------------------------------- | --------------------- |
| `sending.get`               | `GET /sending`                        | `sending:read`        |
| `sending.update`            | `PUT /sending`                        | `sending:write`       |
| `sending.diagnostics`       | `GET /sending/diagnostics`            | `diagnostics:read`    |
| `metrics.get`               | `GET /metrics`                        | `metrics:read`        |
| `domains.list`              | `GET /domains`                        | `domains:read`        |
| `domains.get`               | `GET /domains/:name`                  | `domains:read`        |
| `domains.refresh`           | `POST /domains/:name/refresh`         | `domains:refresh`     |
| `suppressions.list`         | `GET /suppressions`                   | `suppressions:read`   |
| `suppressions.get`          | `GET /suppressions/:email`            | `suppressions:read`   |
| `suppressions.create`       | `POST /suppressions`                  | `suppressions:add`    |
| `suppressions.delete`       | `DELETE /suppressions/:email`         | `suppressions:remove` |
| `webhooks.events`           | `GET /webhooks/events`                | `webhooks:read`       |
| `webhooks.list`             | `GET /webhooks`                       | `webhooks:read`       |
| `webhooks.get`              | `GET /webhooks/:id`                   | `webhooks:read`       |
| `webhooks.create`           | `POST /webhooks`                      | `webhooks:write`      |
| `webhooks.update`           | `PUT /webhooks/:id`                   | `webhooks:write`      |
| `webhooks.delete`           | `DELETE /webhooks/:id`                | `webhooks:write`      |
| `webhooks.deliveries.list`  | `GET /webhooks/deliveries`            | `webhooks:read`       |
| `webhooks.deliveries.get`   | `GET /webhooks/deliveries/:id`        | `webhooks:read`       |
| `webhooks.deliveries.retry` | `POST /webhooks/deliveries/:id/retry` | `webhooks:retry`      |

Scopes are independent: write does not imply read, webhook configuration does not imply manual retry, and suppression addition does not imply removal. Existing legacy full/scoped/sending keys do not gain these operations. Existing OAuth grants do not gain newly introduced scopes; reconnect with a new consent flow to choose all requested permissions or a selected subset. “All” remains a snapshot of that request, not future permission expansion.

## Resource restrictions

Domain lists filter to permitted sender domains. Direct reads and refreshes check the domain before loading diagnostics. Metrics accept `days` (integer 1–90, default 15) and optional `domain`. A sender-domain-restricted grant must explicitly select an allowed domain; it cannot retrieve workspace totals or other domains. Metrics use UTC acceptance dates and existing persisted counters; feedback can update an earlier day's counts. Domain registration/configuration gain delegated operations in the local onboarding extension below. DNS changes are external; domain test emails and removal remain owner-only.

Sending settings, SES account diagnostics, suppressions and webhooks are workspace-wide. A grant with any sender-domain, form-ID or publication-ID restriction cannot use these operations. Form/publication restrictions also exclude metrics and domain diagnostics because those aggregates cannot be limited to those resources. Unsupported combinations fail closed in discovery and direct invocation.

Webhook write permission explicitly authorizes exporting selected event data to an external endpoint. Some event types contain recipient addresses or contact information; this is workspace administration. Form response payloads and other lifecycle events retain their metadata-only contracts. See [the event catalog and delivery semantics](WEBHOOKS.md).

## SDK usage

Use an operation key with the scopes required for each example. Keep retry keys in your application until the operation is reconciled. These SDK additions require the matching server increment.

```ts
const status = await narada.sending.get();
await narada.sending.update(
  { paused: true, revision: status.revision },
  { idempotencyKey: "pause-for-maintenance-2026-10-23" },
);
const ses = await narada.sending.diagnostics();
const metrics = await narada.metrics.get({ days: 7, domain: "example.com" });
const domains = await narada.domains.list({ limit: 20 });
const saved = await narada.domains.get("example.com");
const refreshed = await narada.domains.refresh("example.com", {
  idempotencyKey: "refresh-example-domain-2026-10-23",
});

const suppressed = await narada.suppressions.list({
  email: "reader@example.com",
});
await narada.suppressions.create(
  { email: "reader@example.com" },
  { idempotencyKey: "suppress-reader-request-123" },
);
```

Sending state includes a revision; updates require that revision and return the new one. A stale update returns 409. Pausing stops new acceptance and defers queued sending work; it does not recall an in-flight send or cancel accepted work. Resuming allows eligible work to proceed under the normal consent and suppression checks. SES diagnostics report account/configuration-set health; local mode never contacts AWS. Domain refresh reads SES/DNS and persists diagnostics without configuring provider resources.

Suppression lookup normalizes email case. Adding an existing suppression preserves its original reason. Removing a suppression with `suppressions.delete(email, options)` does not change subscription consent or resubscribe a recipient. `suppressions.get(email)` returns 404 when absent; the list's exact-email filter returns an empty page instead. Encode path values when using raw HTTP; the SDK handles this.

```ts
const catalog = await narada.webhooks.events();
const endpoint = await narada.webhooks.create(
  {
    url: "https://example.com/narada-events",
    events: [
      "form.response.completed",
      "issue.published",
      "broadcast.completed",
    ],
  },
  { idempotencyKey: "create-automation-endpoint-123" },
);
// Store endpoint.secret in your server-side secret store. Do not log it.
const current = await narada.webhooks.get(endpoint.id);
await narada.webhooks.update(
  current.id,
  { url: current.url, events: ["issue.published"], revision: current.revision },
  { idempotencyKey: "update-automation-endpoint-123" },
);
const deliveries = await narada.webhooks.deliveries.list({ limit: 20 });
// For a chosen delivery ID:
const history = await narada.webhooks.deliveries.get(deliveryId, { limit: 20 });
// Only a failed, unexpired delivery with an existing endpoint can be retried.
await narada.webhooks.deliveries.retry(deliveryId, {
  idempotencyKey: "retry-delivery-123",
});
```

Creation requires explicit supported events and returns 201 with the signing secret. Other endpoint responses omit the secret. At most five endpoints may exist; all new dashboard/API/MCP configuration writes use a transactional registry to enforce this under concurrency. An installation's existing endpoints are adopted from the index on the first configuration write; allow prior-version endpoint writes to drain before rollout. Public destinations must pass the existing HTTPS/DNS checks, and workers validate and pin the address again on each attempt. Only the documented local test receiver is exempt in local mode.

Endpoint update is a replacement of URL/events and requires the current revision. Pending deliveries use an updated URL. Deletion stops queued deliveries, but in-flight requests may finish. Delivery list/history project event identity, state, attempts, timing, expiry and sanitized errors; they omit event data, signing secrets and receiver bodies. Attempt history uses `{ delivery, data, nextCursor }`. A manual retry preserves event ID/body and earlier attempts. Receivers must deduplicate: an unknown outcome can mean the event was already accepted.

## Pagination and recovery

Lists accept `limit: 1–20` and opaque cursors, defaulting to 20. Follow `nextCursor` until null, including empty filtered pages. Results are not a transactionally frozen snapshot. Domain and endpoint lists consistently reread records after index enumeration. Event catalog and metrics are bounded non-paginated results.

REST mutations accept `Idempotency-Key`; MCP mutations require `idempotencyKey`. Persist the key before calling. Repeating the same operation, key and input returns the saved result when available; the mutation and receipt commit atomically. Ordinary unkeyed REST mutations still create separate operations. Reuse the original key after a lost response; do not create a new key for an unknown outcome. Current scopes, restrictions and revocation apply before receipt replay.

Webhook creation is the explicit secret-returning exception: the same authorized create request may recover its secret through receipt replay while that endpoint and secret remain current. Deleting the endpoint prevents replay of its old creation secret. Activity and operation-status responses contain metadata only. `narada:operations:read` plus permission for the original operation enables `operations.lookup`; see [Activity and recovery](ACTIVITY.md) for retention, correlation and reconciliation.

No infrastructure service, table or index is added by this operational increment. Local integration tests cover every route through the SDK, generated output schemas, real OAuth consent/refresh/revocation, restricted lists and direct calls, secret privacy, revision conflicts, concurrent endpoint limits and lost-response recovery. See [hosted release verification](MCP.md#hosted-verification) for deployed client/approval coverage. The hosted smoke test does not execute every operational mutation.

## Local sender setup extension

Three additional shared operations provide sender registration, MAIL FROM configuration and DKIM enablement. They use separate `narada:domains:create` / `narada:domains:configure` scopes, configuration revisions and durable mutation receipts. They do not create API keys, modify DNS or send email. See [agent onboarding](AGENT-ONBOARDING.md); this extension has not been deployed.
