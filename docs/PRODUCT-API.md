# Forms, publications and issues API

All paths below are relative to `/api/v1`. Authenticate with `Authorization: Bearer na_…`. The same operation catalog supplies HTTP bindings, input/output JSON Schemas, OpenAPI, granular permissions and SDK types. The same handlers are exposed through [OAuth-authenticated MCP](MCP.md); REST authentication remains API-key based.

## Provision an operation key

An authenticated owner can POST `/api/admin/keys` with a valid owner session and same-origin `Origin` header:

```json
{
  "name": "Newsletter editor",
  "permission": "operations",
  "operationAccess": {
    "scopes": [
      "narada:capabilities:read",
      "narada:publications:read",
      "narada:issues:read",
      "narada:issues:write",
      "narada:issues:test"
    ],
    "resources": {
      "publicationIds": ["existing-publication-uuid"],
      "senderDomains": ["example.com"]
    }
  }
}
```

The token is shown once. Update the grant through PUT `/api/admin/keys/:id` with the same settings and the key's current `revision`; the next request reads the updated grant. The existing owner revoke/delete endpoints apply. Operation keys are displayed in the dashboard key list and can be revoked/deleted there; create/edit their grants through the owner API in this increment. API keys cannot authenticate `/api/admin`.

`resources` defaults to `{}` (all resources). Supported dimensions are `formIds`, `publicationIds` and `senderDomains`. Omitted dimensions are unrestricted; empty arrays, unknown scopes/dimensions and nonexistent selected resources are rejected. All supplied dimensions must match. An empty scope set grants no operations. Add `narada:capabilities:read` for capabilities/OpenAPI discovery. To grant all scopes, provide an explicit snapshot of the current shared scope catalog, not a wildcard. New scopes do not enter existing grants automatically.

`operationAccess` is valid only for `permission: "operations"`. The legacy `scopes`/`domain` key fields retain their old meaning and cannot be mixed into an operation key. Existing full keys do not gain product API access; migrate deliberately by provisioning a new operation key or explicitly editing an existing key's mode.

## Endpoint inventory

Scope names in this table omit the `narada:` prefix. Request/response shapes are available from authenticated `/openapi.json` and the SDK declarations. All reads return 200. Creates return 201; issue test/publish return 202. Other mutations return 200.

| Operation                         | HTTP path                                                                                        | Required scope(s)                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| List/get form definitions         | GET `/forms`, `/forms/:id`                                                                       | `forms:read`                                                     |
| Create/update form draft          | POST `/forms`, PUT `/forms/:id`                                                                  | `forms:write`                                                    |
| Publish/close form                | POST `/forms/:id/publish`, `/forms/:id/close`                                                    | `forms:publish` / `forms:close`                                  |
| Preview form draft                | GET `/forms/:id/preview`                                                                         | `forms:read`                                                     |
| List/read responses               | GET `/forms/:id/responses`, `/forms/:id/responses/:responseId`                                   | `form-responses:read`                                            |
| Retry failed processing           | POST `/forms/:id/responses/:responseId/retry`                                                    | `form-responses:retry`                                           |
| Export response CSV chunks        | GET `/forms/:id/export`                                                                          | `form-responses:export`                                          |
| Create invitation broadcast draft | POST `/forms/:id/broadcasts`                                                                     | `forms:read` + `broadcasts:write`                                |
| List/get publications             | GET `/publications`, `/publications/:id`                                                         | `publications:read`                                              |
| Create/update publication         | POST `/publications`, PUT `/publications/:id`                                                    | `publications:write`                                             |
| Activate/archive publication      | POST `/publications/:id/activate`, `/publications/:id/archive`                                   | `publications:activate` / `publications:archive`                 |
| Preview publication landing page  | GET `/publications/:id/preview`                                                                  | `publications:read`                                              |
| List publication subscribers      | GET `/publications/:id/subscribers`                                                              | `subscribers:read`                                               |
| List/get issues                   | GET `/publications/:id/issues`, `/publications/:id/issues/:issueId`                              | `issues:read`                                                    |
| Create/update issue draft         | POST `/publications/:id/issues`, PUT `/publications/:id/issues/:issueId`                         | `issues:write`                                                   |
| Preview issue                     | GET `/publications/:id/issues/:issueId/preview`                                                  | `issues:read`                                                    |
| Send test                         | POST `/publications/:id/issues/:issueId/test`                                                    | `issues:test`                                                    |
| Publish/schedule                  | POST `/publications/:id/issues/:issueId/publish`                                                 | `issues:publish` for web, `issues:send` for email, both for both |
| Cancel scheduled issue            | POST `/publications/:id/issues/:issueId/cancel`                                                  | `issues:cancel`                                                  |
| Withdraw web issue                | POST `/publications/:id/issues/:issueId/withdraw`                                                | `issues:withdraw`                                                |
| Duplicate draft                   | POST `/publications/:id/issues/:issueId/duplicate`                                               | `issues:read` + `issues:write`                                   |
| Read delivery summary/recipients  | GET `/publications/:id/issues/:issueId/delivery`, `/publications/:id/issues/:issueId/recipients` | `issues:delivery:read`                                           |

Create bodies are `FormInput`, `PublicationInput` or `IssueInput`. Updates use `{draft, revision}` for forms/issues and `{settings, revision}` for publications. Publish/close/activate/archive/cancel/withdraw use `{revision}`. Issue test uses `{to, revision}`. Issue publish uses `{revision, channels: "web" | "email" | "both", confirmed: true, scheduledAt?}`; `scheduledAt` is epoch milliseconds. Retry/invitation/duplicate have no body. Unknown input fields are rejected. Revisions are nonnegative integers and stale revisions return 409.

Tests and sends use existing verified-sender, suppression, consent, sender-address and delivery rules. Web publishing remains asynchronous; 202 means accepted, not released or delivered. An issue already distributed by email cannot be sent again; duplicate it for a new distribution. Domain services continue to guard managed resources and published URLs. There are no new delete or audience-import actions for these products; subscriber changes use the existing consent flows, not arbitrary signup insertion.

Form contact sync additionally requires `contacts:create` and `contacts:update`; a configured topic requires `subscriptions:write`; optional `audienceId` routing requires `segments:members:write`; sync or acknowledgment requires `emails:send`. These checks apply at creation, editing, publication and processing retry as appropriate. `audienceId` selects one existing manual audience that is not managed by Newsletters. Membership is added only after email confirmation and a checked consent answer; existing memberships and unsubscribe choices are preserved. Omit the field or set it to an empty string to disable routing. Publication lifecycle scopes cover its own managed signup form/topic/audience; they do not grant generic contact or audience access.

## Restrictions, pagination and privacy

Selected publication IDs permit that publication, its issues and its managed signup form. Selected form IDs permit only those forms. Specifying both dimensions intersects them; publication operations cannot satisfy a form-ID restriction and are denied. New root forms/publications cannot be created with existing-ID restrictions. Selected domains apply to stored and proposed senders, immutable response versions and linked issue broadcasts. A blank sender fails a sender-domain restriction.

Restricted lists filter before returning data. Direct reads, writes, previews, exports, tests and delivery reads resolve and check the same resources. Child IDs must belong to the requested parent. Generic contacts, topics, segments and broadcasts do not support form/publication restrictions and fail closed for such grants, preventing access through internal linked IDs. Creating a standalone invitation broadcast requires unrestricted form/publication ID dimensions.

Lists return `{data, nextCursor}` and accept `limit` (1–20, default 20) and `cursor`. Cursors are opaque, encrypted and bound to their collection/parent. Reuse them unchanged; authorization is checked afresh on each page. A bounded scan can return an empty `data` with a non-null cursor. Continue until `nextCursor` is null. Publication subscriber lists and issue recipient lists retain the existing bounded audience model; this API adds pagination, not a larger audience limit.

Form list/get/preview expose definitions without answers. Response lists return processing summaries without answers or confirmation tokens. Response detail includes answers plus the immutable form content for that submission. Exports return `{csv, nextCursor}` with at most five responses per chunk, one row per question, formula-safe cells, and a header/BOM in the first chunk. Concatenate `csv` chunks in order. Excluded historical sender versions are filtered from lists and exports.

Public projections exclude database keys, scheduler state, verification/message tokens, content digests and internal publication operation/broadcast IDs. Delivery summaries expose status/counts/total; recipient reads expose email, name, message ID, status and error. These permissions expose recipient data and should be granted explicitly.

## Recovery

Every mutation accepts `Idempotency-Key`. Use the same key and body after a lost response; changed payloads conflict. The final domain write and public response receipt commit together. Permissions and parent/linked resources are checked before replay, and receipt projections are checked for historical sender access. Narrowing a key can therefore deny a previously successful request's replay. Stale revisions conflict on new executions while an authorized identical completed request can replay its original response.

Issue creation, editing, tests and publishing bind the publication revision used for sender authorization. Errors retain the common `{error, code, requestId}` shape. See [idempotency behavior](IDEMPOTENCY.md) for contention, retention and uncertain-outcome recovery.

Owner login/MFA, credentials, OAuth client/grant administration, and domain registration, configuration, testing and removal remain owner-only. Sending status/pause, metrics, SES and domain diagnostics, suppressions and webhook management now have shared API/MCP handlers implemented locally; see [Operational API](OPERATIONAL-API.md). The production MCP connection UX is documented in [MCP](MCP.md), and locally implemented durable operation tracking in [Activity](ACTIVITY.md).

## Publication identity (local implementation)

The publication DTO now has optional `branding`, with defaults for existing records. Branding uses its own revision-guarded update operation so older `publications.update` settings calls cannot erase it. The three added operations are `publications.logo.upload`, `publications.branding.preview`, and `publications.branding.update`; all have REST, typed SDK and MCP support through `ProductOperations` and the same domain services.

Grant `narada:publications:read` and the new `narada:publications:branding:write` for the complete workflow, optionally restricted to selected publication IDs. Uploads associate immutable assets only with the authorized publication, and linked asset validation runs before preview, update, and replay. Receipt acceptance includes publication/grant guards. The global owner media library is not exposed.

[API inputs and recovery](API.md#publication-branding-local-implementation) and [the scoped implementation plan](PUBLICATION-BRANDING-V1.md) describe the feature. This section documents local source availability, not a deployed server release.

## Custom publication subdomains

See [publication subdomains](PUBLICATION-DOMAINS.md) for the five shared management operations, dedicated domain-write consent, DNS/HTTPS setup, asynchronous recovery and default-address fallback. The local implementation includes dashboard, API, SDK and MCP coverage; deployment and SDK publication are separate release steps. DNS-provider writes remain an operator action.

## Publication websites

The locally implemented publication site iteration adds About drafts and publication, revisioned navigation/homepage settings, editorial collections and issue assignments. Its canonical bindings and limits are listed in the [publication site plan](PUBLICATION-SITE-PLAN.md), with [typed SDK examples](../packages/sdk/README.md#publication-websites-and-editorial-collections) and [OAuth MCP instructions](MCP.md#publication-site-operations). These operations use the shared authorization and idempotency boundary. They do not send email or create separate subscription preferences. Deployment and SDK package publication remain separate release steps.
