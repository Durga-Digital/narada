# Publication branding v2 and issue management

## Scope

Implement additive branding settings across dashboard, REST, SDK and MCP: a wordmark, homepage cover, three fixed layouts (letter, feature, grid), signup heading/description/button text, and optional name capture. Use immutable publication-owned PNG/JPEG assets through the existing media store; no remote asset URLs, HTML, CSS or scripts accepted. Existing logo upload remains compatible. New branding image upload supports wordmarks, homepage covers and issue covers. All image uploads are public assets, even before attachment/publication.

Issue covers are draft metadata, validated against the publication's uploaded assets and frozen into published versions. Draft cover edits must not leak through archives, homepages, social metadata or previously released emails. Website covers do not change email bodies; authors can insert images in the editor separately.

Issues gain server-side status filtering (draft, scheduled, published, sent, withdrawn), consistent status labels, and a confirmed delete action for drafts without publication/delivery/schedule history. Deletion requires its own `narada:issues:delete` scope and current revision. Retain a hidden audit tombstone and slug reservations for receipt authorization and safe replay; do not delete shared media. Existing grants receive no new permissions. Deletion is unavailable for issues with historical publication/delivery resources.

## Layout investigation

Read-only production checks on 25 October 2026 confirmed `/n/ai-insights` renders the current home intro, inline signup and featured latest issue. `/n/ai-insights/archive` renders the simpler Issues list matching the screenshot. Both respond 200 with no-store. This is an archive/home distinction, not evidence of stale deployment. Add explicit Home/Archive navigation, page identity, and shared issue-card styling.

## Validation

Generate/check canonical contracts; SDK typed bindings and MCP discovery coverage; test scoped writes, linked asset restrictions, old client preservation, revision conflicts, deletion replay/revocation and publication races. Exercise all layouts, custom-domain paths, published-version cover privacy, consent forms, archive pagination and dashboard flows at desktop/mobile widths. No deployment or npm publication in this task.

## Agent-generated designs: proposed future boundary

First support a versioned design manifest that agents generate through the existing branding API: approved layouts, colors, typography presets, assets and plain text. Validate it against canonical schemas, preview through the same renderer, and require explicit revision-checked activation. This delivers custom designs without executing uploaded code.

If HTML import is later needed, parse it into supported document/layout nodes on the server, with an allowlist of elements and attributes; never insert raw HTML. Reject event handlers, executable URLs, forms, frames and arbitrary external assets. Import CSS only as a small set of typed design tokens; arbitrary CSS can fetch URLs and obscure/mimic trusted controls. CSP is defense in depth, not a sanitizer.

Do not allow uploaded JavaScript on Narada's dashboard, reader or media origins. A future interactive-widget product would require a separate untrusted origin, sandboxed frames without same-origin privileges, no credentials, tightly validated messages, restrictive networking/CSP, resource limits and a separate security review. Instructions to Claude Code are authoring guidance, never an enforcement boundary.

Implementation status: implemented locally on 25 October 2026; not deployed or published.

Completed checks: `pnpm contracts:generate`, `pnpm contracts:verify` (494 contract tests and SDK package checks), `pnpm check` (738 unit tests, TypeScript, SDK and frontend builds), 76 integration tests across branding/newsletters/custom domains/production MCP, and four browser flows. The final deletion metadata change was checked again through REST and actual OAuth MCP replay. Desktop/mobile screenshots were inspected; signup, confirmation, email delivery, corrections and unsubscribe passed against disposable local services. Initial browser failures were isolated to shared development queues/server reloads and one hard-coded test mailbox URL; the completed reruns passed after isolation and test configuration fixes. The build retains its existing large-chunk warnings.

API/SDK/MCP impact: two new canonical operations (`publications.assets.upload`, `issues.delete`), optional issue-list status filtering, additive branding/cover fields and status/deletion eligibility DTO fields. All are exposed through the shared authorized executor, REST, typed SDK bindings and MCP discovery. Existing logo upload remains supported; legacy grants do not gain draft deletion. No new transport exclusions. Arbitrary HTML/CSS/JavaScript hosting is intentionally a proposal, not an implemented feature.

Security references: [OWASP XSS prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html), [MDN sandbox isolation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox), and the [HTML iframe sandbox rules](https://html.spec.whatwg.org/multipage/iframe-embed-object.html).
