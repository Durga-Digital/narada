# Audience and campaign MCP

Deployed to **staging and production** on 2026-10-24. Contacts and custom properties, topics, segments, templates and broadcasts now expose 42 MCP tools. The checkout has 104 MCP tools before permission filtering. The existing public API and MCP use the same core handlers, canonical schemas, public DTOs, authorization and mutation receipt coordinator.

Connect using [the MCP instructions](MCP.md). Consent offers all requested permissions or a selected subset. The new tools use existing granular scope definitions; scopes that a connection has not been granted require fresh consent. An existing scope can now expose its corresponding tool, but adding tools does not expand the token's scope list or turn “All” into a wildcard. Existing REST API-key grants retain their frozen compatibility map.

## Tool inventory

Names replace the operation ID's dots with underscores. For example, `templates.broadcasts.create` becomes `templates_broadcasts_create`. Scope names below omit the `narada:` prefix. Write, read, send, test and cancel permissions are independent.

| Area                      | Operation IDs                                                                           | Scopes                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Contacts                  | `contacts.list`, `contacts.get`                                                         | `contacts:read`                                                                   |
| Contact creation          | `contacts.create`                                                                       | `contacts:create`                                                                 |
| Profile editing           | `contacts.update`                                                                       | `contacts:update`                                                                 |
| Preferences               | `contacts.subscribe`, `contacts.unsubscribe`                                            | `subscriptions:write`                                                             |
| Properties                | `properties.list`, `properties.get`                                                     | `properties:read`                                                                 |
| Property definitions      | `properties.create`, `properties.update`                                                | `properties:write`                                                                |
| Topics                    | `topics.list`, `topics.get`                                                             | `topics:read`                                                                     |
| Topic definitions/archive | `topics.create`, `topics.update`                                                        | `topics:write`                                                                    |
| Segments                  | `segments.list`, `segments.get`, `segments.members.list`                                | `segments:read`                                                                   |
| Segment definitions       | `segments.create`, `segments.update`                                                    | `segments:write`                                                                  |
| Manual membership         | `segments.members.add`, `segments.members.remove`                                       | `segments:members:write`                                                          |
| CSV import                | `segments.import`                                                                       | **All three:** `contacts:import`, `segments:members:write`, `subscriptions:write` |
| Templates                 | `templates.list`, `templates.get`, `templates.preview`                                  | `templates:read`                                                                  |
| Template drafts           | `templates.create`, `templates.update`                                                  | `templates:write`                                                                 |
| Template duplication      | `templates.duplicate`                                                                   | **Both:** `templates:read`, `templates:write`                                     |
| Template publication      | `templates.publish`                                                                     | `templates:publish`                                                               |
| Template archive/restore  | `templates.archive`                                                                     | `templates:archive`                                                               |
| Template test send        | `templates.test`                                                                        | `templates:test`                                                                  |
| Template to broadcast     | `templates.broadcasts.create`                                                           | **Both:** `templates:read`, `broadcasts:write`                                    |
| Broadcasts                | `broadcasts.list`, `broadcasts.get`, `broadcasts.preview`, `broadcasts.recipients.list` | `broadcasts:read`                                                                 |
| Broadcast drafts          | `broadcasts.create`, `broadcasts.update`                                                | `broadcasts:write`                                                                |
| Broadcast duplication     | `broadcasts.duplicate`                                                                  | **Both:** `broadcasts:read`, `broadcasts:write`                                   |
| Broadcast test send       | `broadcasts.test`                                                                       | `broadcasts:test`                                                                 |
| Broadcast launch/schedule | `broadcasts.send`                                                                       | `broadcasts:send`                                                                 |
| Broadcast cancellation    | `broadcasts.cancel`                                                                     | `broadcasts:cancel`                                                               |

These are workspace-wide operations under the existing policy. Any sender-domain, form-ID or publication-ID restriction excludes them from discovery and execution. They cannot be used as alternate paths around a restricted publication or form grant. Use the dedicated publication/issue/form tools for those grants. Public API calls enforce the same restrictions; the actor identity never comes from tool arguments.

## Inputs and consent

Tool inputs use the canonical `{ params?, query?, body? }` envelope. Every mutation additionally requires a caller-generated `idempotencyKey`. Tools declare their inputs, outputs and effects in discovery; `capabilities` requires `narada:capabilities:read`. Contact properties are included so agents can define typed custom data and dynamic-segment rules without a separate dashboard step.

Example `contacts_create` arguments:

```json
{
  "body": { "email": "reader@example.com", "first_name": "Alex" },
  "idempotencyKey": "create-reader-profile-123"
}
```

Creating a profile or topic does not subscribe anyone. Adding manual membership requires an existing contact and accepts an omitted body or `{}`; consent assertions are rejected. Membership preserves topic preferences, list consent, global opt-outs and suppressions, and does not itself grant broadcast permission. Topic subscription changes require `source` and `confirmed: true`. Dynamic membership follows rules, and rules do not grant consent. CSV import requires an explicit consent attestation and all three scopes even when no topic IDs are supplied. Existing bounds remain: 180,000 CSV characters and up to 1,000 imported contacts.

Contact updates replace the complete profile: provide `name`, `first_name`, `last_name`, `properties`, and the current revision. The generated contract now reflects these existing service requirements. Property types and segment kinds cannot change after creation. Publication-owned topic/segment updates retain their service guards.

Template IDs or aliases work for direct template operations. Publishing creates an immutable version. Creating a broadcast from a template uses a published broadcast template and creates an independent draft. No template edit or publication tool launches a campaign. Public template and broadcast DTOs omit dashboard editor documents and storage metadata; source HTML/text remain available.

Example `approvals_request` arguments for a broadcast launch:

```json
{
  "body": {
    "operation": "broadcasts.send",
    "input": {
      "params": { "id": "broadcast-uuid" },
      "body": { "revision": 2, "confirmed": true }
    }
  },
  "idempotencyKey": "review-october-update-123"
}
```

MCP OAuth launch and test operations require [human approval](SEND-APPROVALS.md). Present the returned review URL; the owner decision executes the reviewed operation. Do not call the original send tool afterward.

Use `scheduledAt` in Unix milliseconds to schedule within the existing 90-day window. Sending freezes eligible recipients, checks verified sender, sending pause, consent and suppression rules, and queues work. Acceptance is not proof of delivery. Test sends have separate permissions. Cancellation stops remaining work but cannot recall submitted messages. Publication-owned issue launch/cancel retains the dedicated issue workflow.

Lists default to 20 records. MCP accepts 1–20; existing REST endpoints retain 1–100 and their cursor format. Follow `nextCursor` to null. Lists are not frozen snapshots. Recipient outputs contain the public recipient fields only, with no preference tokens, stored consent metadata or worker keys. Current domain-service collection limits remain unchanged; this increment does not introduce arbitrary search or larger audience capacity.

## Recovery and compatibility

Save the operation key before invoking a mutation. Repeating the same key and input replays the committed public result. Current scopes, resource restrictions and revocation are checked before replay. Different clients have separate receipt namespaces; token refresh preserves the same client's namespace.

Creates, template publication, test acceptance, launch, single-step edits, membership changes, subscription changes, and cancellation commit their terminal mutation and result receipt atomically. Lost database acknowledgments are reconciled against that receipt. Profile/topic changes and their webhook jobs share that transaction, so replay does not emit another event. Existing dashboard callers still use the same domain services; their transport-specific response shapes remain unchanged.

CSV import is multi-step. An interrupted import can have committed some profiles, memberships or preferences. Its operation becomes `unknown` and is fenced against automatic re-execution. Inspect existing state before deciding how to reconcile it; do not submit a new key merely because the previous response was lost. Once an import has completed and its receipt is saved, the same key returns that saved result.

With `narada:operations:read` and permission for the original action, `operations_lookup` retrieves status using `{ body: { operation, idempotencyKey } }`. Activity records contain identifiers and execution metadata, not contact addresses or content. The owner can inspect these in Activity. See [Activity and recovery](ACTIVITY.md).

No new infrastructure is required by this increment. Local tests exercise all 42 operations through real OAuth/MCP and generated output schemas, same-key replay, selected scopes, compound-scope denial, restricted grants, refresh/reduction/revocation, lost commit acknowledgments, interrupted import fencing, and existing REST workflows. See [hosted release verification](MCP.md#hosted-verification) for deployed client/approval coverage. The hosted smoke test does not execute every campaign operation.

API-key launch and test operations execute automatically within their existing scopes in the current checkout. This API compatibility correction is pending deployment; see [sending policy and rollout status](SEND-APPROVALS.md).

## Main-branch integration

The current shared catalog also exposes `contacts.properties.patch` (`contacts_properties_patch`) using `narada:contacts:update`, and `contacts.topics.unsubscribe` (`contacts_topics_unsubscribe`) using `narada:subscriptions:write`. Their SDK methods are `contacts.patchProperties` and `contacts.unsubscribeTopic`. Both retain resource restrictions, activity tracking and idempotent receipt recovery; they do not grant subscription consent. Property patches require the current revision and preserve unnamed properties. Topic unsubscribe preserves other topics and segment membership. These contracts reconcile the existing REST/SDK additions with MCP; their availability in a deployed environment depends on its release revision.
