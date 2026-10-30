# Publication branding and public homepage plan

> Historical scope and acceptance record. Dated status statements describe that increment, not current hosted or npm availability. For current source behavior, start with [branding v2](PUBLICATION-BRANDING-V2.md) and [publication site operations](MCP.md#publication-site-operations).

Status: implemented locally on 24 October 2026. Not deployed; SDK package not published. The sections below retain the implementation scope and acceptance contract.

Give each publication a recognizable public identity using a logo, three curated themes, and one fixed homepage layout. Build on the existing publication, archive, signup flow, and environment-specific media storage. Keep custom domains and a general website editor outside this increment.

## Product scope

- One logo per publication, with upload, replacement, removal, and a publication-name fallback.
- Three themes: **Classic** (warm paper and serif headings), **Editorial** (white background and stronger serif typography), and **Minimal** (neutral background and sans-serif typography). All use the same content order and layout; they are visual presets, not independently maintained templates.
- Reuse the existing publication name, description, author, and accent color. Add optional plain-text welcome copy, at most 1,000 characters, with paragraph breaks. No separate site title or duplicate description field.
- A fixed homepage at the existing `/n/:slug` URL. Preserve article, archive, signup, confirmation, and preference links.
- Apply the shared public identity to homepage, archive, article, signup, and publication-specific confirmation pages. Shared account/preferences pages remain outside this branding scope.
- Add a **Branding** tab alongside Issues, Subscribers, and Settings, using the existing tab component. Settings continues to own publication identity and sender configuration; Branding owns the logo, theme, and welcome copy, and links to Settings for name/description/accent changes.
- Desktop/mobile preview and explicit **Save branding**. Explain that saving changes the public site immediately. Uploading a logo or previewing a draft alone does not change the live site.

No custom domains, DNS changes, page builder, drag-and-drop sections, arbitrary HTML/CSS, custom fonts, multiple pages, menus, cover images, comments, paid subscriptions, or new analytics. Email template branding is a later feature: this release must not alter generated email bodies, scheduled content snapshots, or sent issues.

## Fixed homepage

The page reads from the top down:

1. Header: optional logo, publication name, Archive link, and Subscribe link when active.
2. Introduction: publication name, description, optional welcome copy, and author where configured.
3. Signup: a labeled email field, consent explanation, and subscribe action using the existing confirmed-opt-in flow.
4. Latest issue: a prominent text card for the newest publicly visible issue, with title, subtitle, date, and article link.
5. Recent issues: up to five additional public issue cards, without repeating the latest issue, followed by a link to the paginated archive.
6. Footer: author/publication attribution and existing privacy-policy link.

No manual featured-issue selector in v1. Using the latest public issue avoids new editorial state and linked-resource permissions. Use existing archive ordering, including its stable tie-breaking behavior. Bound database work; render an empty state if there are no public issues. Show a clear publication introduction and signup even before the first issue exists.

Extract the existing signup form rendering for reuse. Preserve its version/submission identifiers, honeypot, rate limits, origin checks, generic responses, explicit confirmation, and opt-out handling. Submission can use the existing `/n/:slug/subscribe` POST and confirmation pages; there is no need for client-side JavaScript or a new subscription operation.

Draft publications keep their existing anonymous visibility restrictions. Archived publications retain their public archive and branding, display an archived notice, and hide signup actions/forms. A withdrawn, scheduled, private, or email-only issue must never appear in homepage cards. Corrections use the current public version. Archival/withdrawal races must not expose private content.

## Data and compatibility

Add an optional top-level `branding` value to the publication record and authorized publication DTO, separate from the existing `settings` object:

```ts
type PublicationBranding = {
  theme: "classic" | "editorial" | "minimal";
  logoAssetId: string | null;
  logoAlt: string; // at most 160 characters; empty uses accessible name fallback
  welcomeText: string; // plain text, at most 1,000 characters
};
```

Records without branding resolve to Classic, no logo, and no welcome copy. No bulk migration is required. Existing publication create/update inputs remain valid. Existing settings updates must preserve branding, including old SDK clients that know nothing about it. Returning branding is additive; keep it optional in the public resource type for compatibility with older server responses. Resolve defaults in shared core code.

Branding writes replace this small branding object explicitly and use the publication's existing revision. Concurrent settings/branding edits conflict rather than overwrite each other. No mutation occurs during a GET or preview. Removing a logo clears its reference; it does not delete the immutable image from storage. Historical issue versions and email snapshots are not rewritten. Current public page chrome uses current branding while article content retains existing version semantics.

Keep the existing accent color source. Validate its format and derive accessible foreground/button colors; do not assume an arbitrary accent has enough contrast on white. Themes use system fonts and a bounded set of CSS variables. Plain text is escaped, and assets resolve through trusted stored references rather than caller-supplied URLs.

## Logo storage and access

Reuse `MediaService`, its S3/local adapters, immutable URLs, and content-addressed deduplication. No new bucket, public bucket permissions, or AWS resource is needed. Logos are publicly retrievable assets, consistent with existing newsletter images; say so in the uploader.

The current `/api/admin/media` upload/library is owner-only and has no REST/SDK/MCP catalog equivalent. This is an existing coverage gap. Do not claim the branding feature has machine-client parity by requiring an owner to upload every logo first.

Add a publication-scoped upload operation that stores an image and records its authorized association with that publication. It returns the asset ID, URL, content type, and dimensions without changing active branding. Branding saves/previews may reference only assets associated with that publication. Knowing another asset ID or its public URL must not grant access to its metadata or permission to attach it. Uploading the same bytes to another authorized publication may deduplicate the object while creating a separate association.

For v1 logos, accept PNG and JPEG up to 512 KiB decoded, at most 2,048 pixels per side. Recommend a square PNG with transparency, but contain rather than crop rectangular logos. Reuse existing signature/dimension validation and clearly retain its limitation: it is not full decoding or transcoding. Reject SVG, GIF, remote URL imports, malformed base64, unsupported content, and oversized input before storage. Reserve cropping, automatic resizing, and a global media API for later work.

Use canonical JSON input `{ fileName, contentBase64 }` for REST/MCP consistency; the SDK offers a typed byte-upload helper that encodes to this contract. Enforce encoded and decoded body limits. This intentionally smaller logo limit keeps JSON/MCP payloads bounded. Do not return or log image bytes in receipts, activity, or errors. Failed/canceled uploads may leave an unattached immutable asset; they must not change branding or create unbounded duplicate association records.

The existing global media library remains owner-only. The Branding tab uses the publication-scoped uploader on every transport; browsing arbitrary workspace media is not part of this feature. Document this narrow exclusion without adding blanket transport exclusions.

## API SDK and MCP contracts

Define canonical types, HTTP bindings, permissions, effect annotations, and operation schemas in `packages/contracts/src`, then implement through the shared authorized operation executor in `packages/core/src`. Dashboard handlers use the same domain rules; REST and MCP do not call privileged owner HTTP routes.

| Operation                                           | HTTP binding                                     | SDK method                                                          | Authorization and effect                                                                                 |
| --------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Existing `publications.get` and `publications.list` | Existing GET routes                              | Existing methods                                                    | Existing publication read permission/restrictions; add optional branding output                          |
| Existing `publications.preview`                     | `GET /api/v1/publications/:id/preview`           | `publications.preview(id)`                                          | Existing read permission; keep `{ html }`, render the real saved homepage instead of today's placeholder |
| New `publications.branding.update`                  | `PUT /api/v1/publications/:id/branding`          | `publications.branding.update(id, { branding, revision }, options)` | New `narada:publications:branding:write`; publication-restricted write                                   |
| New `publications.branding.preview`                 | `POST /api/v1/publications/:id/branding/preview` | `publications.branding.preview(id, { branding, revision })`         | `narada:publications:read`; publication-restricted, side-effect-free read                                |
| New `publications.logo.upload`                      | `POST /api/v1/publications/:id/logo`             | `publications.logo.upload(id, input, options)`                      | New `narada:publications:branding:write`; publication-restricted write                                   |

Update returns the canonical publication DTO and incremented revision. Draft preview returns `{ html }`; require the submitted base revision to match, validate logo associations, and return a revision conflict if settings changed. Upload returns bounded public asset metadata and its publication association. Use existing error envelopes for validation, permission denial, missing resources, revision conflict, and replay mismatch. Final input/output shapes and success status codes must be frozen in the catalog before implementation.

The new branding write scope keeps existing settings permissions and legacy grants from silently acquiring image-upload capabilities. Newly granted callers need publication read plus branding write for the full workflow. Publication activation, issue publication, and email sending remain separately authorized. Existing read-only preview behavior remains read-only; branding actions do not send email or activate publications.

Expose all three new operations through MCP discovery with canonical inputs/outputs and accurate descriptions. Identify read-only previews and writes correctly, and document that branding save changes a public page immediately. Require stable MCP mutation operation keys; preserve REST idempotency conventions and explicit SDK keys. Add one explicitly typed SDK binding for every new operation, including binary helper-to-JSON behavior. No SDK/MCP exclusion is acceptable for these operations.

Check publication restrictions before storage access, association creation, preview, mutation, and response replay. Recheck current grants on replay and preserve transactional grant/revision guards. Upload S3 writes are content-addressed; association and receipt acceptance must be atomic/recoverable so a lost response cannot attach the wrong asset or increment a publication revision twice. A replay after revocation must not reveal previously authorized results. Record mutation activity/status with references and counts, not content. Follow existing reconciliation rules after receipt expiry.

## Rendering and dashboard implementation

Create a shared public-page view model and pure renderer in core for both anonymous pages and authorized previews. Reuse the existing public issue projection and archive service; do not load arbitrary draft issue data to build a card. The preview uses real public issues and can show the homepage of a draft publication privately, without exposing its draft issues.

Separate homepage and archive bodies, which currently share the same simple listing, while retaining the common themed page shell. Keep archive pagination and old URLs working. Correct homepage/archive metadata to website semantics while retaining article metadata for issues. Keep canonical URLs based on trusted installation configuration. Theme/logo changes do not change slugs or redirect URLs.

Preview responses use `no-store` and private/noindex markup. Dashboard iframe previews remain sandboxed with a policy that permits trusted logo images and prevents signup submissions/navigation from acting as a real subscription. Public signup remains functional. Add explicit image dimensions, responsive logo sizing, lazy loading where appropriate, semantic headings, meaningful link text, focus states, reduced-motion compatibility, and contrast checks across all themes.

In Branding, show theme cards, upload/replace/remove controls, alt-text input, welcome text, preview width controls, and save/error state. Preserve unsaved input after failed saves; on revision conflict offer reload without silently discarding changes. Upload completion only selects the pending asset. Cancel/revert restores saved branding. A failed image displays the publication name without a broken layout. Explain that branding applies to public pages and does not change email designs.

## Delivery sequence and acceptance

1. **Contracts and shared behavior:** add branding types/defaults, dedicated operations/scope, scoped logo associations, revision/replay handling, SDK bindings, and MCP execution/discovery. Add schema and permission tests with the implementation.
2. **Public rendering:** build the common theme shell, homepage layout, shared signup markup, metadata, and real saved/draft previews. Add renderer and public-route tests; preserve archive and issue privacy behavior.
3. **Dashboard and integration:** add Branding, uploader, theme choices, and responsive preview. Finish complete REST/SDK/MCP and browser flows, documentation, and regression checks.

Do not ship a dashboard-only intermediate release. A rough planning allowance is one to two engineering weeks for the bounded feature, including cross-transport support and verification; this is not a delivery commitment. Domain provisioning is not included.

Required evidence:

- Existing publications render with defaults; older create/update calls preserve branding; settings and branding revision races conflict safely.
- All themes render homepage/archive/article/signup/confirmation at desktop and mobile widths without overflow, and with keyboard navigation and acceptable contrast.
- Upload, replace, remove, cancel, preview, save, and reload work. Same-key retry after a lost response reuses the result; mismatched payloads conflict. Upload failure never changes the live logo.
- REST and real typed SDK calls receive canonical outputs. MCP performs upload, preview, and save using the same service and enforces scopes, publication restrictions, current grants, and recovery.
- Cross-publication asset references, restricted discovery/listing, direct access, and receipt replay fail appropriately. Old keys/grants do not gain branding writes automatically.
- Anonymous pages expose no draft/scheduled/private/withdrawn issues or owner/subscriber data. Archived and empty publications have the intended states.
- Existing signup to explicit confirmation to unsubscribe flow remains intact, including prior opt-outs, rate limiting, origin checks, and generic responses. No branding operation sends an email.
- Previously saved/scheduled/sent issue email content remains unchanged. Public corrections and archive pagination continue to work.

Run `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm contracts:verify`, `pnpm check`, relevant integration/browser suites, `pnpm test:mcp`, and `pnpm sdk:check`. Use isolated local fixtures. Document any blocked checks rather than weakening coverage. Update `docs/API.md`, `docs/PRODUCT-API.md`, `docs/MCP.md`, `docs/AGENT-ACCESS-PLAN.md`, SDK examples, and the newsletter documentation with the new operations, scope, asset visibility, and recovery behavior. Regenerate schemas/types rather than hand-editing generated files.

Deployment and SDK publication require a later explicit request. When requested, validate real media delivery and public pages in staging before production; local implementation, server deployment, and a published SDK version must be reported separately.

## References

- [Newsletter v1](NEWSLETTERS-V1.md)
- [Shared operation contracts](OPERATION-CONTRACTS.md)
- [Contract CI enforcement](CONTRACT-CI.md)
- [Agent access and intentional exclusions](AGENT-ACCESS-PLAN.md)
- [MCP transport](MCP.md)
- [Activity and recovery](ACTIVITY.md)
- [SDK usage](../packages/sdk/README.md)

## Implementation notes

The new shared operations, dedicated branding scope, typed SDK methods/byte helper, generated bounded REST/MCP schemas, publication-scoped asset associations, themed public renderer and Branding tab are implemented. Existing publication settings and URLs are preserved. The fixed homepage uses up to six public issues, with a bounded three-page archive scan. Public logo files remain retained when a logo is removed; upload acceptance commits metadata/association/receipt together, while interrupted storage writes may leave reusable unattached bytes.

Validation includes the contract/SDK package gate, full type/unit/build checks, branding/media/newsletter/product API integration tests, real OAuth MCP tests, and browser flows for branding, newsletters and media. Browser evidence covers logo loading in the sandboxed preview, unsaved edits across tabs, explicit discard, revision conflicts, public signup, and mobile layouts. Tests use isolated local services. Actual S3/CloudFront delivery for this increment remains a staging-release check after explicit deployment authorization.
