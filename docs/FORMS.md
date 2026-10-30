# Forms

Forms adds client intake, feedback, and signup flows to the Narada dashboard. Responses live separately from contacts. The public experience displays one question at a time and works without a dashboard account.

## Create and share

1. Open **Forms** and choose **Client intake**, **Feedback**, or **Signup**.
2. In **Build**, edit the title, introduction, questions, descriptions, and thank-you text directly on the document canvas. Click a plus between questions, or use the `/` prompt at the end, to search and insert a block. Drag a handle to reorder, or use the up/down controls. Duplicate questions or undo a removal from the block controls. Edit choices inline; Enter adds another option. Open **Block settings** to change the answer type or contact mapping. Supported answers are short text, long text, email, single-choice multiple choice, a 1–5 rating, and optional marketing consent. Forms support up to 30 questions and 150 KB of configuration.
3. In **Settings**, set the welcome text, brand name, accent color, and thank-you message. Configure contact and email behavior as needed.
4. Use **Preview** to try the current draft without saving a response or sending email.
5. Choose **Publish form**, then **Share** to copy or open its public link. **Create broadcast invitation** opens an independent email draft containing the published form's title, introduction, and link. Select an audience, complete the sender/footer settings, and use the existing review/send flow.

Drafts save automatically after a short pause in editing, including unfinished labels and choices. The header shows waiting, saving, and saved states; failed saves can be retried without replacing your edits. Dragging pauses autosave until the block is placed or the drag is cancelled. Publishing and leaving via **Forms** first finish pending saves. If another editor changes the form, choose **Keep my edits** or **Use saved draft** to resolve the conflict.

Saving a draft does not change the live form. Publishing creates a new immutable version. A respondent viewing an older version must reload before making a new submission. **Close form** stops new responses; stored responses and already accepted processing remain available. Publishing reopens a closed form.

## Contacts, signup, and email

Integrations are opt-in per form. Feedback can be anonymous. To enable either integration, make the email question required and configure a sender from a verified Narada domain.

- **Save verified respondents to Contacts** sends a confirmation link. The respondent must open it and press **Confirm email** before Narada creates or updates their profile. A GET request or a mail link scanner does not confirm a response. Links expire 24 hours after submission.
- Map questions to `name`, `first_name`, `last_name`, or existing compatible custom properties. Text maps to string properties and ratings to number properties. Unmapped answers remain only in the response. Existing unrelated properties are retained. Built-in name answers are limited to 80 characters and mapped custom strings to 500 characters.
- **Audience destination** optionally adds confirmed respondents to one existing manual audience, created in **Audience → Segments**. Enable contact sync and include an optional consent question describing the emails respondents will receive. Only a checked consent answer plus email confirmation adds membership. Dynamic segments and newsletter-managed audiences cannot be selected. Repeated submissions reuse existing membership and do not reset its original consent record. Leaving this setting empty keeps the previous contact-only behavior.
- **Signup** forms require contact sync and an audience destination or an active public topic, created in **Audience → Topics**. Their consent question is always optional and unchecked. A checked answer plus email confirmation creates a missing audience membership and/or topic subscription as configured. Existing topic opt-outs, global unsubscribes, audience opt-outs, and suppressions are not cleared. Form submission alone is not marketing consent. Membership does not override send eligibility or send a broadcast; select the audience when composing a broadcast later.
- **Send a response acknowledgment** queues a fixed receipt through the existing email service. With contact sync enabled, the receipt follows confirmation and contact processing. Without contact sync it follows submission. Receipts do not include submitted answers. This is a transactional receipt, not a workflow or marketing automation.

Each submission has its own answers, version, submission time, consent answer, confirmation time, processing state, and related email IDs. Later profile updates do not change the original response.

## Responses and exports

**Responses** lists submissions with pagination, with individual answers shown against the exact published questions used at submission. Refresh to see new responses or processing status; there is no dashboard polling.

**Export all CSV** downloads all responses by fetching small server-side pages. Each CSV row represents one answer and includes the response ID, timestamp, form version, email, question ID/label, answer, and processing status. This preserves changed question definitions across versions. Formula-like cells are escaped for spreadsheet applications. Large exports are assembled in the browser to stay within Lambda/API Gateway response limits; an interrupted export can be restarted.

A `complete` processing state means configured contact actions finished and email messages were accepted into Narada's delivery queue. Check **Emails** for actual delivery, failure, or local capture. It does not mean inbox delivery. `awaiting verification` means a confirmation email has been queued and the respondent has not confirmed.

Responses and published versions have no automatic expiry. The first version offers viewing and export, not a deletion UI or configurable retention policy.

## Reliability and limits

The existing DynamoDB table stores forms, immutable versions, responses, and pending processing. The existing dispatcher and SQS worker process form jobs; no additional database or queue is required. AWS's minute-based recovery schedule picks up form work. Verification/receipt sends use stable idempotency keys, and contact changes, webhook jobs, and the response's sync marker commit atomically. Contact/topic changes produce the existing contact webhook events; there is no separate form webhook event in v1.

Audience membership and its count are committed in that same transaction. The destination comes from the response's published form version, so republishing a different destination does not reroute already submitted responses. Full or unavailable audiences retain the response for the existing processing retry flow; they cannot leave a partially synced contact. The existing 1,000-member limit applies. Previously completed responses are not backfilled, and existing forms need no migration.

Public submissions have server-side validation, same-origin JSON checks, a shared limit of 60 submissions per minute per form, and a limit of three email-enabled submissions per hour per recipient across forms. These are initial abuse controls, not a CAPTCHA service. A honeypot field is accepted and rejected when populated. The standard request-size limit still applies. Public endpoints do not return submitted answers or contact records. Confirmation credentials are removed from the address bar and the frontend uses a no-referrer policy.

Duplicate submissions with the same submission ID and content return success without creating another response. Changed content with the same ID conflicts. The browser retains answers in memory while retrying an uncertain submission; it does not store answers in local storage.

Processing retries up to six times with backoff. A failure does not discard the response. The detail view exposes errors and allows retrying failed processing within 24 hours of the original submission. Beyond that, review the saved response manually. Sending pauses, removed sender domains, and recipient suppressions use the existing email-service behavior.

## HTTP endpoints

Dashboard operations require a signed-in owner session; mutations require the configured same origin. Forms are also available through the [public API and SDK](PRODUCT-API.md), using explicit operation keys with granular scopes and optional resource restrictions. Form-definition, response read/export and retry permissions are separate.

Form input accepts optional `audienceId` (a manual audience UUID; omit or use an empty string to disable routing). Configuring or publishing routing, and retrying a routed response, additionally requires `narada:segments:members:write` alongside the existing contact-sync and sending permissions. The destination identifier is hidden from public respondent content.

- `GET/POST /api/admin/forms` — list (20 per page maximum) or create.
- `GET/PUT /api/admin/forms/:id` — read or save a draft with `revision`.
- `POST /api/admin/forms/:id/publish` and `/close` — revision-guarded lifecycle actions.
- `GET /api/admin/forms/:id/responses` — paginated response metadata.
- `GET /api/admin/forms/:id/responses/:responseId` — answers and published content.
- `POST /api/admin/forms/:id/responses/:responseId/retry` — retry failed processing.
- `GET /api/admin/forms/:id/export` — up to five responses as CSV; follow `x-next-cursor` with the `cursor` query parameter. Only the first page has column headings.
- `POST /api/admin/forms/:id/broadcasts` — create an invitation draft; does not send.
- `GET /api/forms/:id` — public current published form.
- `POST /api/forms/:id/responses` — `{version, submissionId, answers, website?}`.
- `POST /api/forms/confirm` — `{token}` from a verification email.

## Local verification and deployment

Run `pnpm dev`, then use Mailpit at `http://localhost:8025` for verification and acknowledgment messages. Relevant checks:

```sh
pnpm check
pnpm exec vitest run --project integration tests/integration/forms.test.ts
pnpm exec playwright test tests/e2e/forms.test.ts
pnpm infra:check
```

Deploy through the existing staging/production process. The infrastructure change attaches a CloudFront viewer-request function that rewrites `/forms/:id` and `/forms/confirm` to the frontend entry point while leaving API and asset requests intact. Deploy frontend, API, worker, and infrastructure together. No existing data migration is required.

Conditional branching, uploads, payments, website embedding, partial-response recovery, reminders, and general automation are outside this first version.
