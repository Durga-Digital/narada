# Publication pages and editorial collections plan

Status: implemented and validated locally, 25 October 2026. Not deployed or published. It builds on the locally implemented branding v2 work described in [Publication branding v2](PUBLICATION-BRANDING-V2.md).

Give each publication a complete reader-facing home: an About page, ordered navigation, named collections of issues, and a curated homepage. Keep the existing fixed layouts and publication-wide subscription behavior. Dashboard, REST, SDK and OAuth MCP ship together for every applicable operation.

## Product scope

### About page

One optional About page per publication at `/n/:slug/about`, or `/about` on its custom domain. Use the existing structured rich-text editor and safe web renderer for headings, paragraphs, lists, links, quotes and supported images. No raw HTML, CSS or scripts. Reuse the existing hosted image library and content limits; uploads through publication assets also work. The service validates that each referenced image exists in this environment. Uploading an asset still makes that asset public immediately.

The editor includes title, body, saved/published state, preview, Publish changes and Unpublish. Saving a draft does not change the public page. Publishing creates an immutable public snapshot; subsequent edits remain private until published again. Unpublishing hides the page and its navigation entry while preserving the draft. Empty or never-published pages return 404. No email is sent by any About operation.

Reuse the shared publication header, branding, footer, canonical URLs and signup component. On archived publications, preserve the existing public-read policy and disable signup consistently. Preview is authenticated, private, no-store and noindex, with submission disabled. About is the only static page in this release; generic custom pages can follow later.

### Navigation

Configure one ordered navigation shared by home, archive, issues, About, collection pages and signup. Allow up to eight items: built-in Home, Archive, About and Subscribe destinations, a collection reference, or an external HTTPS link. Each item has a bounded plain-text label. The publication wordmark always links home, and a primary Subscribe action remains available while signup is enabled.

Store internal targets as typed references, never installation-specific URLs. Resolve them through `PublicSiteContext` so default and custom-domain paths work identically. Reject executable URL schemes, credentials in URLs, control characters, duplicate internal destinations and foreign publication references. External links are not fetched server-side. Mobile uses an accessible expandable navigation menu with keyboard and focus handling.

Missing or unpublished About targets and archived collections are omitted from public navigation. The dashboard explains why a saved item is hidden. Invalid targets are rejected when publishing a new navigation configuration. Existing publications without site settings keep Home/Archive and their current Subscribe action.

### Editorial collections

A collection is a named group of issues, such as Deep Dives, The Pulse or Announcements. Each has an ID, publication ID, name, stable slug, plain-text description, active/archived state and revision. Start with at most 20 active collections per publication and at most five collection assignments per issue. No nested collections, independent branding, per-collection subscriber lists or per-collection sending controls.

Public routes are `/n/:slug/c/:collectionSlug` and `/c/:collectionSlug` on a custom domain. Each renders the collection introduction and a paginated, newest-first list of public issues using existing cards. Empty active collections show an honest empty state. Collection slugs are immutable after creation and reserved after archive, avoiding ambiguous old links. Archived collection pages return 404; archiving never deletes or withdraws issues.

Collection creation and metadata edits take effect immediately, with clear save labels in the dashboard. Archiving requires confirmation and removes the collection from public navigation and homepage rows at render time. Restore and slug changes are deferred; there is no destructive collection deletion in v1.

Issue assignments are separate editorial metadata, changed through an explicit revision-checked operation. They may be saved for drafts, but a public collection only exposes issues with a current public web version. Assigning or removing an already-public issue changes discovery immediately without publishing its draft or sending email. Email-only, scheduled-but-unreleased, withdrawn and deleted issues never appear. Displayed titles, covers, excerpts and dates always come from the public version, not the current draft.

### Homepage curation

Keep the letter, feature and grid layouts introduced by branding v2. Add an optional featured issue and up to three ordered collection rows, each displaying up to four newest public issues with a View all link. Keep the existing recent-issues area and signup section; the layout preset determines their placement. Each issue appears once within a row; intentional repetition across collections and the recent-issues area is allowed.

Only a currently public issue from the same publication can be selected as featured. Without a valid selection, fall back to the newest public issue. Withdrawn/deleted featured issues disappear immediately, including when an index is stale. Empty or archived collection rows are omitted. Hide the latest issue's duplicate card in the recent-issues area when it is featured there.

Navigation and curation share one site-settings draft, preview and publish action so users can review the complete change together. This snapshot is independent of branding v2, whose current immediate-save behavior remains unchanged. Preview shows current branding plus the proposed site settings and only public issue versions. State that boundary clearly in the dashboard.

## Dashboard experience

Keep Issues, Subscribers and Settings. Add a Website area with Appearance, About, Navigation and Homepage panels, and a Collections area for editorial management. Appearance contains the existing branding editor. Avoid exposing another flat row of unrelated buttons.

The issue editor gains a Collections picker with immediate editorial-save feedback, separate from Save issue and publish controls. The issue list gains a collection filter alongside existing status filters. Collection management shows its description and a paginated issue list; archive confirmation explains that articles remain published. Users may manage collections before any issue is published.

About and site editors show unsaved, saved draft and live states, with explicit preview and publication actions. Show revision conflicts without discarding edits. Confirmation messages distinguish public website updates from email delivery. Preserve all current draft deletion, sending, scheduling, approval and recovery behavior.

## Shared model and implementation

- Define external DTOs, typed inputs, operation IDs, HTTP bindings, effects and scopes in `packages/contracts/src`. Keep draft management DTOs separate from anonymous reader DTOs.
- Add dedicated About and site-settings records with their own revisions and immutable published versions. Do not inflate or overwrite the existing publication settings or branding object. Collections and issue classification have independent revisions as well. Classification metadata is stored on the issue record and also advances the issue revision, allowing issue lifecycle and classification writes to serialize in one transaction without a second record lock.
- Implement About, site-settings and collection services in `packages/core/src`, invoked through the existing shared authorized execution boundary. Extend `PublicationPages` and the safe renderer for public pages; use `sitePath` for every internal link and canonical route.
- Store collection memberships as publication-scoped edges with bounded per-issue assignments. Maintain a collection/publication-time query index on classification and issue web publication transitions. Query pages rather than scanning all issues. Recheck parent, collection, membership and issue records before projection so stale index rows cannot leak drafts, removed assignments or withdrawn content.
- Bind classification changes to the current classification revision and a transaction condition on the issue revision. Bind public-index changes to the current issue version. Collection activation/archive revisions must be guarded for concurrent mutations. Races between classification, publish, withdrawal, deletion and collection archive must have deterministic outcomes and be covered by integration tests.
- Preserve existing list limits and opaque parent/filter-bound cursors. An empty page with a continuation cursor remains valid. Bound homepage queries; continue through stale entries within the scan budget, then show fewer cards rather than doing unbounded reads.
- Include new operations in activity/status and receipt recovery. Every mutation must atomically commit state and its receipt under the existing coordinator. Reauthorize current and historical resources before replay; publishing an About/site draft must replay the originally published version rather than publish newer changes.

## API SDK and MCP contracts

The following bindings are proposed. All paths below are relative to `/api/v1/publications/:id`. Read and mutation responses are typed DTOs; mutations return the resulting record/revision or publication result, never internal storage rows. Creation returns 201; other successful operations return 200. New read operations have effect `read` and no mutation key; mutations have effect `write` and support the existing REST/SDK operation key, required for OAuth MCP mutations.

| Canonical operation                | HTTP binding                              | SDK method under `publications`                   |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `publications.about.get`           | GET `/about`                              | `about.get`                                       |
| `publications.about.update`        | PUT `/about`                              | `about.update`                                    |
| `publications.about.preview`       | POST `/about/preview`                     | `about.preview`                                   |
| `publications.about.publish`       | POST `/about/publish`                     | `about.publish`                                   |
| `publications.about.withdraw`      | POST `/about/withdraw`                    | `about.withdraw`                                  |
| `publications.site.get`            | GET `/site`                               | `site.get`                                        |
| `publications.site.update`         | PUT `/site`                               | `site.update`                                     |
| `publications.site.preview`        | POST `/site/preview`                      | `site.preview`                                    |
| `publications.site.publish`        | POST `/site/publish`                      | `site.publish`                                    |
| `publications.collections.list`    | GET `/collections`                        | `collections.list`                                |
| `publications.collections.create`  | POST `/collections`                       | `collections.create`                              |
| `publications.collections.get`     | GET `/collections/:collectionId`          | `collections.get`                                 |
| `publications.collections.update`  | PUT `/collections/:collectionId`          | `collections.update`                              |
| `publications.collections.archive` | POST `/collections/:collectionId/archive` | `collections.archive`                             |
| `issues.collections.get`           | GET `/issues/:issueId/collections`        | Existing `issues` namespace: `collections.get`    |
| `issues.collections.update`        | PUT `/issues/:issueId/collections`        | Existing `issues` namespace: `collections.update` |

Extend `issues.list` with an optional `collectionId`, combined with existing status filters. Do not change the shape or semantics of old calls. `issues.collections.update` replaces the bounded assignment set and requires both classification and issue revisions. This separate operation avoids granting editorial permissions to existing issue-write keys. Creation endpoints use caller operation keys for deduplication; update/publish/archive/withdraw operations require the relevant current revision. First creation of singleton drafts uses a documented initial revision of zero.

Management reads use existing `narada:publications:read`; issue classification reads and filtered issue lists retain `narada:issues:read`. Introduce `narada:publications:site:write` for About/site drafts, `narada:publications:site:publish` for making those snapshots public or withdrawing About, and `narada:publications:collections:write` for collection and classification mutations. Classification updates additionally require issue read access. Existing branding scopes remain unchanged. Legacy keys and OAuth grants receive none of the new scopes automatically.

Preview inputs accept an optional unsaved draft plus the base revision; they never persist, subscribe or send. The read scope is required, all linked references are authorized, and previews return the established safe HTML preview envelope. Use the shared publication restrictions and sender-domain restrictions on every new operation, including linked collections, issue references, assets and historical receipts. Discovery must accurately communicate that collection edits/classification changes affect the public website immediately.

Expose every new operation through OAuth MCP with generated input/output schemas and conventional underscore tool names. Specify read-only/destructive/idempotency annotations accurately: collection archive and About withdrawal remove public visibility; preview never changes state. These website-only operations have no email-send effect or email approval flow. They must not bypass approval rules for existing issue publication or sending operations.

Add explicitly typed SDK calls to `tests/contracts/sdk-bindings.ts`, SDK examples for creating a collection and publishing site settings, and MCP instructions for permissions, preview, publish and lost-response recovery. No new machine-client exclusions are intended. Anonymous reader routes return only live content and contain no drafts, subscription records, internal references or receipt data.

## Compatibility and delivery

1. Complete and validate the existing branding v2 changes as the baseline. Keep their implementation/release status explicit; this plan does not authorize deployment.
2. Build canonical contracts, storage and shared operations with authorization, revision and replay tests. Add SDK/MCP support in the same change as each operation.
3. Add About and the shared navigation renderer, including custom-domain paths and unpublished/archived fallback behavior.
4. Add collection management, classification and paginated public collection pages. Integrate issue status filters and existing issue lifecycle transitions.
5. Add curation, combined site preview/publish and dashboard polish. Run the complete local flow before preparing a release.

All new data is additive. Missing singleton records derive current defaults. Existing issue/publication payloads continue to work without the new fields, and no collection backfill or subscriber migration is required. Preserve existing issue URLs, public-domain routing, branding revisions and email HTML. A later rollback must retain new records rather than destructively remove them. Before any deployment, verify that the previous release can safely ignore these additive records and rehearse a return to that release in staging.

## Acceptance and verification

- About: save/preview/publish/edit/republish/withdraw; unpublished edits never leak; link and image validation; empty state; revision conflicts and replay of the exact original snapshot.
- Navigation: ordered items across all page types; keyboard/mobile operation; external URL validation; custom-domain and installation paths; hidden About and archived collection targets; no cross-publication references.
- Collections: create/edit/archive, same-publication assignment and removal, multiple collections, pagination, intersecting status filters, stable slug reservations, immediate changes for published issues and privacy for every non-public issue state.
- Curation: featured selection/fallback, collection order, card limits, empty rows, no draft cover/title leakage, independent branding behavior and atomic site publication.
- Authorization: scope denial, legacy-grant ceilings, restricted publication/sender access, cross-publication assets/issues/collections, changed permissions during receipt replay, and no anonymous access to drafts/previews.
- Concurrency: simultaneous classification/publication, withdrawal, draft deletion, archive and site publish; stale indexes; retry after lost response; activity receipts matching committed state.
- Existing flows: signup and confirmation, consent, unsubscribe, scheduling, sending approvals, email delivery, corrections, branding, draft deletion and custom-domain routing remain intact. Collection changes must create no audience/topic/subscription/broadcast mutations.
- Run `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm contracts:verify`, `pnpm check`, `pnpm test:mcp` and `pnpm sdk:check`, plus relevant integration and browser tests on isolated local fixtures. Verify the full reader journey at desktop/mobile widths and on both route styles. Do not substitute production mutations for local tests.

## Explicitly deferred

Separate subscription preferences, section-specific sends, extra audiences/topics, subscriber migration, paid tiers, generic custom pages, nested menus/collections, arbitrary uploaded HTML/CSS/JavaScript and a drag-and-drop website builder. Collections in this release organize discovery only; the signup UI must not imply that readers can select individual email streams.

## Completed validation

Implemented across the dashboard, public pages, canonical REST operations, Node SDK and OAuth MCP. The custom-domain gateway now permits About and collection paths and preserves reader indexing headers from its nested router. No infrastructure resources or separate subscription preferences were added.

Completed `pnpm contracts:generate`, `pnpm contracts:verify` (558 contract/transport checks and SDK packaging checks), `pnpm check` (806 unit tests, type checks and SDK/frontend builds), 87 integration tests across newsletter/site/branding/domain/MCP suites including `pnpm test:mcp`, and five browser journeys. Browser coverage includes draft privacy, collection assignment/archive, curation, mobile navigation and the existing signup/confirmation/send/correction/unsubscribe lifecycle. The authenticated custom-domain gateway is covered using local provider/DNS fixtures; no real DNS or production mutations were performed.

Reviewed desktop/mobile screenshots, checked source formatting and `git diff --check`. Generated artifacts use the contract generator's deterministic serialization and pass `contracts:check`. The frontend retains its existing large-chunk build warnings. Initial browser checks caught a duplicate About heading and expectations needing updates for Website/Collections tabs and the mobile menu; corrected reruns pass. Integration checks also cover the 20-collection concurrency cap, stale membership candidates, scheduled release, archived/withdrawn preview fallbacks and revoked permissions during replay.

No new SDK/MCP transport exclusions. Classification metadata is intentionally stored on the issue with its own classification revision, advancing the issue revision to serialize with content mutations. About uses the existing hosted media library, whose uploads are public immediately. This records local implementation availability only; commit, deployment and SDK publication remain separate steps.
