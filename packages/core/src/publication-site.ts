import type { Publication } from "./newsletter-model.js";
import type { DomainConnection } from "./publication-domains.js";
export interface PublicSiteContext {
  publicationId: string;
  origin: string;
  pathPrefix: string;
}
export function defaultPublicationSite(
  pub: Publication,
  installationUrl: string,
): PublicSiteContext {
  return {
    publicationId: pub.id,
    origin: new URL(installationUrl).origin,
    pathPrefix: `/n/${pub.settings.slug}`,
  };
}
/** Only use with a connection resolved and authenticated by PublicationDomains. */
export function customPublicationSite(
  row: DomainConnection,
): PublicSiteContext {
  return {
    publicationId: row.publicationId,
    origin: `https://${row.hostname}`,
    pathPrefix: "",
  };
}
export function sitePath(site: PublicSiteContext, suffix = "") {
  return site.pathPrefix + suffix || "/";
}
