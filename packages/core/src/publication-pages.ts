import { publicOrigin } from "./origins.js";
import { PublicationEditorial } from "./publication-editorial.js";
import { defaultSite } from "@narada/contracts/publication-site";
import type { PublicationSiteInput } from "@narada/contracts/types";
import { escapeHtml as e } from "./message-content.js";
import { newsletterCard } from "./newsletter-page.js";
import {
  defaultPublicationSite,
  sitePath,
  type PublicSiteContext,
} from "./publication-site.js";
import { randomUUID } from "node:crypto";
import type { Runtime } from "./runtime.js";
import type { Publication } from "./newsletter-model.js";
import {
  newsletterPage,
  newsletterHome,
  newsletterSignup,
  type NewsletterPageOptions,
} from "./newsletter-page.js";
import { defaultBranding } from "@narada/contracts/branding";
import { PublicationBrandingService } from "./publication-branding.js";

export class PublicationPages {
  constructor(private runtime: Runtime) {}
  async image(pub: Publication, assetId?: string | null) {
    if (!assetId) return;
    return new PublicationBrandingService(this.runtime).logo(pub, {
      ...(pub.branding ?? defaultBranding),
      logoAssetId: assetId,
    });
  }
  async page(pub: Publication, body: string, options: NewsletterPageOptions) {
    const [logo, wordmark, cover] = await Promise.all([
      new PublicationBrandingService(this.runtime).logo(pub),
      this.image(pub, pub.branding?.wordmarkAssetId),
      this.image(pub, pub.branding?.coverAssetId),
    ]);
    const site =
      options.site ??
      defaultPublicationSite(pub, publicOrigin(this.runtime.config));
    const urls = options.private
      ? undefined
      : await this.runtime.publicationDomains.get(pub);
    const suffix = options.path.startsWith(site.pathPrefix)
      ? options.path.slice(site.pathPrefix.length)
      : "";
    const canonicalUrl = urls
      ? urls.preferredUrl.replace(/\/$/, "") + (suffix === "/" ? "" : suffix)
      : undefined;
    const editorial = new PublicationEditorial(this.runtime);
    const config =
      options.siteContent ??
      (await editorial.snapshot(pub, "site")).published?.content ??
      defaultSite;
    const navigation: { href: string; label: string }[] = [];
    for (const item of config.navigation) {
      if (
        item.type === "about" &&
        !(await editorial.snapshot(pub, "about")).published
      )
        continue;
      if (item.type === "subscribe" && pub.status !== "active") continue;
      if (item.type === "collection") {
        try {
          const col = await editorial.collection(pub, item.collectionId, true);
          navigation.push({
            href: sitePath(site, `/c/${col.slug}`),
            label: item.label,
          });
        } catch (error) {
          if (!(
            error instanceof Error &&
            "status" in error &&
            error.status === 404
          ))
            throw error;
        }
      } else
        navigation.push({
          href:
            item.type === "external"
              ? item.url
              : sitePath(site, item.type === "home" ? "" : `/${item.type}`),
          label: item.label,
        });
    }
    return newsletterPage(pub, body, {
      navigation,
      subscribeLabel: config.navigation.find((i) => i.type === "subscribe")
        ?.label,

      ...options,
      logo,
      wordmark,
      cover,
      site,
      canonicalUrl,
    });
  }
  async home(
    pub: Publication,
    preview = false,
    site = defaultPublicationSite(pub, publicOrigin(this.runtime.config)),
    siteContent?: PublicationSiteInput,
  ) {
    const issues = [];
    let cursor: Record<string, unknown> | undefined;
    // Bound reads when stale archive index entries have been withdrawn.
    for (let n = 0; n < 3; n++) {
      const page = await this.runtime.issues.archive(pub, cursor);
      issues.push(...page.data);
      cursor = page.cursor;
      if (issues.length >= 6 || !cursor) break;
    }
    const editorial = new PublicationEditorial(this.runtime);
    const config =
      siteContent ??
      (await editorial.snapshot(pub, "site")).published?.content ??
      defaultSite;
    let featuredSelected = false;
    if (config.featuredIssueId) {
      const featured = await editorial.publicIssue(pub, config.featuredIssueId);
      if (featured) {
        featuredSelected = true;
        const previous = issues.findIndex((i) => i.slug === featured.slug);
        if (previous >= 0) issues.splice(previous, 1);
        issues.unshift(featured);
      }
    }
    let collections = "";
    for (const cid of config.collectionIds) {
      try {
        const col = await editorial.collection(pub, cid, true);
        const page = await editorial.collectionIssues(pub, cid, { limit: 4 });
        if (page.data.length)
          collections += `<section class="collection-row"><h2>${e(col.name)}</h2><div class="issue-grid">${(await Promise.all(page.data.map(async (card) => newsletterCard({ ...card, cover: await this.image(pub, card.coverAssetId) }, site.pathPrefix)))).join("")}</div><p><a href="${e(sitePath(site, `/c/${col.slug}`))}">View all ${e(col.name)} →</a></p></section>`;
      } catch (error) {
        if (!(
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ))
          throw error;
      }
    }
    let signup = "";
    if (pub.status === "active") {
      const { form } = await this.runtime.forms.publicForm(pub.formId);
      signup = newsletterSignup(pub, form.version, randomUUID(), preview, site);
    } else if (preview && pub.status === "draft") {
      signup = newsletterSignup(pub, 0, randomUUID(), true, site);
    }
    return this.page(
      pub,
      newsletterHome(
        pub,
        await Promise.all(
          issues.slice(0, 6).map(async (issue) => ({
            ...issue,
            cover: await this.image(pub, issue.coverAssetId),
          })),
        ),
        signup,
        site,
        await this.image(pub, pub.branding?.coverAssetId),
        featuredSelected,
      ) + collections,
      {
        site,
        siteContent: config,
        origin: site.origin,
        path: sitePath(site),
        private: preview,
        preview,
      },
    );
  }
}
