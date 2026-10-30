# Better Auth OAuth feasibility

Status: historical feasibility investigation. The probe findings and reproduction steps below explain the adapter patch and early OAuth design; they are not a current deployment checklist. Use [MCP](MCP.md), [activity and recovery](ACTIVITY.md) and [send approvals](SEND-APPROVALS.md) for the implemented product contracts and verification instructions.

Better Auth can authorize a public MCP client using Narada's DynamoDB adapter, including a user-selected subset of requested scopes. This probe exercises real HTTP, DynamoDB Local, browser login/MFA, PKCE, token exchange, refresh, and authenticated MCP calls. The isolated probe itself does not expose product operations. The verified implementation has since been integrated into the main application; see [production MCP](MCP.md).

## Run the probe

Start the repository's local DynamoDB service, install dependencies with pnpm (including the checked-in adapter patch), then run:

```sh
pnpm oauth:feasibility
```

Open `http://127.0.0.1:3219`. The command prints the path to a temporary owner credential file under `.local/`, with permissions `0600`. Sign in, click **Test all or selected permissions**, and authorize either all displayed permissions or selected checkboxes. The result page shows the exact issued scopes; it does not display or retain tokens. To change the port, set `NARADA_OAUTH_PORT`. `DYNAMODB_ENDPOINT` can select another local DynamoDB endpoint.

Each run creates uniquely named `narada-oauth-feasibility-*` tables and a temporary account. Ctrl+C removes those tables and the credential file. Abrupt termination can leave disposable tables/files behind; remove only the names belonging to that run. The server binds to loopback, rejects foreign origins/hosts, refuses AWS mode, and requires isolated table names. It does not use the normal owner account or application tables.

The catalog deliberately has two read-only probe permissions:

| Scope                      | MCP tool       |
| -------------------------- | -------------- |
| `narada:identity:read`     | `whoami`       |
| `narada:capabilities:read` | `capabilities` |

`openid` and optional `offline_access` are displayed separately as account identification and refresh access. **All requested permissions** submits an explicit scope list, never a wildcard. Selected permissions must be a subset of the signed original request. No product scopes means no available tools. Client registration is owner-session-only; unauthenticated dynamic registration remains disabled.

## Adapter findings

Pinned packages are Better Auth / OAuth Provider / MCP `1.7.7`, DynamoDB adapter `0.2.2`, and MCP server `2.3.1`. The probe supports MCP `2026-07-28` plus the SDK's stateless compatibility handler. Installed clients negotiated `2025-06-18` and `2025-11-25`. Both paths use the same per-request authorization and tool registry; no session transport bypasses grant checks.

The stock adapter needed two fixes, carried in [the pnpm patch](../patches/@datar-platform__better-auth-dynamodb@0.2.2.patch):

1. A missing DynamoDB field must match an equality predicate for `null`. Newly created refresh-token rows omit `revoked`; the provider selects them with `revoked = null`.
2. `incrementOne` must retain and atomically recheck all `where` predicates. Previously it resolved the row ID and dropped the predicates before updating. The patch checks them against the revision protected by the existing DynamoDB transaction and retries with a fresh read. Concurrent refresh consumption cannot both succeed against the same unrevoked revision.

An eight-way adapter test verifies exactly one conditional update succeeds. OAuth tests also check concurrent code exchange and refresh rotation. A short provider retry window may return the same successor refresh token; this is intentional retry recovery, not a second successor.

JWT key discovery defaults to an unfiltered query, which this adapter disallows. The feasibility schema adds an indexed `keySet` field and a bounded JWT key lookup. Keys remain persisted across auth instances; scans remain disabled. The resulting schema needs **6 lookup slots**, compared with the previous owner-only schema's 5. Production CDK/local provisioning now includes the sixth slot; staging must verify the migration. The probe still provisions only its own isolated schema.

## Durable grant lifecycle

`scripts/oauth-feasibility/grants.ts` stores one authoritative grant per user, OAuth client, and resource in the isolated application table. Its key hashes that tuple; its record contains a random generation, current scopes, active state, and a revision. Reads are strongly consistent. Changes use DynamoDB conditional writes against the revision, without scans, a process-local cache, or TTL-based revocation.

- Explicit accepted consent creates a new generation, replacing the previous connection for that user/client/resource. Canceling consent preserves existing access.
- Better Auth's consent `referenceId` binds the generation to the consent, authorization code, and rotated refresh tokens. Access JWTs carry the same reference. Consent lookup during issuance includes the generation, so historical consents cannot accidentally supply authority.
- MCP requests check the current generation and intersect token scopes with current grant/consent scopes. Revocation rejects already-issued JWTs on the next request. A request that already passed authorization can finish; revocation does not undo accepted work.
- Refresh checks the durable generation before entering the provider, including its cached rotation-retry path, and again during normal token issuance. Reconnecting cannot reactivate an old refresh token or a pending old authorization code. Replaying an old family is rejected before provider cleanup can affect a new connection.
- Reductions keep the generation and only remove scopes. The management endpoint rejects expansion; expansion requires fresh consent and a new generation. An older JWT cannot regain removed permissions when the owner reconnects.
- Owner changes commit the grant restriction before updating/deleting the provider consent. A later provider failure remains fail-closed. Deleting an obsolete consent does not revoke a newer generation. Management hooks require an authenticated owner session and the configured origin before writing.

This state survives auth/MCP reconstruction. The grant records do not contain access or refresh tokens. The explicit SHA-256 token hasher is shared with the provider for refresh lookup. The production lifecycle is now shared from `packages/core/src/oauth-grants.ts`; existing probe tokens without generation/reset references must reauthorize.

## Verification

```sh
pnpm test:oauth
```

Requires DynamoDB Local and installed Playwright Chromium. Tests cover discovery/challenges, closed signup/registration, all/selected consent, optional refresh access, exact scopes after refresh, scope escalation, PKCE/client/resource mismatch, denial and signed-request tampering, code replay, concurrent refresh, JWT validation, scope-filtered tools and direct denied invocation, current-consent reduction/deletion, persisted signing keys, browser callbacks, and OAuth continuation through MFA recovery-code verification after TOTP enrollment.

The suite additionally covers reconnect/restart with old JWTs, rotated refresh tokens and pending authorization codes; scope expansion after reduction; stale consent management; concurrent refresh/revocation; other-client isolation; canceled reconnections; unauthorized management; and allowed/denied invocation on both clients' 2025 protocol versions.

Browser tests use separate simulated source IPs so independent clients do not consume each other's login rate limits. Production rate limiting remains enabled.

The existing six auth integration cases were also run against fresh isolated fixtures with the patched adapter: login, origin checks, owner operations, concurrent account uniqueness, MFA, and one-use password reset passed. The normal shared fixture had a stale saved owner password; the production increment now uses isolated owner-auth fixtures. The 166 unit tests and TypeScript check passed. Runner startup and graceful cleanup were smoke-tested.

## Installed-client compatibility

Verified locally on 2026-10-23 using the actual installed clients, a headless Chromium consent browser, public clients registered by the temporary owner, and loopback callbacks:

| Client               | Version              | Negotiated MCP | Verified                                                                                                                    |
| -------------------- | -------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI/app-server | `0.163.0-alpha.10.2` | `2025-06-18`   | All/selected consent, exact tool discovery, successful refresh with unchanged scopes, rejection after revocation, reconnect |
| Claude Code          | `2.1.187`            | `2025-11-25`   | All/selected consent, exact tool discovery, successful refresh with unchanged scopes, rejection after revocation, reconnect |

All grants exposed `capabilities` and `whoami`; selected grants exposed only `whoami`. Both clients attempted refresh after revocation and received `invalid_grant`. Codex requested `openid` as well as the product scopes and `offline_access`; Claude requested the product scopes and `offline_access`. Consent honors each client's request rather than silently adding scopes.

Run the opt-in harness with both CLIs on PATH and Python 3 available for Claude's interactive callback prompt:

```sh
pnpm oauth:clients
# Or test just one installed client:
NARADA_TEST_CLIENT=codex pnpm oauth:clients
NARADA_TEST_CLIENT=claude pnpm oauth:clients
```

It creates disposable local tables and owner credentials, uses a temporary Claude configuration, and supplies Codex process-local configuration overrides that disable unrelated MCP connections. It logs out the uniquely named Codex test connection during cleanup; the user's Codex configuration is not edited. No model inference or production operation runs. Temporary data is removed on normal completion/error. An abrupt process kill may require cleanup of that run's temporary data.

The harness uses five-second access tokens to exercise client refresh and separate stable test IP buckets for independent scenarios. Short lifetimes cause proactive refresh on many Codex requests; they are not the proposed production setting. It saves only versions, scope names, tool names, and HTTP/protocol outcomes in `.local/oauth-client-results.json`. It never prints tokens or browser callback codes. Actual tool invocation is covered by the integration suite; the installed-client harness validates OAuth and discovery without sending a model prompt.

This verifies **Claude Code and Codex CLI/app-server**, not Claude's hosted connector or every desktop/cloud surface. This probe run used owner-registered clients. The separate hosted harness verifies automatic registration and the HTTPS/CDN path with both installed clients; see [MCP hosted verification](MCP.md#hosted-verification) for coverage and limitations. This probe does not establish CIMD support or compatibility with every hosted client. Setup references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [Claude Code MCP](https://code.claude.com/docs/en/mcp).

## Production implementation and remaining verification

Durable grants, password-reset invalidation, resource restrictions, owner connection management, activity lookup and send approvals now have product implementations. Use the current [MCP guide](MCP.md), [activity guide](ACTIVITY.md) and [approval guide](SEND-APPROVALS.md); the small probe catalog is not the product's full tool inventory.

Each deployment still needs its own HTTPS issuer/resource configuration, auth-index readiness, refresh/revocation checks and authorized hosted rehearsal. Installed CLI tests do not establish compatibility with every desktop or hosted connector. Preserve the adapter's conditional refresh-consumption and null-field matching behavior when upgrading dependencies.

The feasibility result supports keeping Better Auth and DynamoDB. It also establishes that the unpatched adapter and token-signature validation alone are insufficient for Narada's delegation requirements.

References: [Better Auth MCP](https://better-auth.com/docs/plugins/mcp), [OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider), [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

The production variant runs with `pnpm mcp:clients` and saves `.local/mcp-production-client-results.json`. See [MCP verification](MCP.md#verification) for its separate client and product coverage.
