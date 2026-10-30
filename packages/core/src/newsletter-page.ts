import type { PublicSiteContext } from "./publication-site.js";
import { escapeHtml as e } from "./message-content.js";
import type { Publication } from "./newsletter-model.js";
import type { PublicationLogo } from "@narada/contracts/types";
import { defaultBranding } from "@narada/contracts/branding";

/** Keep brand accents readable even when an owner chooses a very light color. */
export function accentColors(color: string) {
  const safe = /^#[a-fA-F0-9]{6}$/.test(color) ? color : "#345d37";
  const rgb = [1, 3, 5].map((i) => parseInt(safe.slice(i, i + 2), 16) / 255);
  const linear = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  const luminance =
    0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  return { accent: safe, onAccent: luminance > 0.179 ? "#000000" : "#ffffff" };
}
export interface NewsletterPageOptions {
  siteContent?: import("@narada/contracts/types").PublicationSiteInput;
  navigation?: { href: string; label: string }[];
  subscribeLabel?: string;
  site?: PublicSiteContext;
  canonicalUrl?: string;
  origin: string;
  path: string;
  title?: string;
  description?: string;
  private?: boolean;
  preview?: boolean;
  article?: boolean;
  logo?: PublicationLogo;
  wordmark?: PublicationLogo;
  cover?: PublicationLogo;
  socialImage?: PublicationLogo;
}
export function newsletterPage(
  pub: Publication,
  body: string,
  options: NewsletterPageOptions,
) {
  const base = options.site?.pathPrefix ?? `/n/${pub.settings.slug}`;
  const title = options.title ?? pub.settings.name;
  const description = options.description ?? pub.settings.description;
  const branding = pub.branding ?? defaultBranding;
  const { accent, onAccent } = accentColors(pub.settings.color);
  const theme = {
    classic: {
      background: "#faf8f2",
      surface: "#fffdf8",
      heading: "Georgia,serif",
      weight: "400",
    },
    editorial: {
      background: "#ffffff",
      surface: "#f7f7f5",
      heading: "Georgia,serif",
      weight: "700",
    },
    minimal: {
      background: "#f6f7f8",
      surface: "#ffffff",
      heading: "system-ui,sans-serif",
      weight: "600",
    },
  }[branding.theme];
  const logo = options.logo
    ? `<img class="publication-logo" src="${e(options.logo.url)}" alt="${e(branding.logoAlt || pub.settings.name)}" width="${options.logo.width}" height="${options.logo.height}">`
    : "";
  const wordmark = options.wordmark
    ? `<img class="publication-wordmark" src="${e(options.wordmark.url)}" alt="${e(branding.wordmarkAlt || pub.settings.name)}" width="${options.wordmark.width}" height="${options.wordmark.height}">`
    : `<span>${e(pub.settings.name)}</span>`;
  const currentPath = options.path.replace(/\/$/, "") || "/";
  const navigation = (href: string, label: string) =>
    `<a href="${e(href)}"${href === `${base}/subscribe` ? ' class="subscribe-link"' : ""}${currentPath === href ? ' aria-current="page"' : ""}>${e(label)}</a>`;
  const socialImage = options.socialImage ?? options.cover ?? options.logo;
  let html = `<!doctype html><html lang="en" data-theme="${branding.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}${title === pub.settings.name ? "" : ` · ${e(pub.settings.name)}`}</title><meta name="description" content="${e(description)}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}">${socialImage ? `<meta property="og:image" content="${e(socialImage.url)}">` : ""}<meta property="og:type" content="${options.article ? "article" : "website"}"><meta property="og:url" content="${e(options.canonicalUrl ?? options.origin + options.path)}">${options.private ? '<meta name="robots" content="noindex,nofollow">' : `<link rel="canonical" href="${e(options.canonicalUrl ?? options.origin + options.path)}">`}<style>
  :root{--accent:${accent};--on-accent:${onAccent};--surface:${theme.surface};--heading:${theme.heading}}
  *{box-sizing:border-box}body{font:17px/1.7 system-ui,sans-serif;color:#222;background:${theme.background};margin:0}main,header,footer{max-width:820px;margin:auto;padding:28px 24px}header{border-bottom:1px solid #d9d9d4;display:flex;gap:24px;align-items:center;justify-content:space-between;flex-wrap:wrap}.identity{display:flex;align-items:center;gap:14px;min-width:0;font-weight:600;text-decoration:none}.identity span{overflow-wrap:anywhere}.publication-logo{width:64px;height:64px;object-fit:contain;flex-shrink:0}nav{display:flex;gap:20px;align-items:center;flex-wrap:wrap}a{color:inherit;text-underline-offset:4px}a:hover{text-decoration-thickness:2px}h1,h2,h3{font-family:var(--heading);line-height:1.2;overflow-wrap:anywhere;font-weight:${theme.weight}}h1{font-size:clamp(2.1rem,7vw,3.6rem);margin:12px 0 20px}h2{font-size:1.7rem}h3{font-size:1.25rem}p{overflow-wrap:anywhere}.intro{padding:36px 0 16px}.description{font-size:1.2rem}.welcome{white-space:pre-wrap}.signup{padding:24px;border:1px solid #d9d9d4;border-radius:12px;background:var(--surface);margin:24px 0 40px}.signup h2{margin-top:0}label{display:block;margin:14px 0}input{display:block;width:100%;padding:12px;font:inherit;border:1px solid #777;border-radius:6px;background:#fff;color:#222}button,.subscribe-link{font:inherit;padding:12px 20px;background:var(--accent);color:var(--on-accent);border:0;border-radius:6px;cursor:pointer;font-weight:600;text-decoration:none;display:inline-block;max-width:100%;overflow-wrap:anywhere}button:disabled{cursor:default}fieldset{border:0;padding:0;margin:0;min-width:0}.consent,.muted,time{color:#515151;font-size:14px}.honeypot{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}.issue-card{padding:22px 0;border-bottom:1px solid #d9d9d4}.issue-card h2,.issue-card h3{margin:6px 0 12px}.latest{background:var(--surface);border:1px solid #d9d9d4;border-left:4px solid var(--accent);padding:24px;border-radius:8px}.eyebrow{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.archive-link{margin:30px 0}.empty{padding:30px 0}article{overflow-wrap:anywhere}article img{max-width:100%;height:auto}pre{white-space:pre-wrap;background:var(--surface);padding:16px}blockquote{border-left:3px solid #777;margin:16px 0;padding-left:20px}li{margin:8px 0}footer{border-top:1px solid #d9d9d4;margin-top:40px;font-size:14px}:focus-visible{outline:3px solid #555;outline-offset:4px}@media(max-width:480px){main,header,footer{padding:20px}.signup,.latest{padding:18px}.publication-logo{width:48px;height:48px}nav{gap:14px}.subscribe-link{padding:8px 12px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
  .publication-wordmark{max-width:min(300px,60vw);max-height:76px;width:auto;height:auto;object-fit:contain}.publication-cover{display:block;width:100%;max-height:360px;object-fit:cover;border-radius:12px;margin:8px 0 28px}.issue-cover{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;margin-bottom:18px}.issue-card a{text-decoration:none}.issue-card a:hover{text-decoration:underline}.issue-card time{display:block;margin-top:16px}.issue-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.layout-grid .latest{margin-bottom:28px}.layout-feature .latest{padding:28px}.layout-feature .latest h2{font-size:2rem}.signup-description{margin-top:0}.signup .signup-fields{display:flex;flex-wrap:wrap;align-items:end;gap:12px}.signup-fields label{flex:1;min-width:180px;margin:0}.signup-fields button{min-height:50px}.signup .consent{font-size:12px;line-height:1.5}nav [aria-current=page]{text-decoration:underline;text-decoration-thickness:2px}.archive-heading{margin-bottom:32px}@media(max-width:600px){.issue-grid{grid-template-columns:1fr}.signup-fields button{width:100%}.publication-cover{max-height:220px}}
  .mobile-navigation{display:none}.mobile-navigation summary{cursor:pointer;padding:10px}.collection-row{margin:36px 0}@media(max-width:600px){.desktop-navigation{display:none}.mobile-navigation{display:block;width:100%}.mobile-navigation nav{padding:12px 0;flex-direction:column;align-items:flex-start}}
  </style></head><body><header><a class="identity" href="${base || "/"}">${logo}${wordmark}</a><div class="desktop-navigation"><nav aria-label="Publication navigation">${(
    options.navigation ?? [
      { href: base || "/", label: "Home" },
      { href: `${base}/archive`, label: "Archive" },
    ]
  )
    .map((item) => navigation(item.href, item.label))
    .join(
      "",
    )}${pub.status === "active" && !options.navigation?.some((item) => item.href === `${base}/subscribe`) ? `<a class="subscribe-link" href="${base}/subscribe">${e(options.subscribeLabel || "Subscribe")}</a>` : pub.status === "archived" ? "<span>Archived publication</span>" : ""}</nav></div><details class="mobile-navigation"><summary>Menu</summary><nav aria-label="Mobile publication navigation">${(
    options.navigation ?? [
      { href: base || "/", label: "Home" },
      { href: `${base}/archive`, label: "Archive" },
    ]
  )
    .map((item) => navigation(item.href, item.label))
    .join(
      "",
    )}${pub.status === "active" && !options.navigation?.some((item) => item.href === `${base}/subscribe`) ? `<a class="subscribe-link" href="${base}/subscribe">${e(options.subscribeLabel || "Subscribe")}</a>` : pub.status === "archived" ? "<span>Archived publication</span>" : ""}</nav></details></header><main>${body}</main><footer><p>${e(pub.settings.author || pub.settings.name)}</p>${pub.settings.privacyUrl ? `<a href="${e(pub.settings.privacyUrl)}">Privacy policy</a>` : ""}</footer></body></html>`;
  // Preview content uses the same renderer, but never navigates or submits.
  if (options.preview)
    html = html.replace(/<a\b[^>]*>/g, '<a aria-disabled="true">');
  return html;
}

export function newsletterSignup(
  pub: Publication,
  version: number,
  submissionId: string,
  preview = false,
  site?: PublicSiteContext,
) {
  const branding = pub.branding ?? defaultBranding;
  return `<form method="post" action="${e(site?.pathPrefix ?? `/n/${pub.settings.slug}`)}/subscribe"><fieldset${preview ? " disabled" : ""}><input type="hidden" name="submissionId" value="${e(submissionId)}"><input type="hidden" name="version" value="${version}"><div class="signup-fields"><label>Email<input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"></label>${branding.signupName === false ? "" : '<label>Name (optional)<input name="name" maxlength="80" autocomplete="name"></label>'}<button${preview ? " disabled" : ""}>${e(branding.signupButton?.trim() || `Subscribe to ${pub.settings.name}`)}</button></div><label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><p class="consent">By subscribing, you ask to receive ${e(pub.settings.name)} by email. Confirm your address to join. You can unsubscribe at any time.</p></fieldset></form>`;
}
export type PublicCard = {
  title: string;
  subtitle: string;
  slug: string;
  publishedAt?: string;
  cover?: PublicationLogo;
  coverAlt?: string;
};
export function newsletterCard(
  i: PublicCard,
  base: string,
  latest = false,
  label = "Latest issue",
) {
  const titleTag = latest ? "2" : "3";
  return `<section class="issue-card ${latest ? "latest" : ""}">${i.cover ? `<a href="${e(base)}/p/${e(i.slug)}" tabindex="-1" aria-hidden="true"><img class="issue-cover" src="${e(i.cover.url)}" alt="${e(i.coverAlt || "")}" width="${i.cover.width}" height="${i.cover.height}" loading="lazy"></a>` : ""}${latest ? `<p class="eyebrow">${e(label)}</p>` : ""}<h${titleTag}><a href="${e(base)}/p/${e(i.slug)}">${e(i.title)}</a></h${titleTag}>${i.subtitle ? `<p>${e(i.subtitle)}</p>` : ""}${i.publishedAt ? `<time datetime="${e(i.publishedAt)}">${e(new Date(i.publishedAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }))}</time>` : ""}</section>`;
}
export function newsletterHome(
  pub: Publication,
  issues: PublicCard[],
  signup: string,
  site?: PublicSiteContext,
  cover?: PublicationLogo,
  featured = false,
) {
  const base = site?.pathPrefix ?? `/n/${pub.settings.slug}`;
  const branding = pub.branding ?? defaultBranding;
  const layout = branding.layout ?? "letter";
  const intro = `<section class="intro">${cover ? `<img class="publication-cover" src="${e(cover.url)}" alt="${e(branding.coverAlt || "")}" width="${cover.width}" height="${cover.height}">` : ""}<h1>${e(pub.settings.name)}</h1><p class="description">${e(pub.settings.description)}</p>${branding.welcomeText ? `<p class="welcome">${e(branding.welcomeText)}</p>` : ""}${pub.settings.author ? `<p class="muted">By ${e(pub.settings.author)}</p>` : ""}</section>`;
  const subscribe =
    pub.status === "archived"
      ? "<p>This publication is archived. Browse its published issues below.</p>"
      : signup
        ? `<section class="signup"><h2>${e(branding.signupHeading?.trim() || "Stay in the loop")}</h2>${branding.signupDescription ? `<p class="signup-description">${e(branding.signupDescription)}</p>` : ""}${signup}</section>`
        : "";
  const latest = issues[0]
    ? newsletterCard(
        issues[0],
        base,
        true,
        featured ? "Featured issue" : "Latest issue",
      )
    : '<p class="empty">No public issues yet. New stories will appear here.</p>';
  const recent =
    issues.length > 1
      ? `<section aria-labelledby="recent-issues"><h2 id="recent-issues">Recent issues</h2><div${layout === "grid" ? ' class="issue-grid"' : ""}>${issues
          .slice(1, 6)
          .map((i) => newsletterCard(i, base))
          .join("")}</div></section>`
      : "";
  return `<div class="layout-${layout}">${intro}${layout === "letter" ? subscribe + latest : latest + subscribe}${recent}<p class="archive-link"><a href="${e(base)}/archive">Browse the archive →</a></p></div>`;
}
