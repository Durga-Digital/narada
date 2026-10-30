# Narada MCP

The application serves authenticated MCP at **`https://<your-narada-host>/api/mcp`**. Product, operational, campaign, activity and approval operations share canonical contracts and authorization. Scope selection, resource checks, domain validation and durable mutation receipts run on the server. Use `tools/list` for the exact tools available on your server and grant; counts change as features ship. See [operational operations](OPERATIONAL-API.md), [campaign operations](CAMPAIGN-MCP.md) and [product permissions](PRODUCT-API.md).

API-key/SDK sending is automatic within existing permissions; MCP OAuth sends require owner approval. This guide describes source behavior. The maintained installation’s compatibility correction was verified on 24 October 2026; later source additions and npm releases have separate availability. Installation-specific deployment reports belong in private operator records.

## Connect

Open **Profile → Security → Connected apps**, copy the endpoint, and add it as a remote HTTP MCP server in your client. Better Auth provides discovery, automatic public-client registration, authorization-code exchange with PKCE, and optional refresh tokens. No API key or client secret is required for a public client.

**Deployed to staging and production:** connected apps are listed directly inside Profile → Security, with in-app dialogs to reduce permissions and resource access or disconnect an app. The panel supports paginated connections and resource choices; stale edits must be reloaded before saving. Login and initial OAuth consent remain separate redirect pages for MCP client compatibility. The legacy management URLs remain available for existing links. These controls require an owner browser session and are deliberately excluded from public API keys, SDK methods and MCP tools.

Narada opens its login page, including your existing MFA challenge when enabled. Consent identifies the signed-in account and client ID; app names are self-reported, not verified publisher identities. Choose **All requested permissions** or **Choose permissions**, then optionally select existing publications, forms and sending domains. All is an explicit snapshot of the displayed request. It never grants future scopes. `offline_access` permits refresh; omitting it requires login again after access-token expiry.

Selections intersect. Publication restrictions include their issues and managed signup forms. Direct IDs, list pages, previews, exports, tests, publishing channels, linked resources and stored response replay pass the same authorization boundary. Selecting existing form/publication IDs prevents creating new root resources. Unsupported combinations fail closed. Permissions for reading answers, exporting answers, sending tests, publishing on the web and sending email remain separate. See [product permissions](PRODUCT-API.md).

The consent POST is bound to the signed, expiring OAuth request. The server validates the chosen subset and resource IDs; submitting directly to the provider's consent endpoint cannot bypass this check. Only the authenticated owner session can manage connections. MCP cannot mint credentials or expand its own grant.

## Tools and retries

Tool names replace dots in operation IDs with underscores: `forms.list` → `forms_list`, `issues.publish` → `issues_publish`. `tools/list` exposes only operations allowed by current scopes and supported restrictions. Discovery is advisory; direct invocation checks permissions again. Inputs and outputs come from the canonical schemas in `packages/contracts`.

For example, `issues_get` accepts:

```json
{ "params": { "id": "publication-id", "issueId": "issue-id" } }
```

`issues_update` accepts the same shared envelope plus a required retry key:

```json
{
  "params": { "id": "publication-id", "issueId": "issue-id" },
  "body": {
    "revision": 3,
    "draft": {
      "title": "Updated issue",
      "slug": "updated-issue",
      "document": {
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Hello subscribers" }]
          }
        ]
      }
    }
  },
  "idempotencyKey": "edit-issue-2026-10-23-001"
}
```

Use `tools/list` for the exact schema and required fields. Every mutation requires `idempotencyKey` (1–128 printable non-space ASCII characters). Reuse the same key and arguments after a lost response, including after refresh or reconnect. A changed payload conflicts. OAuth receipts are isolated by installation, user, client and operation, and do not share a namespace with API-key receipts. Current and historical-result authorization runs before replay. Completed receipts have the existing 24-hour recovery window; never retry an uncertain send using a new key. See [idempotency](IDEMPOTENCY.md).

Responses contain the public DTO in `structuredContent` and JSON text. Tool failures use `isError` with a JSON error containing `code`, `status`, `requestId` and optional `retryAfter`; protocol/schema errors may instead be MCP errors. HTTP responses carry a request ID after authentication. List cursors remain opaque, bounded and reauthorized on every page. Accepted publication work is not a delivery guarantee; inspect the issue and its delivery operation.

## Human approval for sends

This release requires owner approval for transactional email (inline or published template), broadcast launch/schedule, broadcast/template/issue test emails, and issue publication (including web-only publication). Direct send tools return `approval_required`. Select `narada:approvals:request` and `narada:approvals:read`, plus the target operation's scopes, during fresh consent. Previously granted “All” does not include new scopes.

Call `approvals_request` with `{ body: { operation, input }, idempotencyKey }`, where `input` is the target operation's canonical envelope without its retry key. Present the returned `reviewUrl` to the human. The owner reviews and approves or rejects in **Send approvals**; approval executes the reviewed action once. Poll `approvals_get` to recover its status, operation ID and single-message `messageId`; `emails_get` reads delivery metadata with `narada:emails:read`. Application API-key/SDK sends execute automatically within their existing permissions; MCP cannot create application keys or use them as an approval bypass. There is no MCP approval tool, and no need to invoke the original send tool after approval. See [examples, retention and recovery](SEND-APPROVALS.md).

## Activity and recovery

Select `narada:operations:read` during fresh consent to use `operations_list`, `operations_get` and `operations_lookup`. They inspect only your client’s operations and recheck current product permissions and resource restrictions. Mutation results include an operation ID in `_meta`. After a lost response, look up the original retry key and replay the same mutation to recover its result. See [status semantics and recovery](ACTIVITY.md). Source availability and deployment are separate; verify the target installation before relying on new operations.

## Reduce or revoke

Connected apps supports paginated inventory, narrowing scopes/resources and disconnecting. Increasing access requires new consent. Current JWT scopes are intersected with the freshly read durable grant and provider consent on every request; disabled/deleted clients are rejected too. Reductions apply to already-issued tokens. A refresh requesting removed scopes fails and requires a narrower request or reconnection.

Reconnection rotates the grant generation. Old access tokens, refresh tokens and pending authorization codes cannot regain access. Password reset rotates a per-user generation and invalidates every existing grant. Signing out does not disconnect apps. The state lives in DynamoDB, not process memory, so restart does not reset revocation.

A request that has already passed authorization can finish. Revocation does not recall accepted queued/scheduled work or an in-flight mail submission. Cancel pending work explicitly through the relevant product operation. OAuth send and issue-publication operations now require a separate owner decision in Narada. Scope consent and `confirmed: true` cannot substitute for that decision. See [send approvals](SEND-APPROVALS.md).

## Runtime and rollout

- `/api/mcp` uses the pinned MCP SDK's stateless handler, including compatibility with `2025-06-18` and `2025-11-25` clients. Tokens must match the configured issuer and MCP resource. REST `/api/v1` continues to authenticate API keys.
- `BETTER_AUTH_URL` must be the canonical origin, without a trailing slash/path, and HTTPS in AWS mode. Use a separate installation origin/secret for each environment. Vite proxies `/oauth/*` and `/.well-known/*` locally.
- CloudFront forwards `/oauth/*`, `/.well-known/*` and `/api/*` to the API without caching, preserving authorization headers, cookies and queries. The deployed issuer/resource never derives from an arbitrary request Host header.
- The auth table needs **six lookup GSIs** plus `byType`. CDK adds `lookup6`; API/bootstrap updates depend on the auth table resource. CloudFormation may finish before index backfill; the deployment script explicitly waits for every auth index to be ACTIVE before bootstrap and success reporting. Existing owner model slots are unchanged. Wait for the GSI to be active before using the new code. Local initialization performs the equivalent schema upgrade.
- Keep the pinned DynamoDB adapter patch: conditional refresh consumption and null-field matching are required. Signing keys use the indexed `keySet=primary` field, with a bounded 20-key ring. Existing installations without OAuth need no key backfill; any manually imported/probe keys must be migrated deliberately. Never copy temporary probe tokens or tables into production.
- Grant records have no TTL. Retain them when rolling application code back so older tokens cannot become valid after a later rollout. Disable/revert the endpoint if rollback is needed; do not delete live grant history as cleanup.
- Registration is rate limited and grants no user access. Untyped public clients with exclusively HTTP loopback callbacks are classified as native for Claude Code compatibility; explicitly web or mixed remote-HTTP redirects remain rejected. Remote JWKS/backchannel client URLs, machine grants and bypassing PKCE/consent are excluded. Refresh tokens are hashed; JWT signing keys remain persisted.
- Structured operation logs record actor, operation, request ID, outcome and duration, without tool arguments, tokens or returned content. Durable mutation activity and authorized operation lookup are described in [Activity and recovery](ACTIVITY.md). Operational management and lifecycle webhooks are deployed to staging and production; see [Operational API](OPERATIONAL-API.md) and [Webhooks](WEBHOOKS.md).

## Verification

```sh
pnpm test:mcp
pnpm test:oauth
pnpm mcp:clients
pnpm infra:check
```

Integration tests use isolated DynamoDB Local tables, actual HTTP token exchange and Chromium consent. They cover all/selected scopes, resource-filtered lists/direct IDs, web/email permission separation, receipt recovery across refresh/reconnect, live reductions, consent bypass attempts, durable revocation, disabled clients and management pagination. Owner-auth tests exercise login, MFA and password-reset grant invalidation. Shared product/API tests cover the underlying operation lifecycle.

The installed-client harness tests Claude Code `2.1.187` and Codex CLI/app-server `0.163.0-alpha.10.2` on loopback with disposable tables and temporary client settings, without model inference. Both clients register automatically from the MCP URL. The harness verifies discovery for its requested grant versus identity-only discovery, unchanged scopes on refresh and rejection after revocation. Results are stored without secrets in `.local/mcp-production-client-results.json`. This local harness does not certify hosted deployment. The hosted verification below checks the CDN/HTTPS path; Claude's hosted connector and other desktop surfaces remain untested.

Protocol references: [Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider) and [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

## Hosted verification

After an authorized deployment, run `pnpm mcp:staging` or `pnpm mcp:production` for that environment. Both invoke `scripts/verify-hosted-mcp.ts` with an explicit `--stage`; the script refuses an omitted stage. It reads that environment’s configured outputs and saved owner credentials, rejects non-HTTPS endpoints, and uses actual installed Claude Code and Codex clients. It creates uniquely named draft publications, validates selected publication/domain access and later form restrictions, tests durable draft-update replay, refresh, permission reduction and revoked tokens across reconnection. Without `--approvals`, it never sends mail or activates a publication.

Codex invokes tools directly through its app-server API. Claude Code performs real registration, browser consent, discovery and revoked-connection checks; additional HTTP protocol checks obtain a new consent generation for that same registered client to exercise resource authorization and refresh without model inference. Reports distinguish these paths. Temporary client settings are removed, test grants are revoked and publications are archived on exit. Reports under `.local/mcp-<stage>-*.json` contain no tokens or passwords. Incomplete grant or publication cleanup fails the run. If the process is forcibly interrupted, use its saved fixture IDs to finish cleanup.

For the send-approval release, run `pnpm mcp:staging --approvals` after deploying staging. After an authorized production deployment, run `pnpm mcp:production --approvals --allow-production-approval-tests`. Production simulator sends require this additional explicit flag; omitting it fails before login or mutation. It checks automatic sending and optional reviews for five API-key variants (sending, full, scoped, sender-domain and operation), owner-only decision enforcement, native Codex approval tool calls, and approval protocol checks under both clients’ registered identities. The browser deliberately loses a successful owner response; the harness recovers the result, repeats the request and makes concurrent decision retries. Pending approvals and old access/refresh tokens must remain invalid after revocation and reconnect. Selected email scopes and sender domains are checked separately from the publication grant.

Approved test messages go exclusively to `success@simulator.amazonses.com`. A consistent DynamoDB audit in the selected environment checks the exact message set, one provider submission per accepted direct or approved action and delivered simulator feedback; revoked pending requests must create no message. The selected environment’s AWS profile needs read access for this audit. The harness revokes its keys/connections, rejects pending approvals and archives draft publications; it retains accepted message/audit metadata. The harness does not deploy or publish the SDK, and no customer recipients are involved. `tests/e2e/send-approval-recovery.test.ts` rehearses the API-key/browser portion locally with Mailpit. Isolate diagnostics with `--client claude` or `--client codex`; only the default combined run includes every API-key variant.

CloudFormation can report completion while `lookup6` is still backfilling. The deployment script waits for all auth indexes to become ACTIVE before declaring readiness. The MCP response adapter sets `Cache-Control: no-store` after the SDK creates its response so the SDK's SSE defaults cannot overwrite it.

### Recorded compatibility coverage

The 24 October 2026 compatibility correction was verified on staging and production with Codex CLI/app-server `0.163.0-alpha.10.2` and Claude Code `2.1.187`. Coverage included automatic API-key/SDK sending, mandatory MCP approval, narrowed scopes/resources, revocation across reconnect, approval recovery and owner connection management. Simulator delivery checks verified one provider submission per accepted message. These are historical results for that release, not certification of subsequent source changes or a new installation.

Keep account IDs, infrastructure hostnames, fixture IDs and report paths in private operator records. Run the relevant local checks for each change and the opt-in hosted harness only against an explicitly authorized environment. Other applications’ login/session flows require their own end-to-end verification.

## Publication branding tools (local implementation)

With explicit `narada:publications:branding:write` consent, `publications_logo_upload` accepts a publication ID and `{ fileName, contentBase64 }`, returning a public immutable logo reference. PNG/JPEG only, at most 512 KiB decoded and 2,048 pixels per side. The logo is associated with that publication; it is not immediately shown publicly. The tool does not browse the owner's global image library or fetch remote files.

`publications_branding_preview` requires `narada:publications:read`, a current revision and candidate branding. It is a read-only operation returning private HTML with links/signup disabled. `publications_branding_update` requires the branding write scope, current revision and branding; it updates the public page immediately but does not send mail or activate the publication. The default theme is Classic; Editorial and Minimal use the same fixed layout.

Upload/save require an `idempotencyKey` for each logical mutation. Reuse identical arguments and the same key after a lost response. Recheck operation status for unknown outcomes; do not invent a fresh key to repeat uncertain work. A stale revision requires fetching/reconciling the current publication. Current permissions and publication/asset restrictions apply before execution and replay, including after grant reduction or revocation. Previously granted scopes do not silently gain branding writes.

These tools and their bounded schemas are implemented in local source with real OAuth/MCP tests. Deployment and an SDK release are separate actions. [Full feature scope](PUBLICATION-BRANDING-V1.md).

Owner password changes, password resets and recovery sender preferences are intentionally excluded from MCP, including “All” consent. Configure them through [Profile → Security](PROFILE-SECURITY.md). Password reset continues to invalidate connected-app grants; reconnect and consent again afterward. The Profile UI is a local implementation until deployed.

## Custom publication subdomains

See [publication subdomains](PUBLICATION-DOMAINS.md) for the five shared management operations, dedicated domain-write consent, DNS/HTTPS setup, asynchronous recovery and default-address fallback. The local implementation includes dashboard, API, SDK and MCP coverage; deployment and SDK publication are separate release steps. DNS-provider writes remain an operator action.

## Agent onboarding

Sender-domain registration, bounce-domain configuration, DKIM enablement and scoped resource search now have shared REST/SDK/MCP contracts. New `narada:domains:create` and `narada:domains:configure` scopes require fresh consent; old grants do not expand. Start with `integration_guide`, the `narada://guides/project-integration` resource, or the `migrate_from_resend` prompt. The owner supplies the application's domain-restricted Sending key through its secret store. See [workflow, permissions and recovery](AGENT-ONBOARDING.md). These API and MCP additions are deployed to staging and production as of 24 October 2026. SDK source is updated; npm publication remains separate.

### Publication branding v2 and draft management (not yet deployed)

`publications_assets_upload` returns a publication-owned public image for a
wordmark, homepage cover or issue cover. It requires
`narada:publications:branding:write`; uploads are publicly accessible immediately.
Use `publications_branding_preview` before revision-checked
`publications_branding_update`. The canonical schema includes fixed layouts
(`letter`, `feature`, `grid`), wordmark/cover references, alt text and signup copy.
No HTML, CSS or JavaScript fields are accepted. Omitted new fields retain their
previous values; null removes an image.

`issues_list` accepts a status filter and returns status/canDelete information.
Continue through nextCursor even for empty pages. `issues_delete` requires new
explicit `narada:issues:delete` consent, a current revision and a stable
idempotencyKey. It only deletes drafts with no publication/schedule/delivery
history. A lost response can be replayed with the same key after deletion;
inspect the existing operation first. Revoked scopes and changed resource
restrictions still deny receipt replay. Deletion does not remove shared images
or email history. Existing API keys and OAuth grants gain no permissions.

## Publication site operations

The publication site iteration adds 16 shared operations (implemented locally; not yet deployed): `publications_about_get/update/preview/publish/withdraw`, `publications_site_get/update/preview/publish`, `publications_collections_list/get/create/update/archive`, and `issues_collections_get/update`. These are individual tools; slash-separated action suffixes here abbreviate their names. `issues_list` additionally accepts `collectionId` together with status and pagination.

Request publication read and the least required new write scopes: `narada:publications:site:write` for private About/site drafts, `narada:publications:site:publish` for making those snapshots public or unpublishing About, and `narada:publications:collections:write` for collections and assignments. Issue classification requires issue read too. Existing grants are not widened. Selected publication and sender restrictions apply at discovery/execution, linked-resource validation and receipt replay.

Read current revisions, save drafts, preview, then explicitly publish. About and site settings have independent revisions starting at zero. Site publication changes navigation and homepage together; appearance changes retain their separate branding behavior. About/site publication never sends email and does not require a send approval. Existing issue publication and sending still follow their existing approval rules.

Collections are editorial groups, not independently subscribable newsletters. Create/update/archive and issue assignment changes affect website discovery immediately; they never publish an issue draft, resend an issue or change consent. Assignment writes require both classification and issue revisions and advance both. Archive hides the collection page/navigation/rows without removing any issues. Only current public issue versions can appear to readers.

Supply a stable `idempotencyKey` for every mutation. Retry identical arguments with the same key after an uncertain response, or use operation lookup/status; do not generate a fresh key to repeat an uncertain write. Replay rechecks current permissions and the receipt's historical authorization. Pagination tokens are bound to parent/filter; follow an empty page's `nextCursor` and keep filters unchanged. See the [implementation plan](PUBLICATION-SITE-PLAN.md) and [SDK examples](../packages/sdk/README.md).
