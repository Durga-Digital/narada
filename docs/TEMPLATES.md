# Templates

Templates are reusable email designs with editable drafts, stable aliases, and immutable published versions. They use the existing DynamoDB application table and the same email delivery pipeline. No new AWS resources or third-party services are needed.

## Local walkthrough

1. Open **Templates → New template**. Choose a design from the visual starter gallery: blank transactional/broadcast, Welcome, Verification code, or Product update. Give it a permanent lowercase alias such as `welcome-email`.
2. The **Design** workspace opens blank and built-in starters directly in the visual block editor. Unmodified legacy starter bodies are also recognized on open; their published versions remain unchanged. Custom imported HTML opens as a rendered email, with **Edit HTML** for source editing and **Convert to blocks** for an explicit conversion. Conversion retains supported inline typography, colors, spacing, borders, and table/cell styles; imported stylesheets, responsive/dark-mode rules, Outlook conditionals, and unsupported CSS are omitted, so layouts can change. Viewing source and returning to design preserves the block document when source is unchanged. Templates and broadcasts share the same editor, block controls, style inspector, and sandboxed preview. Improved inline-style conversion is implemented locally and requires deployment.
3. Define variables and optional fallbacks in **Variables**. Insert them with **Insert variable**, or type `{{vars.first_name}}`. **Preview & test** shows the current composition without saving; fill the sample-value fields and choose **Preview draft** to save and apply those values. Switch between desktop/mobile widths, rendered HTML, source HTML, and plain text, and test with a verified sender. Locally use `hello@narada.test` and inspect the result in [Mailpit](http://localhost:8025).
4. **Publish template** saves the editor and creates an immutable published version. Later draft changes do not affect live API sends. **Preview published** uses the last published version, not unsaved edits.
5. In **Settings**, for a broadcast template, **Use in broadcast** copies published content into a separate draft. Set recipients, topic, sender, organization/address, then review and send through the normal broadcast flow. This button does not send anything.

Use **Save as template** in an existing broadcast to capture its message as a new unpublished template; recipients, sender details, and scheduling are excluded.

Search filters loaded templates by name/alias; load more to search additional pages. Grid/list and status filters are available. Duplicate makes an unpublished copy of the saved draft. Archive blocks future template resolution; restore re-enables it. Copies already in broadcasts or accepted email jobs keep their own content. The library thumbnail shows the saved draft, including unresolved placeholders, rather than sample data.

## Variables and content

Variables support string, number, boolean, and URL types. Missing referenced variables require a fallback or explicit value. Empty strings, `false`, and `0` are valid supplied values. Unknown variables, duplicate keys, mismatched types, malformed placeholders, and header newlines are rejected. Values never execute as template code; HTML values are escaped.

Use URL variables for links: `<a href="{{vars.reset_url}}">Reset password</a>`. A URL variable must occupy the entire quoted href and must resolve to HTTP(S) without embedded credentials. Dynamic styles, scripts, arbitrary attributes, and partial URLs are not supported. Template values cannot contain nested template expressions. This is substitution, not an executable template language: there are no loops or conditionals.

Broadcast templates may also contain `{{contact.first_name}}` and custom contact properties. Those remain placeholders until the broadcast resolves recipients. Transactional templates use `vars` only. Broadcasts still add their organization/address footer and unsubscribe/preference links. Transactional templates do not automatically receive marketing footers. Template tests may show literal contact placeholders; recipient-specific tests belong to the broadcast editor.

The starter designs compose shared layout/text primitives. Reusable templates and the editor's built-in blocks are available now; saved partials that update across multiple templates, a marketplace, image hosting, and arbitrary React code execution are not part of this release. Source HTML can be supplied through the API from your own React Email build.

## API and Node.js

Choose `templates:read` for list/get/preview, `templates:write` for create/update/publish/archive/duplicate, and `templates:test` for test sends, or use **Full access**. Creating a broadcast from a template requires both `templates:read` and `broadcasts:write`. Sending keys can send published transactional templates through `/api/v1/emails`, but cannot read or edit the library. IDs and aliases can both address templates.

```js
import { Narada } from "@durgadigital/narada";
const narada = new Narada({
  baseUrl: "http://localhost:5173",
  apiKey: process.env.NARADA_API_KEY,
});
const template = await narada.templates.create({
  alias: "welcome-email",
  name: "Welcome",
  kind: "transactional",
  subject: "Hello {{vars.first_name}}",
  html: "<p>Welcome, {{vars.first_name}}</p>",
  text: "Welcome, {{vars.first_name}}",
  variables: [{ key: "first_name", type: "string", fallback: "friend" }],
});
const published = await narada.templates.publish(template.id, {
  revision: template.revision,
});
await narada.emails.send(
  {
    from: "hello@narada.test",
    to: "alex@example.com",
    template: {
      id: template.alias,
      version: published.publishedVersion,
      variables: { first_name: "Alex" },
    },
  },
  { idempotencyKey: "welcome-user-123" },
);
```

A template send must not also contain subject, HTML, or text overrides. Provide the sender/recipients and optional reply-to/expiry at send time. Variables and the published version resolve before durable acceptance; workers send the stored content. Omitting `version` selects the current publication. Pin the version for repeatable idempotent retries: after a new publication, the same idempotency key with different resolved content returns 409 rather than silently sending again. An archived template rejects resolution even if an earlier request used the same idempotency key; GET the email to inspect an already accepted send.

Supported routes under `/api/v1`:

| Route                       | Method and input                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `/templates`                | GET paginated list; POST `{alias, name, kind, subject, html, text, variables}`                    |
| `/templates/:id`            | GET; PUT `{draft, revision}`                                                                      |
| `/templates/:id/publish`    | POST `{revision}`                                                                                 |
| `/templates/:id/preview`    | POST `{variables?, version?}`; without version previews the saved draft                           |
| `/templates/:id/test`       | POST `{from, to, variables?}`; tests the saved draft                                              |
| `/templates/:id/broadcasts` | POST `{variables?, version?, name?, audienceId?, topicId?, from?, organization?, postalAddress?}` |
| `/templates/:id/duplicate`  | POST `{alias}`                                                                                    |
| `/templates/:id/archive`    | POST `{archived, revision}`                                                                       |

The SDK exposes matching `templates` methods. Updates replace the draft input and use revision checks. Public get/list responses omit the editor document; source updates through the SDK replace any prior editor document. Publication numbers increase separately from draft revisions. Versions are retained permanently in the application table; archived aliases remain reserved. Drafts are limited to 300 KB, 30 variables, 50,000 HTML characters, and 30,000 plain-text characters. Existing email/broadcast field limits apply again after rendering.

## Verification

Tests cover variable types/escaping, URL contexts, missing values, starter designs, unique aliases, concurrent publication, revision conflicts, version pinning, idempotency, restricted keys, archiving/restoration, independent broadcast copies, browser editing/preview/publication, and local Mailpit delivery. Local checks do not validate rendering in every email client or live SES account permissions.
