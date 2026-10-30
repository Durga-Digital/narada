# Profile and account security

This feature was deployed to staging and production on 24 October 2026.
No SDK publication is implied.

Open **Profile → Security** from the sidebar, or select your account name at the
bottom of the desktop sidebar. The initial owner credentials still come from
deployment. Public signup remains disabled.

## Change your password

Enter your current password, a new password of at least 12 characters, and its
confirmation. Better Auth verifies the current password and signs out other
browser sessions. Your current session remains signed in. Changing your password
does not update the locally saved bootstrap credentials: use `pnpm deploy:smoke
--stage staging --public` (or `production`) and verify login manually afterward.

Two-factor authentication and Connected apps now live in **Profile → Security**.
Password changes do not remove MFA enrollment or revoke connected-app grants.
Password resets invalidate all browser sessions and connected-app grants;
reconnect clients through the existing consent flow afterward.

## Choose a recovery sender

1. Add a domain under **Domains** and complete its verification.
2. In **Profile → Security → Recovery email**, select a verified domain.
3. Select **Save recovery sender**. Reset emails use
   `Narada <security@your-domain>`.
4. Select **Send reset link** and check the inbox for your existing owner email.
   The sender address does not need its own receiving mailbox.

The setting is stored in the installation's application table and persists
across deployments. Staging and production keep separate settings. The same
sender is loaded for every **Forgot your password?** request on the login screen;
no signed-in session is needed to request recovery. The destination always comes
from the Better Auth account record, never from the selected sending domain.
This feature does not change the owner's email address.

Until a sender is saved, the existing deployment `AUTH_FROM` is used. That
identity must be verified with SES even if it was configured outside Narada.
After saving a sender, removal, loss of stored verification, or re-registration
of that domain makes it unavailable. Select and save a verified domain again;
Narada does not silently switch back to the deployment sender. SES also enforces
current sending authorization at delivery time. The UI reflects Narada's saved
domain verification, not a guarantee of inbox delivery.

In the SES sandbox, the owner recipient email or its domain must also be verified
in the same account and Region. Sending must be enabled and within SES limits.
Use **Settings → Amazon SES** for account status. In local mode, reset emails are
captured by Mailpit and no real recipient receives mail. See
[SES onboarding](SES-ONBOARDING.md).

Reset requests retain a generic response to protect account privacy, including
when delivery fails. A request confirmation is not proof of delivery. Check the
inbox and installation logs (`password_reset_delivery_failed`, without tokens or
message content) when diagnosing failures. The reset path remains separate from
application sending pause, campaigns, approval queues and activity receipts.
Links are single-use and Better Auth retains expiry, origin and rate-limit checks.

## Contracts and access

Canonical owner-only definitions are in
`packages/contracts/src/owner-security.ts`, implemented in
`packages/core/src/recovery-sender.ts`:

| Operation                      | HTTP binding                             | Access and effect                                              |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------- |
| `owner.recovery-sender.get`    | `GET /api/admin/profile/recovery-sender` | Owner session; reads sender, source, availability and revision |
| `owner.recovery-sender.update` | `PUT /api/admin/profile/recovery-sender` | Owner session and same origin; saves `{ domain, revision }`    |

Updates validate the verified domain and its registration, enforce revisions,
and atomically save the configuration and optional idempotency receipt. Replay
rechecks the current settings and domain availability. Responses are uncached.
Better Auth's existing `/api/auth/change-password`,
`/api/auth/request-password-reset` and `/api/auth/reset-password` endpoints retain
their authentication contracts; no parallel password or token implementation is
introduced.

These operations deliberately have no public REST v1, SDK or MCP binding. API
keys, including full keys, and OAuth grants cannot read or change account-security
preferences. Exact exclusions are recorded in
`tests/contracts/transport-exclusions.ts` and tested in
`tests/unit/owner-security.test.ts`. Public product contracts and credentials are
unchanged. See [agent access exclusions](AGENT-ACCESS-PLAN.md).

## Staging verification

The staging deployment and authenticated deployment smoke checks passed. Live
checks confirmed that a verified recovery sender can be saved and survives a
reload, unauthorized and foreign-origin updates are rejected, and invalid
updates leave the saved sender unchanged. Reset emails from both Profile and
the signed-out forgot-password flow arrived from the saved sender; the emailed
link opened the password reset form.

Staging uses the SES sandbox, so its owner recipient identity also needed
verification in the staging account and Region before delivery succeeded.
The owner confirmed completing the live password reset and signing in afterward.
Password change, reset, single-use links and session invalidation also have
automated local coverage below. Live password submission was performed by the
owner; token replay and session invalidation were not independently established
in staging.

## Production verification

The production deployment preserved the existing custom hostname and certificate.
Contract freshness, type checking, all 635 unit tests, SDK/web builds and
infrastructure checks passed before deployment. Authenticated smoke checks then
passed for the frontend, API health, secure owner login, admin reads, SES status,
anonymous access denial and logout.

The live Profile → Security page renders its password form and verified-domain
selector. The owner-only recovery endpoint returns uncached settings and rejects
anonymous access. Production retains its deployment sender; no production
password change, recovery-sender update or reset-email send was performed during
this rollout. Those mutation flows were covered by local and staging verification
above. Public REST, SDK and MCP account-security exclusions remain unchanged.

## Local verification

With DynamoDB Local, Mailpit and ElasticMQ running (`docker compose up -d`):

```sh
pnpm contracts:generate
pnpm contracts:verify
pnpm check
pnpm exec vitest run --project integration tests/integration/recovery-sender.test.ts tests/integration/auth.test.ts
pnpm test:profile
pnpm test:mcp
```

`pnpm test:profile` requires ports 5173 and 3001 to be free. It creates disposable
owner credentials and separate tables, tests desktop/mobile UI and actual Mailpit
reset delivery, then removes its tables and credentials. Screenshots are saved
under `.local/profile-desktop.png` and `.local/profile-mobile.png`. The password
mutation browser test is skipped by ordinary `pnpm test:e2e` runs without an
explicit isolated owner fixture.
