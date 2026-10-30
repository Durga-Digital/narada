import type {
  BroadcastInput,
  ContactInput,
  PropertyInput,
  SegmentInput,
  TopicInput,
} from "../../../../../packages/sdk/src/types.js";
export const resources = [
  "Emails",
  "Templates",
  "Broadcasts",
  "Contacts",
  "Properties",
  "Segments",
  "Topics",
] as const;
export type ApiResource = (typeof resources)[number];
export interface Example {
  title: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  call: string;
  args: unknown[];
  body?: unknown;
  note?: string;
  idempotencyKey?: string;
}
const id = "00000000-0000-4000-8000-000000000001";
const topicId = "00000000-0000-4000-8000-000000000002";
const contact = "alex@example.com";
const property = {
  key: "company_name",
  type: "string",
  fallback: "your team",
} satisfies PropertyInput;
const segment = { name: "Customers", kind: "manual" } satisfies SegmentInput;
const topic = {
  name: "Product updates",
  description: "News about our product",
  visibility: "public",
  active: true,
} satisfies TopicInput;
const draft = {
  name: "Product update",
  audienceId: id,
  topicId,
  from: "Acme <hello@example.com>",
  subject: "Hello {{contact.first_name}}",
  text: "Here is the latest news.",
  organization: "Acme",
  postalAddress: "123 Example Street, Sydney NSW 2000",
} satisfies BroadcastInput;
const profile = {
  name: "Alex",
  first_name: "Alex",
  last_name: "",
  properties: {},
};
const list = (resource: string, call: string): Example => ({
  title: "List",
  method: "GET",
  path: `/${resource}?limit=20`,
  call: `${call}.list`,
  args: [{ limit: 20 }],
  note: "Follow nextCursor until null. Lists are eventually consistent.",
});
const get = (resource: string, call: string, value = id): Example => ({
  title: "Retrieve",
  method: "GET",
  path: `/${resource}/${encodeURIComponent(value)}`,
  call: `${call}.get`,
  args: [value],
});
const create = (resource: string, call: string, body: unknown): Example => ({
  title: "Create",
  method: "POST",
  path: `/${resource}`,
  call: `${call}.create`,
  args: [body],
  body,
});
const update = (
  resource: string,
  call: string,
  body: unknown,
  value = id,
): Example => ({
  title: "Update",
  method: "PUT",
  path: `/${resource}/${encodeURIComponent(value)}`,
  call: `${call}.update`,
  args: [value, body],
  body,
  note: "Use the current revision returned by Retrieve. Updates replace the supplied resource fields; stale revisions return 409.",
});
const directExamples: Record<ApiResource, Example[]> = {
  Templates: [
    create("templates", "templates", {
      alias: "welcome-email",
      name: "Welcome",
      kind: "transactional",
      subject: "Hello {{vars.first_name}}",
      html: "<p>Welcome, {{vars.first_name}}</p>",
      text: "Welcome, {{vars.first_name}}",
      variables: [{ key: "first_name", type: "string", fallback: "friend" }],
    }),
    get("templates", "templates", "welcome-email"),
    list("templates", "templates"),
    update(
      "templates",
      "templates",
      {
        draft: {
          name: "Welcome",
          kind: "transactional",
          subject: "Welcome",
          text: "Welcome aboard",
          variables: [],
        },
        revision: 0,
      },
      "welcome-email",
    ),
    {
      title: "Publish",
      method: "POST",
      path: "/templates/welcome-email/publish",
      call: "templates.publish",
      args: ["welcome-email", { revision: 0 }],
      body: { revision: 0 },
      note: "Use the revision returned by the latest save. Published versions are immutable; editing the draft does not change live sends.",
    },
    {
      title: "Preview draft",
      method: "POST",
      path: "/templates/welcome-email/preview",
      call: "templates.preview",
      args: ["welcome-email", { variables: { first_name: "Alex" } }],
      body: { variables: { first_name: "Alex" } },
    },
    {
      title: "Send template email",
      method: "POST",
      path: "/emails",
      call: "emails.send",
      args: [
        {
          from: "hello@example.com",
          to: "alex@example.com",
          template: {
            id: "welcome-email",
            version: 1,
            variables: { first_name: "Alex" },
          },
        },
        { idempotencyKey: "welcome-user-123" },
      ],
      body: {
        from: "hello@example.com",
        to: "alex@example.com",
        template: {
          id: "welcome-email",
          version: 1,
          variables: { first_name: "Alex" },
        },
      },
      idempotencyKey: "welcome-user-123",
      note: "Use a published transactional template. Omit version to use the latest publication, or pin it for stable content across retries.",
    },
    {
      title: "Create broadcast from template",
      method: "POST",
      path: "/templates/product-update/broadcasts",
      call: "templates.createBroadcast",
      args: [
        "product-update",
        {
          audienceId: id,
          topicId,
          from: "hello@example.com",
          organization: "Acme",
          postalAddress: "123 Example Street",
        },
      ],
      body: {
        audienceId: id,
        topicId,
        from: "hello@example.com",
        organization: "Acme",
        postalAddress: "123 Example Street",
      },
      note: "Requires a published broadcast template. Creates a separate editable draft; does not send it.",
    },
    {
      title: "Archive",
      method: "POST",
      path: "/templates/welcome-email/archive",
      call: "templates.archive",
      args: ["welcome-email", { archived: true, revision: 1 }],
      body: { archived: true, revision: 1 },
    },
    {
      title: "Duplicate",
      method: "POST",
      path: "/templates/welcome-email/duplicate",
      call: "templates.duplicate",
      args: ["welcome-email", { alias: "welcome-copy" }],
      body: { alias: "welcome-copy" },
    },
  ],
  Emails: [
    {
      title: "Send email",
      method: "POST",
      path: "/emails",
      call: "emails.send",
      args: [
        {
          from: "hello@example.com",
          to: contact,
          subject: "Welcome",
          text: "Your account is ready.",
          tags: { source: "signup", tier: "premium" },
          priority: "high",
        },
        { idempotencyKey: "welcome-user-123" },
      ],
      body: {
        from: "hello@example.com",
        to: contact,
        subject: "Welcome",
        text: "Your account is ready.",
        tags: { source: "signup", tier: "premium" },
        priority: "high",
      },
      idempotencyKey: "welcome-user-123",
      note: "Requires a verified sender domain. Tags are up to 20 string pairs: keys start with a letter and use letters, digits, underscores or hyphens (max 64); values are 1–256 characters without controls. Tags appear in status and recent-email filters. Priority is normal (default) or high; inbox display is client-dependent. The idempotency key deduplicates review creation for 24 hours.",
    },
    {
      ...get("approvals", "approvals"),
      title: "Approval status",
      note: "Use the approval ID from the review request. A succeeded single-message request includes messageId for email status; it does not prove delivery.",
    },
    { ...list("approvals", "approvals"), title: "Your approval requests" },
    {
      ...get("emails", "emails"),
      title: "Email delivery status",
      note: "Use the id returned by emails.send (or messageId from an optional approval).",
    },
  ],
  Broadcasts: [
    create("broadcasts", "broadcasts", draft),
    get("broadcasts", "broadcasts"),
    list("broadcasts", "broadcasts"),
    update("broadcasts", "broadcasts", { draft, revision: 0 }),
    {
      title: "Preview",
      method: "GET",
      path: `/broadcasts/${id}/preview?contact=${encodeURIComponent(contact)}`,
      call: "broadcasts.preview",
      args: [id, contact],
    },
    {
      title: "Test email",
      method: "POST",
      path: `/broadcasts/${id}/test`,
      call: "broadcasts.test",
      args: [id, { to: contact, previewEmail: contact }],
      body: { to: contact, previewEmail: contact },
    },
    {
      title: "Send broadcast",
      method: "POST",
      path: `/broadcasts/${id}/send`,
      call: "broadcasts.send",
      args: [id, { revision: 0, confirmed: true }],
      body: { revision: 0, confirmed: true },
      note: "Use the latest draft revision. Sending queues delivery to eligible recipients. Optional scheduledAt is a Unix timestamp in milliseconds. If a request times out, retrieve the broadcast before deciding whether to retry.",
    },
    {
      title: "List recipients",
      method: "GET",
      path: `/broadcasts/${id}/recipients?limit=20`,
      call: "broadcasts.recipients",
      args: [id, { limit: 20 }],
    },
    {
      title: "Cancel",
      method: "POST",
      path: `/broadcasts/${id}/cancel`,
      call: "broadcasts.cancel",
      args: [id],
    },
    {
      title: "Duplicate",
      method: "POST",
      path: `/broadcasts/${id}/duplicate`,
      call: "broadcasts.duplicate",
      args: [id],
    },
  ],
  Contacts: [
    create("contacts", "contacts", {
      email: contact,
      ...profile,
    } satisfies ContactInput),
    get("contacts", "contacts", contact),
    list("contacts", "contacts"),
    update("contacts", "contacts", { contact: profile, revision: 0 }, contact),
    {
      title: "Update or clear selected contact properties",
      method: "PATCH",
      path: `/contacts/${encodeURIComponent(contact)}/properties`,
      call: "contacts.patchProperties",
      args: [contact, { properties: { company_name: null }, revision: 0 }],
      body: { properties: { company_name: null }, revision: 0 },
      note: "Requires contacts:write. Null clears only the named key; other properties, names, memberships and preferences are preserved. Use the current contact revision; reload after a 409.",
    },
    {
      title: "Update topic subscription",
      method: "POST",
      path: `/contacts/${encodeURIComponent(contact)}/topics/${topicId}`,
      call: "contacts.subscribe",
      args: [
        contact,
        topicId,
        {
          subscribed: true,
          source: "Signup form with explicit consent",
          confirmed: true,
        },
      ],
      body: {
        subscribed: true,
        source: "Signup form with explicit consent",
        confirmed: true,
      },
      note: "Creating a contact or adding segment membership does not subscribe it to a topic. Record consent explicitly.",
    },
    {
      title: "Unsubscribe from one topic",
      method: "POST",
      path: `/contacts/${encodeURIComponent(contact)}/topics/${topicId}/unsubscribe`,
      call: "contacts.unsubscribeTopic",
      args: [contact, topicId],
      note: "Requires contacts:subscriptions. No consent assertion or body needed. Preserves membership, profile, other topic preferences and suppression status. Use an Example App-only topic for Example App marketing.",
    },
    {
      title: "Unsubscribe from all broadcasts",
      method: "POST",
      path: `/contacts/${encodeURIComponent(contact)}/unsubscribe`,
      call: "contacts.unsubscribe",
      args: [contact],
      note: "Global marketing opt-out across every app in this Narada workspace. Use unsubscribeTopic for one app’s topic. Transactional emails remain subject to delivery suppressions.",
    },
  ],
  Properties: [
    create("properties", "contactProperties", property),
    get("properties", "contactProperties", "company_name"),
    update(
      "properties",
      "contactProperties",
      { property: { ...property, fallback: "Acme" }, revision: 0 },
      "company_name",
    ),
    list("properties", "contactProperties"),
  ],
  Segments: [
    create("segments", "segments", segment),
    get("segments", "segments"),
    list("segments", "segments"),
    update("segments", "segments", { segment, revision: 0 }),
    {
      title: "Import contacts",
      method: "POST",
      path: `/segments/${id}/import`,
      call: "segments.import",
      args: [
        id,
        {
          csv: "email,first_name\nalex@example.com,Alex",
          consentSource: "Confirmed signup form",
          consentConfirmed: true,
          topicIds: [topicId],
        },
      ],
      body: {
        csv: "email,first_name\nalex@example.com,Alex",
        consentSource: "Confirmed signup form",
        consentConfirmed: true,
        topicIds: [topicId],
      },
      note: "Requires segments:import or Full access. Manual segments only. Existing profiles and opt-outs are preserved. For JSON contact creation, use contacts.create, then segments.addContact without consent fields.",
    },
    {
      title: "List members",
      method: "GET",
      path: `/segments/${id}/contacts?limit=20`,
      call: "segments.contacts",
      args: [id, { limit: 20 }],
    },
    {
      title: "Add member",
      method: "POST",
      path: `/segments/${id}/contacts/${encodeURIComponent(contact)}`,
      call: "segments.addContact",
      args: [id, contact],
      note: "Requires segments:members or Full access, an existing contact and a manual segment. Membership only: preserves all preferences and suppressions and grants no marketing permission. Repeat additions preserve the original membership.",
    },
    {
      title: "Remove member",
      method: "DELETE",
      path: `/segments/${id}/contacts/${encodeURIComponent(contact)}`,
      call: "segments.removeContact",
      args: [id, contact],
    },
  ],
  Topics: [
    create("topics", "topics", topic),
    get("topics", "topics"),
    list("topics", "topics"),
    update("topics", "topics", {
      topic: { ...topic, active: false },
      revision: 0,
    }),
  ],
};
// API-key callers send directly; MCP OAuth callers use owner approval.
export const examples = directExamples;

// One key per logical operation. Reuse it only when retrying that same request.
for (const example of Object.values(examples).flat()) {
  if (
    example.method === "GET" ||
    example.path.endsWith("/preview") ||
    example.idempotencyKey
  )
    continue;
  example.idempotencyKey = `example-${example.call.replaceAll(".", "-")}-1`;
  example.args.push({ idempotencyKey: example.idempotencyKey });
  example.note = [
    example.note,
    "Keep this key for retries of this operation; use a fresh key for a new operation.",
  ]
    .filter(Boolean)
    .join(" ");
}
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
export function snippet(
  example: Example,
  language: "Node.js" | "cURL",
  origin: string,
) {
  if (language === "Node.js")
    return `import { Narada } from '@durgadigital/narada';\n\nconst narada = new Narada({\n  baseUrl: ${JSON.stringify(origin)},\n  apiKey: process.env.NARADA_API_KEY,\n});\n\nconst result = await narada.${example.call}(\n${example.args.map((arg) => JSON.stringify(arg, null, 2)).join(",\n")}\n);\nconsole.log(result);`;
  const parts = [
    `curl --fail-with-body -X ${example.method} ${quote(`${origin}/api/v1${example.path}`)}`,
    '  -H "Authorization: Bearer $NARADA_API_KEY"',
  ];
  if (example.idempotencyKey)
    parts.push(`  -H ${quote(`Idempotency-Key: ${example.idempotencyKey}`)}`);
  if (example.body !== undefined)
    parts.push(
      `  -H 'Content-Type: application/json'`,
      `  --data-raw ${quote(JSON.stringify(example.body, null, 2))}`,
    );
  return parts.join(" \\\n");
}
