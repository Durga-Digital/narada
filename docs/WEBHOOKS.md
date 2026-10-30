# Webhooks

Add an endpoint under **Webhooks**, choose a public HTTPS URL and at least one event, then save the signing secret shown once. There are at most five endpoints. The searchable event picker and event badges show exactly which subscriptions are configured. Edit the endpoint to change its URL or selection. The dashboard uses the owner session. The [operational API and MCP tools](OPERATIONAL-API.md) also support endpoint management and delivery history with explicit workspace-wide read, write and retry scopes. These additions are deployed to staging and production.

| Group          | Events                                                                                  |
| -------------- | --------------------------------------------------------------------------------------- |
| Email feedback | `email.delivered`, `email.delayed`, `email.bounced`, `email.complained`, `email.failed` |
| Contacts       | `contact.created`, `contact.updated`, `contact.topics.updated`                          |
| Topics         | `topic.created`, `topic.updated` (including archive)                                    |
| Domains        | `domain.created`, `domain.updated` (verification or authentication settings)            |
| Forms          | `form.response.received`, `form.response.completed`, `form.response.failed`             |
| Publications   | `issue.published`                                                                       |
| Broadcasts     | `broadcast.completed`                                                                   |
| Suppressions   | `suppression.added`, `suppression.removed`                                              |

`email.failed` currently represents SES reject/rendering feedback, not all application validation failures or uncertain submissions. Open/click tracking, contact/topic/domain deletion events, and a separate `email.sent` webhook are not implemented and are not offered in the picker. `email.delayed` retains Narada's existing event name. Local contact migration can create missing shared profiles and emit `contact.created`. Topic preference writes emit `contact.topics.updated`, including imports and email unsubscribe; a global/list opt-out is not a topic preference update. Mutation events describe committed writes; reapplying a value may emit another event.

Existing endpoints, and legacy dashboard creation requests omitting `events`, subscribe to the five original email events. Explicit arrays must contain at least one supported event; duplicates are normalized. Newly introduced event types are never opted into automatically. Endpoints are read from an eventually consistent index, so configuration changes can take a short time to affect routing. Selection changes affect new jobs; jobs already queued retain their original selection. Updating a URL changes the destination for pending deliveries; removing an endpoint stops them.

Public API/MCP creation requires explicit events. The creation response includes the signing secret, and a currently authorized retry with the same operation key may recover that same response. Reads and history never reveal it. Deleting the endpoint prevents later replay of its creation secret. Endpoint edits require the current revision. Configuration writes share a transactional registry that enforces the five-endpoint limit under concurrent creation; existing endpoints are adopted when the first configuration write creates the registry.

## Payloads

```json
{
  "id": "stable-event-id",
  "type": "email.bounced",
  "created_at": "2026-10-11T12:00:00.000Z",
  "data": {
    "email_id": "message-id",
    "recipients": ["recipient@example.com"],
    "bounce_type": "Permanent"
  }
}
```

Email events use SES occurrence timestamps where available and include the message ID and affected recipients. `bounce_type` is included when SES supplies it. Contacts use `data.email`; contact edits also include updated fields. Topic events contain `data.id` and topic fields; subscription events contain `email`, `topic_id`, and `subscribed`. Domain events contain `name` and `verified`. Suppression events contain `email` and, for additions, `reason`.

Business mutations and outbound jobs commit in one DynamoDB transaction, so a rejected mutation produces no delivery. The existing SQS workers deliver jobs with retries. Delivery is **at least once**, not exactly once or ordered. Receivers should deduplicate by event ID, tolerate additional fields, and return a 2xx response promptly. SES feedback is deduplicated by normalized notification hash; semantically similar SES notifications can still have different IDs. The metrics layer separately deduplicates recipients per message/outcome.

Requests contain `webhook-id`, `webhook-timestamp` (Unix seconds), and `webhook-signature` (`v1=` followed by hex HMAC-SHA256). Verify the HMAC over `id.timestamp.rawBody` using your endpoint secret, compare in constant time, and reject stale timestamps (for example, beyond five minutes). Use the original raw request body, before parsing or reserializing JSON. A retry retains the event ID with a new signing timestamp. Secrets must stay on your server.

The worker makes up to six attempts per retry cycle with exponential backoff (2, 4, 8, 16, and 32 seconds before automatic retries; dispatcher cadence can add delay). Any 2xx completes the delivery; non-2xx responses, timeouts, and connection failures retry. Failed jobs appear under **Delivery history** and permit owner-initiated retry. Manual retry resets the cycle budget while preserving the lifetime attempt count, previous attempts, event ID, and body. It uses the same mutation receipt protection as other dashboard operations. Deliveries and their attempt history expire 30 days after the event was queued; reads, manual retries, and new sends enforce expiry before asynchronous TTL cleanup. Retrying does not extend retention. Removing an endpoint cancels pending delivery; a request already in flight can still finish. Production endpoints require HTTPS port 443, public IPv4 DNS results, no embedded credentials, and no redirects. Addresses are validated and pinned for each attempt to prevent requests to private infrastructure.

## Lifecycle semantics

Lifecycle events are produced below the transport layer, so the same domain transitions from the dashboard, public API, MCP, and background workers emit them. They start at rollout; old transitions are not backfilled. Existing endpoint subscriptions do not automatically gain these events. This increment is deployed to staging and production.

| Event                     | Committed transition                                                                                                                                                                                                                                                                                                            | `data` fields                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `form.response.received`  | A validated response has been saved. Processing and email verification may still be pending.                                                                                                                                                                                                                                    | `form_id`, `response_id`, `version`, `revision`, `status`                                                                          |
| `form.response.completed` | Required processing finished: verified profile/subscription work committed, and any acknowledgment was accepted into the email queue. A response requiring no processing emits this alongside `received`. This does not prove acknowledgment delivery.                                                                          | Same response metadata                                                                                                             |
| `form.response.failed`    | Processing exhausted its automatic attempts. The response remains saved; an allowed manual processing retry can later produce `completed` or another `failed` transition with a new revision. Waiting for email verification is not failure or completion.                                                                      | Same response metadata                                                                                                             |
| `issue.published`         | An immutable issue version was released to the selected channels. Immediate release emits now; a scheduled release emits when the worker releases it. Web corrections emit for their new version. Cancelled schedules and withdrawal do not emit this event. Email-only release is included and does not assert email delivery. | `publication_id`, `issue_id`, `version_id`, `release_id`, `revision`, `channels` (`web`, `email`, `both`), optional `broadcast_id` |
| `broadcast.completed`     | All frozen snapshot recipients have left `pending`, `queued`, or `submitting`. Counts are a snapshot of known message statuses at completion and can include failures or unknown outcomes. Subsequent feedback can change recipient outcomes without another completion event.                                                  | `broadcast_id`, optional `publication_id` and `issue_id`, `total`, `counts`                                                        |

Lifecycle payloads deliberately omit form answers, email addresses, recipient lists, content, secrets, and raw provider errors. Use the IDs to retrieve further information through separately authorized APIs. A publication `release_id` identifies the publication job, not an Activity operation ID. Broadcast completion and issue release are different transitions; neither guarantees inbox delivery. Cancellation is not a completion event.

```json
{
  "id": "stable-event-id",
  "type": "issue.published",
  "created_at": "2026-10-23T12:00:00.000Z",
  "data": {
    "publication_id": "publication-uuid",
    "issue_id": "issue-uuid",
    "version_id": "version-uuid",
    "release_id": "release-uuid",
    "revision": 3,
    "channels": "web"
  }
}
```

Event IDs are deterministic per lifecycle transition and shared across subscribed endpoints; delivery IDs are per event/endpoint. The guarded resource transition and delivery jobs commit together. Duplicate submissions, mutation receipt replays, and repeated worker invocations do not emit that transition again. Multiple transitions can be delivered out of order; use resource versions/revisions and current authorized status rather than assuming arrival order.

## Delivery history and recovery

**Webhooks → Delivery history → View attempts** shows event identity, delivery state, lifetime attempt count, HTTP status, retry timing, expiry, and each recorded attempt. Older pages remain available through cursor pagination. Detailed attempts start with this release; older jobs keep their existing totals but have no reconstructed attempts.

The dashboard retains these owner-session routes; the equivalent public API/MCP routes are documented in [Operational API](OPERATIONAL-API.md):

- `GET /api/admin/webhooks/deliveries?limit=20&cursor=…` returns `{ data, nextCursor }`.
- `GET /api/admin/webhooks/deliveries/:id?limit=20&cursor=…` returns `{ delivery, data, nextCursor }`, where `data` contains attempts newest first.
- `POST /api/admin/webhooks/attempts/:id/retry` starts a new cycle only for a failed, unexpired delivery with an existing endpoint. Supply the same `Idempotency-Key` when recovering a lost response.

Cursors are opaque and collection-bound; follow non-null cursors even if a page is empty. Delivery states are `webhook` (queued), `webhook-running`, `complete` (HTTP 2xx), `failed` (cycle exhausted), and `cancelled` (endpoint removed). Attempt outcomes are `running`, `succeeded`, `failed`, `unknown`, and `cancelled`. A failed HTTP or connection attempt means no successful acknowledgment was recorded; it does not prove the receiver performed no work. Responses project metadata only: no storage keys, lease tokens, signing secrets, original payload data, or receiver response bodies.

A claim and its initial attempt history commit atomically. Final status and attempt outcome commit together under a unique worker lease token. Recovery consistently rereads expired leases and marks the old attempt `unknown`; late results cannot overwrite a new attempt. Unknown means the receiver may already have accepted the event, so automatic recovery reuses the original event ID and body. Receiver deduplication is essential. A committed success with a lost database acknowledgment remains complete and is not resubmitted. There is no additional AWS service, table, or index.

## Local testing

1. Open **Webhooks → Add webhook → Use local test receiver**.
2. Choose `email.bounced`, or choose `contact.created` to test by adding a contact. For lifecycle testing, choose `form.response.completed`, publish a feedback form, and submit it.
3. Save and keep the signing secret.
4. For email feedback, send an email locally, open its details, and click **Simulate bounced**.
5. Open Webhooks to inspect the delivery result. Signed payloads are captured at the development receiver and available to the owner at `GET /api/admin/webhook-captures`.

Only the exact local receiver `http://localhost:3001/api/dev/webhook-receiver` is exempted from HTTPS in local mode. `http://localhost:5173/` is the dashboard, not a receiver. Local mode never sends real SES email.
