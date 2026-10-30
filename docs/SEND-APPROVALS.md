# Human approval for MCP sends

API-key/SDK sending is automatic within the key’s permissions. Human approval is mandatory for MCP OAuth connections. This guide describes the current source contract; see [validation](#validation) for the historical release boundary and local verification.

MCP OAuth callers must request owner review before `emails.send`, `broadcasts.send`, `broadcasts.test`, `templates.test`, `issues.test`, or `issues.publish`, including web-only publication and scheduled sends. All requested permissions and `confirmed: true` do not bypass this decision. The shared server boundary uses the authenticated caller kind, never a request flag. MCP accepts OAuth credentials; the public API accepts API keys. OAuth consent does not create an API key.

API keys (legacy/default, sending, scoped, operation and full-access) execute their permitted sends automatically. Existing scopes, sender/resource restrictions, revocation, suppression, rate limits and sending pause still apply. API keys cannot approve requests or administer credentials. Form-response retries with email effects are permitted for authorized API keys; MCP must use the owner dashboard for these retries. Internal authentication email and configured form automation remain unchanged.

## Compatibility and optional review

Existing applications keep `POST /api/v1/emails` or `narada.emails.send(...)`, their credentials, and their existing payloads. Success remains HTTP 202 `{ id, replayed }`. No new key setting, template conversion, approval scope or SDK release is needed for existing email sends. Auth hooks can send OTPs, magic links and password resets automatically again. Transactional REST sends preserve the original project-scoped 24-hour email receipts, including older receipts; a repeated key returns the same message ID with `replayed: true`.

API callers may still voluntarily use the approval API/SDK below. Legacy keys can request/read their own reviews within existing target permissions; operation keys require approval scopes plus target scopes. Owner approval executes that action, so never follow it with a direct send. A request key from an approval is not a direct-send retry key. Application API keys belong in application backends: an agent given one has its unattended permissions too.

## Agent and owner flow

1. Prepare the draft using existing operations.
2. For OAuth and operation keys, request `narada:approvals:request` and `narada:approvals:read`, plus every scope needed by the target action. Existing connections need fresh consent for these new permissions. Resource restrictions still apply to the target action.
3. Call `approvals_request`, preserving its retry key and full input.
4. Give the returned `reviewUrl` to the human. The owner signs in to Narada and reviews sender, subject, content, recipients, personalization, channels, timing, priority, tags and delivery expiry in **Send approvals**. The preview offers each recipient's personalized message and a separate web preview for combined publication.
5. **Approve and send/publish** executes the exact reviewed operation. **Reject** prevents this request from sending. There is no subsequent agent execution step or transferable approval token.
6. Call `approvals_get` with the approval ID for status and the target operation ID. Single-message acceptance also returns `messageId`; use `emails_get` / `narada.emails.get(messageId)` for delivery status. Use existing activity/status operations for campaign progress.

Example MCP request:

```json
{
  "body": {
    "operation": "broadcasts.send",
    "input": {
      "params": { "id": "broadcast-uuid" },
      "body": { "revision": 2, "confirmed": true }
    }
  },
  "idempotencyKey": "review-newsletter-2026-10-23"
}
```

The `input` is the canonical target envelope without a separate target retry key. Optional `scheduledAt` is Unix milliseconds. Supported shapes and outputs are discoverable in MCP, OpenAPI and the operation catalog. Direct MCP OAuth send invocation returns `approval_required`; no public `approvals.approve` operation exists.

## REST and SDK

| Operation           | HTTP                        | Permission                                        |
| ------------------- | --------------------------- | ------------------------------------------------- |
| `approvals.request` | `POST /api/v1/approvals`    | `narada:approvals:request` and target scopes      |
| `approvals.list`    | `GET /api/v1/approvals`     | `narada:approvals:read` and current target access |
| `approvals.get`     | `GET /api/v1/approvals/:id` | `narada:approvals:read` and current target access |

Legacy keys use their existing target permissions in place of the new approval scopes. Lists default to 20 and accept opaque cursors. Results contain metadata and the owner review URL, never message content, recipients or the review digest. A client can read only its own authorized requests. The owner can review requests in the authenticated application. Public API authentication remains an API key; MCP authentication remains OAuth.

```ts
const approval = await narada.approvals.request(
  {
    operation: "emails.send",
    input: {
      body: {
        from: "hello@example.com",
        to: "reviewer@example.com",
        subject: "Review this message",
        text: "Exact content to send",
        priority: "high",
        tags: { source: "agent" },
      },
    },
  },
  { idempotencyKey: "review-template-test-001" },
);
console.log(approval.reviewUrl); // Present to the human.
const status = await narada.approvals.get(approval.id);
if (status.messageId) console.log(await narada.emails.get(status.messageId));
```

## Binding, revocation and recovery

Preparation stores an immutable review snapshot. Execution verifies the input and freshly prepared message/audience against that snapshot. Content, sender, recipient, personalization or relevant publication settings changes cause a conflict. Request a new review after an intentional change. Delivery workers still exclude recipients who become ineligible; they cannot add recipients outside the accepted snapshot.

The current grant, consent, scopes and resources are rechecked at approval. Revoked/replaced connections and revoked keys cannot use a pending review. The acceptance transaction conditionally checks OAuth grant revision/epoch and user generation, or API-key revision/revocation, and atomically consumes the approval with the send acceptance and result receipt. Reconnection cannot revive an earlier review. Revocation after acceptance does not recall queued or submitted mail; use the existing cancellation operation.

Double clicks and a lost response reuse the same server-owned operation identity. Reload or fetch the approval to recover the result. `succeeded` means the operation was accepted, **not delivered**. `pending`, `executing`, `rejected`, `expired` and `unknown` distinguish the other states. An `unknown` result requires reconciliation through activity; never create a new request just to retry an uncertain send. Rejection cannot recall a send whose acceptance already committed.

Approval requests expire after 24 hours. Message and recipient snapshots are encrypted in a separate DynamoDB item, logically inaccessible after expiry and deleted on approval or rejection; DynamoDB TTL removes expired items asynchronously. The encryption key derives from the installation auth secret, so secret rotation makes existing snapshots unreadable and requires new requests. Review size is bounded to 3 MB before compression and 350 KB encrypted; oversized requests must be reduced. Metadata is retained for 30 days without the content snapshot. Consumed approval metadata prevents reuse after the 24-hour result-receipt window; missing or expired metadata fails closed.

## Validation

Run local checks against isolated DynamoDB and Mailpit fixtures:

```sh
pnpm check
pnpm contracts:verify
pnpm test:mcp
pnpm exec playwright test tests/e2e/send-approval-recovery.test.ts
```

Coverage includes automatic API-key/SDK sending, optional API reviews, mandatory OAuth send approval, legacy project-scoped receipts, changed-content conflicts, scope/domain restrictions, revoked credentials, lost responses and concurrent retries. OAuth bearer tokens cannot authenticate to REST; API keys cannot authenticate to MCP.

The maintained installation's corrected behavior was verified on staging and production on 24 October 2026. That historical result does not certify a new installation or later source changes. Earlier reports requiring approval for API-key sends describe a superseded policy. Keep installation-specific reports in private operator records.

See [hosted verification](MCP.md#hosted-verification) for opt-in simulator checks after an authorized deployment. A generic send or recovery check does not certify another application's authentication callback, token verification, external receipt storage or completed user session. Validate those in the consuming application.
