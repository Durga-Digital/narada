# Agent-led project setup and Resend migration

The API and OAuth MCP are deployed to staging and production as of 24 October 2026. The SDK methods are implemented and package-checked in source; the npm package has **not been published**. The coding agent edits the consuming project's repository with its own coding tools; Narada supplies authorized setup operations and guidance.

## Workflow

1. Read `integration_guide` and `capabilities`. The same playbook is exposed as resource `narada://guides/project-integration` and prompt `migrate_from_resend`, with server instructions pointing agents to it. These require `narada:capabilities:read`.
2. Inspect existing email code, templates, auth hooks, webhooks, retries and secret-variable names. Use `resources_search` to resolve permitted names/IDs. Choose a single kind: domains, forms, publications, contacts, templates, broadcasts, segments or topics. It requires that kind's existing read scope and applies the underlying list's resource restrictions. Results are compact references. Follow `nextCursor` even after an empty page; cursors bind to the kind and search text. Ask about ambiguous matches.
3. Call `domains_create` to register a sender hostname with Narada/SES. It does not purchase a domain or change DNS. Return the exact DKIM `records` and `authentication.mailFrom.records` with type, name and value. Local mode returns simulated diagnostics and cannot validate public DNS.
4. Optionally configure a dedicated bounce subdomain with `domains_mailFrom_update`, or enable signing with `domains_dkim_enable`. Both require the current `revision`. Explain fallback behavior and preserve existing provider records, inbound MX routing and DMARC policies. The user or a separately authorized DNS integration applies the records. Refresh with `domains_refresh` after propagation; inspect account readiness with `sending_get` and `sending_diagnostics` when permitted.
5. The owner creates a **Sending key restricted to the exact From domain**, and configures it in the consuming application's server-side secret store. MCP cannot mint, retrieve or approve API keys. Never request a secret in chat, commit it, expose it in client code, or use it to bypass MCP approval. Preserve an already configured valid application key.
6. Adapt the application's transport and tests using the guide's existing SDK or HTTP examples. Preserve template rendering, auth-hook signature verification, token lifetime, receipt persistence and idempotency. Do not silently drop unsupported Resend features. Webhook payloads/signatures are provider-specific. Cutover and consumer deployment require user authorization.
7. Verify the real application outcome. A 202 means accepted, not delivered or signed in. For auth flows, validate a fresh message through callback/token verification to an established session. MCP-initiated sends still require the human approval workflow.

## Contracts and permissions

| Operation                 | REST                                                     | Scope                      |
| ------------------------- | -------------------------------------------------------- | -------------------------- |
| `domains.create`          | `POST /api/v1/domains`                                   | `narada:domains:create`    |
| `domains.mailFrom.update` | `PUT /api/v1/domains/:name/mail-from`                    | `narada:domains:configure` |
| `domains.dkim.enable`     | `POST /api/v1/domains/:name/dkim`                        | `narada:domains:configure` |
| `integration.guide`       | `GET /api/v1/integration/guide`                          | `narada:capabilities:read` |
| `resources.search`        | `GET /api/v1/resources/search?kind=domains&text=example` | Selected kind's read scope |

The new domain scopes require fresh consent or an explicitly configured operation key. Existing legacy full/sending/scoped keys and old OAuth grants do not gain administrative privileges. Exact sender-domain restrictions apply to registration and configuration; form/publication-only grants cannot administer sender domains. The consent picker selects existing domains, so registering a new domain normally requires unrestricted sender-domain access plus the explicit create scope.

All three domain mutations accept HTTP `Idempotency-Key`; MCP requires `idempotencyKey`. Reuse identical arguments/key after a lost response. Registration of an active domain returns its existing configuration unchanged. Configuration increments its revision; diagnostics refresh preserves the revision. Per-domain locks serialize setup and conditional commits prevent a stale completion from resurrecting a removed registration. If an external SES change has an uncertain outcome, inspect operation status and refresh diagnostics before preparing a replacement action; an uncertain receipt is not permission to blindly repeat work.

Domain deletion, account security, credentials and generic media administration remain owner-only. DNS-provider changes and repository edits are outside the Narada service.

## Local verification

`tests/integration/operational-api.test.ts` exercises SDK/REST setup, exact DNS records from local diagnostics, schema validation, revision conflicts, response-loss recovery, restricted search and legacy-key denials. `tests/integration/mcp-production.test.ts` exercises the local production MCP handler with real OAuth consent, resource/prompt discovery, domain setup, scope restrictions and revocation. Despite the test filename, these use isolated local fixtures. They are protocol/workflow regression tests, not a claim of a live Resend cutover or a hosted Claude/Codex migration.

## Hosted release validation — 24 October 2026

The staging and production API/MCP deployment preserves the separately deployed publication-domain release. Only the API and frontend assets changed; publication infrastructure, worker and reader assets were retained.

Both environments passed actual AWS SES registration with exact DKIM and MAIL FROM MX/SPF records, revision conflicts, lost-response replay and operation status, sender restrictions, legacy-key denials and key revocation. Claude Code and Codex passed HTTPS/CloudFront consent with all or selected scopes, onboarding guide/resource/prompt discovery, restricted search and direct access, retry recovery, in-app disconnect, refresh, live scope reduction and durable revocation after reconnect. Temporary SES identities and keys were removed/revoked, grants revoked and test drafts archived. No customer email was sent or DNS-provider records changed.

The release passed 722 unit, 478 contract and 72 integration tests, type checking, SDK packaging and the frontend build. This validates hosted setup and delegation; it does not claim a complete real-project Resend migration. The new SDK package still needs a separate npm release. Existing OAuth connections need fresh consent for the new domain setup scopes.
