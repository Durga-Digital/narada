# Custom publication subdomains plan

> Historical scope and acceptance record. Dated status statements describe that increment, not current hosted or npm availability. For current source behavior, start with [publication domain operator guide](PUBLICATION-DOMAINS.md).

Status: implemented locally on 24 October 2026. See [implementation and operator guide](PUBLICATION-DOMAINS.md) for behavior, verification and release gates. No real DNS, certificate, CloudFront or deployment changes have been made for this feature.

Let a publication use an address such as `https://news.example.com` for its existing branded homepage, archive, articles and signup pages. Suggest subdomains of Narada's verified sending identities first, while requiring fresh proof of control of the exact website hostname. Keep the dashboard, authentication, API and MCP on the installation's existing origin.

## Scope and decisions

- One connected hostname per publication, with no wildcard or registrable apex domains in v1.
- Default to an unused subdomain under an existing verified SES domain. Also allow another owned subdomain through the same DNS ownership flow; a website domain need not become an email-sending identity.
- Provide DNS records and verification for any authoritative DNS provider, including Route 53. Users publish the records at their provider. Narada provisions and maintains the certificate and CloudFront resources.
- Use a dedicated standard CloudFront distribution and exact-hostname ACM certificate per connection for Narada's current single-owner, small-publication model. Do not add publication aliases to the dashboard distribution.
- Keep the original `/n/:slug` URLs working as a fallback. Saving domain configuration does not activate a publication, publish an issue or send email.
- Include dashboard, REST, SDK and MCP management together, with durable asynchronous provisioning and recovery.

Defer automatic Route 53 writes, DNS-provider OAuth, apex domains, wildcard certificates, imported certificates, multiple aliases, zero-downtime hostname replacement and custom email tracking domains. Domain replacement in v1 uses disconnect and cleanup followed by a new setup; the default publication URL remains available throughout. Branding and the fixed layout remain the website experience.

## Existing foundations and prerequisites

`transport.ts` stores SES `VerifiedForSendingStatus`, DKIM records and a verification timestamp. This is sending eligibility, not website ownership or HTTPS readiness. Existing `domains.list/get/refresh` operations provide scoped diagnostics. Reuse those contracts and the DNS zone/full-name/short-name presentation described in [domain authentication](DOMAIN-AUTHENTICATION.md).

The existing CloudFront distribution serves the dashboard, API, OAuth, media and `/n/*`. Its optional certificate is configured at deployment, and API origin requests deliberately exclude the viewer Host header. See [the dashboard custom-domain guide](CUSTOM-DOMAIN.md). A standard CloudFront distribution has one attached certificate; making it cover every publication would couple publication changes to the dashboard certificate. [AWS alternate-domain requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html)

Public rendering and signup currently derive their origin from `BETTER_AUTH_URL`, and several links embed `/n/:slug`. Introduce a shared public-site URL context before adding hostname routing. Do not change `BETTER_AUTH_URL`, owner-session cookies, OAuth redirect origins or the SDK base URL when connecting a publication.

First integrate branding commit `5a30a3f` with the current shared operations, Activity/recovery and contract CI work. Its isolated release branch is not a replacement for that newer baseline. Preserve all existing functionality and the full catalog coverage gate while resolving integration conflicts.

## Domain selection and ownership

Show a **Domain** tab alongside the publication's existing tabs. Begin with **Use your default address** and **Connect a custom subdomain**.

The suggested flow is `news` plus a permitted verified domain. For `example.com`, suggest `news.example.com`; an identity verified only as `mail.example.com` permits suggesting `news.mail.example.com`, not assuming control of its parent. Match DNS labels, never plain string suffixes. Show the sending-verification timestamp and distinguish a stale snapshot from a current result. Refresh through the existing permissioned operation when requested; lack of refresh permission must not block manual website proof.

Reuse the existing paginated `domains.list` for the selector. It requires `narada:domains:read`, preserves existing resource filtering, and never reveals domains outside a grant. A client without that access can provide an exact hostname without enumerating sending identities. Do not introduce a privileged domain-list endpoint for this screen.

Normalize hostnames to lowercase ASCII using a vetted IDNA/public-suffix implementation; display normalized values before submission. Strip only an optional final dot. Reject URLs, paths, ports, credentials, IP addresses, wildcards, public suffixes, registrable apexes, empty/invalid labels and overlong names. Reject installation/dashboard/API/media hostnames and known SES MAIL FROM hostnames. Do not select an existing email-receiving hostname. Detect conflicting CNAME, A/AAAA or MX records and explain the conflict rather than instructing the user to overwrite a working service.

Every connection, including a suggested verified-domain child, gets a fresh random, publication/environment-specific TXT challenge at `_narada.<hostname>`. Reserve the normalized hostname transactionally before provisioning. A hostname cannot belong to two publications in the same installation. Reconnection or reassignment requires a new challenge; old receipts, an old SES verification, and stale TXT values cannot authorize a new binding. DNS timeouts and SERVFAIL are unknown outcomes, not evidence of absence or loss of ownership.

## DNS and HTTPS setup

The screen presents a step-by-step checklist with record purpose, type, full name, provider-friendly short name, exact value and observed state. The provider is editable guidance, not a requirement to move nameservers.

| Record        | Example name               | Purpose and retention                                                                               |
| ------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| Narada TXT    | `_narada.news.example.com` | Fresh connection ownership; retain while connected.                                                 |
| ACM CNAME     | Exact name returned by ACM | Certificate issuance and renewal; retain while the certificate is in use.                           |
| Website CNAME | `news.example.com`         | Routes to this connection's exact CloudFront hostname; keep DNS-only, without an extra proxy in v1. |

The workflow is:

1. **Configure:** validate and reserve the hostname, return the TXT challenge, and persist a provisioning job. This is acceptance, not a live site.
2. **Prove ownership:** a bounded background DNS check observes the current challenge. Only then request an exact-hostname, DNS-validated ACM certificate in `us-east-1` and display its validation record.
3. **Issue HTTPS certificate:** poll ACM asynchronously. Surface actionable errors such as restrictive CAA, incorrect validation records, timeouts and provider limits. Do not invent an issuance ETA.
4. **Prepare routing:** once ACM reports `ISSUED`, create the publication distribution and wait for its deployment. Display its website CNAME target as soon as it is known.
5. **Verify readiness:** require the ownership TXT, correct public DNS target, deployed distribution, matching valid certificate, and a successful HTTPS probe of a narrow site-verification endpoint. DNS equality alone is not readiness.
6. **Activate:** the user or authorized machine client explicitly activates the ready connection. Recheck readiness before enabling the public mapping. Update share links and public canonical metadata only after activation completes.

ACM certificates for CloudFront must be in `us-east-1`. Keep validation records so an in-use certificate remains eligible for automatic renewal. Narada must monitor renewal/expiry and report failures rather than treating initial issuance as permanent success. [CloudFront certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html), [ACM DNS validation and renewal](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html)

Manual DNS publication is the v1 boundary for all clients. There is no Route 53 write capability in the dashboard, REST, SDK or MCP. The complete record set and next actions are available through every Narada management interface; another authorized DNS tool can publish them. A later Route 53 integration should use explicit hosted-zone access and record-level change review, not infer write permission from SES verification.

## Provisioning and infrastructure

Introduce `PublicationDomains` for lifecycle/domain rules, a DNS resolver interface, and a `PublicationDomainProvider` AWS adapter. Use fake adapters for local tests. CDK owns a public-site gateway/Lambda, worker permissions, recovery scheduling, alarms and routing templates. Runtime provisioning owns the tagged per-connection distributions and certificates, whose identifiers and template version are persisted in the application table. Deployments must not recreate those resources or overwrite their configuration from a stale CDK snapshot.

The dedicated public-site Lambda reuses core publication services and public reader handlers. It exposes only homepage, archive, article, signup, confirmation and the limited verification endpoint; it does not mount owner, REST v1 or OAuth handlers. Give its role only the storage/queue capabilities those reader flows need. It shares the existing publication data and immutable media storage.

For each distribution, use HTTPS to the fixed API Gateway origin, uncached dynamic reader responses and a minimum TLS 1.2 viewer policy. Preserve methods and bodies for native signup POSTs. Redirect HTTP GET/HEAD to HTTPS and reject insecure mutations. Keep media on its existing stable origin in v1; configure the public-page CSP to allow that exact trusted media origin along with the existing supported video/image sources.

Authenticate the distribution-to-origin route using a per-binding secret custom origin header and a fixed binding identifier. A viewer-request function overwrites the forwarded public-host header from the actual viewer Host. The gateway checks the secret, binding, expected hostname and lifecycle state; it never trusts arbitrary Host or X-Forwarded-Host values. Requests to the raw API Gateway endpoint, an unrelated distribution or the default distribution hostname must not select a publication. CloudFront overwrites viewer-supplied values for configured custom origin headers. [AWS custom origin headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html)

Keep origin secrets, AWS identifiers and provider internals out of public DTOs, previews and logs. Preserve query strings needed by existing public flows, while preventing subscriber tokens from entering access logs, analytics or cached responses. HTTPS readiness probes accept only the stored hostname and fixed verification path, validate certificates, do not follow redirects, reject private/reserved IPv4 and IPv6 destinations, and guard against DNS rebinding. A pre-activation probe returns only a bounded challenge response, never draft publication content.

Provisioning is a durable state machine driven by the existing queue/dispatcher recovery pattern. Do not wait for DNS or CloudFront in an HTTP request or Lambda invocation. Use leases, conditional state transitions, exponential backoff, bounded attempts and `nextCheckAt`. Configure a small per-installation connection cap and creation rate limit, with an operator-controlled override; document provider quotas and resource costs before enabling the feature.

Record provider intent before creation. Use stable CloudFront caller references and ACM idempotency tokens derived from the connection generation. Persist discovered provider IDs and reconcile tagged resources after lost responses; ACM's token window must not be treated as indefinite deduplication. Use provider ETags for updates. A retry must not create a second distribution or certificate. Unknown outcomes stay reconcilable, with an operator-visible orphan inventory, rather than triggering blind recreation.

Tag resources with application, environment and connection ID. Separate staging and production accounts/configuration, certificates, challenges and resource reservations. Scope IAM to managed resources wherever the API supports it; document unavoidable create/list wildcards and enforce account, region, ownership tags and stored IDs in the adapter. The provider cannot modify the dashboard distribution or unrelated certificates. Define secret rotation and resource retention/cleanup behavior before staging deployment.

## Routing and compatibility

Introduce a validated `PublicSiteContext` containing publication ID, public origin and path prefix. The default route uses the installation origin plus `/n/:slug`; the custom route uses `https://<hostname>` with an empty prefix. Pure renderers, canonical/Open Graph metadata, navigation, form actions and issue links must consume that context. Do not perform string replacement over rendered HTML.

| Reader page  | Default URL path        | Custom hostname path |
| ------------ | ----------------------- | -------------------- |
| Homepage     | `/n/:slug`              | `/`                  |
| Archive      | `/n/:slug/archive`      | `/archive`           |
| Article      | `/n/:slug/p/:issueSlug` | `/p/:issueSlug`      |
| Signup       | `/n/:slug/subscribe`    | `/subscribe`         |
| Confirmation | `/n/:slug/confirm`      | `/confirm`           |

Original URLs remain directly usable, including while the custom connection is pending, degraded or disconnected. Do not add automatic redirects from the fallback URL in v1. Ordinary public pages use the active healthy custom URL as canonical; otherwise they use the default URL. Token-bearing, confirmation and preference pages retain noindex/no-store behavior.

Preserve existing double opt-in, submission/version IDs, honeypot, rate limits, prior opt-outs and confirmation-to-publication binding. POST origin checks compare against the server-resolved site context, preserving the narrowly supported same-origin native-form behavior. Rate limits aggregate by publication across both hosts rather than granting an extra allowance per alias. Unknown or mismatched hosts fail closed.

Keep new confirmation emails, unsubscribe/preferences links and immutable media URLs on the stable installation origin for this increment. These links must survive a domain disconnect or transfer. Make the preferences link from a custom-host confirmation page explicitly point to that stable origin. Do not rewrite existing drafts, scheduled/sent email snapshots, stored issue HTML or signed tokens. If stored content contains relative links, resolve them at render time against the historical default article URL, preserving fragment-only anchors, rather than silently rebasing them to the custom host. Test that normalization against existing content and allowlisted media.

Preserve existing REST/SDK relative URL fields; add a separate optional absolute `publicUrl` where needed instead of changing their meaning. The domain-management response provides both default and preferred URLs. Dashboard previews remain private and on the authenticated installation origin; opening a custom domain never carries owner credentials. Draft publications still return 404 publicly, archived publications retain their archive without signup, and private/scheduled/withdrawn issues remain excluded.

## State and ongoing maintenance

Use a separate domain connection record and revision, leaving existing publication settings/branding contracts intact. Suggested states are `awaiting_ownership`, `awaiting_certificate`, `provisioning`, `awaiting_dns`, `ready`, `active`, `degraded`, `suspended`, `disconnecting`, `disconnected` and `failed`. Store the desired state separately from provider observations so recovery can resume the user's intent. Worker observation updates must not cause endless revision conflicts: use a configuration revision for client mutations and an internal observation version for worker writes. Preserve the configuration revision across reconnects while changing the generation and ownership challenge; an old revision or receipt cannot address the new generation.

The management DTO includes the connection/publication IDs, normalized hostname, configuration revision, state, DNS records with purpose and observed status, certificate status/expiry, routing status, last/next check times, safe actionable error, and default/preferred URLs. It excludes AWS credentials, origin secrets, raw provider errors and unrelated domain metadata. The authenticated read returns `domain: null` when never configured, not a missing-publication error.

Maintain a hostname reservation and connection-generation identifier atomically with the accepted job/receipt. Domain mutations guard the current publication and configuration revision. Settings edits, archival, activation and provisioning races must not resurrect a disconnected generation or apply a hostname to the wrong publication. Domain jobs must respect current publication visibility even if already accepted. Revoking a client prevents new actions, discovery and receipt/status disclosure; it does not implicitly cancel accepted infrastructure work. Use the explicit disconnect operation to stop it.

Run bounded periodic checks for DNS ownership/routing, distribution state and certificate expiry/renewal. A transient DNS/provider error marks a diagnostic as unknown and preserves the last known result. Repeated authoritative loss of ownership or an invalid certificate suspends the custom mapping and restores default preferred links; confirmed routing failures mark it degraded. Finalize polling intervals, TTL-aware negative-confirmation thresholds and notification limits in the adapter spike. Show degraded/renewal states in the dashboard and operation status, and emit the established activity/operational signals without exposing token-bearing URLs.

Disconnect first removes the preferred/public mapping transactionally so new share links immediately fall back. Then disable the distribution, wait for deployment, and clean up the dedicated resources. Keep a disabled reserved distribution while DNS still points to it; show the website CNAME removal as a pending user action. Do not release the hostname reservation or delete the distribution until safe detachment is confirmed. Delete a dedicated certificate only when unused, and never remove user DNS records automatically. Preserve audit/status history. An interrupted cleanup resumes after restart. Default pages and already sent confirmation/unsubscribe links remain usable.

## Canonical API SDK and MCP contracts

Add the dedicated scope `narada:publications:domains:write`. Existing publication read covers management status. Existing publication/branding write scopes and legacy full keys do not acquire provisioning or disconnection powers. Domain writes can allocate AWS resources and change the publication's public address; say this in consent labels and tool descriptions.

The proposed singleton resource uses `/api/v1/publications/:id/domain` and `narada.publications.domain`. Define exact bounded schemas, operation IDs, permissions, effects and HTTP bindings in `packages/contracts/src` before implementation.

| Operation ID                     | HTTP binding                                     | SDK method                                           | Permission and effect                                                   |
| -------------------------------- | ------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `publications.domain.get`        | `GET /publications/:id/domain` → 200             | `publications.domain.get(id)`                        | Publication read; side-effect-free read.                                |
| `publications.domain.configure`  | `PUT /publications/:id/domain` → 202             | `publications.domain.configure(id, input, options)`  | Domain write; reserves hostname and starts setup.                       |
| `publications.domain.check`      | `POST /publications/:id/domain/check` → 202      | `publications.domain.check(id, input, options)`      | Domain write; queues a rate-limited persisted diagnostic/recovery pass. |
| `publications.domain.activate`   | `POST /publications/:id/domain/activate` → 202   | `publications.domain.activate(id, input, options)`   | Domain write; requests activation after readiness checks.               |
| `publications.domain.disconnect` | `POST /publications/:id/domain/disconnect` → 202 | `publications.domain.disconnect(id, input, options)` | Domain write; disables public mapping and starts cleanup.               |

Paths in the table omit `/api/v1`. Configure takes `{ hostname, revision }`, with revision zero for an unconfigured resource. Other mutations take `{ revision }`. Activation is explicit and cannot bypass readiness. A different hostname while an existing connection is still attached/cleaning up returns a conflict. Repeated checks coalesce rather than multiplying jobs. Reads never refresh DNS or make provider writes.

Mutations return an accepted result containing the domain snapshot and the existing operation ID/status URL convention, with `Operation-Location` and request correlation headers. HTTP 202 does not mean the website is ready. Integrate asynchronous work status with the Activity resource projection so accepted/succeeded request status remains distinct from pending/failed provisioning and cleanup. Record connection IDs, revisions and transition outcomes, not image bytes, subscriber information or secrets.

Implement through `SharedOperations` and a shared authorized domain service. Dashboard handlers, REST and MCP use the same preparation, execution and replay authorization boundary. Recheck current scopes, publication restrictions and the publication's sender restriction on reads, direct access, mutations, linked records and receipts. Sender-domain restrictions retain their existing email-sender meaning: they do not automatically grant or deny DNS control of the chosen website hostname. Fresh DNS proof authorizes that binding. A publication-limited domain writer may configure only its allowed publication; it gains neither a workspace domain inventory nor Route 53 access.

All five operations must appear in MCP discovery when permitted. Mark get read-only, describe setup/check/activation as writes, and mark disconnect destructive while explaining the default-site fallback. Require stable MCP mutation keys. REST/SDK use existing idempotency conventions and explicit `RequestOptions` keys; uncertain results are reconciled via the same key, connection read and operation status, not a new hostname/job. Error schemas distinguish invalid hostname, conflict, forbidden, stale revision, throttling, pending external action and provider failure. Lists remain bounded through existing domains and publication APIs; a singleton domain read needs no pagination.

Provide one typed binding per new operation in `tests/contracts/sdk-bindings.ts`, regenerate SDK types/OpenAPI/MCP schemas, update SDK methods/examples and MCP permission/recovery guidance. No new transport exclusions for publication-domain management. DNS-provider writes and SES identity creation keep their existing owner/operator boundary and are not prerequisites for a machine client to submit a manually specified website hostname and complete the Narada workflow.

## Delivery and verification

The implementation belongs in these areas:

| Area                                 | Planned changes                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src`             | Domain inputs/DTOs, five operation bindings, dedicated scope, effects and MCP discovery; generated schemas remain canonical.                                 |
| `packages/core/src`                  | New domain lifecycle/provider/URL-context modules; shared-operation integration, public renderers, activity work projection and durable dispatcher recovery. |
| `apps/api/src`                       | Catalog-backed management adapters and reusable reader routes; a dedicated public-site entry point with no owner/API/OAuth mounts.                           |
| `apps/worker/src`                    | Domain provisioning/health/cleanup jobs with leases and generation checks.                                                                                   |
| `infrastructure`                     | Public-site gateway/Lambda, IAM, routing function/template, alarms, configuration outputs and DynamoDB stream filters for the new work kind.                 |
| `apps/web/src/features/newsletters`  | Domain setup/status UI and share links using the resolved preferred URL.                                                                                     |
| `packages/sdk` and `tests/contracts` | Typed domain methods, bindings, wire tests and package examples; retain complete existing SDK/MCP catalog coverage.                                          |

1. **Integration and adapter spike:** integrate the current feature baseline; prove exact-host ACM issuance, dedicated distribution creation, trusted host forwarding, secure origin access, HTTPS probes, provider replay recovery and safe deletion in an isolated AWS test environment when deployment is authorized. Confirm IAM capabilities, quotas, costs and the negative-DNS health policy before freezing the adapter design.
2. **Contracts and lifecycle:** add schemas/scopes, separate records/reservations, revision/idempotency/activity integration, provider interfaces and durable jobs. Deliver API/SDK/MCP together with tests.
3. **Public routing:** extract URL context, implement the dedicated public gateway and route guards, preserve fallback/security links and update metadata/CSP. Test both origins against the same reader flows.
4. **Dashboard:** build domain suggestions, hostname entry, DNS record copying, progress/error recovery, activation and disconnection screens. Explain resource creation and retained DNS records without exposing provider implementation details unnecessarily.
5. **Staging rehearsal and release:** after local gates pass and deployment is requested, use an explicitly chosen staging hostname to verify real DNS, ACM, CloudFront, signup, confirmation and disconnect/recovery. Promote only after that evidence; production DNS changes and SDK publication are separate requested actions.

Required tests cover:

- Hostname normalization, public suffixes, deceptive suffix matches, existing hostname conflicts, DNS delegation, short/full record names, stale SES snapshots and manual-hostname setup.
- Fresh proof on reconnect; two-publication/environment claims; concurrent configure/activate/disconnect; stale revisions; lost responses before/after provider creation; worker crashes, leases, expired receipts and cleanup recovery without duplicate resources.
- Canonical REST/SDK outputs and typed calls; MCP discovery/annotations; missing scopes, legacy grants, resource restrictions, linked-resource checks, grant reduction/revocation and replay privacy.
- Forged forwarding/origin headers, raw origin/default CloudFront access, cross-publication paths, insecure POSTs, cross-origin submissions, DNS rebinding and certificate mismatch; no dashboard/auth/API exposure through the public gateway.
- Actual custom-root navigation, archive pagination, article images/video, signup to explicit confirmation, unsubscribe/preferences, stable old email links, archived/draft/private/withdrawn visibility, fallback URLs and previews on desktop/mobile.
- Certificate pending/issuance failure/expiry/renewal; DNS unknown versus negative answers; CAA errors, alias-in-use/quota errors, removal of website/ownership/validation records, outage recovery and disabled-resource retention during cleanup.
- Infrastructure synthesis and IAM/resource-account constraints, environment separation, no dashboard-distribution mutation, no Route 53 writes, and no accidental resource deletion on ordinary deployment.

Run `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm contracts:verify`, `pnpm check`, `pnpm test:mcp`, `pnpm sdk:check`, relevant integration/browser suites and `pnpm infra:check`. Local fixtures must use isolated database, queue, mail and development-cache resources. Real DNS/TLS/CloudFront evidence is a separate staging gate; mocks cannot establish it.

Update [API](API.md), [Product API](PRODUCT-API.md), [MCP](MCP.md), [Activity](ACTIVITY.md), [Agent access](AGENT-ACCESS-PLAN.md), [SDK usage](../packages/sdk/README.md), [self-hosting](SELF-HOSTING.md) and [dashboard custom domains](CUSTOM-DOMAIN.md), clearly distinguishing publication-hosting from sending identities and dashboard hosting. Keep planned, locally implemented, deployed and SDK-published status separate.

This is a moderate infrastructure feature. A provisional planning allowance is two to three engineering weeks including recovery/security work and staging verification, subject to the adapter spike and DNS/provider turnaround. Public layout work is already covered by branding; provisioning, origin separation and lifecycle recovery are the main effort.
