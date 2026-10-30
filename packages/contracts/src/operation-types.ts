import type * as T from "./types.js";
import type { OperationId } from "./operations.js";

// Transport-neutral request envelope. Path/query/body retain v1 field names.
// Authentication and delegation are intentionally absent from every input.
type Empty = Record<string, never>;
type Contract<Input, Output> = { input: Input; output: Output };
type Get = { params: { id: string } };
type Email = { params: { email: string } };
type Body<B> = { body: B };
type List = { query?: T.ListOptions };
type Update<B> = Get & Body<{ draft: B; revision: number }>;
type Member = { params: { id: string; email: string } };

export interface OperationContracts {
  "publications.about.get": Contract<
    { params: { id: string } },
    T.PublicationAbout
  >;
  "publications.about.update": Contract<
    { params: { id: string } } & Body<{
      revision: number;
      draft: T.PublicationAboutInput;
    }>,
    T.PublicationAbout
  >;
  "publications.about.preview": Contract<
    { params: { id: string } } & Body<{
      revision: number;
      draft?: T.PublicationAboutInput;
    }>,
    { html: string }
  >;
  "publications.about.publish": Contract<
    { params: { id: string } } & Body<{ revision: number }>,
    T.PublicationAbout
  >;
  "publications.about.withdraw": Contract<
    { params: { id: string } } & Body<{ revision: number }>,
    T.PublicationAbout
  >;
  "publications.site.get": Contract<
    { params: { id: string } },
    T.PublicationSite
  >;
  "publications.site.update": Contract<
    { params: { id: string } } & Body<{
      revision: number;
      draft: T.PublicationSiteInput;
    }>,
    T.PublicationSite
  >;
  "publications.site.preview": Contract<
    { params: { id: string } } & Body<{
      revision: number;
      draft?: T.PublicationSiteInput;
    }>,
    { html: string }
  >;
  "publications.site.publish": Contract<
    { params: { id: string } } & Body<{ revision: number }>,
    T.PublicationSite
  >;
  "publications.collections.list": Contract<
    { params: { id: string } } & List,
    T.Page<T.EditorialCollection>
  >;
  "publications.collections.create": Contract<
    { params: { id: string } } & Body<T.EditorialCollectionInput>,
    T.EditorialCollection
  >;
  "publications.collections.get": Contract<
    { params: { id: string; collectionId: string } },
    T.EditorialCollection
  >;
  "publications.collections.update": Contract<
    { params: { id: string; collectionId: string } } & Body<{
      revision: number;
      name: string;
      description: string;
    }>,
    T.EditorialCollection
  >;
  "publications.collections.archive": Contract<
    { params: { id: string; collectionId: string } } & Body<{
      revision: number;
    }>,
    T.EditorialCollection
  >;
  "issues.collections.get": Contract<
    { params: { id: string; issueId: string } },
    T.IssueCollections
  >;
  "issues.collections.update": Contract<
    { params: { id: string; issueId: string } } & Body<{
      revision: number;
      issueRevision: number;
      collectionIds: string[];
    }>,
    T.IssueCollections
  >;
  "approvals.request": Contract<Body<T.SendApprovalRequest>, T.SendApproval>;
  "approvals.list": Contract<List, T.Page<T.SendApproval>>;
  "approvals.get": Contract<Get, T.SendApproval>;
  "sending.get": Contract<Empty, T.SendingStatus>;
  "sending.update": Contract<
    Body<{ paused: boolean; revision: number }>,
    T.SendingStatus
  >;
  "sending.diagnostics": Contract<Empty, T.SesStatus>;
  "metrics.get": Contract<{ query?: T.MetricsOptions }, T.SendingMetrics>;
  "domains.create": Contract<Body<T.DomainRegistrationInput>, T.SenderDomain>;
  "domains.mailFrom.update": Contract<
    { params: { name: string }; body: T.DomainMailFromInput },
    T.SenderDomain
  >;
  "domains.dkim.enable": Contract<
    { params: { name: string }; body: { revision: number } },
    T.SenderDomain
  >;
  "integration.guide": Contract<Empty, T.IntegrationGuide>;
  "resources.search": Contract<
    { query: T.ResourceSearchOptions },
    T.Page<T.ResourceReference>
  >;
  "domains.list": Contract<List, T.Page<T.SenderDomain>>;
  "domains.get": Contract<{ params: { name: string } }, T.SenderDomain>;
  "domains.refresh": Contract<{ params: { name: string } }, T.SenderDomain>;
  "suppressions.list": Contract<
    { query?: T.SuppressionListOptions },
    T.Page<T.Suppression>
  >;
  "suppressions.get": Contract<Email, T.Suppression>;
  "suppressions.create": Contract<Body<{ email: string }>, T.Suppression>;
  "suppressions.delete": Contract<Email, { ok: true }>;
  "webhooks.events": Contract<
    Empty,
    { data: { type: T.WebhookEventType; group: string; description: string }[] }
  >;
  "webhooks.list": Contract<List, T.Page<T.WebhookEndpoint>>;
  "webhooks.get": Contract<Get, T.WebhookEndpoint>;
  "webhooks.create": Contract<Body<T.WebhookInput>, T.WebhookCreated>;
  "webhooks.update": Contract<
    Get & Body<T.WebhookInput & { revision: number }>,
    T.WebhookEndpoint
  >;
  "webhooks.delete": Contract<Get, { ok: true }>;
  "webhooks.deliveries.list": Contract<List, T.Page<T.WebhookDelivery>>;
  "webhooks.deliveries.get": Contract<Get & List, T.WebhookHistory>;
  "webhooks.deliveries.retry": Contract<Get, { ok: true }>;

  "operations.list": Contract<List, T.Page<T.OperationStatus>>;
  "operations.get": Contract<Get, T.OperationStatus>;
  "operations.lookup": Contract<Body<T.OperationLookup>, T.OperationStatus>;
  "forms.list": Contract<List, T.Page<T.Form>>;
  "forms.get": Contract<Get, T.Form>;
  "forms.create": Contract<Body<T.FormInput>, T.Form>;
  "forms.update": Contract<
    Get & Body<{ draft: T.FormInput; revision: number }>,
    T.Form
  >;
  "forms.publish": Contract<Get & Body<{ revision: number }>, T.Form>;
  "forms.close": Contract<Get & Body<{ revision: number }>, T.Form>;
  "publications.list": Contract<List, T.Page<T.Publication>>;
  "publications.get": Contract<Get, T.Publication>;
  "publications.create": Contract<Body<T.PublicationInput>, T.Publication>;
  "publications.update": Contract<
    Get & Body<{ settings: T.PublicationInput; revision: number }>,
    T.Publication
  >;
  "publications.domain.get": Contract<Get, T.PublicationDomainResult>;
  "publications.domain.configure": Contract<
    Get & Body<T.PublicationDomainConfigureInput>,
    T.PublicationDomainResult
  >;
  "publications.domain.check": Contract<
    Get & Body<T.PublicationDomainRevisionInput>,
    T.PublicationDomainResult
  >;
  "publications.domain.activate": Contract<
    Get & Body<T.PublicationDomainRevisionInput>,
    T.PublicationDomainResult
  >;
  "publications.domain.disconnect": Contract<
    Get & Body<T.PublicationDomainRevisionInput>,
    T.PublicationDomainResult
  >;
  "publications.branding.update": Contract<
    Get & Body<{ branding: T.PublicationBranding; revision: number }>,
    T.Publication
  >;
  "publications.branding.preview": Contract<
    Get & Body<{ branding: T.PublicationBranding; revision: number }>,
    { html: string }
  >;
  "publications.logo.upload": Contract<
    Get & Body<T.PublicationLogoInput>,
    T.PublicationLogo
  >;
  "publications.activate": Contract<
    Get & Body<{ revision: number }>,
    T.Publication
  >;
  "publications.archive": Contract<
    Get & Body<{ revision: number }>,
    T.Publication
  >;
  "forms.preview": Contract<Get, T.FormPreview>;
  "forms.responses.list": Contract<Get & List, T.Page<T.FormResponseSummary>>;
  "forms.responses.get": Contract<
    { params: { id: string; responseId: string } },
    T.FormResponseDetail
  >;
  "forms.responses.retry": Contract<
    { params: { id: string; responseId: string } },
    T.FormResponseSummary
  >;
  "forms.responses.export": Contract<Get & List, T.FormExport>;
  "forms.broadcasts.create": Contract<Get, T.Broadcast>;
  "publications.preview": Contract<Get, { html: string }>;
  "publications.subscribers.list": Contract<Get & List, T.Page<T.Subscriber>>;
  "issues.list": Contract<
    Get & { query?: T.IssueListOptions },
    T.Page<T.Issue>
  >;
  "issues.delete": Contract<
    { params: { id: string; issueId: string } } & Body<{ revision: number }>,
    T.IssueDeleteResult
  >;
  "publications.assets.upload": Contract<
    Get & Body<T.PublicationLogoInput>,
    T.PublicationLogo
  >;
  "issues.create": Contract<Get & Body<T.IssueInput>, T.Issue>;
  "issues.get": Contract<{ params: { id: string; issueId: string } }, T.Issue>;
  "issues.update": Contract<
    { params: { id: string; issueId: string } } & Body<{
      draft: T.IssueInput;
      revision: number;
    }>,
    T.Issue
  >;
  "issues.preview": Contract<
    { params: { id: string; issueId: string } },
    T.IssuePreview
  >;
  "issues.test": Contract<
    { params: { id: string; issueId: string } } & Body<{
      to: string;
      revision: number;
    }>,
    T.EmailAccepted
  >;
  "issues.publish": Contract<
    { params: { id: string; issueId: string } } & Body<T.IssuePublishInput>,
    T.Issue
  >;
  "issues.cancel": Contract<
    { params: { id: string; issueId: string } } & Body<{ revision: number }>,
    T.Issue
  >;
  "issues.withdraw": Contract<
    { params: { id: string; issueId: string } } & Body<{ revision: number }>,
    T.Issue
  >;
  "issues.duplicate": Contract<
    { params: { id: string; issueId: string } },
    T.Issue
  >;
  "issues.delivery.get": Contract<
    { params: { id: string; issueId: string } },
    T.IssueDelivery
  >;
  "issues.recipients.list": Contract<
    { params: { id: string; issueId: string } } & List,
    T.Page<T.Recipient>
  >;

  "emails.send": Contract<
    Body<T.EmailInput | T.TemplateEmailInput>,
    T.EmailAccepted
  >;
  "emails.get": Contract<Get, T.EmailStatus>;
  "contacts.list": Contract<List, T.Page<T.Contact>>;
  "contacts.get": Contract<Email, T.ContactDetails>;
  "contacts.create": Contract<Body<T.ContactInput>, T.Contact>;
  "contacts.properties.patch": Contract<
    Email &
      Body<{
        properties: Record<string, T.PropertyValue | null>;
        revision: number;
      }>,
    T.Contact
  >;
  "contacts.topics.unsubscribe": Contract<
    { params: { email: string; id: string } },
    T.Ok
  >;
  "contacts.update": Contract<
    Email &
      Body<{
        contact: Omit<T.Contact, "email" | "revision" | "addedAt">;
        revision: number;
      }>,
    T.Contact
  >;
  "contacts.subscribe": Contract<
    { params: { email: string; id: string } } & Body<T.SubscriptionInput>,
    T.Ok
  >;
  "contacts.unsubscribe": Contract<Email, T.Ok>;
  "properties.list": Contract<List, T.Page<T.Property>>;
  "properties.get": Contract<{ params: { key: string } }, T.Property>;
  "properties.create": Contract<Body<T.PropertyInput>, T.Property>;
  "properties.update": Contract<
    { params: { key: string } } & Body<{
      property: T.PropertyInput;
      revision: number;
    }>,
    T.Property
  >;
  "topics.list": Contract<List, T.Page<T.Topic>>;
  "topics.get": Contract<Get, T.Topic>;
  "topics.create": Contract<Body<T.TopicInput>, T.Topic>;
  "topics.update": Contract<
    Get & Body<{ topic: T.TopicInput; revision: number }>,
    T.Topic
  >;
  "segments.list": Contract<List, T.Page<T.Segment>>;
  "segments.get": Contract<Get, T.Segment>;
  "segments.create": Contract<Body<T.SegmentInput>, T.Segment>;
  "segments.update": Contract<
    Get & Body<{ segment: T.SegmentInput; revision: number }>,
    T.Segment
  >;
  "segments.members.list": Contract<Get & List, T.Page<T.SegmentMember>>;
  "segments.members.add": Contract<
    Member & { body?: T.SegmentMembershipInput },
    T.SegmentMember
  >;
  "segments.members.remove": Contract<Member, T.Ok>;
  "segments.import": Contract<
    Get & Body<T.ImportInput>,
    { added: number; duplicates: number; total: number }
  >;
  "broadcasts.list": Contract<List, T.Page<T.Broadcast>>;
  "broadcasts.get": Contract<Get, T.Broadcast>;
  "broadcasts.create": Contract<Body<T.BroadcastInput>, T.Broadcast>;
  "broadcasts.update": Contract<Update<T.BroadcastInput>, T.Broadcast>;
  "broadcasts.recipients.list": Contract<Get & List, T.Page<T.Recipient>>;
  "broadcasts.preview": Contract<
    Get & { query?: { contact?: string } },
    T.Preview
  >;
  "broadcasts.duplicate": Contract<Get, T.Broadcast>;
  "broadcasts.send": Contract<Get & Body<T.SendBroadcastInput>, T.Broadcast>;
  "broadcasts.test": Contract<
    Get & Body<{ to: string; previewEmail?: string }>,
    T.EmailAccepted
  >;
  "broadcasts.cancel": Contract<Get, T.Broadcast>;
  "templates.list": Contract<List, T.Page<T.Template>>;
  "templates.get": Contract<Get, T.Template>;
  "templates.create": Contract<
    Body<T.TemplateContent & { alias: string }>,
    T.Template
  >;
  "templates.update": Contract<Update<T.TemplateContent>, T.Template>;
  "templates.publish": Contract<Get & Body<{ revision: number }>, T.Template>;
  "templates.archive": Contract<
    Get & Body<{ archived: boolean; revision: number }>,
    T.Template
  >;
  "templates.duplicate": Contract<Get & Body<{ alias: string }>, T.Template>;
  "templates.preview": Contract<
    Get & Body<T.TemplatePreviewInput>,
    { subject: string; html: string; text: string }
  >;
  "templates.test": Contract<
    Get &
      Body<{
        from: string;
        to: string;
        variables?: Record<string, T.PropertyValue>;
      }>,
    T.EmailAccepted
  >;
  "templates.broadcasts.create": Contract<
    Get & Body<T.TemplateBroadcastInput>,
    T.Broadcast
  >;
  "identity.read": Contract<Empty, { userId: string; clientId?: string }>;
  "contracts.read": Contract<Empty, T.OpenApiDocument>;
  "capabilities.read": Contract<Empty, T.Capabilities>;
}
export type OperationInput<K extends OperationId> =
  OperationContracts[K]["input"];
export type OperationOutput<K extends OperationId> =
  OperationContracts[K]["output"];
// Adding metadata without a typed contract (or vice versa) is a compile error.
const coverage:
  | Exclude<keyof OperationContracts, OperationId>
  | Exclude<OperationId, keyof OperationContracts> extends never
  ? true
  : never = true;
void coverage;
