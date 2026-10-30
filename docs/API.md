# HTTP API

This is Narada's API, not a drop-in implementation of every Resend endpoint. Base URL: your dashboard origin. All `/api/v1/*` routes require `Authorization: Bearer na_…`.

## Capability discovery

`GET /api/v1/capabilities` returns the current caller's permitted operations, scopes/restrictions, contract version and pagination limits. `GET /api/v1/openapi.json` returns generated OpenAPI 3.1 for those operations. Both require a valid API key and return `Cache-Control: no-store`. The SDK exposes `narada.capabilities()`. See [shared operation contracts](OPERATION-CONTRACTS.md) for scope and schema ownership.

## Forms, publications and issues

The [product API](PRODUCT-API.md) covers form definitions, publication lifecycle, subscribers, issues, previews, exports, tests, publishing and delivery results. These endpoints require explicitly provisioned **operation keys** using the shared `narada:*` scopes and optional resource restrictions. Existing sending/scoped/full keys keep their original access.

## Send

API keys and the SDK send automatically within their existing permissions. `POST /api/v1/emails` accepts the body below and returns HTTP 202 `{ id, replayed }`. A stable `Idempotency-Key` recovers the original message ID on retry; no owner review is required. MCP OAuth sends still require [owner approval](SEND-APPROVALS.md). **This compatibility correction is deployed to staging and production. Existing API-key senders do not need an approval migration.**

Email input:

```json
{
  "from": "Your App <hello@example.com>",
  "to": ["person@example.net"],
  "subject": "Your receipt",
  "text": "Thank you.",
  "html": "<p>Thank you.</p>",
  "reply_to": "support@example.com",
  "expires_in": 3600,
  "tags": {
    "source": "audit-request",
    "tier": "premium",
    "tag": "enquiry",
    "urgency": "urgent"
  },
  "priority": "high"
}
```

`to` accepts a string or 1–10 addresses. At least one of `text`/`html` is required. `expires_in` defaults to 3600 seconds and accepts 30–86400. `reply_to` is optional. Unknown fields are rejected. The sender domain must be verified. Subjects cannot contain newlines. HTTP request bodies are limited to 350 KB; each text/HTML field to 100,000 characters.

An optional `Idempotency-Key` header (1–128 printable ASCII characters) deduplicates approval requests for 24 hours. Reusing it with different content returns 409.

`tags` is an optional object of up to 20 string key/value pairs. Keys are 1–64 ASCII characters, start with a letter, and contain only letters, digits, underscores, and hyphens; `constructor` and `prototype` are reserved. Values are 1–256 characters and cannot contain control characters. Keys and values are case-sensitive. Resend's array of `{name, value}` tags must be converted to this object, rejecting duplicate names. Tag order does not affect idempotency, but changing a tag or priority does. Tags remain in delivery metadata after body removal and are visible to authorized dashboard/status readers: do not include secrets or message content. They are not added to recipient headers or SES tags. Email details show all tags; the dashboard supports exact key/value filters within its latest 100 messages.

`priority` accepts `"normal"` or `"high"`. Omission uses normal behavior. High adds `X-Priority: 1 (Highest)`, `X-MSMail-Priority: High`, and `Importance: High` in both SMTP and SES. Normal adds no priority headers. This is an inbox hint, not a delivery guarantee or queue scheduling priority; clients decide whether to display it. Arbitrary `headers` remain unsupported, so callers cannot override routing or authentication headers. The priority fields follow [Nodemailer's header conventions](https://nodemailer.com/message) and use [SES message headers](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_MessageHeader.html).

Approval request success: HTTP 201 with approval metadata. After owner acceptance, approval status is `succeeded` and `messageId` identifies the queued message; this does not mean delivered. Common errors: 400 invalid input, 401 invalid/revoked key, 409 idempotency conflict, 422 unverified domain/suppressed recipient, 503 sending paused. Error responses have an `error` string.

## Status

`GET /api/v1/emails/:id` returns `id`, `status`, `created_at`, `events`, `tags`, and `priority`. Messages without these options return `tags: {}` and `priority: "normal"`. Statuses: queued, submitting, captured (local), sent, delivered, delayed, bounced, complained, failed, expired, unknown. `sent` means SES accepted the submission; `delivered` means the recipient mail server accepted it, not that a human read it.

## Audience and broadcast APIs

The audience, broadcast and template operations in this section are available under `/api/v1` with **Full access** API keys. Default and existing keys retain email sending/status access only. Create a full key in **API keys → Create API key → Permission**. Revocation blocks subsequent authentication; already queued emails continue. API keys cannot authenticate dashboard `/api/admin` endpoints.

For application contact sync, choose **Scoped access** and only the required permissions. The admin key-creation contract is `{name, permission: "scoped", scopes: [...], domain?}`. Scoped keys require at least one scope; sending/full keys cannot specify scopes.

| Scope                    | Allowed operations (paths relative to `/api/v1`)                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `emails:send`            | POST `/emails`, GET `/emails/:id` (including template-based sends)                                                                     |
| `contacts:create`        | POST `/contacts` only; suitable for signup hooks                                                                                       |
| `contacts:read`          | GET `/contacts` and `/contacts/:email`                                                                                                 |
| `contacts:write`         | POST `/contacts`, GET and PUT `/contacts/:email`, PATCH `/contacts/:email/properties`; preserves the original individual-contact scope |
| `contacts:subscriptions` | POST `/contacts/:email/topics/:id`, `/contacts/:email/topics/:id/unsubscribe`, and `/contacts/:email/unsubscribe`                      |
| `properties:read`        | GET `/properties` and `/properties/:key`                                                                                               |
| `properties:write`       | POST `/properties`, PUT `/properties/:key`                                                                                             |
| `segments:read`          | GET `/segments`, `/segments/:id`, and `/segments/:id/contacts`                                                                         |
| `segments:write`         | POST `/segments`, PUT `/segments/:id`                                                                                                  |
| `segments:members`       | POST and DELETE `/segments/:id/contacts/:email`                                                                                        |
| `segments:import`        | POST `/segments/:id/import`; includes contact creation, membership, and topic consent imports                                          |
| `topics:read`            | GET `/topics` and `/topics/:id`                                                                                                        |
| `topics:write`           | POST `/topics`, PUT `/topics/:id` (including archive)                                                                                  |
| `broadcasts:read`        | GET `/broadcasts`, `/broadcasts/:id`, `/broadcasts/:id/preview`, and `/broadcasts/:id/recipients`                                      |
| `broadcasts:write`       | POST `/broadcasts`, PUT `/broadcasts/:id`, POST `/broadcasts/:id/duplicate`                                                            |
| `broadcasts:send`        | POST `/broadcasts/:id/send`, `/test`, and `/cancel`; includes scheduling                                                               |
| `templates:read`         | GET `/templates` and `/templates/:id`, POST `/templates/:id/preview`                                                                   |
| `templates:write`        | POST `/templates`, PUT `/templates/:id`, POST `/templates/:id/publish`, `/archive`, and `/duplicate`                                   |
| `templates:test`         | POST `/templates/:id/test`                                                                                                             |

POST `/templates/:id/broadcasts` requires **both** `templates:read` and `broadcasts:write`. Other rows grant their listed operations independently; write scopes do not imply read access except the existing `contacts:write` individual read. Combine scopes when your app needs to retrieve revisions before updating resources. Full access permits the existing v1 product operations in the frozen legacy capability map; new operations require an explicit future opt-in.

Scopes can be combined on one key. The original `emails:send`, `contacts:write`, and `segments:members` scopes retain their target capability limits. All existing keys keep their target permissions until explicitly edited, and API/SDK sending remains automatic. MCP send/test and issue-publication actions require human approval. The contacts:write scope also permits targeted custom property patches; segments:members remains limited to membership changes. Scoped email operations can be restricted to an exact sender domain. This restriction only applies to POST `/emails` and GET `/emails/:id`; **all other scopes, including broadcast sending and template tests, are workspace-wide**. API keys never authorize dashboard administration. Unmapped operations are denied to every key; full keys retain a 404 response for unknown routes.

To update a key, open **API keys → Edit**, choose permissions, and save. For a signup integration, select **Scoped access → Create contacts only** (`contacts:create`); retain `emails:send` too if the same app sends transactional email. The token, prefix, usage history, and creation date remain unchanged, so the application does not need a new secret. New access applies on the next authenticated request; in-flight requests and queued emails are unaffected. Revoked keys cannot be edited.

The owner-session endpoint `PUT /api/admin/keys/:id` accepts the complete configuration `{name, permission, scopes?, domain?, revision}`. Read `revision` from the key list (legacy keys return `0`). The permission is required; omit `scopes` for sending/full access and omit `domain` to remove a restriction. Stale revisions or revoked/deleted keys encountered during the update return 409. Refresh before retrying. Writes require a signed-in owner session and matching Origin, never an API key. Edits and list responses return metadata only, without the token, hash, or storage key. No database migration or SDK change is required.

Transactional sending never creates a contact or grants marketing consent. Creating a contact only saves a profile. Adding an existing contact to a manual segment accepts an empty body or `{}` and returns `{email, name, addedAt}`. It neither requires nor accepts consent assertions. Repeated additions preserve the original membership and timestamp without duplicating members. Missing contacts return 404 and dynamic segments reject membership changes. Additions and removals preserve all topic subscriptions, list consent, unsubscribes, and suppressions. Topic preference changes require `contacts:subscriptions` or Full access; opting in requires explicit confirmation. **An enquiry or app signup alone is not marketing consent.**

Broadcasts choose an audience from segment membership, then independently require either a positive subscription to the selected topic or, without a topic, separately recorded list consent. Existing consent from older manual lists is migrated idempotently into independent records; no consent is inferred for new memberships or dynamic rule matches. Explicit-consent CSV imports remain available and still require consent confirmation and source. All broadcasts also honor list/global unsubscribes and suppressions, including a final worker check before submission. Removed manual members are excluded from queued sends. Marketing preferences do not gate transactional email; delivery suppressions still do.

For a topic-specific opt-out, POST `/contacts/:email/topics/:id/unsubscribe` with no body (`contacts.unsubscribeTopic(email, topicId)` in the SDK). It requires `contacts:subscriptions`, records a negative preference with source `API topic unsubscribe`, and preserves other topics, membership, profile data, and suppression status. No previous subscription or consent assertion is required; archived topics also allow opt-out. Repeating it keeps the contact opted out (the preference timestamp and webhook event may be refreshed). Unknown contacts/topics return 404. Use separate topics for each app and select the appropriate topic on every promotional broadcast. A topic opt-out applies across segments but does not opt out of topicless legacy broadcasts. The existing `contacts.unsubscribe(email)` is a global opt-out from all broadcasts in the workspace, including other apps. Both leave transactional email unaffected by marketing preferences; delivery suppressions still apply. Signed email unsubscribe links already support topic/list opt-out and the preference page.

For app-specific account cleanup, opt out of each app-exclusive marketing topic if applicable, then DELETE the app's segment membership and PATCH `/contacts/:email/properties` with `{properties: {app_user_id: null}, revision}`. Only the named custom properties change; `null` removes a key. Use keys owned exclusively by that app, since the contact is shared and API scopes do not enforce property ownership. The current contact revision is required; stale writes return 409. Membership removal is repeatable, and property cleanup can be retried after reading the current revision. Do not delete the shared contact or globally unsubscribe it for one app's account deletion. Consent and suppression history remain separate.

**Compatibility:** membership requests containing the old `consentSource` / `consentConfirmed` fields now return 400. Remove those arguments and record actual opt-in through topic subscriptions. Membership responses replace `consentedAt` with `addedAt` and omit `consentSource`. Deploy the updated server before using the matching SDK contract.

Sending keys may be restricted to one domain during creation or editing. Both `POST /emails` (including template-based sends) and `GET /emails/:id` check the resolved sender domain and return 403 for a mismatch. This is an exact domain match, so a key for `example.com` cannot send from `updates.example.com`. Full-access keys are workspace-wide. Existing unrestricted keys remain unrestricted.

| Resource                                  | Operations                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/contacts`                               | GET list, POST create (no implicit subscription)                                              |
| `/contacts/:email`                        | GET profile/preferences, PUT `{contact, revision}`                                            |
| `/contacts/:email/properties`             | PATCH `{properties, revision}`; set named fields or clear with `null`                         |
| `/contacts/:email/topics/:id`             | POST `{subscribed, source, confirmed: true}`                                                  |
| `/contacts/:email/topics/:id/unsubscribe` | POST with no body; opt out of only this topic                                                 |
| `/contacts/:email/unsubscribe`            | POST global broadcast opt-out                                                                 |
| `/properties`                             | GET list, POST `{key, type, fallback?}`                                                       |
| `/properties/:key`                        | GET, PUT `{property, revision}`                                                               |
| `/segments`                               | GET list, POST `{name, kind, match?, rules?}`                                                 |
| `/segments/:id`                           | GET, PUT `{segment, revision}`                                                                |
| `/segments/:id/contacts`                  | GET members                                                                                   |
| `/segments/:id/contacts/:email`           | POST empty body or `{}` membership; DELETE membership (preserves profile and all preferences) |
| `/segments/:id/import`                    | POST `{csv, consentSource, consentConfirmed: true, topicIds?}`                                |
| `/topics`                                 | GET list, POST `{name, description?, visibility?, active?}`                                   |
| `/topics/:id`                             | GET, PUT `{topic, revision}`; `active: false` archives                                        |
| `/broadcasts`                             | GET list, POST draft                                                                          |
| `/broadcasts/:id`                         | GET, PUT `{draft, revision}`                                                                  |
| `/broadcasts/:id/recipients`              | GET recipient delivery statuses                                                               |
| `/broadcasts/:id/preview`                 | GET, optional `?contact=email`                                                                |
| `/broadcasts/:id/test`                    | POST `{to, previewEmail?}`                                                                    |
| `/broadcasts/:id/send`                    | POST `{revision, confirmed: true, scheduledAt?}`                                              |
| `/broadcasts/:id/cancel`                  | POST cancel pending deliveries                                                                |
| `/broadcasts/:id/duplicate`               | POST create a new draft                                                                       |

The **API reference** page and contextual `</>` panels contain cURL and Node.js examples. The SDK's exported TypeScript contracts describe request/response shapes. The API is versioned independently of database records; responses omit storage keys, leases, and internal worker state. Public broadcast drafts accept source HTML/text rather than visual-editor documents. A public draft update replaces source content and clears any previous visual-editor document.

List endpoints accept `limit` (1–100, default 20) and opaque `cursor`; return `{data, nextCursor}`. Follow the cursor until null. Do not decode or construct cursors. Collections are eventually consistent, so concurrent changes may affect pagination. Broadcast history uses database pagination; bounded audience collections use identity cursors. Existing installation limits still apply; see [Broadcasts](BROADCASTS.md).

Creation returns 201; email submission, broadcast test and launch return 202 (accepted/queued, not delivered). Other operations return 200. IDs are UUIDs except contacts (URL-encoded email) and properties (key). `audienceId` refers to a segment ID. `scheduledAt` is Unix **milliseconds**, not seconds. Updates replace their input fields and require the latest revision, with 409 on stale writes. Property keys/types and segment kinds are immutable.

The public APIs use the same validation, personalization, consent, suppression, and delivery services as the dashboard. Imports preserve existing profiles and opt-outs. Creating a contact or segment membership does not imply topic consent. Dynamic broadcasts require a topic. No new AWS resources are needed.

## Errors and retries

Each authenticated API request is limited to 120 requests per minute per key. Exceeding this returns 429 with `Retry-After` seconds. V1 responses include `X-Request-Id`; handled errors include `{error, code, requestId}`. Common codes: `invalid_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `validation_error`, `rate_limited`, `unavailable`, `internal_error`. Oversized bodies return 413; infrastructure-generated errors may not be JSON.

Authenticated mutation endpoints support `Idempotency-Key`, including creates, duplicates, tests, imports, updates and actions. Reuse the same key and request after a timeout; do not generate a fresh key for a retry. Successful management responses replay for 24 hours, and concurrent or uncertain outcomes return explicit 409 codes. Multi-step operations can require reconciliation after interruption. See [Safe retries and idempotency](IDEMPOTENCY.md) for coverage, key scoping, SDK usage and recovery. The SDK does not retry automatically.

## SDK

`@durgadigital/narada` now provides typed `emails`, `broadcasts`, `contacts`, `contactProperties`, `segments`, and `topics` methods. The original `client.send(...)` alias remains supported. Node.js 22+ and ESM are supported. Build and pack a standalone archive:

```sh
pnpm --filter @durgadigital/narada pack
# In your consuming project:
npm install /path/to/narada/packages/sdk/durgadigital-narada-0.3.0.tgz
```

```js
import { Narada } from "@durgadigital/narada";
const narada = new Narada({
  baseUrl: "http://localhost:5173",
  apiKey: process.env.NARADA_API_KEY,
});
const property = await narada.contactProperties.create({
  key: "company_name",
  type: "string",
  fallback: "your team",
});
console.log(property);
```

See [SDK guide](../packages/sdk/README.md) for installation, pagination, typed errors, and a complete broadcast example. The SDK can be installed from npm or a locally built archive. SDK publishing is a separate release from server deployment. Other language SDKs, OpenAPI generation, automations, and destructive property/contact/segment deletion remain future work; examples only cover implemented endpoints.

## Webhooks

Manage endpoints from the authenticated dashboard, or through the locally implemented [operational API/MCP](OPERATIONAL-API.md) with explicit webhook scopes. The creation result includes the signing secret; ordinary reads do not. Payload:

```json
{
  "id": "event-id",
  "type": "email.delivered",
  "created_at": "2026-01-01T00:00:00Z",
  "data": { "email_id": "uuid", "recipients": ["you@example.net"] }
}
```

Headers: `webhook-id`, `webhook-timestamp` (Unix seconds), `webhook-signature` (`v1=` plus a hexadecimal HMAC-SHA256).

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
const expected = createHmac("sha256", secret)
  .update(`${id}.${timestamp}.${rawBody}`)
  .digest();
const received = Buffer.from(signature.replace(/^v1=/, ""), "hex");
const recent =
  Number.isFinite(Number(timestamp)) &&
  Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
const valid =
  recent &&
  received.length === expected.length &&
  timingSafeEqual(received, expected);
```

Verify the exact raw request body before parsing JSON or acting on it. Return a 2xx response promptly and deduplicate events using their ID. Non-2xx responses and network errors are retried. The [event catalog](WEBHOOKS.md) includes email feedback, contacts, topics, domains, suppressions, form responses, issue publication, and broadcast completion. See its lifecycle definitions and owner-session delivery history/retry endpoints. Opening/click tracking is not implemented.

## Templates

Manage reusable designs through `/api/v1/templates` and `narada.templates`. Email submission also accepts `{from, to, template: {id, version?, variables?}}` in place of subject/HTML/text. Sending keys may use published transactional templates; library access uses `templates:read`, `templates:write`, and `templates:test`, or Full access. See [Templates](TEMPLATES.md) for publication, revision checks, URL variables, and all routes. Template sends resolve content before acceptance; pin the version when using an idempotency key.

## Dashboard newsletters

Newsletter v1 is an owner-session feature under `/api/admin/publications`; API keys and the SDK do not expose newsletter administration. Publication creation, settings, activation, archival and subscriber views live here, with nested `/issues` routes for drafts, previews, tests, publication, schedule cancellation, duplication and withdrawal. Mutations use revision guards and the existing idempotency receipts. Linked broadcasts remain the delivery record and cannot be launched or cancelled independently through generic broadcast endpoints.

Reader pages live at `/n/:publicationSlug`, `/subscribe`, `/confirm`, `/archive` and `/p/:issueSlug`. Signup and explicit confirmation use native POST forms. Public pages are server-rendered and uncached, and never include private drafts, recipient data or signed subscriber links. See [Newsletter v1](NEWSLETTERS-V1.md) for lifecycle, consent and delivery limits.

## Send approval requests

Operation-scoped API keys can request owner review through `POST /api/v1/approvals`, list their own requests with `GET /api/v1/approvals`, and fetch metadata with `GET /api/v1/approvals/:id`. Requesting requires `narada:approvals:request` and all target scopes; reads require `narada:approvals:read` and current target permissions. Owner approval/rejection is session-only in Narada. API-key sends do not require approval; these review endpoints are optional for API callers. Legacy keys can request/read their own approvals within existing target permissions without gaining new product access. See [Send approvals](SEND-APPROVALS.md) for canonical inputs, SDK/MCP examples and recovery. The approval endpoints and automatic API-sending correction were verified on the maintained staging and production installations on 24 October 2026. Verify the deployed revision on an independent installation.

## Publication branding (local implementation)

Branding and the fixed public homepage are implemented in source; this does not indicate a deployed server or published SDK release. See [the branding plan and implementation notes](PUBLICATION-BRANDING-V1.md).

- `POST /api/v1/publications/:id/logo`: `{ fileName, contentBase64 }`; returns `201` with `{ publicationId, id, url, contentType, width, height }`. Upload PNG/JPEG up to 512 KiB decoded and 2,048 pixels per side. This creates a publication-specific asset association, not a live logo change.
- `PUT /api/v1/publications/:id/branding`: `{ revision, branding: { theme, logoAssetId, logoAlt, welcomeText } }`; returns the publication with its new revision. Themes are `classic`, `editorial`, and `minimal`. A null asset removes the logo reference without deleting the image. Alt text is limited to 160 characters and welcome text to 1,000 plain-text characters. Saving changes public pages immediately.
- `POST /api/v1/publications/:id/branding/preview`: the same body, returns `{ html }` without saving. The base revision must match. Links and signup are disabled in the private preview.
- Existing publication get/list responses may include `branding`. Existing `GET /api/v1/publications/:id/preview` now renders the saved homepage with real public issues and keeps its `{ html }` response.

Upload/update require `narada:publications:branding:write`; reads/previews require `narada:publications:read`. Publication and sender restrictions apply. Existing full keys and prior grants do not acquire branding writes automatically. Reference only a logo uploaded for the same publication. Logos have public immutable URLs; neither a public URL nor a guessed asset ID grants access to another publication's assets.

Use a stable `Idempotency-Key` for upload/save retries. A lost response is retried with the same key and body. A revision conflict requires loading the current publication and explicitly reconciling edits. Keep the original operation for unknown outcomes and follow operation-status recovery. Upload acceptance records its media metadata, publication association and receipt atomically; unfinished immutable bytes can be reused on retry. No raw image bytes are retained in receipts or activity.

These operations never activate a publication or send email. Existing settings updates preserve branding, and existing email content/version snapshots are unchanged. The general `/api/admin/media` library remains owner-only; this feature exposes only publication-scoped logo upload. No custom-domain operations are included.

Owner password changes and recovery sender configuration remain owner-only account-security operations, deliberately excluded from public REST v1, the Node SDK and OAuth MCP. Use [Profile → Security](PROFILE-SECURITY.md). Existing API keys, public DTOs and delegated permissions are unchanged.

## Custom publication subdomains

See [publication subdomains](PUBLICATION-DOMAINS.md) for the five shared management operations, dedicated domain-write consent, DNS/HTTPS setup, asynchronous recovery and default-address fallback. The local implementation includes dashboard, API, SDK and MCP coverage; deployment and SDK publication are separate release steps. DNS-provider writes remain an operator action.

## Project onboarding (local increment)

The shared API adds `POST /api/v1/domains`, `PUT /api/v1/domains/:name/mail-from`, `POST /api/v1/domains/:name/dkim`, `GET /api/v1/integration/guide` and `GET /api/v1/resources/search`. Registration returns HTTP 201, configuration HTTP 200, with the same public sender diagnostics plus a configuration `revision`. New operation-key scopes are explicit; legacy keys retain their previous capability ceiling. See [agent onboarding](AGENT-ONBOARDING.md) for bodies, scope selection, DNS/credential handoffs and recovery. These endpoints are deployed to staging and production as of 24 October 2026; SDK npm publication remains separate.
