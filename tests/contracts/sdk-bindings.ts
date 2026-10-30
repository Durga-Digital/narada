import type { OperationId } from "@narada/contracts/operations";
import type {
  OperationInput,
  OperationOutput,
} from "@narada/contracts/operation-types";
import type { Narada, RequestOptions } from "../../packages/sdk/src/index.js";
import { sdkExclusions } from "./transport-exclusions.js";

export type SdkOperationId = Exclude<OperationId, keyof typeof sdkExclusions>;
type SdkBindings = {
  [K in SdkOperationId]: (
    sdk: Narada,
    input: OperationInput<K>,
    options: RequestOptions,
  ) => Promise<OperationOutput<K>>;
};

// Explicit calls exercise the public client, independently of its URL implementation.
// The mapped type requires a binding and compatible input/output types for every operation.
export const sdkBindings = {
  "approvals.request": (sdk, input, options) =>
    sdk.approvals.request(input.body, options),
  "approvals.list": (sdk, input) => sdk.approvals.list(input.query),
  "approvals.get": (sdk, input) => sdk.approvals.get(input.params.id),
  "sending.get": (sdk, input, options) => sdk.sending.get(),
  "sending.update": (sdk, input, options) =>
    sdk.sending.update(input.body, options),
  "sending.diagnostics": (sdk, input, options) => sdk.sending.diagnostics(),
  "metrics.get": (sdk, input, options) => sdk.metrics.get(input.query),
  "domains.create": (sdk, input, options) =>
    sdk.domains.create(input.body, options),
  "domains.mailFrom.update": (sdk, input, options) =>
    sdk.domains.updateMailFrom(input.params.name, input.body, options),
  "domains.dkim.enable": (sdk, input, options) =>
    sdk.domains.enableDkim(input.params.name, input.body, options),
  "integration.guide": (sdk) => sdk.integration.guide(),
  "resources.search": (sdk, input) => sdk.resources.search(input.query),
  "domains.list": (sdk, input, options) => sdk.domains.list(input.query),
  "domains.get": (sdk, input, options) => sdk.domains.get(input.params.name),
  "domains.refresh": (sdk, input, options) =>
    sdk.domains.refresh(input.params.name, options),
  "suppressions.list": (sdk, input, options) =>
    sdk.suppressions.list(input.query),
  "suppressions.get": (sdk, input, options) =>
    sdk.suppressions.get(input.params.email),
  "suppressions.create": (sdk, input, options) =>
    sdk.suppressions.create(input.body, options),
  "suppressions.delete": (sdk, input, options) =>
    sdk.suppressions.delete(input.params.email, options),
  "webhooks.events": (sdk, input, options) => sdk.webhooks.events(),
  "webhooks.list": (sdk, input, options) => sdk.webhooks.list(input.query),
  "webhooks.get": (sdk, input, options) => sdk.webhooks.get(input.params.id),
  "webhooks.create": (sdk, input, options) =>
    sdk.webhooks.create(input.body, options),
  "webhooks.update": (sdk, input, options) =>
    sdk.webhooks.update(input.params.id, input.body, options),
  "webhooks.delete": (sdk, input, options) =>
    sdk.webhooks.delete(input.params.id, options),
  "webhooks.deliveries.list": (sdk, input, options) =>
    sdk.webhooks.deliveries.list(input.query),
  "webhooks.deliveries.get": (sdk, input, options) =>
    sdk.webhooks.deliveries.get(input.params.id, input.query),
  "webhooks.deliveries.retry": (sdk, input, options) =>
    sdk.webhooks.deliveries.retry(input.params.id, options),
  "operations.list": (sdk, input, options) => sdk.operations.list(input.query),
  "operations.get": (sdk, input, options) =>
    sdk.operations.get(input.params.id),
  "operations.lookup": (sdk, input, options) =>
    sdk.operations.lookup(input.body),
  "forms.list": (sdk, input, options) => sdk.forms.list(input.query),
  "forms.get": (sdk, input, options) => sdk.forms.get(input.params.id),
  "forms.create": (sdk, input, options) =>
    sdk.forms.create(input.body, options),
  "forms.update": (sdk, input, options) =>
    sdk.forms.update(input.params.id, input.body, options),
  "forms.publish": (sdk, input, options) =>
    sdk.forms.publish(input.params.id, input.body, options),
  "forms.close": (sdk, input, options) =>
    sdk.forms.close(input.params.id, input.body, options),
  "publications.list": (sdk, input, options) =>
    sdk.publications.list(input.query),
  "publications.get": (sdk, input, options) =>
    sdk.publications.get(input.params.id),
  "publications.create": (sdk, input, options) =>
    sdk.publications.create(input.body, options),
  "publications.update": (sdk, input, options) =>
    sdk.publications.update(input.params.id, input.body, options),
  "publications.domain.get": (sdk, input, options) =>
    sdk.publications.domain.get(input.params.id),
  "publications.domain.configure": (sdk, input, options) =>
    sdk.publications.domain.configure(input.params.id, input.body, options),
  "publications.domain.check": (sdk, input, options) =>
    sdk.publications.domain.check(input.params.id, input.body, options),
  "publications.domain.activate": (sdk, input, options) =>
    sdk.publications.domain.activate(input.params.id, input.body, options),
  "publications.domain.disconnect": (sdk, input, options) =>
    sdk.publications.domain.disconnect(input.params.id, input.body, options),
  "publications.about.get": (sdk, input, options) =>
    sdk.publications.about.get(input.params.id),
  "publications.about.update": (sdk, input, options) =>
    sdk.publications.about.update(input.params.id, input.body, options),
  "publications.about.preview": (sdk, input, options) =>
    sdk.publications.about.preview(input.params.id, input.body),
  "publications.about.publish": (sdk, input, options) =>
    sdk.publications.about.publish(input.params.id, input.body, options),
  "publications.about.withdraw": (sdk, input, options) =>
    sdk.publications.about.withdraw(input.params.id, input.body, options),
  "publications.site.get": (sdk, input, options) =>
    sdk.publications.site.get(input.params.id),
  "publications.site.update": (sdk, input, options) =>
    sdk.publications.site.update(input.params.id, input.body, options),
  "publications.site.preview": (sdk, input, options) =>
    sdk.publications.site.preview(input.params.id, input.body),
  "publications.site.publish": (sdk, input, options) =>
    sdk.publications.site.publish(input.params.id, input.body, options),
  "publications.collections.list": (sdk, input, options) =>
    sdk.publications.collections.list(input.params.id, input.query),
  "publications.collections.create": (sdk, input, options) =>
    sdk.publications.collections.create(input.params.id, input.body, options),
  "publications.collections.get": (sdk, input, options) =>
    sdk.publications.collections.get(
      input.params.id,
      input.params.collectionId,
    ),
  "publications.collections.update": (sdk, input, options) =>
    sdk.publications.collections.update(
      input.params.id,
      input.params.collectionId,
      input.body,
      options,
    ),
  "publications.collections.archive": (sdk, input, options) =>
    sdk.publications.collections.archive(
      input.params.id,
      input.params.collectionId,
      input.body,
      options,
    ),
  "issues.collections.get": (sdk, input, options) =>
    sdk.issues.collections.get(input.params.id, input.params.issueId),
  "issues.collections.update": (sdk, input, options) =>
    sdk.issues.collections.update(
      input.params.id,
      input.params.issueId,
      input.body,
      options,
    ),
  "publications.branding.update": (sdk, input, options) =>
    sdk.publications.branding.update(input.params.id, input.body, options),
  "publications.branding.preview": (sdk, input) =>
    sdk.publications.branding.preview(input.params.id, input.body),
  "publications.assets.upload": (sdk, input, options) =>
    sdk.publications.assets.upload(input.params.id, input.body, options),
  "issues.delete": (sdk, input, options) =>
    sdk.issues.delete(
      input.params.id,
      input.params.issueId,
      input.body,
      options,
    ),
  "publications.logo.upload": (sdk, input, options) =>
    sdk.publications.logo.upload(input.params.id, input.body, options),
  "publications.activate": (sdk, input, options) =>
    sdk.publications.activate(input.params.id, input.body, options),
  "publications.archive": (sdk, input, options) =>
    sdk.publications.archive(input.params.id, input.body, options),
  "forms.preview": (sdk, input, options) => sdk.forms.preview(input.params.id),
  "forms.responses.list": (sdk, input, options) =>
    sdk.forms.responses(input.params.id, input.query),
  "forms.responses.get": (sdk, input, options) =>
    sdk.forms.response(input.params.id, input.params.responseId),
  "forms.responses.retry": (sdk, input, options) =>
    sdk.forms.retryResponse(input.params.id, input.params.responseId, options),
  "forms.responses.export": (sdk, input, options) =>
    sdk.forms.exportResponses(input.params.id, input.query),
  "forms.broadcasts.create": (sdk, input, options) =>
    sdk.forms.createBroadcast(input.params.id, options),
  "publications.preview": (sdk, input, options) =>
    sdk.publications.preview(input.params.id),
  "publications.subscribers.list": (sdk, input, options) =>
    sdk.publications.subscribers(input.params.id, input.query),
  "issues.list": (sdk, input, options) =>
    sdk.issues.list(input.params.id, input.query),
  "issues.create": (sdk, input, options) =>
    sdk.issues.create(input.params.id, input.body, options),
  "issues.get": (sdk, input, options) =>
    sdk.issues.get(input.params.id, input.params.issueId),
  "issues.update": (sdk, input, options) =>
    sdk.issues.update(
      input.params.id,
      input.params.issueId,
      input.body,
      options,
    ),
  "issues.preview": (sdk, input, options) =>
    sdk.issues.preview(input.params.id, input.params.issueId),
  "issues.test": (sdk, input, options) =>
    sdk.issues.test(input.params.id, input.params.issueId, input.body, options),
  "issues.publish": (sdk, input, options) =>
    sdk.issues.publish(
      input.params.id,
      input.params.issueId,
      input.body,
      options,
    ),
  "issues.cancel": (sdk, input, options) =>
    sdk.issues.cancel(
      input.params.id,
      input.params.issueId,
      input.body,
      options,
    ),
  "issues.withdraw": (sdk, input, options) =>
    sdk.issues.withdraw(
      input.params.id,
      input.params.issueId,
      input.body,
      options,
    ),
  "issues.duplicate": (sdk, input, options) =>
    sdk.issues.duplicate(input.params.id, input.params.issueId, options),
  "issues.delivery.get": (sdk, input, options) =>
    sdk.issues.delivery(input.params.id, input.params.issueId),
  "issues.recipients.list": (sdk, input, options) =>
    sdk.issues.recipients(input.params.id, input.params.issueId, input.query),
  "emails.send": (sdk, input, options) => sdk.emails.send(input.body, options),
  "emails.get": (sdk, input, options) => sdk.emails.get(input.params.id),
  "contacts.list": (sdk, input, options) => sdk.contacts.list(input.query),
  "contacts.get": (sdk, input, options) => sdk.contacts.get(input.params.email),
  "contacts.create": (sdk, input, options) =>
    sdk.contacts.create(input.body, options),
  "contacts.properties.patch": (sdk, input, options) =>
    sdk.contacts.patchProperties(input.params.email, input.body, options),
  "contacts.topics.unsubscribe": (sdk, input, options) =>
    sdk.contacts.unsubscribeTopic(input.params.email, input.params.id, options),
  "contacts.update": (sdk, input, options) =>
    sdk.contacts.update(input.params.email, input.body, options),
  "contacts.subscribe": (sdk, input, options) =>
    sdk.contacts.subscribe(
      input.params.email,
      input.params.id,
      input.body,
      options,
    ),
  "contacts.unsubscribe": (sdk, input, options) =>
    sdk.contacts.unsubscribe(input.params.email, options),
  "properties.list": (sdk, input, options) =>
    sdk.contactProperties.list(input.query),
  "properties.get": (sdk, input, options) =>
    sdk.contactProperties.get(input.params.key),
  "properties.create": (sdk, input, options) =>
    sdk.contactProperties.create(input.body, options),
  "properties.update": (sdk, input, options) =>
    sdk.contactProperties.update(input.params.key, input.body, options),
  "topics.list": (sdk, input, options) => sdk.topics.list(input.query),
  "topics.get": (sdk, input, options) => sdk.topics.get(input.params.id),
  "topics.create": (sdk, input, options) =>
    sdk.topics.create(input.body, options),
  "topics.update": (sdk, input, options) =>
    sdk.topics.update(input.params.id, input.body, options),
  "segments.list": (sdk, input, options) => sdk.segments.list(input.query),
  "segments.get": (sdk, input, options) => sdk.segments.get(input.params.id),
  "segments.create": (sdk, input, options) =>
    sdk.segments.create(input.body, options),
  "segments.update": (sdk, input, options) =>
    sdk.segments.update(input.params.id, input.body, options),
  "segments.members.list": (sdk, input, options) =>
    sdk.segments.contacts(input.params.id, input.query),
  "segments.members.add": (sdk, input, options) =>
    sdk.segments.addContact(
      input.params.id,
      input.params.email,
      input.body,
      options,
    ),
  "segments.members.remove": (sdk, input, options) =>
    sdk.segments.removeContact(input.params.id, input.params.email, options),
  "segments.import": (sdk, input, options) =>
    sdk.segments.import(input.params.id, input.body, options),
  "broadcasts.list": (sdk, input, options) => sdk.broadcasts.list(input.query),
  "broadcasts.get": (sdk, input, options) =>
    sdk.broadcasts.get(input.params.id),
  "broadcasts.create": (sdk, input, options) =>
    sdk.broadcasts.create(input.body, options),
  "broadcasts.update": (sdk, input, options) =>
    sdk.broadcasts.update(input.params.id, input.body, options),
  "broadcasts.recipients.list": (sdk, input, options) =>
    sdk.broadcasts.recipients(input.params.id, input.query),
  "broadcasts.preview": (sdk, input, options) =>
    sdk.broadcasts.preview(input.params.id, input.query?.contact),
  "broadcasts.duplicate": (sdk, input, options) =>
    sdk.broadcasts.duplicate(input.params.id, options),
  "broadcasts.send": (sdk, input, options) =>
    sdk.broadcasts.send(input.params.id, input.body, options),
  "broadcasts.test": (sdk, input, options) =>
    sdk.broadcasts.test(input.params.id, input.body, options),
  "broadcasts.cancel": (sdk, input, options) =>
    sdk.broadcasts.cancel(input.params.id, options),
  "templates.list": (sdk, input, options) => sdk.templates.list(input.query),
  "templates.get": (sdk, input, options) => sdk.templates.get(input.params.id),
  "templates.create": (sdk, input, options) =>
    sdk.templates.create(input.body, options),
  "templates.update": (sdk, input, options) =>
    sdk.templates.update(input.params.id, input.body, options),
  "templates.publish": (sdk, input, options) =>
    sdk.templates.publish(input.params.id, input.body, options),
  "templates.archive": (sdk, input, options) =>
    sdk.templates.archive(input.params.id, input.body, options),
  "templates.duplicate": (sdk, input, options) =>
    sdk.templates.duplicate(input.params.id, input.body, options),
  "templates.preview": (sdk, input, options) =>
    sdk.templates.preview(input.params.id, input.body),
  "templates.test": (sdk, input, options) =>
    sdk.templates.test(input.params.id, input.body, options),
  "templates.broadcasts.create": (sdk, input, options) =>
    sdk.templates.createBroadcast(input.params.id, input.body, options),
  "capabilities.read": (sdk, input, options) => sdk.capabilities(),
} satisfies SdkBindings;
