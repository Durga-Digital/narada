/** Public v1 contracts. No database or server-runtime dependencies. */
export type PropertyValue = string | number | boolean;
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
export interface ListOptions {
  limit?: number;
  cursor?: string;
}
export interface EmailInput {
  tags?: Record<string, string>;
  priority?: "normal" | "high";
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
  expires_in?: number;
}
export interface EmailAccepted {
  id: string;
  replayed: boolean;
}
export interface EmailStatus {
  tags: Record<string, string>;
  priority: "normal" | "high";
  id: string;
  status: string;
  created_at: string;
  events: {
    id: string;
    type: string;
    at: string;
    recipients: string[];
    reason?: string;
    permanent?: boolean;
  }[];
}
export interface PropertyInput {
  key: string;
  type: "string" | "number" | "boolean" | "date";
  fallback?: PropertyValue;
}
export interface Property extends PropertyInput {
  revision: number;
  createdAt: string;
}
export interface ContactInput {
  email: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  properties?: Record<string, PropertyValue>;
}
export interface Contact {
  email: string;
  name: string;
  first_name: string;
  last_name: string;
  properties: Record<string, PropertyValue>;
  revision: number;
  addedAt: string;
}
export interface TopicInput {
  name: string;
  description?: string;
  visibility?: "public" | "private";
  active?: boolean;
}
export interface Topic {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  active: boolean;
  revision: number;
  createdAt: string;
}
export interface ContactDetails {
  contact: Contact;
  topics: (Topic & { subscribed: boolean })[];
  unsubscribedAll: boolean;
}
export interface SegmentRule {
  property: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "greater_than"
    | "less_than"
    | "is_set"
    | "is_not_set";
  value?: PropertyValue;
}
export interface SegmentInput {
  name: string;
  kind: "manual" | "dynamic";
  match?: "all" | "any";
  rules?: SegmentRule[];
}
export interface Segment {
  id: string;
  name: string;
  kind: "manual" | "dynamic";
  match: "all" | "any";
  rules: SegmentRule[];
  revision: number;
  total: number;
  updatedAt: string;
}
export interface SegmentMember {
  email: string;
  name: string;
  addedAt: string;
}
/** Membership is organizational only. Use contacts.subscribe for topic opt-in. */
export type SegmentMembershipInput = Record<string, never>;
export interface ImportInput {
  csv: string;
  consentSource: string;
  consentConfirmed: true;
  topicIds?: string[];
}
export interface BroadcastInput {
  name: string;
  audienceId?: string;
  topicId?: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  organization?: string;
  postalAddress?: string;
  replyTo?: string;
}
export interface Broadcast {
  id: string;
  draft: BroadcastInput;
  status: "draft" | "scheduled" | "sending" | "completed" | "cancelled";
  revision: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  scheduledAt?: number;
}
export interface Recipient {
  email: string;
  name: string;
  messageId: string;
  status: string;
  error?: string;
}
export interface Preview {
  subject: string;
  html: string;
  text?: string;
  eligible: number;
  total: number;
  excluded: number;
  previewEmail?: string;
}
export interface SendBroadcastInput {
  revision: number;
  confirmed: true;
  scheduledAt?: number;
}
export interface SubscriptionInput {
  subscribed: boolean;
  source: string;
  confirmed: true;
}
export interface Ok {
  ok: true;
}

export interface TemplateVariable {
  key: string;
  type?: "string" | "number" | "boolean" | "url";
  fallback?: PropertyValue;
}
export interface TemplateContent {
  name: string;
  kind?: "transactional" | "broadcast";
  subject?: string;
  html?: string;
  text?: string;
  variables?: TemplateVariable[];
}
export interface Template {
  id: string;
  alias: string;
  draft: TemplateContent;
  revision: number;
  publishedVersion?: number;
  archived: boolean;
  status: "draft" | "published" | "archived";
  hasUnpublishedChanges: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface TemplateEmailInput {
  tags?: Record<string, string>;
  priority?: "normal" | "high";
  from: string;
  to: string | string[];
  reply_to?: string;
  expires_in?: number;
  template: {
    id: string;
    version?: number;
    variables?: Record<string, PropertyValue>;
  };
}
export interface TemplatePreviewInput {
  variables?: Record<string, PropertyValue>;
  version?: number;
}
export interface TemplateBroadcastInput extends TemplatePreviewInput {
  name?: string;
  audienceId?: string;
  topicId?: string;
  from?: string;
  organization?: string;
  postalAddress?: string;
}

export interface Capabilities {
  contractVersion: string;
  apiVersion: "v1";
  environment: string;
  permissionModel:
    "legacy-key-v1" | "delegated-v1" | "operation-key-v1" | "owner";
  scopes: string[];
  resources: {
    senderDomains?: string[];
    publicationIds?: string[];
    formIds?: string[];
  };
  operations: {
    id: string;
    description?: string;
    http?: {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      status: 200 | 201 | 202;
    };
    scopes: readonly string[];
    anyScopes?: readonly string[];
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
  }[];
  pagination: { defaultLimit: number; maxLimit: number };
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  paths: Record<string, unknown>;
  components: { securitySchemes: Record<string, unknown> };
}

export interface FormQuestionInput {
  id: string;
  label: string;
  type: "text" | "long_text" | "email" | "choice" | "rating" | "consent";
  description?: string;
  required?: boolean;
  options?: string[];
  property?: string;
}
export interface FormInput {
  name: string;
  kind: "intake" | "feedback" | "signup";
  questions: FormQuestionInput[];
  description?: string;
  brand?: string;
  color?: string;
  thankYou?: string;
  syncContacts?: boolean;
  /** Manual audience for confirmed respondents who checked the consent answer. */
  audienceId?: string;
  topicId?: string;
  from?: string;
  acknowledgment?: boolean;
}
export interface Form {
  id: string;
  draft: FormInput;
  publicationId?: string;
  revision: number;
  version: number;
  publishedRevision?: number;
  accepting: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface FormResponseSummary {
  id: string;
  formId: string;
  version: number;
  createdAt: string;
  email?: string;
  verifiedAt?: string;
  syncedAt?: string;
  status: "pending" | "awaiting_verification" | "complete" | "failed";
  attempts: number;
  revision: number;
  error?: string;
}
export interface FormResponseDetail {
  response: FormResponseSummary & { answers: Record<string, PropertyValue> };
  content: FormInput;
}
export interface FormPreview {
  content: FormInput;
  version: number;
  accepting: boolean;
}
export interface FormExport {
  csv: string;
  nextCursor: string | null;
}
export interface PublicationInput {
  name: string;
  slug: string;
  description?: string;
  author?: string;
  color?: string;
  from?: string;
  replyTo?: string;
  organization?: string;
  postalAddress?: string;
  privacyUrl?: string;
}
export interface PublicationBranding {
  theme: "classic" | "editorial" | "minimal";
  logoAssetId: string | null;
  logoAlt: string;
  welcomeText: string;
  layout?: "letter" | "feature" | "grid";
  wordmarkAssetId?: string | null;
  wordmarkAlt?: string;
  coverAssetId?: string | null;
  coverAlt?: string;
  signupHeading?: string;
  signupDescription?: string;
  signupButton?: string;
  signupName?: boolean;
}
export interface PublicationLogoInput {
  fileName: string;
  contentBase64: string;
}
export interface PublicationLogo {
  publicationId: string;
  id: string;
  url: string;
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}
export interface Publication {
  branding?: PublicationBranding;
  id: string;
  settings: PublicationInput;
  status: "draft" | "active" | "archived";
  formId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface Subscriber {
  email: string;
  name: string;
  subscribed: boolean;
  eligible: boolean;
  deliveryStatus: string;
}
export type IssueStatus =
  "draft" | "scheduled" | "published" | "sent" | "withdrawn";
export interface IssueListOptions extends ListOptions {
  collectionId?: string;
  status?: IssueStatus;
}
export interface IssueDeleteResult {
  id: string;
  deleted: true;
}
export interface IssueInput {
  coverAssetId?: string | null;
  coverAlt?: string;
  title: string;
  slug: string;
  subtitle?: string;
  subject?: string;
  preheader?: string;
  document: {
    type: "doc";
    content: unknown[];
    attrs?: Record<string, unknown>;
  };
}
export interface Issue {
  id: string;
  publicationId: string;
  draft: IssueInput;
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  webUpdatedAt?: string;
  scheduledAt?: number;
  emailReleased?: boolean;
  webPublished: boolean;
  status?: IssueStatus;
  canDelete?: boolean;
}
export interface IssuePreview {
  web: { html: string; text: string };
  email: { html: string; text: string };
  eligible: number;
  excluded: number;
  subject: string;
  from: string;
  url: string;
}
export interface IssuePublishInput {
  revision: number;
  channels: "web" | "email" | "both";
  confirmed: true;
  scheduledAt?: number;
}
export interface IssueDelivery {
  status: string | null;
  counts: Record<string, number>;
  total: number;
}

/** Mutation outcome is separate from asynchronous work and recipient delivery. */
export interface OperationTarget {
  kind: string;
  id: string;
}
export interface OperationStatus {
  id: string;
  operation: string;
  transport: "api" | "mcp" | "dashboard";
  actor:
    | { kind: "session"; userId: string }
    | { kind: "api-key"; keyId: string }
    | { kind: "oauth"; userId: string; clientId: string; grantId: string };
  requestId: string;
  status: "running" | "succeeded" | "failed" | "unknown";
  createdAt: string;
  updatedAt: string;
  targets: OperationTarget[];
  revision?: number;
  replayExpiresAt?: string;
  recovery:
    | "retry_same_key"
    | "replay_available"
    | "reconcile"
    | "expired"
    | "no_retry_key";
  statusUrl: string;
  work: {
    kind:
      | "publication"
      | "broadcast"
      | "message"
      | "form-response"
      | "publication-domain";
    status: string;
  }[];
}
export interface OperationLookup {
  operation: string;
  idempotencyKey: string;
  params?: Record<string, string>;
}

// Shared with the dashboard. Only events with an implemented producer belong here.
export const webhookEvents = [
  {
    type: "form.response.received",
    group: "Forms",
    description:
      "A response was durably saved; processing or email verification may still be pending",
  },
  {
    type: "form.response.completed",
    group: "Forms",
    description:
      "Response processing completed; any acknowledgment was queued, not necessarily delivered",
  },
  {
    type: "form.response.failed",
    group: "Forms",
    description:
      "Response processing exhausted its automatic attempts; the saved response remains available",
  },
  {
    type: "issue.published",
    group: "Publications",
    description:
      "An issue version was released to its selected channels, including web corrections; email delivery may still be pending",
  },
  {
    type: "broadcast.completed",
    group: "Broadcasts",
    description:
      "Every snapshot recipient left pending, queued or submitting; this is not confirmation of delivery",
  },
  {
    type: "email.delivered",
    group: "Email",
    description: "Recipient mail server accepted the message",
  },
  { type: "email.delayed", group: "Email", description: "Delivery is delayed" },
  {
    type: "email.bounced",
    group: "Email",
    description: "SES reported a bounce",
  },
  {
    type: "email.complained",
    group: "Email",
    description: "Recipient reported spam",
  },
  {
    type: "email.failed",
    group: "Email",
    description: "SES rejected or could not render the message",
  },
  {
    type: "contact.created",
    group: "Contacts",
    description: "A contact was added to the directory",
  },
  {
    type: "contact.updated",
    group: "Contacts",
    description: "A contact profile changed",
  },
  {
    type: "contact.topics.updated",
    group: "Contacts",
    description: "A topic subscription changed",
  },
  {
    type: "topic.created",
    group: "Topics",
    description: "A topic was created",
  },
  {
    type: "topic.updated",
    group: "Topics",
    description: "A topic was edited or archived",
  },
  {
    type: "domain.created",
    group: "Domains",
    description: "A sender domain was added",
  },
  {
    type: "domain.updated",
    group: "Domains",
    description: "Domain verification or authentication settings changed",
  },
  {
    type: "suppression.added",
    group: "Suppressions",
    description: "A recipient was suppressed manually or by feedback",
  },
  {
    type: "suppression.removed",
    group: "Suppressions",
    description: "A suppression was removed",
  },
] as const;
export type WebhookEventType = (typeof webhookEvents)[number]["type"];
export const legacyWebhookEvents: WebhookEventType[] = webhookEvents
  .filter((e) => e.group === "Email")
  .map((e) => e.type);
export interface WebhookPayload {
  id: string;
  type: WebhookEventType;
  created_at: string;
  data: Record<string, unknown>;
}

export type DnsCheck = "found" | "missing" | "invalid" | "unknown" | "local";
export interface DmarcCheck {
  status: DnsCheck;
  name: string;
  record?: string;
  inherited?: boolean;
  policy?: "none" | "quarantine" | "reject";
  alignment?: { dkim: "r" | "s"; spf: "r" | "s" };
  message: string;
}
export interface MailFromSettings {
  domain: string | null;
  behavior: "USE_DEFAULT_VALUE" | "REJECT_MESSAGE";
}
export interface DomainAuthentication {
  checkedAt: string;
  dkim: { status: string; signingEnabled: boolean | null; origin?: string };
  dmarc: DmarcCheck;
  mailFrom: MailFromSettings & {
    status: string;
    mx: DnsCheck;
    spf: DnsCheck;
    records: { name: string; type: string; value: string }[];
  };
}

export interface SesStatus {
  mode: "local" | "aws";
  region: string;
  configurationSet: string;
  checkedAt: string | null;
  account: null | {
    productionAccess: boolean | null;
    sendingEnabled: boolean | null;
    enforcementStatus: string | null;
    maxPerSecond: number | null;
    maxPer24Hours: number | null;
    sentLast24Hours: number | null;
  };
  delivery: null | {
    poolName: string | null;
    tlsPolicy: string | null;
    sendingEnabled: boolean | null;
  };
}

export interface SendingStatus {
  mode: "local" | "aws";
  region: string;
  paused: boolean;
  revision: number;
}
export interface SenderDomain {
  revision: number;
  name: string;
  verified: boolean;
  local: boolean;
  region?: string;
  checkedAt?: string;
  createdAt?: string;
  records: { type: string; name: string; value: string }[];
  authentication?: DomainAuthentication;
}
export interface MetricsOptions {
  days?: number;
  domain?: string;
}
export type MetricCounts = Record<
  | "accepted"
  | "submitted"
  | "captured"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "failed",
  number
>;
export interface SendingMetrics {
  mode: "local" | "aws";
  fetchedAt: string;
  startedAt: string | null;
  days: { day: string; counts: MetricCounts }[];
  totals: MetricCounts;
  domains: { domain: string; counts: MetricCounts }[];
}
export interface Suppression {
  email: string;
  reason: string;
}
export interface SuppressionListOptions extends ListOptions {
  email?: string;
}
export interface WebhookInput {
  url: string;
  events: WebhookEventType[];
}
export interface WebhookEndpoint extends WebhookInput {
  id: string;
  revision: number;
  createdAt: string;
}
export interface WebhookCreated extends WebhookEndpoint {
  secret: string;
}
export interface WebhookDelivery {
  id: string;
  endpointId: string;
  state: string;
  attempts: number;
  cycleAttempts: number;
  payload?: { id?: string; type?: string; created_at?: string };
  createdAt?: string;
  completedAt?: string;
  lastStatus?: number;
  error?: string;
  nextAttemptAt?: number;
  expiresAt?: string;
}
export interface WebhookAttempt {
  id: string;
  attempt: number;
  outcome: string;
  startedAt: string;
  finishedAt?: string;
  status?: number;
  error?: string;
}
export interface WebhookHistory extends Page<WebhookAttempt> {
  delivery: WebhookDelivery;
}

/** Agent sends are proposed here; approval is restricted to the owner session. */
export type SendApprovalRequest =
  | {
      operation: "emails.send";
      input: { body: EmailInput | TemplateEmailInput };
    }
  | {
      operation: "broadcasts.send";
      input: { params: { id: string }; body: SendBroadcastInput };
    }
  | {
      operation: "broadcasts.test";
      input: {
        params: { id: string };
        body: { to: string; previewEmail?: string };
      };
    }
  | {
      operation: "templates.test";
      input: {
        params: { id: string };
        body: {
          from: string;
          to: string;
          variables?: Record<string, PropertyValue>;
        };
      };
    }
  | {
      operation: "issues.test";
      input: {
        params: { id: string; issueId: string };
        body: { to: string; revision: number };
      };
    }
  | {
      operation: "issues.publish";
      input: {
        params: { id: string; issueId: string };
        body: IssuePublishInput;
      };
    };
export interface SendApproval {
  messageId?: string;
  id: string;
  operation: SendApprovalRequest["operation"];
  status:
    "pending" | "executing" | "succeeded" | "rejected" | "expired" | "unknown";
  requestedBy:
    | { kind: "oauth"; userId: string; clientId: string }
    | { kind: "api-key"; keyId: string };
  createdAt: string;
  expiresAt: string;
  reviewUrl: string;
  operationId?: string;
  decidedAt?: string;
  decidedBy?: string;
}
/** Owner-only preview. Never returned by MCP or public API approval reads. */
export interface SendApprovalReview extends SendApproval {
  priority?: "normal" | "high";
  tags?: Record<string, string>;
  expiresInSeconds?: number;
  webHtml?: string;
  webText?: string;
  digest?: string;
  from?: string;
  replyTo?: string;
  subject?: string;
  html?: string;
  text?: string;
  recipients?: string[];
  previewRecipient?: string;
  scheduledAt?: number;
  channels?: "web" | "email" | "both";
}

/** A website connection is independent of the publication and SES identity revisions. */
export type PublicationDomainState =
  | "awaiting_ownership"
  | "awaiting_certificate"
  | "provisioning"
  | "awaiting_dns"
  | "ready"
  | "active"
  | "degraded"
  | "suspended"
  | "disconnecting"
  | "disconnected"
  | "failed";
export interface PublicationDomainRecord {
  purpose: "ownership" | "certificate" | "website";
  type: "TXT" | "CNAME";
  name: string;
  shortName: string;
  value: string;
  status: "pending" | "verified" | "missing" | "unknown";
}
export interface PublicationDomain {
  id: string;
  publicationId: string;
  hostname: string;
  revision: number;
  state: PublicationDomainState;
  records: PublicationDomainRecord[];
  certificate: {
    status: "not_requested" | "pending" | "issued" | "invalid";
    expiresAt?: string;
  };
  routing: "not_created" | "deploying" | "deployed" | "disabled" | "deleted";
  lastCheckedAt?: string;
  nextCheckAt?: string;
  message?: string;
  defaultUrl: string;
  preferredUrl: string;
}
export interface PublicationDomainResult {
  domain: PublicationDomain | null;
  defaultUrl: string;
  preferredUrl: string;
}
export interface PublicationDomainConfigureInput {
  hostname: string;
  revision: number;
}
export interface PublicationDomainRevisionInput {
  revision: number;
}

export interface DomainRegistrationInput {
  name: string;
}
export interface DomainMailFromInput {
  domain: string | null;
  behavior: "USE_DEFAULT_VALUE" | "REJECT_MESSAGE";
  revision: number;
}
export interface IntegrationGuide {
  installationUrl: string;
  mcpUrl: string;
  title: string;
  markdown: string;
}
export type SearchKind =
  | "domains"
  | "forms"
  | "publications"
  | "contacts"
  | "templates"
  | "broadcasts"
  | "segments"
  | "topics";
export interface ResourceSearchOptions {
  kind: SearchKind;
  text: string;
  limit?: number;
  cursor?: string;
}
export interface ResourceReference {
  kind: SearchKind;
  id: string;
  name: string;
  revision?: number;
  status?: string;
}

export interface PublicationAboutInput {
  title: string;
  document: IssueInput["document"];
}
export type PublicationNavigationItem =
  | { type: "home" | "archive" | "about" | "subscribe"; label: string }
  | { type: "collection"; label: string; collectionId: string }
  | { type: "external"; label: string; url: string };
export interface PublicationSiteInput {
  navigation: PublicationNavigationItem[];
  featuredIssueId: string | null;
  collectionIds: string[];
}
export interface PublicationAbout {
  publicationId: string;
  revision: number;
  draft: PublicationAboutInput;
  published: {
    versionId: string;
    publishedAt: string;
    content: PublicationAboutInput;
  } | null;
}
export interface PublicationSite {
  publicationId: string;
  revision: number;
  draft: PublicationSiteInput;
  published: {
    versionId: string;
    publishedAt: string;
    content: PublicationSiteInput;
  } | null;
}
export interface EditorialCollectionInput {
  name: string;
  slug: string;
  description: string;
}
export interface EditorialCollection extends EditorialCollectionInput {
  id: string;
  publicationId: string;
  revision: number;
  status: "active" | "archived";
}
export interface IssueCollections {
  publicationId: string;
  issueId: string;
  revision: number;
  issueRevision: number;
  collectionIds: string[];
}
