export type IntegrationMode = "resend" | "new";

/** Keep this handoff aligned with packages/sdk and docs/API.md. Never accept credentials. */
export function integrationPrompt(
  origin: string,
  mode: IntegrationMode,
  sender: string,
) {
  return `Integrate this application with my self-hosted Narada email service${mode === "resend" ? ", replacing Resend" : ""}.

Inspect the repository and follow its conventions before editing. Implement the integration, add meaningful tests, and document the required environment variables. Do not deploy or send real email without my explicit approval.

Narada setup through MCP
- If connected to Narada MCP, start with integration_guide and capabilities. Use resources_search to resolve names, domains_create to register the sending hostname, and domains_mailFrom_update / domains_dkim_enable when needed. Request fresh consent for missing scopes; older grants do not expand automatically.
- Return the exact DKIM and bounce-domain DNS records for me to publish, preserving existing Resend records, inbound MX routing and DMARC policies. Recheck with domains_refresh after propagation. Do not buy domains or modify DNS without separate authorization.
- I create and supply the application's API key through its secret configuration. MCP must not mint keys or use an application key to bypass human send approval. If MCP is not connected, report the connection/setup handoff instead of inventing a credential or pretending setup succeeded.

Configuration
- NARADA_BASE_URL=${origin} (origin only; do not append /api/v1 for the SDK).
- NARADA_FROM=${sender.trim() ? JSON.stringify(sender.trim()) : "<set the approved sender address after checking the existing app configuration>"}.
- NARADA_API_KEY must be supplied separately through server-side environment variables or a secret manager. Never ask me to paste it into a prompt, commit it, expose it in a browser bundle, or log it. Use placeholders in .env.example.
- Use a Sending access key restricted to the exact sender domain. Full access is not needed for sending or email status. Register and verify that exact domain in Narada; a parent-domain key does not authorize a subdomain. Staging and production need their own configuration and keys. SES sandbox environments also require verified recipients (or SES simulator addresses).

${
  mode === "resend"
    ? `Resend migration
- Find every Resend import, API call, environment variable, background job, auth email hook, template renderer, and webhook handler. Inventory the email flows before replacing them.
- Keep existing application-facing email interfaces, recipients, subjects, HTML/text templates, reply-to behavior, and authentication semantics. Render React Email components to HTML on the server before sending; Narada does not accept a React component as an API field.
- Narada is not a drop-in Resend client. Do not simply swap the API hostname. Map the request and response explicitly, including replyTo to reply_to where applicable.
- Map Resend tags to Narada's tags object (for example { source: "audit-request", tier: "premium", tag: "enquiry", urgency: "urgent" }); reject duplicate names rather than silently overwriting them. Map standard high-priority headers to priority: "high". Arbitrary custom headers are rejected.
- Audit attachments, cc/bcc, other custom headers, scheduling, batch sends, hosted templates, and inbound email if the application uses them. They are outside the inline send contract below; consult Narada's API reference and report unmigrated usages rather than dropping them silently. Resend template IDs and webhook signatures are not portable.
- Keep contact sync separate from transactional sending. Use a Scoped access key with contacts:write and, only if required, segments:members; optionally add emails:send and restrict its sender domain. contacts.create does not subscribe anyone. segments.addContact(segmentId, email, { consentSource, consentConfirmed: true }) requires an existing contact and explicit consent for manual membership, preserves opt-outs, and does not subscribe to topics. Never treat an enquiry as marketing consent. Bulk imports require segments:import and topic-subscription changes require contacts:subscriptions (or Full access); do not widen application credentials silently.
- Replace Resend's { data, error } handling with Narada's direct success result and thrown errors. If webhooks are used, inspect Narada's webhook configuration and signing contract separately before changing the receiver.
- Avoid dual sending during the switch. Remove Resend dependencies and configuration only after confirming all relevant call sites have migrated; list any flows still requiring work.
`
    : `New integration
- Identify the application's email triggers and add a small server-side email adapter using the existing architecture. Keep provider-specific code in that adapter.
- Reuse existing templates where available. Do not invent user-facing email flows or change authentication behavior beyond the requested integration.
`
}
Contact and audience configuration (when needed)
- Copy segment/topic IDs from Audience → Segments / Topics and configure NARADA_SEGMENT_ID / NARADA_TOPIC_ID per environment. Alternatively, discover them with segments.list() / topics.list() using segments:read / topics:read. Creation returns an id; persist it. Names and segment kinds do not identify a destination.
- Save profiles with contacts.create({ email, name?, first_name?, last_name?, properties? }); an existing email returns 409. For updates, get the latest profile and revision and call contacts.update(email, { contact: { name, first_name, last_name, properties }, revision }), preserving fields you still need. contacts:write permits individual create/get/update.
- For manual membership, call segments.addContact(segmentId, email, { consentSource, consentConfirmed: true }) after explicit opt-in; it requires an existing contact and segments:members. For dynamic segments, update properties matching the rules instead. Matching uses the shared directory; include an app-specific property when needed.
- Topic consent is separate: contacts.subscribe(email, topicId, { subscribed: true, source, confirmed: true }) requires contacts:subscriptions and explicit opt-in. Broadcast audienceId is the segment ID; dynamic broadcasts require topicId. Never treat an enquiry or rule match as consent.

Sending policy
- API keys and the SDK send automatically within their existing permissions and sender restrictions. Keep authentication hooks, templates and triggers unchanged; no owner review or extra approval scope is needed.
- MCP OAuth connections require owner approval for sends and issue publication. This policy follows verified credentials, not a client-supplied flag. Never give application API keys to an agent as a substitute for delegated MCP access.
- API keys can voluntarily request review with approvals.request. If using that workflow, owner approval executes the send; never send it again afterward.

Node.js integration
The ESM SDK is @durgadigital/narada and requires Node.js 22+. Install the matching release with the repository's package manager. For other server runtimes/languages use the HTTP contract below instead of forcing a Node migration.

import { Narada, NaradaError } from "@durgadigital/narada";

// Validate these server-side environment variables at startup.
const narada = new Narada({
  baseUrl: process.env.NARADA_BASE_URL,
  apiKey: process.env.NARADA_API_KEY,
});

// Adapt to the app's types. eventId is a stable, persisted logical email ID.
const sent = await narada.emails.send({
  from: process.env.NARADA_FROM,
  to: recipient,
  subject: "Welcome",
  text: "Your account is ready.",
}, { idempotencyKey: eventId });
// Persist sent.id for delivery-status lookup; accepted does not mean delivered.


HTTP contract
- POST $NARADA_BASE_URL/api/v1/emails with Authorization: Bearer $NARADA_API_KEY, Content-Type: application/json, and Idempotency-Key: <stable logical email ID>. Body: the email fields below.
- Accepted fields: from (string), to (string or 1–10 addresses), subject (string), text and/or html (at least one required), reply_to (optional string), expires_in (optional seconds, 30–86400, default 3600), tags (optional string key/value object), priority (optional "normal" or "high", normal behavior when omitted). Tags: at most 20 pairs, keys 1–64 ASCII letters/digits/underscores/hyphens starting with a letter; constructor and prototype are reserved; values 1–256 characters without control characters. Tags are retained as delivery metadata; never put secrets or message content in them. High priority adds inbox hints; clients decide whether to display them and queue order is unchanged. Unknown fields, including headers, are rejected. Request body limit: 350 KB; text/HTML each at most 100,000 characters.
- Send success: HTTP 202 with { id, replayed }. replayed is true when recovering an existing acceptance with the same key. Accepted means queued, not delivered. GET /api/v1/emails/:id with the same authentication returns metadata including status, events, tags, and priority. A sending key can only read messages within its sender-domain scope. Tags also appear in dashboard email details and exact key/value filters within the latest 100 emails.
- HTTP errors contain an error string, with optional code and requestId. The SDK throws NaradaError with status, code, requestId, and optional retryAfter (seconds). Network and timeout errors may be other error types. Log only safe error metadata, not the raw request, body, tokens, links, or API key.

Reliability and authentication emails
- Idempotency keys are 1–128 printable ASCII characters and deduplicate transactional email acceptance within the project for 24 hours. Persist one key per logical email and reuse it with exactly the same payload on retries. Do not generate a new key on each retry or reuse a key with changed content (409).
- The SDK has a 30-second default timeout and does not retry automatically. A timeout does not mean the send failed. Use bounded retries for appropriate transient failures, honoring Retry-After when present, with the same key and payload. Do not retry validation/authentication errors blindly or resend indefinitely after the idempotency window.
- A sent status means provider acceptance; delivered means acceptance by the recipient mail server. An unknown submission outcome requires reconciliation, not a new send that could duplicate it.
- For automatic sign-in codes, magic links and password resets, preserve short token lifetimes and single-use validation in the consuming app. Set expires_in no longer than the token's remaining lifetime; do not submit if fewer than 30 seconds remain. It limits queue submission lifetime, not inbox delivery time. Never put secrets in subjects, application logs, analytics, or idempotency keys.

Validation and handoff
- Test the adapter using mocked SDK/HTTP responses: 202 acceptance, replayed acceptance, thrown HTTP error, timeout/uncertain outcome, and retry reuse of the same key and payload. Check that credentials stay server-side and existing email templates and auth flows still work.
- Run the repository's relevant checks. Provide a concise summary of changed files, environment variables, unsupported features, and a manual smoke-test procedure using an inbox I control. Do not send that test automatically.
- I can obtain a key in Narada → API keys and verify the sender in Domains. The Narada API reference and the installed SDK's README/types are the source of truth for any additional operations.
`;
}
