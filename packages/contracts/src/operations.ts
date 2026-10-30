import type { Scope } from "./scopes.js";

export const contractVersion = "2026-10-23";
export interface OperationDefinition {
  id: string;
  description?: string;
  http?: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    status: 200 | 201 | 202;
  };
  // All scopes are required; when anyScopes is present, at least one of those
  // alternatives is also required. Input-specific requirements are enforced in core.
  scopes: readonly Scope[];
  anyScopes?: readonly Scope[];
  effect: "read" | "write" | "send";
  idempotency: "none" | "optional-key";
  resources:
    | "operation"
    | "global"
    | "sender-domain"
    | "form"
    | "form-collection"
    | "form-create"
    | "publication"
    | "publication-collection"
    | "publication-create";
}

export const operations = [
  {
    id: "approvals.request",
    description:
      "Prepare an exact send or publication for human review. Does not send. Requires the target operation's permissions; only the signed-in owner can approve through reviewUrl.",
    http: { method: "POST", path: "/api/v1/approvals", status: 201 },
    scopes: ["narada:approvals:request"],
    effect: "write",
    idempotency: "optional-key",
    resources: "operation",
  },
  {
    id: "approvals.list",
    description:
      "List this caller's send approval requests without message content or recipient lists. Current target permissions are checked.",
    http: { method: "GET", path: "/api/v1/approvals", status: 200 },
    scopes: ["narada:approvals:read"],
    effect: "read",
    idempotency: "none",
    resources: "operation",
  },
  {
    id: "approvals.get",
    description:
      "Read the current status and owner review URL of a permitted send approval. Approval cannot be granted by an agent.",
    http: { method: "GET", path: "/api/v1/approvals/:id", status: 200 },
    scopes: ["narada:approvals:read"],
    effect: "read",
    idempotency: "none",
    resources: "operation",
  },
  {
    id: "sending.get",
    description:
      "Read the workspace sending pause state and revision. Pausing does not cancel already accepted work.",
    http: { method: "GET", path: "/api/v1/sending", status: 200 },
    scopes: ["narada:sending:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "sending.update",
    description:
      "Set the workspace pause state using its current revision. Resuming lets eligible queued work continue.",
    http: { method: "PUT", path: "/api/v1/sending", status: 200 },
    scopes: ["narada:sending:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "sending.diagnostics",
    description:
      "Read SES account and configuration-set diagnostics. Local mode does not contact AWS.",
    http: { method: "GET", path: "/api/v1/sending/diagnostics", status: 200 },
    scopes: ["narada:diagnostics:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "metrics.get",
    description:
      "Read metrics for 1\u201390 UTC days by acceptance date. A sender-domain-restricted grant must select an allowed domain.",
    http: { method: "GET", path: "/api/v1/metrics", status: 200 },
    scopes: ["narada:metrics:read"],
    effect: "read",
    idempotency: "none",
    resources: "sender-domain",
  },
  {
    id: "domains.create",
    description:
      "Register a sender domain with Narada/SES and return its DNS records. Does not buy a domain, edit DNS, or send mail. Existing registrations are returned unchanged; use domains.refresh to recheck DNS. Requires explicit domain-registration consent.",
    http: { method: "POST", path: "/api/v1/domains", status: 201 },
    scopes: ["narada:domains:create"],
    effect: "write",
    idempotency: "optional-key",
    resources: "sender-domain",
  },
  {
    id: "domains.mailFrom.update",
    description:
      "Configure a dedicated bounce subdomain and return the exact MX/SPF records to publish. Does not write DNS. Requires the current domain revision. Preserve existing provider records and never use the root mail-receiving domain.",
    http: {
      method: "PUT",
      path: "/api/v1/domains/:name/mail-from",
      status: 200,
    },
    scopes: ["narada:domains:configure"],
    effect: "write",
    idempotency: "optional-key",
    resources: "sender-domain",
  },
  {
    id: "domains.dkim.enable",
    description:
      "Enable SES DKIM signing for an existing sender domain. Does not rotate selectors, write DNS, or send mail. Requires the current domain revision.",
    http: { method: "POST", path: "/api/v1/domains/:name/dkim", status: 200 },
    scopes: ["narada:domains:configure"],
    effect: "write",
    idempotency: "optional-key",
    resources: "sender-domain",
  },
  {
    id: "integration.guide",
    description:
      "Read the Narada setup and Resend migration playbook, current installation URL, HTTP/SDK examples, DNS handoff, credential boundary, and verification checklist. Read this before onboarding a project. Does not inspect or change the application's repository.",
    http: { method: "GET", path: "/api/v1/integration/guide", status: 200 },
    scopes: ["narada:capabilities:read"],
    effect: "read",
    idempotency: "none",
    resources: "operation",
  },
  {
    id: "resources.search",
    description:
      "Find permitted resources by name, slug, or contact email. Choose one kind. Returns compact references, not resource content. Requires that kind's existing read scope. Follow nextCursor even for empty pages; ambiguous names are not automatically resolved.",
    http: { method: "GET", path: "/api/v1/resources/search", status: 200 },
    scopes: [],
    anyScopes: [
      "narada:domains:read",
      "narada:forms:read",
      "narada:publications:read",
      "narada:contacts:read",
      "narada:templates:read",
      "narada:broadcasts:read",
      "narada:segments:read",
      "narada:topics:read",
    ],
    effect: "read",
    idempotency: "none",
    resources: "operation",
  },
  {
    id: "domains.list",
    description: "List permitted sender domain diagnostics in bounded pages.",
    http: { method: "GET", path: "/api/v1/domains", status: 200 },
    scopes: ["narada:domains:read"],
    effect: "read",
    idempotency: "none",
    resources: "sender-domain",
  },
  {
    id: "domains.get",
    description: "Read saved diagnostics for a permitted sender domain.",
    http: { method: "GET", path: "/api/v1/domains/:name", status: 200 },
    scopes: ["narada:domains:read"],
    effect: "read",
    idempotency: "none",
    resources: "sender-domain",
  },
  {
    id: "domains.refresh",
    description:
      "Refresh SES and DNS diagnostics for an existing permitted sender domain. Does not change DKIM, MAIL FROM, or DNS configuration.",
    http: {
      method: "POST",
      path: "/api/v1/domains/:name/refresh",
      status: 200,
    },
    scopes: ["narada:domains:refresh"],
    effect: "write",
    idempotency: "optional-key",
    resources: "sender-domain",
  },
  {
    id: "suppressions.list",
    description:
      "List workspace suppressions; optionally filter by exact email. Requires unrestricted workspace delegation.",
    http: { method: "GET", path: "/api/v1/suppressions", status: 200 },
    scopes: ["narada:suppressions:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "suppressions.get",
    description: "Read a workspace recipient suppression.",
    http: { method: "GET", path: "/api/v1/suppressions/:email", status: 200 },
    scopes: ["narada:suppressions:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "suppressions.create",
    description:
      "Suppress a recipient across the workspace without replacing an existing suppression reason.",
    http: { method: "POST", path: "/api/v1/suppressions", status: 201 },
    scopes: ["narada:suppressions:add"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "suppressions.delete",
    description:
      "Remove a workspace suppression. Does not resubscribe the recipient or override subscription consent.",
    http: {
      method: "DELETE",
      path: "/api/v1/suppressions/:email",
      status: 200,
    },
    scopes: ["narada:suppressions:remove"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "webhooks.events",
    description:
      "Discover supported webhook event types and their lifecycle semantics.",
    http: { method: "GET", path: "/api/v1/webhooks/events", status: 200 },
    scopes: ["narada:webhooks:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "webhooks.list",
    description:
      "List workspace webhook endpoints. Signing secrets are never included.",
    http: { method: "GET", path: "/api/v1/webhooks", status: 200 },
    scopes: ["narada:webhooks:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "webhooks.create",
    description:
      "Create a workspace webhook exporting selected event data. Save the signing secret securely; ordinary reads never return it. Requires a public HTTPS destination outside local testing.",
    http: { method: "POST", path: "/api/v1/webhooks", status: 201 },
    scopes: ["narada:webhooks:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "webhooks.deliveries.list",
    description:
      "List webhook delivery metadata in bounded pages, without event data or secrets.",
    http: { method: "GET", path: "/api/v1/webhooks/deliveries", status: 200 },
    scopes: ["narada:webhooks:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "webhooks.deliveries.get",
    description:
      "Read paginated attempt history. HTTP success does not assert recipient email delivery; unknown attempts may already have reached the receiver.",
    http: {
      method: "GET",
      path: "/api/v1/webhooks/deliveries/:id",
      status: 200,
    },
    scopes: ["narada:webhooks:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "webhooks.deliveries.retry",
    description:
      "Retry a failed unexpired delivery with its original event ID and body. The receiver must deduplicate; prior attempt history is preserved.",
    http: {
      method: "POST",
      path: "/api/v1/webhooks/deliveries/:id/retry",
      status: 200,
    },
    scopes: ["narada:webhooks:retry"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "webhooks.get",
    description:
      "Read webhook configuration and revision without its signing secret.",
    http: { method: "GET", path: "/api/v1/webhooks/:id", status: 200 },
    scopes: ["narada:webhooks:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "webhooks.update",
    description:
      "Change a webhook URL or selected events using its current revision. Pending deliveries use the updated URL.",
    http: { method: "PUT", path: "/api/v1/webhooks/:id", status: 200 },
    scopes: ["narada:webhooks:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "webhooks.delete",
    description:
      "Remove an endpoint and prevent queued delivery. In-flight requests may finish.",
    http: { method: "DELETE", path: "/api/v1/webhooks/:id", status: 200 },
    scopes: ["narada:webhooks:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },

  {
    id: "operations.list",
    http: { method: "GET", path: "/api/v1/operations", status: 200 },
    scopes: ["narada:operations:read"],
    effect: "read",
    idempotency: "none",
    resources: "operation",
  },
  {
    id: "operations.get",
    http: { method: "GET", path: "/api/v1/operations/:id", status: 200 },
    scopes: ["narada:operations:read"],
    effect: "read",
    idempotency: "none",
    resources: "operation",
  },
  {
    id: "operations.lookup",
    http: { method: "POST", path: "/api/v1/operations/lookup", status: 200 },
    scopes: ["narada:operations:read"],
    effect: "read",
    idempotency: "none",
    resources: "operation",
  },
  {
    id: "emails.send",
    description:
      "Submit a transactional message. API keys send directly within their permissions. MCP OAuth callers must use approvals.request with emails.send and present reviewUrl for owner approval.",
    http: { method: "POST", path: "/api/v1/emails", status: 202 },
    scopes: ["narada:emails:send"],
    effect: "send",
    idempotency: "optional-key",
    resources: "sender-domain",
  },
  {
    id: "emails.get",
    http: { method: "GET", path: "/api/v1/emails/:id", status: 200 },
    scopes: ["narada:emails:read"],
    effect: "read",
    idempotency: "none",
    resources: "sender-domain",
  },
  {
    id: "contacts.list",
    description:
      "List shared contact profiles in bounded pages. Profile creation does not imply marketing consent.",
    http: { method: "GET", path: "/api/v1/contacts", status: 200 },
    scopes: ["narada:contacts:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "contacts.get",
    description:
      "Read a contact profile and its topic preferences and global opt-out status.",
    http: { method: "GET", path: "/api/v1/contacts/:email", status: 200 },
    scopes: ["narada:contacts:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "contacts.create",
    description:
      "Create a contact profile without subscribing it. An existing email returns a conflict; use update to edit it.",
    http: { method: "POST", path: "/api/v1/contacts", status: 201 },
    scopes: ["narada:contacts:create"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "contacts.properties.patch",
    description:
      "Patch selected custom properties using the current contact revision; null removes a property. Preserves other profile fields and does not grant consent.",
    http: {
      method: "PATCH",
      path: "/api/v1/contacts/:email/properties",
      status: 200,
    },
    scopes: ["narada:contacts:update"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "contacts.update",
    description:
      "Replace the complete profile using the current revision. Supply name, first_name, last_name and properties, preserving values you still need.",
    http: { method: "PUT", path: "/api/v1/contacts/:email", status: 200 },
    scopes: ["narada:contacts:update"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "properties.list",
    description:
      "List custom contact property definitions for profiles, segment rules and personalization.",
    http: { method: "GET", path: "/api/v1/properties", status: 200 },
    scopes: ["narada:properties:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "properties.get",
    description: "Read a custom contact property definition by key.",
    http: { method: "GET", path: "/api/v1/properties/:key", status: 200 },
    scopes: ["narada:properties:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "properties.create",
    description:
      "Define a custom contact property before assigning values or importing CSV columns.",
    http: { method: "POST", path: "/api/v1/properties", status: 201 },
    scopes: ["narada:properties:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "properties.update",
    description:
      "Update a property definition using its current revision. Its type cannot change.",
    http: { method: "PUT", path: "/api/v1/properties/:key", status: 200 },
    scopes: ["narada:properties:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "topics.list",
    description: "List topic definitions, including archived topics.",
    http: { method: "GET", path: "/api/v1/topics", status: 200 },
    scopes: ["narada:topics:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "topics.get",
    description: "Read a topic definition by ID.",
    http: { method: "GET", path: "/api/v1/topics/:id", status: 200 },
    scopes: ["narada:topics:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "topics.create",
    description:
      "Create a topic definition. This does not subscribe any contacts.",
    http: { method: "POST", path: "/api/v1/topics", status: 201 },
    scopes: ["narada:topics:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "topics.update",
    description:
      "Edit or archive a topic using its current revision. Subscription consent remains separate.",
    http: { method: "PUT", path: "/api/v1/topics/:id", status: 200 },
    scopes: ["narada:topics:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "segments.list",
    description: "List manual and dynamic segment summaries in bounded pages.",
    http: { method: "GET", path: "/api/v1/segments", status: 200 },
    scopes: ["narada:segments:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "segments.get",
    description: "Read a segment definition and current membership count.",
    http: { method: "GET", path: "/api/v1/segments/:id", status: 200 },
    scopes: ["narada:segments:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "segments.create",
    description:
      "Create a manual segment or a dynamic segment with property rules. Rules do not grant marketing consent.",
    http: { method: "POST", path: "/api/v1/segments", status: 201 },
    scopes: ["narada:segments:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "segments.update",
    description:
      "Edit a segment definition using its current revision. Segment kind cannot change.",
    http: { method: "PUT", path: "/api/v1/segments/:id", status: 200 },
    scopes: ["narada:segments:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "broadcasts.list",
    description: "List broadcast drafts and sending states in bounded pages.",
    http: { method: "GET", path: "/api/v1/broadcasts", status: 200 },
    scopes: ["narada:broadcasts:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "broadcasts.get",
    description: "Read a broadcast draft, state and revision.",
    http: { method: "GET", path: "/api/v1/broadcasts/:id", status: 200 },
    scopes: ["narada:broadcasts:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "broadcasts.create",
    description: "Create an independent broadcast draft. No email is sent.",
    http: { method: "POST", path: "/api/v1/broadcasts", status: 201 },
    scopes: ["narada:broadcasts:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "broadcasts.update",
    description:
      "Edit a broadcast draft using the current revision. Only drafts can be edited.",
    http: { method: "PUT", path: "/api/v1/broadcasts/:id", status: 200 },
    scopes: ["narada:broadcasts:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "templates.list",
    description: "List reusable templates in bounded pages.",
    http: { method: "GET", path: "/api/v1/templates", status: 200 },
    scopes: ["narada:templates:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "templates.get",
    description:
      "Read a reusable template by ID or alias, including its draft and publication state.",
    http: { method: "GET", path: "/api/v1/templates/:id", status: 200 },
    scopes: ["narada:templates:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "templates.create",
    description:
      "Create a template with a unique alias. This does not publish or send it.",
    http: { method: "POST", path: "/api/v1/templates", status: 201 },
    scopes: ["narada:templates:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "templates.update",
    description:
      "Edit a template draft using its current revision. Published versions and accepted messages remain unchanged.",
    http: { method: "PUT", path: "/api/v1/templates/:id", status: 200 },
    scopes: ["narada:templates:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "contacts.subscribe",
    description:
      "Set a topic preference with an explicit consent source and confirmed=true. Subscribing does not clear a global opt-out or suppression.",
    http: {
      method: "POST",
      path: "/api/v1/contacts/:email/topics/:id",
      status: 200,
    },
    scopes: ["narada:subscriptions:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "contacts.topics.unsubscribe",
    description:
      "Opt out of one topic without changing other topic preferences, segment membership or global marketing preferences.",
    http: {
      method: "POST",
      path: "/api/v1/contacts/:email/topics/:id/unsubscribe",
      status: 200,
    },
    scopes: ["narada:subscriptions:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "contacts.unsubscribe",
    description:
      "Opt a contact out of all marketing. Does not remove the contact profile or transactional-email eligibility.",
    http: {
      method: "POST",
      path: "/api/v1/contacts/:email/unsubscribe",
      status: 200,
    },
    scopes: ["narada:subscriptions:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "segments.members.list",
    description:
      "List segment members in bounded pages. Membership does not imply subscription or delivery eligibility.",
    http: { method: "GET", path: "/api/v1/segments/:id/contacts", status: 200 },
    scopes: ["narada:segments:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "segments.members.add",
    description:
      "Add an existing contact to a manual segment without asserting consent. Preserves all preferences and opt-outs; membership alone never grants broadcast permission.",
    http: {
      method: "POST",
      path: "/api/v1/segments/:id/contacts/:email",
      status: 200,
    },
    scopes: ["narada:segments:members:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "segments.members.remove",
    description:
      "Remove a manual segment membership. Dynamic membership must be changed through rules or profile properties.",
    http: {
      method: "DELETE",
      path: "/api/v1/segments/:id/contacts/:email",
      status: 200,
    },
    scopes: ["narada:segments:members:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "segments.import",
    description:
      "Import up to 1000 contacts from CSV into a manual segment with explicit consent. Requires import, membership and subscription permissions. Can partially complete: reconcile an unknown outcome rather than retrying with a new key.",
    http: { method: "POST", path: "/api/v1/segments/:id/import", status: 200 },
    scopes: [
      "narada:contacts:import",
      "narada:segments:members:write",
      "narada:subscriptions:write",
    ],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "broadcasts.recipients.list",
    description:
      "List recipient delivery outcomes in bounded pages. Acceptance or submission does not prove inbox delivery.",
    http: {
      method: "GET",
      path: "/api/v1/broadcasts/:id/recipients",
      status: 200,
    },
    scopes: ["narada:broadcasts:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "broadcasts.preview",
    description:
      "Preview personalized content and current eligibility counts. Does not send email.",
    http: {
      method: "GET",
      path: "/api/v1/broadcasts/:id/preview",
      status: 200,
    },
    scopes: ["narada:broadcasts:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "broadcasts.duplicate",
    description:
      "Copy a broadcast into a new independent draft. Requires both read and draft-write permissions.",
    http: {
      method: "POST",
      path: "/api/v1/broadcasts/:id/duplicate",
      status: 201,
    },
    scopes: ["narada:broadcasts:read", "narada:broadcasts:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "broadcasts.send",
    description:
      "Launch or schedule a broadcast using its current revision and confirmed=true. scheduledAt is Unix milliseconds. Acceptance freezes eligible recipients and queues work; it does not prove delivery.",
    http: { method: "POST", path: "/api/v1/broadcasts/:id/send", status: 202 },
    scopes: ["narada:broadcasts:send"],
    effect: "send",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "broadcasts.test",
    description:
      "Send one test email. Test permission is separate from launching a broadcast; normal verified-sender and suppression checks apply.",
    http: { method: "POST", path: "/api/v1/broadcasts/:id/test", status: 202 },
    scopes: ["narada:broadcasts:test"],
    effect: "send",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "broadcasts.cancel",
    description:
      "Cancel an active broadcast. Already submitted messages cannot be recalled; manage publication-owned issue delivery through issue operations.",
    http: {
      method: "POST",
      path: "/api/v1/broadcasts/:id/cancel",
      status: 200,
    },
    scopes: ["narada:broadcasts:cancel"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "templates.preview",
    description:
      "Render a draft or selected published template version with variables. Does not send email.",
    http: {
      method: "POST",
      path: "/api/v1/templates/:id/preview",
      status: 200,
    },
    scopes: ["narada:templates:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "templates.publish",
    description:
      "Publish an immutable template version using its current revision. Requires publication permission separately from draft editing.",
    http: {
      method: "POST",
      path: "/api/v1/templates/:id/publish",
      status: 200,
    },
    scopes: ["narada:templates:publish"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "templates.archive",
    description:
      "Archive or restore a template using its current revision. Does not recall accepted messages.",
    http: {
      method: "POST",
      path: "/api/v1/templates/:id/archive",
      status: 200,
    },
    scopes: ["narada:templates:archive"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "templates.duplicate",
    description:
      "Copy a template into a new draft with a new alias. Requires read and draft-write permissions.",
    http: {
      method: "POST",
      path: "/api/v1/templates/:id/duplicate",
      status: 201,
    },
    scopes: ["narada:templates:read", "narada:templates:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "templates.test",
    description:
      "Render the draft and send one test email from an authorized verified sender. Test permission does not grant broadcast sending.",
    http: { method: "POST", path: "/api/v1/templates/:id/test", status: 202 },
    scopes: ["narada:templates:test"],
    effect: "send",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "templates.broadcasts.create",
    description:
      "Create an independent draft from a published broadcast template. Requires template-read and broadcast-write permissions; does not send it.",
    http: {
      method: "POST",
      path: "/api/v1/templates/:id/broadcasts",
      status: 201,
    },
    scopes: ["narada:templates:read", "narada:broadcasts:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "global",
  },
  {
    id: "identity.read",
    scopes: ["narada:identity:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "capabilities.read",
    http: { method: "GET", path: "/api/v1/capabilities", status: 200 },
    scopes: ["narada:capabilities:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "contracts.read",
    http: { method: "GET", path: "/api/v1/openapi.json", status: 200 },
    scopes: ["narada:capabilities:read"],
    effect: "read",
    idempotency: "none",
    resources: "global",
  },
  {
    id: "forms.list",
    http: { method: "GET", path: "/api/v1/forms", status: 200 },
    scopes: ["narada:forms:read"],
    effect: "read",
    idempotency: "none",
    resources: "form-collection",
  },
  {
    id: "forms.create",
    http: { method: "POST", path: "/api/v1/forms", status: 201 },
    scopes: ["narada:forms:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "form-create",
  },
  {
    id: "forms.get",
    http: { method: "GET", path: "/api/v1/forms/:id", status: 200 },
    scopes: ["narada:forms:read"],
    effect: "read",
    idempotency: "none",
    resources: "form",
  },
  {
    id: "forms.update",
    http: { method: "PUT", path: "/api/v1/forms/:id", status: 200 },
    scopes: ["narada:forms:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "form",
  },
  {
    id: "forms.publish",
    http: { method: "POST", path: "/api/v1/forms/:id/publish", status: 200 },
    scopes: ["narada:forms:publish"],
    effect: "write",
    idempotency: "optional-key",
    resources: "form",
  },
  {
    id: "forms.close",
    http: { method: "POST", path: "/api/v1/forms/:id/close", status: 200 },
    scopes: ["narada:forms:close"],
    effect: "write",
    idempotency: "optional-key",
    resources: "form",
  },
  {
    id: "publications.about.get",
    description:
      "Read the publication About draft, current revision and published snapshot.",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/about",
      status: 200,
    },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.about.update",
    description:
      "Save a private About draft at the current revision. Does not change the live page or send email. Reuse the same operation key after a lost response.",
    http: {
      method: "PUT",
      path: "/api/v1/publications/:id/about",
      status: 200,
    },
    scopes: ["narada:publications:site:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.about.preview",
    description:
      "Preview the saved or supplied About draft at its current revision. Never saves or sends; links and signup are disabled.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/about/preview",
      status: 200,
    },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.about.publish",
    description:
      "Publish the saved About draft at its current revision. Makes it publicly readable without sending email. Reuse the same operation key after a lost response.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/about/publish",
      status: 200,
    },
    scopes: ["narada:publications:site:publish"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.about.withdraw",
    description:
      "Unpublish About at its current revision. Hides the page and navigation link, preserving the private draft. No email. Reuse the same operation key after a lost response.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/about/withdraw",
      status: 200,
    },
    scopes: ["narada:publications:site:publish"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.site.get",
    description:
      "Read navigation and homepage draft settings, revision and published snapshot.",
    http: { method: "GET", path: "/api/v1/publications/:id/site", status: 200 },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.site.update",
    description:
      "Save private navigation and homepage settings together at their current revision. Does not change live pages or email. Reuse the same operation key after a lost response.",
    http: { method: "PUT", path: "/api/v1/publications/:id/site", status: 200 },
    scopes: ["narada:publications:site:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.site.preview",
    description:
      "Preview saved or supplied site settings using current branding and published issue versions. Does not save, subscribe or send.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/site/preview",
      status: 200,
    },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.site.publish",
    description:
      "Publish the saved navigation and homepage settings atomically at their current revision. Does not publish issue drafts or send email. Reuse the same operation key after a lost response.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/site/publish",
      status: 200,
    },
    scopes: ["narada:publications:site:publish"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.collections.list",
    description:
      "List editorial collections with opaque pagination. Includes archived collections; follow nextCursor even after an empty page. No subscriber preferences.",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/collections",
      status: 200,
    },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.collections.create",
    description:
      "Create an active editorial collection with a permanent unique slug. Its public page appears immediately, displaying only public issues. Up to 20 active collections; no email. Reuse the same operation key after a lost response.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/collections",
      status: 201,
    },
    scopes: ["narada:publications:collections:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.collections.get",
    description:
      "Read one collection, including archived collections, within its publication.",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/collections/:collectionId",
      status: 200,
    },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.collections.update",
    description:
      "Update collection name and description at its current revision. Changes its public page immediately; its slug is immutable. No email. Reuse the same operation key after a lost response.",
    http: {
      method: "PUT",
      path: "/api/v1/publications/:id/collections/:collectionId",
      status: 200,
    },
    scopes: ["narada:publications:collections:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.collections.archive",
    description:
      "Archive a collection at its current revision. Immediately hides its page, navigation and homepage rows. Issues and subscriptions are preserved. Reuse the same operation key after a lost response.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/collections/:collectionId/archive",
      status: 200,
    },
    scopes: ["narada:publications:collections:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "issues.collections.get",
    description:
      "Read editorial collection assignments and classification/issue revisions. Independent of issue content and subscriber preferences.",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/issues/:issueId/collections",
      status: 200,
    },
    scopes: ["narada:issues:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "issues.collections.update",
    description:
      "Replace up to five editorial collection assignments using both classification and issue revisions. Changes public discovery immediately for web-published issues, without publishing draft content or sending email. Reuse the same operation key after a lost response.",
    http: {
      method: "PUT",
      path: "/api/v1/publications/:id/issues/:issueId/collections",
      status: 200,
    },
    scopes: ["narada:issues:read", "narada:publications:collections:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.list",
    http: { method: "GET", path: "/api/v1/publications", status: 200 },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication-collection",
  },
  {
    id: "publications.create",
    http: { method: "POST", path: "/api/v1/publications", status: 201 },
    scopes: ["narada:publications:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication-create",
  },
  {
    id: "publications.get",
    http: { method: "GET", path: "/api/v1/publications/:id", status: 200 },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.update",
    http: { method: "PUT", path: "/api/v1/publications/:id", status: 200 },
    scopes: ["narada:publications:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.domain.get",
    description:
      "Read saved website setup and DNS records. Does not refresh DNS or provision resources.",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/domain",
      status: 200,
    },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.domain.configure",
    description:
      "Reserve an exact subdomain and queue certificate and website hosting setup, which may incur AWS charges. Revision zero starts a first connection. Publish the returned DNS records manually; SES verification alone does not prove website control. Reuse the same operation key after an uncertain response and inspect operation status.",
    http: {
      method: "PUT",
      path: "/api/v1/publications/:id/domain",
      status: 202,
    },
    scopes: ["narada:publications:domains:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.domain.check",
    description:
      "Queue a persisted DNS, HTTPS and provisioning check. Repeated checks are rate limited. HTTP acceptance does not mean the site is ready. Reuse the same operation key after an uncertain response and inspect operation status.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/domain/check",
      status: 202,
    },
    scopes: ["narada:publications:domains:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.domain.activate",
    description:
      "Request custom website activation after readiness is rechecked. Does not activate a draft publication, publish issues, or send email. Reuse the same operation key after an uncertain response and inspect operation status.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/domain/activate",
      status: 202,
    },
    scopes: ["narada:publications:domains:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.domain.disconnect",
    description:
      "Disconnect the custom website immediately and queue hosting cleanup. Default publication URLs remain available. Remove the website CNAME to complete cleanup; Narada never edits DNS. Reuse the same operation key after an uncertain response and inspect operation status.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/domain/disconnect",
      status: 202,
    },
    scopes: ["narada:publications:domains:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.branding.update",
    description:
      "Save branding immediately on a publication's public pages using its current revision. Does not activate the publication or change email content.",
    http: {
      method: "PUT",
      path: "/api/v1/publications/:id/branding",
      status: 200,
    },
    scopes: ["narada:publications:branding:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.branding.preview",
    description:
      "Preview unsaved branding against the current publication revision and public issues. Does not save, subscribe, or send.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/branding/preview",
      status: 200,
    },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.assets.upload",
    description:
      "Upload a public PNG/JPEG branding or issue-cover image, up to 512 KiB and 2048 pixels per side. Returns a publication-owned immutable asset; attaching it requires a separate revision-checked branding or issue update. Uploads are publicly accessible immediately. Reuse the operation key after an uncertain response.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/assets",
      status: 201,
    },
    scopes: ["narada:publications:branding:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.logo.upload",
    description:
      "Upload a public PNG or JPEG logo (base64, up to 512 KiB decoded and 2048 pixels per side) for this publication. Returns an asset reference; does not change live branding. Save with publications_branding_update. Reuse the operation key after an uncertain response.",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/logo",
      status: 201,
    },
    scopes: ["narada:publications:branding:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.activate",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/activate",
      status: 200,
    },
    scopes: ["narada:publications:activate"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "publications.archive",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/archive",
      status: 200,
    },
    scopes: ["narada:publications:archive"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "forms.preview",
    http: { method: "GET", path: "/api/v1/forms/:id/preview", status: 200 },
    scopes: ["narada:forms:read"],
    effect: "read",
    idempotency: "none",
    resources: "form",
  },
  {
    id: "forms.responses.list",
    http: { method: "GET", path: "/api/v1/forms/:id/responses", status: 200 },
    scopes: ["narada:form-responses:read"],
    effect: "read",
    idempotency: "none",
    resources: "form",
  },
  {
    id: "forms.responses.get",
    http: {
      method: "GET",
      path: "/api/v1/forms/:id/responses/:responseId",
      status: 200,
    },
    scopes: ["narada:form-responses:read"],
    effect: "read",
    idempotency: "none",
    resources: "form",
  },
  {
    id: "forms.responses.retry",
    http: {
      method: "POST",
      path: "/api/v1/forms/:id/responses/:responseId/retry",
      status: 200,
    },
    scopes: ["narada:form-responses:retry"],
    effect: "write",
    idempotency: "optional-key",
    resources: "form",
  },
  {
    id: "forms.responses.export",
    http: { method: "GET", path: "/api/v1/forms/:id/export", status: 200 },
    scopes: ["narada:form-responses:export"],
    effect: "read",
    idempotency: "none",
    resources: "form",
  },
  {
    id: "forms.broadcasts.create",
    http: { method: "POST", path: "/api/v1/forms/:id/broadcasts", status: 201 },
    scopes: ["narada:forms:read", "narada:broadcasts:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "form",
  },
  {
    id: "publications.preview",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/preview",
      status: 200,
    },
    scopes: ["narada:publications:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "publications.subscribers.list",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/subscribers",
      status: 200,
    },
    scopes: ["narada:subscribers:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "issues.list",
    description:
      "List issues with an optional status filter. Follow nextCursor even when data is empty. Published means currently visible on the web; sent means email released without a current web version. Deleted drafts are excluded.",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/issues",
      status: 200,
    },
    scopes: ["narada:issues:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "issues.create",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/issues",
      status: 201,
    },
    scopes: ["narada:issues:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "issues.get",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/issues/:issueId",
      status: 200,
    },
    scopes: ["narada:issues:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "issues.delete",
    description:
      "Delete a private draft with no publication, schedule or delivery history. Requires its current revision. Retains a hidden audit tombstone and shared assets. Cannot delete published, sent or scheduled issues. Reuse the same operation key after a lost response; inspect operation status before retrying with a new key.",
    http: {
      method: "DELETE",
      path: "/api/v1/publications/:id/issues/:issueId",
      status: 200,
    },
    scopes: ["narada:issues:delete"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "issues.update",
    http: {
      method: "PUT",
      path: "/api/v1/publications/:id/issues/:issueId",
      status: 200,
    },
    scopes: ["narada:issues:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "issues.preview",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/issues/:issueId/preview",
      status: 200,
    },
    scopes: ["narada:issues:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "issues.test",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/issues/:issueId/test",
      status: 202,
    },
    scopes: ["narada:issues:test"],
    effect: "send",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "issues.publish",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/issues/:issueId/publish",
      status: 202,
    },
    scopes: [],
    effect: "send",
    idempotency: "optional-key",
    resources: "publication",
    anyScopes: ["narada:issues:publish", "narada:issues:send"],
  },
  {
    id: "issues.cancel",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/issues/:issueId/cancel",
      status: 200,
    },
    scopes: ["narada:issues:cancel"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "issues.withdraw",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/issues/:issueId/withdraw",
      status: 200,
    },
    scopes: ["narada:issues:withdraw"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "issues.duplicate",
    http: {
      method: "POST",
      path: "/api/v1/publications/:id/issues/:issueId/duplicate",
      status: 201,
    },
    scopes: ["narada:issues:read", "narada:issues:write"],
    effect: "write",
    idempotency: "optional-key",
    resources: "publication",
  },
  {
    id: "issues.delivery.get",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/issues/:issueId/delivery",
      status: 200,
    },
    scopes: ["narada:issues:delivery:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
  {
    id: "issues.recipients.list",
    http: {
      method: "GET",
      path: "/api/v1/publications/:id/issues/:issueId/recipients",
      status: 200,
    },
    scopes: ["narada:issues:delivery:read"],
    effect: "read",
    idempotency: "none",
    resources: "publication",
  },
] as const satisfies readonly OperationDefinition[];
export type OperationId = (typeof operations)[number]["id"];
export const operationById: ReadonlyMap<string, OperationDefinition> = new Map(
  operations.map((op) => [op.id, op]),
);

/** Exact complete-path matching; never accepts prefixes, queries or unknown methods. */
export function matchHttpOperation(
  method: string,
  path: string,
): OperationDefinition | undefined {
  return operations.find((op) => {
    if (!("http" in op) || op.http.method !== method) return false;
    const pattern = op.http.path
      .split("/")
      .map((part) =>
        part.startsWith(":")
          ? "[^/]+"
          : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/");
    return new RegExp(`^${pattern}$`).test(path);
  });
}

/** Additional channel-specific requirements for issues.publish. */
export const issuePublishScopes = {
  web: ["narada:issues:publish"],
  email: ["narada:issues:send"],
  both: ["narada:issues:publish", "narada:issues:send"],
} as const;
