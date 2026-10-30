# Broadcasts

Narada supports newsletters and announcements through the **Audience** and **Broadcasts** screens. The UI uses shadcn components around the React Email editor. List, editor, recipient progress, and audience import are separate frontend modules; domain behavior lives in `BroadcastService`, independent of the HTTP and worker entrypoints.

## Local walkthrough

1. Run `pnpm dev` and sign in using `.local/owner.json`.
2. Open **Audience → Create audience**, name your list, then use the **Add contacts** dialog to paste `email,name` CSV or one address per line. Example: `reader@example.com,Alex`. Confirm that these contacts opted in and record where consent came from. For local testing, use fictional addresses; everything stays in Mailpit.
3. Open **Broadcasts → Create broadcast**. Choose your audience, use `hello@narada.test` as the sender, and write a subject and compose your message with blocks. Select a subscription topic when sending category-specific email; dynamic segments require one. Supply the organization and postal address to appear in the footer.
4. Save or preview the draft. Use **Send test email** and inspect [Mailpit](http://localhost:8025). Test emails have a `[Test]` subject and do not launch the audience send. Their unsubscribe link is a placeholder.
5. **Review & send** displays the eligible count and excluded unsubscribes/suppressions. Confirm to send now, or choose a future local date/time to schedule. Scheduling uses the browser's timezone and stores a UTC timestamp.
6. Watch recipient progress. Each recipient receives a separate email. Open a real broadcast message in Mailpit and follow its footer link to test unsubscribe. The link opens a confirmation page; a GET alone never changes preferences.
7. Create another broadcast or duplicate the first. The unsubscribed recipient is excluded. You can cancel a scheduled/active broadcast; submitted or in-flight messages cannot be recalled.

In local mode, delivery means capture in Mailpit. SES-style delivery/bounce/complaint fixtures remain available from the individual message in **Emails**, and feed into broadcast progress.

## Visual email editor

New drafts open in a visual editor built with the MIT-licensed `@react-email/editor`, which uses Tiptap/ProseMirror. It runs locally in the browser with no editor API key or hosted service. Narada uses shadcn controls for the surrounding workflow and page style controls.

- Type `/` to insert paragraphs, titles/headings, lists, quotes, code, buttons, dividers, sections, and columns. Markdown-style shortcuts such as `#` followed by Space work for headings.
- Select text for formatting and links. Use the sidebar for page/block styles; click **Body** in its breadcrumb to return to page backgrounds, message width, and padding. Undo and redo are available in the toolbar.
- **Save draft**, **Preview email**, **Send test email**, and **Review & send** export the current document into email HTML plus a plain-text alternative. The same generated content is used for tests and audience delivery, with the recipient-specific footer added by the backend.
- Structured JSON preserves block types and theme settings when you reopen or duplicate a draft. It is limited to 100 KB, with a 300 KB total draft limit; existing text (30,000 characters) and HTML (50,000 characters) limits still apply. These bounds protect the single DynamoDB draft record.
- Existing text/HTML drafts open in source mode. **Edit source** exposes the generated HTML and plain text. **Convert to blocks** imports that source into editable nodes, retaining supported inline typography, colors, spacing, borders, and table/cell styles. Imported stylesheets, responsive/dark-mode rules, Outlook conditionals, and unsupported CSS are not retained; layouts can change. External markup remains sanitized. Saving in source mode retains HTML/text without a structured document.
- Optional **Reply-To** applies to both test and audience emails. Sender details and the unsubscribe footer remain managed by Narada.

**Save draft** saves the current broadcast name, subject, sender, Reply-To,
audience, topic, organization, and postal address alongside the email content,
including when an existing HTML/plain-text draft opens in source mode. The
source editor serializes only HTML, plain text, and the optional block document;
it must not overwrite current form values with metadata captured when it opened.
This dashboard fix does not change the REST, SDK, or MCP update contracts, which
already support these fields. Availability on a hosted installation requires
deploying this change.

Inline-style import is a dashboard conversion change; the REST, SDK, and MCP
continue to accept and return source HTML/text unchanged. Editor documents remain
an intentional dashboard-only format (see [campaign MCP](CAMPAIGN-MCP.md)); this
does not add native block authoring to machine clients. The conversion improvement
is implemented locally and requires a separate deployment.

The editor and renderer are lazy-loaded when composing, so other dashboard screens do not download that larger bundle. Local browser tests exercise slash commands, styles, save/reopen, and HTML/plain-text delivery into Mailpit. Cross-client rendering in Gmail/Outlook and live SES delivery still require deployment validation.

## Contact directory

The Audience screen opens with a deduplicated shared contact directory. Its tabs are Contacts, Properties, Segments, and Topics. Search by name or email; separate multiple email searches with commas or semicolons. Filter by audience and list consent, choose a page size, and export the filtered results as CSV. Exports contain one row per audience membership, with a `list_consent` column (`recorded` or `none_or_opted_out`). Topic subscriptions are separate.

Counts reflect the selected audience, independently of search. “With list consent” means a contact has separately recorded consent for at least one selected manual list and is not opted out of that list or globally. “Without list consent” includes members added for organizational purposes without opting in. These counts do not represent topic subscriptions or delivery eligibility. Open a contact to inspect its topic preferences and list consent evidence; delivery suppressions are checked separately.

Use **Create audience** to add a list or **Add contacts** to import into an existing one. Historical audience charts and custom preference-page branding are not implemented.

## Audience import

- CSV accepts `email,name,first_name,last_name` plus defined custom property keys when a header is present. Simple `email,name` CSV can omit the header. Quoted names, BOM, blank lines, and one-address-per-line imports are supported. Numbers and booleans (`true`/`false`) are validated against their property definitions.
- Addresses are normalized and deduplicated. Existing contacts and their original consent evidence are preserved. Re-importing an address never resubscribes it.
- This version supports 10,000 shared contacts, 1,000 segments, 1,000 contacts per manual segment, 1,000 eligible recipients per broadcast, and 180 KB CSV uploads. Dynamic segments may match more, but must be narrowed before sending. Recipient snapshots are capped at 300 KB; contact property maps at 20 KB.
- Imports attest to previously obtained consent; the app does not collect new consent or run a double-opt-in signup flow.
- Legacy list unsubscribes apply to one manual segment. Topic unsubscribe applies to that topic across segments. The global broadcast opt-out blocks all broadcasts. Bounce/complaint suppressions retain their existing application-wide behavior. Marketing preferences do not block transactional password resets or receipts.

## Durable sending and scheduling

Launch atomically freezes an eligible-recipient snapshot and moves the draft into `scheduled` or `sending`. Revision checks prevent stale edits and simultaneous launches. Content and audience membership become immutable; use **Duplicate** to create an editable copy.

The existing durable outbox queues broadcast work. Workers expand twenty recipients at a time. Message UUIDs are derived from broadcast ID and normalized email; conditional writes prevent a replayed expansion from creating another message, independently of the transactional API's 24-hour idempotency window. Continuation jobs run through SQS; expired expansion leases and lost publications recover through the existing sweep.

Before each submission the worker checks cancellation, continued manual-segment membership, topic subscription or independent list consent, audience/global unsubscribe, global suppression, message expiry, and the global sending pause. A change after the final pre-send check cannot recall an in-flight provider request. Failed or uncertain submissions retain the transactional worker's existing retry/reconciliation semantics. Recipient submissions expire after 24 hours in the queue.

Scheduling supports the next 90 days. Due work is checked every second locally and by the existing one-minute recovery schedule in AWS, so it is not a second-precise scheduler. No EventBridge Scheduler resource is created per broadcast.

`completed` means all recipient submission attempts have reached terminal states, not that every email was delivered. Counters distinguish accepted/captured/delivered messages from failures and pending work. SES feedback can continue updating recipient results after completion. Message history still follows the application's 30-day TTL; recipients whose records have expired are labeled **history expired**.

## Unsubscribe and preview

Every audience email includes an organization/address footer and a signed recipient-specific unsubscribe URL. Both SMTP and SES use `List-Unsubscribe` and `List-Unsubscribe-Post` headers. The public POST route accepts `List-Unsubscribe=One-Click` without authentication, as expected by mailbox providers. The GET route requires confirmation to avoid link scanners silently unsubscribing people. [AWS documents custom unsubscribe headers](https://aws.amazon.com/about-aws/whats-new/2024/03/amazon-ses-headers-sending-email/), and [Gmail documents one-click unsubscribe behavior](https://support.google.com/mail/answer/14229414?hl=en).

Tokens are authenticated with a purpose-specific HMAC using the installation secret. Keep that secret stable: rotating it invalidates old unsubscribe links. Unsubscribe preferences are retained without a TTL and rechecked immediately before queued delivery. Tokens and recipient URLs should not be logged publicly.

### Properties and personalization

Create up to 50 custom properties with string, number, boolean, or date (`YYYY-MM-DD`) types. Email, name, first_name, and last_name are built in. Keys/types are immutable after creation; fallback values can be edited with revision checks. Contact details allow profile and property edits. CSV imports create shared profiles but preserve existing profile values; use the contact editor to update existing values.

Use **Insert property** in the visual editor, or enter `{{contact.first_name}}` in the subject/text. Both double and triple braces are accepted; neither enables unescaped HTML. Values are HTML-escaped in message text. Personalization is prohibited in tags/attributes, URLs, styles, and scripts. Unknown properties and missing values without a fallback block preview/send. Select **Preview as contact** to inspect or test as a particular recipient; otherwise the first eligible contact is used.

Launch validates every recipient’s personalized subject/body before queuing. Referenced values and fallbacks are frozen in separate per-recipient records, isolated by a unique launch token. Retries use that snapshot, even if profiles or fallbacks change later. Snapshot records expire 30 days after the scheduled send time; concurrent abandoned attempts expire too.

### Segments

Existing audiences are manual segments, with unchanged IDs for compatibility. Create, rename, import into, inspect, and remove members from manual segments. Removing membership leaves the shared contact and opt-out records intact. Existing confirmed broadcasts keep their frozen recipient snapshot.

Dynamic segments use up to ten rules with ALL/ANY matching. Rules support equality/inequality, string contains, number/date comparisons, and set/unset checks. They evaluate actual contact values, without personalization fallbacks. Segment membership never grants marketing consent. Editing rules affects future recipient selection; confirmed broadcasts retain their recipients. Counts rely on DynamoDB indexes and can briefly lag writes.

### Topics and preferences

Create up to 50 topics with names, descriptions, public/private visibility, and an active/archived state. All topics require explicit opt-in. Import can record consent for selected topics, but only creates preferences when none exist; it never overrides a topic opt-out, legacy list unsubscribe, or global broadcast opt-out. Contact details can record explicit subscription changes with a source and consent confirmation.

A topic broadcast includes only selected-segment contacts with an explicit opt-in and no applicable opt-out/suppression. Manual segments retain an **Audience consent only** option for legacy list-based sends; dynamic segments require a topic. Archiving a topic stops queued topic delivery. Tests use the chosen profile but send only to the test address.

Each new broadcast has a signed **Manage preferences** link. Public topics are discoverable; private topics are visible only when already subscribed or identified by that email’s signed topic token. The form lets recipients update topic preferences, unsubscribe from all broadcasts, and explicitly resume globally paused broadcasts. Resuming does not erase legacy list-specific unsubscribes. GET requests never change consent. RFC 8058 one-click POST unsubscribes from the email’s topic, or its legacy audience when no topic was selected.

Consent, topic state, global broadcast opt-out, legacy unsubscribe, and delivery suppression are rechecked immediately before provider submission. No preference change can recall a message already in flight. Existing signed unsubscribe links remain valid after migration.

### Storage migration

The existing DynamoDB application table now stores shared `CONTACT` records, `AUDIENCE` metadata, individual membership sort keys, property definitions, topic definitions, topic preferences, global broadcast opt-outs, and render snapshots. No additional AWS service or table is introduced.

Legacy embedded contact arrays are copied idempotently to shared contacts and membership items before a conditional schema-version switch. Existing shared profiles and all unsubscribe records are preserved; concurrent migration is safe to retry. Old arrays remain as a non-authoritative backup, and new imports use membership records. Directory access or import performs migration automatically; old queued broadcasts remain compatible. Migration/import can make partial progress on a transient failure; retrying preserves completed work without duplicating membership or reversing opt-outs.

HTML previews use a sandboxed iframe with a restrictive content-security policy. Scripts, forms, and external images are blocked in the preview. Image uploads/hosting, AI writing, open/click tracking, automation sequences, and public signup forms are not implemented.

## Deployment and tests

Redeploy the existing CDK stack to add the broadcast stream filter and worker permission to publish continuation jobs. No new tables, indexes, queues, or paid third-party services are added. Real SES sending still requires a verified domain, production access for unverified recipients, and sufficient sending quotas. Local tests do not validate those account-specific conditions.

Tests cover CSV normalization, signed links, safe text rendering, header generation, concurrent launches/expansion, frozen audience membership, scheduling, cancellation during expansion, suppression, late unsubscribe, transactional-email independence, test sends, revision conflicts, and the real browser-to-Mailpit flow.

```sh
pnpm check
pnpm test:integration
pnpm test:e2e
pnpm infra:check
```

Authenticated management endpoints include `/api/admin/audiences`, `/contacts`, `/properties`, `/segments`, `/topics`, and `/broadcasts` under the same `/api/admin` prefix. They require an owner session and matching Origin for writes; sending API keys do not grant audience or campaign management access.
