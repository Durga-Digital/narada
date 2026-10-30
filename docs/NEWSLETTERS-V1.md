# Newsletter v1 plan

> Historical scope and acceptance record. Dated status statements describe that increment, not current hosted or npm availability. For current source behavior, start with [API guide](API.md), [product API](PRODUCT-API.md) and [MCP guide](MCP.md).

Status: released to production on 23 October 2026 after staging verification with real SES and CloudFront.

Narada v1 newsletters let one workspace owner operate multiple free publications. Each publication has a branded subscribe page, confirmed subscribers, issues that can be distributed by email or published on the web, and a public archive. Existing contacts, consent rules, broadcasts, queues, and SES delivery remain the foundation.

The first release is complete when an owner can create a publication, share its subscribe link, receive a confirmed signup, publish an issue to the web and that subscriber's inbox, correct the web article without sending again, and honor a later unsubscribe before the next delivery.

## Scope and defaults

- One existing owner/workspace, multiple publications, free subscriptions, no reader accounts.
- Publication setup includes name, description, stable URL slug, author/display name, accent color, sender, reply-to, organization, postal address, and optional external privacy-policy link. A verified sender is required before enabling signup confirmation or email delivery.
- Each publication owns one public subscription topic and one managed dynamic audience. Creating a publication never opts existing contacts into it.
- Issues support title, optional subtitle, email subject defaulting to the title, preheader, stable issue slug, and structured content. Use editorial blocks: paragraphs, headings, lists, quotes, links, code and dividers. Reuse the existing editor with an appropriate preset.
- Distribution choices are web and email, web only, or email only. Web and email is the default. Support publish now and scheduling within the existing 90-day horizon.
- Retain the current 1,000 eligible recipients per email send and 10,000 shared contacts per installation. Clearly block an oversized send; never silently truncate it. This release does not expand delivery capacity.
- Public URLs use the installation's existing origin, including an already-configured custom domain. No separate domain provisioning per publication.
- Defer paid subscriptions, paywalls, reader accounts, comments, discovery, recommendations, automation sequences, media uploads/hosting, custom themes, embedded signup widgets, and open/click tracking. Existing broadcast APIs keep working. Newsletter SDK endpoints were added subsequently in the [product API increment](PRODUCT-API.md).

## Owner experience

Add a **Newsletters** navigation item. Its library lists publications with status and subscriber count. Publication pages have Issues, Subscribers, and Settings views, plus links to view the site and copy its subscribe URL.

Setup creates a draft publication and its managed resources atomically. Its topic starts inactive/private, its signup form is unpublished, and its audience cannot be used for sends. It does not send mail or expose a public page. The owner previews branding and activates the publication when ready. Activation makes the managed topic public/active and publishes its signup form together with the publication state. The first release uses a text wordmark and accent color rather than requiring image storage.

The Subscribers view shows confirmed topic subscriptions separately from eligible recipients. It distinguishes topic opt-outs, global marketing opt-outs, and delivery suppressions. Link to existing contact details; reuse consent-attested imports and existing preference controls rather than inventing a parallel contact database.

An issue opens in a dedicated editor using shared message content. Provide revision-protected saving, a visible unsaved-changes indicator, web preview, email preview, and test email. Save the current revision before preview, testing, scheduling, or publishing. Test mail goes only to the supplied test address and creates no public issue.

Review shows the publication, title, sender, selected channels, public URL, eligible/excluded counts, and schedule with timezone. Distinguish accepted work, queued emails, provider acceptance and delivery. Zero eligible recipients blocks a choice that includes email; the owner can choose web only. A failed email preflight must not accidentally publish the web article.

## Subscriber experience

`/n/:publicationSlug/subscribe` is a compact branded form with required email and optional name. The button explicitly says **Subscribe to [publication]**, with clear subscription and privacy copy. Deliberately submitting this single-purpose form records the signup's affirmative consent; it is not an implicit opt-in attached to an unrelated form.

Use a managed versioned signup form and `FormService` for validation, confirmation delivery, profile synchronization, and consent evidence. Public clients cannot supply a different topic or audience. Newsletter pages adapt this existing flow to a compact layout without changing ordinary forms.

Submission returns the same neutral check-your-email response for new and existing addresses. Reuse deduplication, email/form rate limits and honeypot protection. Add publication-wide confirmation-mail limits and cooldowns; avoid contact enumeration. No contact or topic opt-in is written before email confirmation.

The confirmation link opens a branded page; GET requests and link scanners never subscribe anyone. An explicit confirmation action invokes the existing verified-signup transaction. Return **Subscribed** only when that topic subscription actually exists. Existing opt-outs remain intact; a verified reader can deliberately change preferences through a signed preference page. Suppression is not cleared by signup or resubscription. Do not mint preference links from expired or invalid confirmation tokens. Signed pages and tokens use no-store/no-referrer behavior and are excluded from search indexing.

A managed dynamic audience matches shared contacts with an email address. `SubscriptionService` then intersects it with explicit consent for this publication's topic and applicable opt-outs/suppressions. This makes a confirmed signup eligible without a separate manual membership step. Public-page views and transactional emails never grant membership or consent.

The publication owns its topic, audience and signup form definitions. Show them as managed/read-only in generic management surfaces, or hide them from editable lists. Enforce that restriction in services and APIs, not only the UI. Contact preferences and explicit subscriber-management actions remain available. V1 creates fresh resources; adopting existing topics/audiences is deferred.

## Public site and archive

| URL                                | Behavior                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `/n/:publicationSlug`              | Publication title, description, author, subscribe action and recent public issues    |
| `/n/:publicationSlug/subscribe`    | Compact signup page                                                                  |
| `/n/:publicationSlug/confirm`      | Token-bound confirmation page and explicit confirmation action                       |
| `/n/:publicationSlug/archive`      | Paginated public issues, newest first                                                |
| `/n/:publicationSlug/p/:issueSlug` | Published issue, publication identity, publication/update dates and subscribe action |

Public issue pages include a canonical URL, title/description metadata and Open Graph text metadata. Server-render the page shell and article so reading and link previews do not depend on loading the dashboard. Use cursor pagination and bounded reads. Search, RSS and dedicated social-preview images can follow later.

Only explicitly published web versions appear in the archive. Drafts, scheduled issues and email-only content return 404 to anonymous readers. Public responses use explicit field allowlists; no contact values, subscriber counts, recipient snapshots, raw private records or signed unsubscribe links are returned.

Use a dedicated allowlisted web renderer, safe URL handling and restrictive response headers. The structured issue document is canonical: derive both channel outputs from that saved document, with server validation/rendering at publication. Do not serve the editor's raw HTML as a public article. Unsupported blocks are reported before publication. Personalized contact tokens are not supported in v1 issues; ordinary broadcasts retain their current personalization feature.

Add a CloudFront `/n/*` behavior pointing to the existing API origin, plus the matching Vite proxy in local development. Do not rewrite these requests to the dashboard SPA. Start with public responses uncached, so withdrawals and corrections are immediately effective; confirmation/signup responses are always no-store. CDN caching and invalidation are a later optimization. Validate expected public traffic against the installation's existing API throttles before launch.

## Records and service ownership

Use the existing application table and indexes. New records are additive; existing broadcasts, forms and topics require no migration.

| Record                       | Owns                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication                  | ID, unique slug, branding, author/sender defaults, draft/active/archived state, managed topic/audience/form IDs, revision                                                 |
| Publication slug reservation | Atomic uniqueness and lookup; reserve published slugs permanently in v1                                                                                                   |
| Issue                        | Publication ID, unique issue slug, editable draft, revision, current public-version pointer, first publication time, optional scheduled operation and linked broadcast ID |
| Issue slug reservation       | Atomic uniqueness within its publication                                                                                                                                  |
| Issue version                | Immutable structured content, channel renderings and relevant author/sender/footer snapshots                                                                              |
| Publication operation        | Stable operation ID, issue/version reference, channels, due time, state, lease/retry data and deterministic linked broadcast ID                                           |
| Broadcast and snapshot       | Existing recipient snapshot, delivery state, opt-out enforcement, cancellation and progress                                                                               |

`PublicationService` owns setup, managed resources, slug reservation, activation and archival. `IssueService` owns drafts, immutable versions, distribution intent, corrections, withdrawal and scheduling. `SubscriptionService`, `ContactService` and `FormService` retain their established responsibilities. `BroadcastService` owns actual email expansion/delivery; `WorkDispatcher` coordinates due publication operations through the existing queue.

Expose authenticated owner routes under `/api/admin/publications` and nested issues, with revision guards, origin checks and existing mutation receipts. Public GET pages and signup/confirmation actions live under `/n/*`, with narrowly scoped public handlers. The original newsletter increment had no API-key/SDK contract; the subsequent [product API increment](PRODUCT-API.md) adds shared contracts, operation keys and resource restrictions.

Use separate public-visibility and email-delivery state. An issue can be publicly live while email delivery is queued, paused, partially failed or complete. Updating a public version never changes a launched broadcast's frozen content.

## Publishing and scheduling contract

1. Validate the saved issue revision, publication state, channels, content, sender and recipient limits. Reserve the issue slug and generate deterministic operation/broadcast identities. Freeze content, sender/footer settings and eligible recipients when the owner confirms, including scheduled sends. The UI must explain that later signups receive future issues.
2. Extract an internal broadcast-launch preparation operation used by both existing broadcast start and issue publication. It returns validated, guarded transaction writes while preserving the existing `start` contract. Commit the issue version, publication operation, linked broadcast/snapshot and mutation receipt atomically. Any preparation records outside that transaction must be isolated by operation ID and expire safely, as existing personalization snapshots do.
3. For publish now, the commit can set the public-version pointer and release email work together. For scheduled publication, keep the version private and linked broadcast held outside the normal dispatchable states. The due publication worker atomically exposes the requested web version and releases the same broadcast. Extend stream filters, job dispatch and expired-lease recovery for this operation; no per-issue cloud scheduler is needed.
4. Retries, duplicate jobs, concurrent clicks and lost HTTP responses reuse the same version/operation/broadcast. This durable uniqueness must outlive the HTTP idempotency window. Never infer that a lost response requires a new send. Existing uncertain SES submissions remain non-retriable automatically.
5. Global sending pause delays email submission; it does not take an already-public article offline. For a scheduled combined release, web publication occurs on schedule while email can remain paused or become blocked. Surface those states clearly. Scheduled jobs recheck publication state, and delivery still rechecks domain validity, topic state, opt-outs and suppression.

Cancel a pending schedule atomically with its held broadcast and return the issue to an editable state. A race already won by the publication worker reports that the issue has published; it must not report a successful cancellation. Sent or in-flight mail cannot be recalled.

Once an issue’s email work has been released, public corrections cannot request another distribution. A canceled schedule whose email work was never released may be replaced by a new explicit operation; its old job and held broadcast remain permanently canceled. Use **Duplicate issue** for an intentional new send. A previously web-only issue may be emailed once through a separate explicit review action, freezing the currently selected version. Never retry an uncertain delivery by creating a replacement broadcast.

Slugs can change while draft but become immutable after publication/scheduling. Correcting a public article creates a new immutable version at the same URL, retains the original publication date, and displays an updated date. **Withdraw from web** removes it from public pages/archive without deleting sent-email history. Retain published content independently from message-body cleanup and 30-day message metadata expiry.

Archiving a publication closes signup and prevents new sends and scheduled releases. For v1, retain its previously published archive with a clear archived notice and no signup action. Workers must honor the archived state immediately; cancellation of pending linked sends must recover after interruption. Global unsubscribe and preference links continue to function. Permanent deletion is deferred.

## Implementation sequence

1. **Publication foundation.** Add records, reservations, `PublicationService`, runtime wiring, owner routes and managed resource guards. Implement creation, settings, activation, archival and subscriber queries. Test concurrent creation, revisions, consent isolation and generic-API restrictions.
2. **Signup and minimal public pages.** Add server-rendered publication/subscribe/confirmation pages and CDN/local routing. Reuse the managed form flow. Prove that a newly confirmed signup is eligible for this publication and not another one, with all prior opt-outs preserved.
3. **Issues and safe previews.** Add `IssueService`, version storage and the dedicated editor. Implement deterministic channel renderers, web/email previews and test sends. Test malformed markup/URLs, disallowed tokens, draft privacy and immutable versions.
4. **Distribution and scheduling.** Add atomic broadcast preparation, durable publication operations and worker handling. Implement review, publish choices, held schedules, cancellation and separate delivery progress. Preserve all existing broadcast/API behavior.
5. **Archive and release hardening.** Finish archive pagination, metadata, corrections, withdrawal, archived publication behavior and failure recovery. Complete responsive/accessibility review, documentation, isolated regression suites and a staging delivery/routing rehearsal.

Each increment should be independently reviewable. Keep unfinished public functionality gated until the complete signup-to-issue flow is verified. Production deployment remains a separate explicitly initiated release.

## Acceptance and regression tests

- Create two publications; subscribing to one never consents to the other. A new confirmed subscriber requires no manual segment membership.
- A GET confirmation request performs no mutation. Invalid/expired tokens, duplicate submissions and retries cannot generate unauthorized preferences or duplicate confirmation deliveries.
- Signup racing an opt-out or profile edit remains atomic; imports and re-signups preserve existing choices. Topic/global opt-outs and suppression block email at delivery time.
- Publish to web only, email only and both. Anonymous reads expose only explicitly public versions. Zero recipients, oversized snapshots, removed senders and invalid content leave no accidentally live issue.
- Concurrent publish/schedule requests and crash recovery create one linked broadcast. Verify recovery after the request commits but before queue publication, and after a worker commits but before acknowledging its job.
- Scheduled issues remain private until due. Verify cancellation races, expired leases, sending pauses, archived publications and late unsubscriptions. Preserve uncertain-send handling.
- Correct/withdraw a public issue without changing or re-sending its email. Archive pagination excludes private versions, and retained articles survive message cleanup.
- Verify escaped text, allowlisted markup/URLs, metadata escaping, browser CSP and the absence of personal data in public DTOs, pages and logs.
- Browser coverage: publication setup → public signup → confirmation → issue composition/test → combined publish → archive → correction → unsubscribe → excluded next send. Include mobile and keyboard operation.
- Run existing type/unit/build, integration, browser and infrastructure checks against isolated local services. Confirm real CDN routing, public metadata and SES delivery in staging before the manual production release.

## Local verification and release

The newsletter regression suites are `tests/unit/newsletters.test.ts`, `tests/integration/newsletters.test.ts`, and `tests/e2e/newsletters.test.ts`. Existing checks remain required: `pnpm check`, `pnpm test:integration`, `pnpm test:e2e`, and `pnpm infra:check`. For isolated integration mail capture, set `MAILPIT_URL` together with `SMTP_PORT`, `DYNAMODB_ENDPOINT` and `SQS_ENDPOINT`.

Before production release, deploy to staging and verify real SES delivery, unsubscribe headers, public `/n/*` routing, sharing metadata, scheduled releases and a withdrawal. Check public traffic against API Gateway throttles. No production infrastructure or remote email configuration is changed by local implementation or tests.

The 23 October 2026 staging rehearsal passed signup and explicit confirmation, test sending, immediate and scheduled distribution, idempotent publish retries, duplicate-send rejection, public archive and metadata, web correction, withdrawal, schedule cancellation, unsubscribe exclusion, and publication archival. Four controlled emails received SES delivery events with one send attempt each. The received newsletter passed Gmail SPF, DKIM and DMARC checks and included both one-click unsubscribe headers. The deployed dashboard/editor loaded without browser errors; worker logs and dead-letter queues were clear. A small public-request sample passed under the configured API limits; this was not a load test. The test reader was unsubscribed and the test publication archived. Operator evidence and the deployed asset manifest are retained locally under `.local/newsletter-staging-*`; no production deployment was performed.

The subsequent authorized production release on 23 October 2026 used the same application asset hashes as the staging rehearsal. CloudFormation completed and CloudFront finished propagation. Production frontend/editor assets, owner authentication, existing administration flows, newsletter GET/POST routing and origin checks passed. SES production access and sending were enabled and healthy; both dead-letter queues were empty. Production verification sent no emails and created no test publications. Release evidence is retained locally under `.local/newsletter-production-*`.

## Public branding increment

The [publication branding increment](PUBLICATION-BRANDING-V1.md) is implemented locally with a Branding tab, publication-scoped logo uploads, Classic/Editorial/Minimal themes, and a fixed introduction/signup/latest/recent-issues homepage. The archive and existing article URLs remain; branding also applies to publication signup/confirmation pages. Preview and save are distinct, old settings clients preserve branding, and email snapshots are unchanged. REST, SDK and OAuth MCP are included. This increment has not been deployed or published as an SDK release.
