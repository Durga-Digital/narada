# Narada Node SDK

Typed, dependency-free, server-side client for the Narada API. API-key sending is automatic within the key’s permissions; MCP OAuth sends require owner approval. Requires Node.js 22+. Licensed under Apache 2.0; see LICENSE and NOTICE. This describes the SDK source in this checkout: new methods and this license change require a separate npm release. Previously published MIT versions retain their original license.

```sh
npm install @durgadigital/narada
```

From the monorepo:

```sh
pnpm --filter @durgadigital/narada build
pnpm --filter @durgadigital/narada pack
```

Install the resulting `durgadigital-narada-0.3.0.tgz` in another application with `npm install /path/to/durgadigital-narada-0.3.0.tgz`. Inside this workspace, declare `"@durgadigital/narada": "workspace:*"` and build the SDK first. The archive includes JavaScript and TypeScript declarations; it does not require the Narada server source or TypeScript at runtime. This release provides an ESM entry point.

```js
import { Narada, NaradaError } from "@durgadigital/narada";

const narada = new Narada({
  baseUrl: "http://localhost:5173", // dashboard origin, without /api/v1
  apiKey: process.env.NARADA_API_KEY,
  timeoutMs: 30000,
});

try {
  const sent = await narada.emails.send(
    {
      from: "hello@narada.test",
      to: "alex@example.com",
      subject: "Welcome",
      text: "Your account is ready.",
      tags: { source: "signup", tier: "premium" },
      priority: "high",
    },
    { idempotencyKey: "welcome-user-123" },
  );
  console.log(await narada.emails.get(sent.id));
} catch (error) {
  if (error instanceof NaradaError) {
    console.error(error.status, error.code, error.requestId);
  } else throw error;
}
```

Resources: `templates`, `emails`, `broadcasts`, `contacts`, `contactProperties`, `segments`, and `topics`. `send` remains an alias for `emails.send`. Existing and default keys retain email sending/status access only. Scoped keys can grant individual operations across all resources. Use `contacts:create` for signup-only contact creation, `contacts:write` for individual create/get/update, or combine the read, write, membership, subscription, import, and sending scopes listed in the [API permission table](../../docs/API.md#audience-and-broadcast-apis). Edit an existing key in the dashboard to change its scopes without replacing its token. **Full access** remains available. Use keys on your server, never in a browser bundle.

`tags` is a string key/value object (up to 20 pairs). Keys start with an ASCII letter and use letters, digits, underscores or hyphens, at most 64 characters; `constructor` and `prototype` are reserved. Values are 1–256 characters without control characters. Tags appear in email status, dashboard details, and recent-email filters; do not put secrets in metadata. To migrate Resend tags, convert its `{name, value}[]` to an object and reject duplicate names. Priority accepts `normal` or `high`, defaults to normal behavior, and adds inbox priority hints for high. Clients may ignore them; queue order is unchanged. Arbitrary custom headers are rejected. Both inline and template emails accept these options. A changed tag or priority requires a new logical email/idempotency key; key ordering alone does not.

For separate contact sync, create a Scoped key with `contacts:write`; add `segments:members` to organize contacts into manual segments:

```js
await narada.contacts.create({ email: "alex@example.com", first_name: "Alex" });
// Membership is organizational and does not grant marketing permission.
await narada.segments.addContact(segmentId, "alex@example.com");
```

Creating a contact does not subscribe it. `segments.addContact` requires an existing profile and manual segment, returns `{email, name, addedAt}`, and safely preserves existing membership on repeat. It preserves all opt-outs and topic preferences. Topic subscription changes require `contacts:subscriptions`; bulk imports require `segments:import`. Full access also permits both. See [HTTP API permissions and consent](../../docs/API.md#audience-and-broadcast-apis) for the complete contract.

### Choose a segment and save contacts

Copy IDs from the dashboard's Segments and Topics pages, or discover them with `segments.list()` (`segments:read`) and `topics.list()` (`topics:read`). Creation also returns the new resource's `id`. Store the selected IDs in each app's environment configuration; names are display labels, not identifiers. Staging and production have separate resources and IDs. The dashboard also exposes copyable template IDs/aliases, broadcast IDs, email IDs, contact emails, and property keys.

```ts
const segmentId = process.env.NARADA_SEGMENT_ID!; // Validate at startup.
const topicId = process.env.NARADA_TOPIC_ID!;
const email = "alex@example.com";

// Create a profile once; this does not add memberships or subscriptions.
await narada.contacts.create({ email, first_name: "Alex" });

// Add the existing profile to the chosen MANUAL segment, without claiming consent.
await narada.segments.addContact(segmentId, email);

// Separately record explicit opt-in to a topic, when applicable.
await narada.contacts.subscribe(email, topicId, {
  subscribed: true,
  source: "Product updates checkbox confirmed on signup",
  confirmed: true,
});
```

`contacts.create(input)` accepts `{ email, name?, first_name?, last_name?, properties? }` and returns the contact profile. It is not an upsert: an existing email returns 409. To change an existing profile, use `contacts.get(email)`, then `contacts.update(email, { contact: { name, first_name, last_name, properties }, revision })`. Updates replace the supplied profile fields, so preserve existing values and properties you still need.

`segments.addContact(segmentId, email)` requires `segments:members` and returns `{ email, name, addedAt }`. The contact must already exist. Repeated additions preserve the existing membership, timestamp, and all consent records; concurrent duplicates cannot increase the member count. This method does not create the segment or grant any marketing permission. The former consent arguments are rejected: record an actual topic opt-in separately. Update the server and SDK together for this contract change.

`contacts.subscribe(email, topicId, { subscribed, source, confirmed: true })` requires `contacts:subscriptions`. For opt-out, use `contacts.unsubscribeTopic(email, topicId)` without consent assertions; the older `subscribe(..., {subscribed: false, source, confirmed: true})` call remains supported.

```ts
// Stop only Example App marketing. Use a topic exclusive to Example App.
await narada.contacts.unsubscribeTopic(email, appTopicId);

// Only when the person requests no marketing from ANY app in this workspace:
await narada.contacts.unsubscribe(email);
```

Both operations require `contacts:subscriptions` and can be repeated safely. Topic opt-out works even without a prior subscription or when a topic is archived. It leaves memberships, profile data, other topic preferences, and suppressions intact. Topic preferences apply across segments: use separate topics for separate apps. All Example App promotional broadcasts must select its topic so the topic opt-out applies; it does not disable a legacy broadcast using independent list consent without that topic. Global unsubscribe blocks every broadcast. Neither operation blocks transactional sign-in email (delivery suppressions still apply). Broadcast unsubscribe links already support topic-specific opt-out, or list opt-out for legacy broadcasts without a topic; GET displays confirmation and POST applies the change.

For a **dynamic segment**, create/update contact properties to match its rules; do not call `segments.addContact`. Rules evaluate the shared contact directory. Define any custom property keys first, and include an app-specific property in the rules if the segment should be limited to one app. Rule matching does not grant topic consent. Broadcasts use the segment ID in `audienceId`; dynamic-segment broadcasts require a `topicId`.

A broadcast selects contacts from its segment, then checks permission independently. A selected topic requires an explicit positive subscription to that topic. Without a topic, only separately recorded historical/CSV list consent qualifies a member. Global and list unsubscribes and delivery suppressions still exclude recipients. Segment membership alone never qualifies someone for a promotional broadcast. Transactional sign-in messages do not require marketing opt-in; delivery suppressions still apply.

### Removing one app's relationship

Use app-specific custom property keys, defined once with `contactProperties.create`, such as `app_user_id`. These fields live on the shared contact; removing membership does not clear them automatically. To delete an Example App account without deleting another app's relationship:

```ts
// If Example App has marketing topics, opt out of each Example App-only topic.
await narada.contacts.unsubscribeTopic(email, appTopicId);
await narada.segments.removeContact(appSegmentId, email);
const { contact } = await narada.contacts.get(email);
await narada.contacts.patchProperties(email, {
  revision: contact.revision,
  properties: { app_user_id: null },
});
```

`patchProperties` requires `contacts:write`. Only supplied keys change; `null` clears a key and other values set it using its defined type. Other fields, memberships, subscriptions, unsubscribes, and suppressions remain intact. Choose keys used exclusively by the app; Narada does not infer field ownership or enforce per-app key isolation. Never use whole-contact deletion or global unsubscribe to remove one app's relationship. These are independent operations: repeat topic opt-out and membership removal safely and, after a 409 or uncertain property-update result, fetch the current revision before retrying the same named cleanup. Retained marketing preference records are separate from the app's profile fields.

To edit the **segment itself**, use `segments.update(segmentId, { segment: { name, kind, match?, rules? }, revision })`. Retrieve the current revision with `segments.get(segmentId)` first. Segment kind cannot be changed.

List methods return `{ data, nextCursor }`. Pass `{ limit: 20, cursor: previous.nextCursor }` to continue. A null cursor ends the list. Lists are eventually consistent, not a transactionally frozen view.

The `update` methods require the latest `revision` and a full resource input (`draft`, `contact`, `property`, `segment`, or `topic`). `contacts.patchProperties` changes only the named custom fields and also requires the current revision. Fetch again after a 409; do not overwrite another writer blindly. Contacts are addressed by email; properties by key; other resources by UUID.

```js
const topic = await narada.topics.create({ name: "Product updates" });
const segment = await narada.segments.create({
  name: "Customers",
  kind: "manual",
});
await narada.segments.import(segment.id, {
  csv: "email,first_name\nalex@example.com,Alex",
  consentSource: "Explicit signup form",
  consentConfirmed: true,
  topicIds: [topic.id],
});
const broadcast = await narada.broadcasts.create({
  name: "October update",
  audienceId: segment.id,
  topicId: topic.id,
  from: "hello@narada.test",
  subject: "Hello {{contact.first_name}}",
  text: "Here is the latest news.",
  organization: "Example company",
  postalAddress: "123 Example Street, Sydney NSW 2000",
});
console.log(await narada.broadcasts.preview(broadcast.id));
// Send using the current revision and a stable key for retries.
await narada.broadcasts.send(
  broadcast.id,
  { revision: broadcast.revision, confirmed: true },
  { idempotencyKey: "send-october-update" },
);
```

Requests time out after 30 seconds by default and are **never retried automatically**. Network/abort errors propagate; HTTP errors throw `NaradaError` with `status`, `code`, `requestId`, and optional `retryAfter` seconds. A timeout does not imply the server rejected a mutation. Starting with SDK 0.3.0, every mutation accepts a final `{ idempotencyKey, signal }` options argument. Reuse the same key and input for retries; generate a fresh key only for a new logical operation. Successful management responses replay for 24 hours. `idempotency_in_progress` (409) includes a retry delay; `idempotency_unknown` (409) requires reconciliation, not a new key. Management keys are scoped to the API key, method and path; approval acceptance uses a server-owned single-use identity; transactional API and owner/internal email keys retain project-wide scope. Multi-step imports/provider changes may partially complete before an interruption. See the repository’s `docs/IDEMPOTENCY.md` for full coverage and recovery. These options require a Narada server with management idempotency support.

Use `fetch` in constructor options to inject a test transport. An optional `signal` is supported on `emails.send`. API keys are not forwarded across redirects.

See the dashboard API reference for copyable Node.js and cURL examples for every supported operation. Automations, property deletion, and whole-contact/segment deletion are not supported in this release. Topics can be archived with `topics.update`.

## Templates

Use `templates.create`, `get`, `list`, `update`, `publish`, `preview`, `test`, `duplicate`, `archive`, and `createBroadcast` with appropriate `templates:read`, `templates:write`, or `templates:test` scopes, or Full access. `createBroadcast` requires both `templates:read` and `broadcasts:write`. Updates/publication require the latest revision. Sending keys use `emails.send({from, to, template: {id: "welcome-email", version: 1, variables: {first_name: "Alex"}}}, {idempotencyKey})` directly. Pin the publication version to keep retries stable. Draft changes do not affect published content or already accepted emails.

```ts
const operation = { idempotencyKey: "create-customers-unique-operation-id" };
const segment = await narada.segments.create(
  { name: "Customers", kind: "manual" },
  operation,
);
// Keep `operation` for retries of this request. Use a new ID for a different action.
```

## Capability discovery

`await narada.capabilities()` returns the operations and restrictions currently available to the key, plus contract versions and pagination limits. The authenticated `/api/v1/openapi.json` endpoint returns the corresponding OpenAPI document. Public types are generated from `packages/contracts`; the published SDK remains self-contained.

## Forms, publications and issues

`forms`, `publications`, and `issues` cover the [product API](../../docs/PRODUCT-API.md). Use an explicit **operation key** with the shared `narada:*` scopes and optional resource restrictions. Legacy full/scoped keys retain their existing access and do not gain these endpoints. Owner provisioning and the complete permission table are documented in the product API reference.

```ts
const publication = await narada.publications.get(publicationId);
const issue = await narada.issues.create(
  publication.id,
  {
    title: "Studio update",
    slug: "studio-update",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello readers." }],
        },
      ],
    },
  },
  { idempotencyKey: "studio-update-draft" },
);

const preview = await narada.issues.preview(publication.id, issue.id);
await narada.issues.publish(
  publication.id,
  issue.id,
  { revision: issue.revision, channels: "web", confirmed: true },
  { idempotencyKey: "studio-update-web" },
);
```

Web publishing requires `narada:issues:publish`; subscriber email requires `narada:issues:send`; `channels: "both"` requires both. Test email, subscriber reads and delivery results have separate scopes. New requests require current resource revisions. Mutations accept the usual `RequestOptions`; the client never retries automatically.

Form methods include `list`, `get`, `create`, `update`, `publish`, `close`, `preview`, `responses`, `response`, `retryResponse`, `exportResponses` and `createBroadcast`. Publication methods include `list`, `get`, `create`, `update`, `activate`, `archive`, `preview` and `subscribers`. Issue methods take `publicationId` first and include `list`, `get`, `create`, `update`, `preview`, `test`, `publish`, `cancel`, `withdraw`, `duplicate`, `delivery` and `recipients`.

Product lists accept `limit: 1–20` and opaque cursors. Follow `nextCursor` until null, including empty filtered pages. `forms.exportResponses` returns `{csv, nextCursor}` with up to five responses per chunk; concatenate CSV strings in order. Form-definition access does not grant response access. Restrictions apply to both lists and direct calls, including linked resources and replays.

## Operation recovery

`narada.operations.list()`, `.get(id)` and `.lookup({ operation, idempotencyKey, params? })` expose metadata for this API key’s operations. These require an operation key with `narada:operations:read` plus current permission for the original action and resources. For a lost response, look up the saved retry key, then repeat the original mutation with that same key and arguments when `recovery` is `replay_available`. Never use a new key for an unknown outcome. `NaradaError.operationId` carries correlation when available. See [Activity and recovery](../../docs/ACTIVITY.md).

## Operational management

The local SDK/server increment adds `sending.get/update/diagnostics`, `metrics.get`, `domains.list/get/refresh`, `suppressions.list/get/create/delete`, `webhooks.events/list/get/create/update/delete`, and `webhooks.deliveries.list/get/retry`. The server is deployed to staging and production; the SDK package has not been published. See [Operational API](../../docs/OPERATIONAL-API.md) for the 20-operation permission table and examples.

Use explicit operation-key scopes. Legacy full keys do not gain these administrative operations. Sender-domain restrictions filter domain diagnostics and require an explicit allowed `domain` for metrics; workspace settings, SES diagnostics, suppressions and webhooks require an unrestricted workspace grant. Sending and webhook updates require the latest revision. Mutations accept the final `RequestOptions` argument for idempotency/recovery.

```ts
const status = await narada.sending.get();
const metrics = await narada.metrics.get({ days: 7, domain: "example.com" });
const history = await narada.webhooks.deliveries.list({ limit: 20 });
```

Only webhook creation (including an authorized replay of that creation) returns a signing secret. Ordinary reads and delivery history omit it. Suppression removal does not resubscribe a recipient. Delivery retry preserves the original event ID and history; receivers must deduplicate.

## Audience and campaign MCP parity

Contacts and custom properties, topics, segments, templates and broadcasts now use the same core operation handlers for REST and MCP. SDK method names and existing REST permission mappings are unchanged. MCP uses the existing granular `narada:*` permissions, including separate test/send/cancel and template edit/publish/archive scopes. Contact updates require `name`, `first_name`, `last_name` and `properties` plus the current revision. See [Campaign MCP](../../docs/CAMPAIGN-MCP.md) for tool coverage, consent and recovery. This increment is deployed to staging and production; SDK package publication remains pending.

## Owner review for sends (local, not yet published)

API-key/SDK sends execute automatically within the key's existing permissions and restrictions. No approval scopes or SDK upgrade are needed for existing transactional email integrations. The server correction must be deployed before hosted API behavior changes.

MCP OAuth sends still require owner review. API callers can optionally request it with `narada.approvals.request({ operation, input }, { idempotencyKey })` and read `narada.approvals.get(id)` or `narada.approvals.list()`. Only the signed-in owner can approve/reject. Approval executes the action; do not send it again afterward. Legacy keys can request/read reviews within their existing capability ceiling; operation keys need approval scopes plus target permissions. See [send approvals](../../docs/SEND-APPROVALS.md) for recovery and policy details.

Owner password changes and recovery sender configuration remain owner-only account-security operations, deliberately excluded from public REST v1, the Node SDK and OAuth MCP. Use [Profile → Security](../../docs/PROFILE-SECURITY.md). Existing API keys, public DTOs and delegated permissions are unchanged.

## Publication subdomains

The local SDK source includes `narada.publications.domain.get`, `configure`, `check`, `activate` and `disconnect`. Read uses `narada:publications:read`; writes require the new `narada:publications:domains:write` consent and may allocate AWS hosting resources. Existing grants are not expanded. Publish the returned DNS records manually and reuse the same request key after an uncertain result.

```ts
const setup = await narada.publications.domain.configure(
  publicationId,
  {
    hostname: "news.example.com",
    revision: 0,
  },
  { idempotencyKey: "connect-news-example-com" },
);
const status = await narada.publications.domain.get(publicationId);
// Once DNS and HTTPS checks report ready:
if (status.domain?.state === "ready") {
  await narada.publications.domain.activate(
    publicationId,
    {
      revision: status.domain.revision,
    },
    { idempotencyKey: "activate-news-example-com" },
  );
}
```

The domain revision is independent of publication settings. A 202 response accepts durable work; inspect domain state and existing operation status before claiming the site is live. Both `defaultUrl` and `preferredUrl` are returned; old relative publication URL fields retain their meanings. See [setup and recovery](../../docs/PUBLICATION-DOMAINS.md). These source changes have not yet been published to npm.

## Agent-led project setup (unpublished source)

New local methods are `integration.guide`, `resources.search`, `domains.create`, `domains.updateMailFrom` and `domains.enableDkim`. Setup requires an owner-provided operation key with explicit domain setup scopes. An application's ordinary Sending key remains sufficient for automatic email sending. MCP does not create keys. The server endpoints are deployed to staging and production as of 24 October 2026. These SDK source methods have not yet been published to npm.

```ts
const guide = await narada.integration.guide();
const domain = await narada.domains.create(
  { name: "example.com" },
  { idempotencyKey: "project-domain-setup" },
);
const configured = await narada.domains.updateMailFrom(
  "example.com",
  {
    domain: "bounce.example.com",
    behavior: "REJECT_MESSAGE",
    revision: domain.revision,
  },
  { idempotencyKey: "project-bounce-setup" },
);
// Hand these exact records to the owner/DNS integration.
console.table([
  ...configured.records,
  ...(configured.authentication?.mailFrom.records ?? []),
]);
const matches = await narada.resources.search({
  kind: "domains",
  text: "example",
});
// Follow nextCursor, including on empty pages; never assume a name is unique.
```

See [the migration workflow](../../docs/AGENT-ONBOARDING.md) for DNS coexistence, owner-supplied secrets, application changes, and verification.

### Publication branding and issue management (source changes, not yet released)

```ts
const image = await narada.publications.assets.upload(
  publicationId,
  {
    fileName: "wordmark.png",
    contentBase64: pngBytes.toString("base64"),
  },
  { idempotencyKey: "upload-wordmark-1" },
);
const pub = await narada.publications.get(publicationId);
await narada.publications.branding.update(
  publicationId,
  {
    revision: pub.revision,
    branding: {
      theme: "editorial",
      logoAssetId: null,
      logoAlt: "",
      welcomeText: "Welcome.",
      layout: "feature",
      wordmarkAssetId: image.id,
      wordmarkAlt: "Our publication",
      signupHeading: "A fresh perspective every Friday",
      signupDescription: "Get our latest essay in your inbox.",
      signupButton: "Join the newsletter",
      signupName: false,
    },
  },
  { idempotencyKey: crypto.randomUUID() },
);
const drafts = await narada.issues.list(publicationId, {
  status: "draft",
  limit: 20,
});
// Follow nextCursor even if this page is empty. Check canDelete before offering deletion.
const issue = drafts.data.find((issue) => issue.canDelete);
if (issue)
  await narada.issues.delete(
    publicationId,
    issue.id,
    { revision: issue.revision },
    { idempotencyKey: `delete-${issue.id}` },
  );
```

`publications.assets.upload` requires `narada:publications:branding:write`. Images
are public immediately; PNG/JPEG only, at most 512 KiB and 2048 pixels per side.
The existing `publications.logo.upload` remains supported. Attach assets to
`wordmarkAssetId`/`coverAssetId` in branding, or `coverAssetId`/`coverAlt` in issue
create/update. Issue covers appear on the website from the published snapshot;
email bodies remain unchanged. Omitting new optional fields preserves existing
values on update; use `null` to remove an image. Layouts: `letter`, `feature`, `grid`.

Deletion requires explicit `narada:issues:delete` consent; existing grants do not
inherit it. Only drafts without publication, schedule or delivery history are
eligible. Hidden audit records and immutable shared assets remain. Same-key
replay is supported after deletion and rechecks current authorization. Filters:
`draft`, `scheduled`, `published`, `sent`, `withdrawn`; these classify web and
email state without treating sent-only issues as unpublished drafts.

### Publication websites and editorial collections

Publication site operations are implemented locally with the next site iteration; deploying the server and publishing this SDK package are separate release steps. Collections organize public issues, and do not create subscription preferences or send email.

```ts
const collection = await narada.publications.collections.create(
  publicationId,
  {
    name: "Deep Dives",
    slug: "deep-dives",
    description: "Research and practical analysis.",
  },
  { idempotencyKey: crypto.randomUUID() },
);

const assignments = await narada.issues.collections.get(publicationId, issueId);
await narada.issues.collections.update(
  publicationId,
  issueId,
  {
    revision: assignments.revision,
    issueRevision: assignments.issueRevision,
    collectionIds: [collection.id],
  },
  { idempotencyKey: crypto.randomUUID() },
);

const current = await narada.publications.site.get(publicationId);
const saved = await narada.publications.site.update(
  publicationId,
  {
    revision: current.revision,
    draft: {
      navigation: [
        { type: "home", label: "Home" },
        { type: "archive", label: "Archive" },
        {
          type: "collection",
          label: "Deep Dives",
          collectionId: collection.id,
        },
      ],
      featuredIssueId: null,
      collectionIds: [collection.id],
    },
  },
  { idempotencyKey: crypto.randomUUID() },
);
const preview = await narada.publications.site.preview(publicationId, {
  revision: saved.revision,
});
await narada.publications.site.publish(
  publicationId,
  {
    revision: saved.revision,
  },
  { idempotencyKey: crypto.randomUUID() },
);
```

`publications.about.get/update/preview/publish/withdraw` follows the same draft and revision workflow, with `{ title, document }` content using newsletter editor JSON. An absent About/site record has revision zero. Publish requires an activated publication; About also requires nonempty content. Later draft edits stay private. Navigation and homepage curation publish together; branding keeps its existing immediate-save behavior.

`publications.collections.list/get/create/update/archive` manages named collections. Updates accept `{ name, description, revision }`; archive accepts `{ revision }`. Collection edits and issue assignment changes affect public discovery immediately. Slugs cannot change or be reused after archive. An issue may belong to five collections; a publication supports 20 active collections, eight navigation links and three homepage collection rows. Use `issues.list(publicationId, { collectionId, status, limit, cursor })` to inspect matching issues. Follow `nextCursor` until null, including after an empty page, and keep filters unchanged between pages.

New scopes are `narada:publications:site:write`, `narada:publications:site:publish` and `narada:publications:collections:write`. Management reads require publication read; issue classification requires issue read, and classification writes also require collections write. Legacy keys and existing grants do not automatically gain new write scopes. All linked resources must belong to the permitted publication. About images use the existing hosted image library; uploads are publicly accessible immediately. Public lists and curated cards always use published issue versions.

Keep the exact operation key and arguments after a lost response; replay returns the original committed result, subject to current permissions. Classification mutations increment the issue revision as well as the classification revision to serialize against publish/edit/delete. Refresh issue state before subsequent content mutations. No site operation requires email-send permission or changes existing send approval rules.
