import { PublicationDomains } from "./publication-domains.js";
import type { PublicPublicationDns } from "./publication-domain-dns.js";
import { OperationalService } from "./operational-service.js";
import { MediaService, type MediaStorage } from "./media.js";
import { PublicationService } from "./publications.js";
import { IssueService } from "./issues.js";
import { ContactService } from "./contacts.js";
import { SubscriptionService } from "./subscriptions.js";
import { TemplateService } from "./templates.js";
import { WorkDispatcher } from "./work-dispatcher.js";
import type { Config } from "./config.js";
import type { Store } from "./store.js";
import type { Queues } from "./queue.js";
import type { Transport } from "./transport.js";
import { EmailService } from "./service.js";
import type { createAuth } from "./auth.js";
import { BroadcastService } from "./broadcasts.js";
import { FormService } from "./forms.js";
export interface RuntimeDependencies {
  config: Config;
  store: Store;
  queues: Queues;
  transport: Transport;
  mediaStorage: MediaStorage;
  publicationDns: PublicPublicationDns;
  publicationDomainProvider: import("./publication-domain-provider.js").PublicationDomainProvider;
  createAuth: () => ReturnType<typeof createAuth>;
}
export function createServices(dependencies: RuntimeDependencies) {
  const { config, store, queues, transport } = dependencies;
  const subscriptions = new SubscriptionService(store);
  const contacts = new ContactService(store, subscriptions);
  const templates = new TemplateService(store);
  const dispatcher = new WorkDispatcher(store, queues);
  const service = new EmailService(
    config,
    store,
    queues,
    transport,
    subscriptions,
    dispatcher,
  );
  const forms = new FormService(
    store,
    config,
    service,
    contacts,
    subscriptions,
  );
  const broadcasts = new BroadcastService(
    config,
    store,
    service,
    contacts,
    subscriptions,
  );
  const publications = new PublicationService(store, contacts);
  const issues = new IssueService(store, publications, broadcasts);
  let auth: ReturnType<typeof createAuth> | undefined;
  return {
    config,
    store,
    queues,
    transport,
    service,
    contacts,
    subscriptions,
    operational: new OperationalService(store),
    templates,
    dispatcher,
    forms,
    broadcasts,
    publications,
    publicationDomains: new PublicationDomains(
      store,
      dependencies.publicationDns,
      dependencies.publicationDomainProvider,
    ),
    issues,
    media: new MediaService(store, dependencies.mediaStorage),
    // OAuth initializes persisted keys. Workers and schema provisioning must
    // not initialize authentication or require auth-table access.
    get auth() {
      return (auth ??= dependencies.createAuth());
    },
  };
}
export type Runtime = ReturnType<typeof createServices>;
