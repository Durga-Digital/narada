import { createServices, type Runtime } from "@narada/core/runtime";
import { loadConfig, type Config } from "@narada/core/config";
import { Store } from "@narada/core/store";
import { Queues } from "@narada/core/queue";
import { createTransport } from "@narada/core/transport";
import { mediaStorage } from "@narada/core/media";
import { PublicPublicationDns } from "@narada/core/publication-domain-dns";
import { AwsPublicationDomainProvider } from "@narada/core/publication-domain-aws";
import { createAuth } from "@narada/core/auth";
export function createRuntime(config: Config = loadConfig()): Runtime {
  const store = new Store(config);
  return createServices({
    config,
    store,
    queues: new Queues(config),
    transport: createTransport(config),
    mediaStorage: mediaStorage(config),
    publicationDns: new PublicPublicationDns(),
    publicationDomainProvider: new AwsPublicationDomainProvider(config),
    createAuth: () => createAuth(config, store),
  });
}
export type { Runtime } from "@narada/core/runtime";
export { loadConfig } from "@narada/core/config";
