import { assetOrigin, publicOrigin } from "@narada/core/origins";
import { operations } from "@narada/contracts/operations";
import {
  PublicationEditorial,
  isEditorialOperation,
} from "@narada/core/publication-editorial";
import { renderIssue } from "@narada/core/newsletter-content";
import { publicationContentLinks } from "@narada/core/publication-content-links";
import {
  defaultPublicationSite,
  type PublicSiteContext,
} from "@narada/core/publication-site";
import type { Context } from "hono";
import { newsletterSignup, newsletterCard } from "@narada/core/newsletter-page";
import { PublicationPages } from "@narada/core/publication-pages";
import { ProductOperations } from "@narada/core/product-operations";
import type { Caller } from "@narada/core/authorization";
export { newsletterPage } from "@narada/core/newsletter-page";
import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Runtime } from "@narada/core/runtime";
import { AppError } from "@narada/core/model";
import { conditional } from "@narada/core/store";
import { editorDocument, escapeHtml as e } from "@narada/core/message-content";
import { unsubscribeToken } from "@narada/core/subscription-links";
import { createRateLimitStorage } from "@narada/core/rate-limit";
import { mutationJson } from "./idempotency.js";
import { decodeCursor, encodeCursor } from "./public-pagination.js";
const revisionInput = z.object({ revision: z.number().int().nonnegative() });
export function newsletterRoutes(runtime: Runtime) {
  const app = new Hono<{ Variables: { caller: Caller } }>(),
    { publications, issues } = runtime;
  const pages = new PublicationPages(runtime);
  const products = new ProductOperations(runtime);
  for (const op of operations.filter((op) => isEditorialOperation(op.id))) {
    if (!("http" in op)) continue;
    app.on(op.http.method, op.http.path.replace("/api/v1", ""), async (c) => {
      c.header("Cache-Control", "no-store");
      const prepared = await products.prepare(
        c.get("caller"),
        op.id as import("@narada/core/product-operations").ProductOperationId,
        {
          params: c.req.param(),
          ...(op.http.method === "GET"
            ? op.id.endsWith(".list")
              ? { query: c.req.query() }
              : {}
            : { body: await c.req.json() }),
        },
      );
      return op.effect === "read"
        ? c.json(await prepared.run())
        : mutationJson(
            c,
            (commit) => prepared.run(commit),
            undefined,
            op.http.status,
          );
    });
  }

  for (const [method, path, operation] of [
    ["PUT", "/publications/:id/branding", "publications.branding.update"],
    [
      "POST",
      "/publications/:id/branding/preview",
      "publications.branding.preview",
    ],
    ["POST", "/publications/:id/logo", "publications.logo.upload"],
    ["POST", "/publications/:id/assets", "publications.assets.upload"],
  ] as const)
    app.on(method, path, async (c) => {
      c.header("Cache-Control", "no-store");
      const prepared = await products.prepare(c.get("caller"), operation, {
        params: { id: c.req.param("id") },
        body: await c.req.json(),
      });
      return mutationJson(
        c,
        (commit) => prepared.run(commit),
        undefined,
        operation.endsWith(".upload") ? 201 : 200,
      );
    });
  for (const [method, suffix, operation] of [
    ["GET", "", "publications.domain.get"],
    ["PUT", "", "publications.domain.configure"],
    ["POST", "/check", "publications.domain.check"],
    ["POST", "/activate", "publications.domain.activate"],
    ["POST", "/disconnect", "publications.domain.disconnect"],
  ] as const)
    app.on(method, `/publications/:id/domain${suffix}`, async (c) => {
      c.header("Cache-Control", "no-store");
      const prepared = await products.prepare(c.get("caller"), operation, {
        params: { id: c.req.param("id") },
        ...(method === "GET" ? {} : { body: await c.req.json() }),
      });
      return method === "GET"
        ? c.json(await prepared.run())
        : mutationJson(c, (commit) => prepared.run(commit), undefined, 202);
    });
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/publications", async (c) => c.json(await publications.summaries()));
  app.post("/publications", (c) =>
    mutationJson(
      c,
      async (commit) => publications.create(await c.req.json(), commit),
      undefined,
      201,
    ),
  );
  app.get("/publications/:id", async (c) =>
    c.json(await publications.get(c.req.param("id"))),
  );
  app.get("/publications/:id/preview", async (c) => {
    const pub = await publications.get(c.req.param("id"));
    return c.json({ html: await pages.home(pub, true) });
  });
  app.put("/publications/:id", (c) =>
    mutationJson(c, async (commit) => {
      const data = revisionInput
        .extend({ settings: z.unknown() })
        .parse(await c.req.json());
      return publications.update(
        c.req.param("id"),
        data.settings,
        data.revision,
        undefined,
        commit,
      );
    }),
  );
  for (const action of ["activate", "archive"] as const)
    app.post(`/publications/:id/${action}`, (c) =>
      mutationJson(c, async (commit) => {
        const data = revisionInput.parse(await c.req.json()),
          pub = await publications.get(c.req.param("id")!);
        return publications.update(
          pub.id,
          pub.settings,
          data.revision,
          action === "activate" ? "active" : "archived",
          commit,
        );
      }),
    );
  app.get("/publications/:id/subscribers", async (c) =>
    c.json(await publications.subscribers(c.req.param("id"))),
  );
  app.delete("/publications/:id/issues/:issueId", async (c) => {
    const prepared = await products.prepare(c.get("caller"), "issues.delete", {
      params: { id: c.req.param("id"), issueId: c.req.param("issueId") },
      body: await c.req.json(),
    });
    return mutationJson(c, (commit) => prepared.run(commit));
  });
  app.get("/publications/:id/issues", async (c) => {
    const prepared = await products.prepare(c.get("caller"), "issues.list", {
      params: { id: c.req.param("id") },
      query: c.req.query(),
    });
    return c.json(await prepared.run());
  });
  app.post("/publications/:id/issues", (c) =>
    mutationJson(
      c,
      async (commit) =>
        issues.create(c.req.param("id"), await c.req.json(), commit),
      undefined,
      201,
    ),
  );
  app.get("/publications/:id/issues/:issueId", async (c) => {
    const issue = await issues.get(c.req.param("id"), c.req.param("issueId"));
    return c.json({
      issue,
      delivery: issue.broadcastId
        ? await runtime.broadcasts.results(issue.broadcastId)
        : undefined,
    });
  });
  app.put("/publications/:id/issues/:issueId", (c) =>
    mutationJson(c, async (commit) => {
      const data = revisionInput
        .extend({ draft: z.unknown() })
        .parse(await c.req.json());
      return issues.update(
        c.req.param("id"),
        c.req.param("issueId"),
        data.draft,
        data.revision,
        commit,
      );
    }),
  );
  app.get("/publications/:id/issues/:issueId/preview", async (c) =>
    c.json(await issues.preview(c.req.param("id"), c.req.param("issueId"))),
  );
  app.post("/publications/:id/issues/:issueId/test", (c) =>
    mutationJson(
      c,
      async (commit) => {
        const data = revisionInput
          .extend({ to: z.email() })
          .parse(await c.req.json());
        return issues.test(
          c.req.param("id"),
          c.req.param("issueId"),
          data.to,
          data.revision,
          commit,
        );
      },
      undefined,
      202,
    ),
  );
  app.post("/publications/:id/issues/:issueId/publish", (c) =>
    mutationJson(
      c,
      async (commit) => {
        const data = revisionInput
          .extend({
            channels: z.enum(["web", "email", "both"]),
            scheduledAt: z.number().int().optional(),
            confirmed: z.literal(true),
          })
          .strict()
          .parse(await c.req.json());
        return issues.publish(
          c.req.param("id"),
          c.req.param("issueId"),
          data.revision,
          data.channels,
          data.scheduledAt,
          commit,
        );
      },
      undefined,
      202,
    ),
  );
  for (const action of ["cancel", "withdraw"] as const)
    app.post(`/publications/:id/issues/:issueId/${action}`, (c) =>
      mutationJson(c, async (commit) =>
        issues[action](
          c.req.param("id")!,
          c.req.param("issueId")!,
          revisionInput.parse(await c.req.json()).revision,
          commit,
        ),
      ),
    );
  app.post("/publications/:id/issues/:issueId/duplicate", (c) =>
    mutationJson(
      c,
      async (commit) => {
        const issue = await issues.get(
          c.req.param("id"),
          c.req.param("issueId"),
        );
        return issues.create(
          issue.publicationId,
          {
            ...issue.draft,
            title: `${issue.draft.title.slice(0, 150)} (copy)`,
            slug: `${issue.draft.slug.slice(0, 65)}-${randomUUID().slice(0, 8)}`,
          },
          commit,
        );
      },
      undefined,
      201,
    ),
  );
  return app;
}
export function publicNewsletterRoutes(
  runtime: Runtime,
  customSite?: PublicSiteContext,
) {
  const app = new Hono(),
    limiter = createRateLimitStorage(runtime.store),
    origin = customSite?.origin ?? new URL(publicOrigin(runtime.config)).origin;
  const route = customSite ? "" : "/:slug";
  const publication = async (c: Context) => {
    const pub = customSite
      ? await runtime.publications.get(customSite.publicationId)
      : await runtime.publications.bySlug(c.req.param("slug")!);
    if (pub.status === "draft")
      throw new AppError(404, "Publication not found");
    return pub;
  };
  const siteFor = (pub: Awaited<ReturnType<typeof publication>>) =>
    customSite ?? defaultPublicationSite(pub, publicOrigin(runtime.config));
  const pages = new PublicationPages(runtime);
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; img-src 'self' ${[...new Set([new URL(publicOrigin(runtime.config)).origin, new URL(assetOrigin(runtime.config)).origin])].join(" ")} https://i.ytimg.com; frame-src https://www.youtube-nocookie.com; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    );
    await next();
  });
  app.use(customSite ? "*" : "/:slug/*", async (c, next) => {
    if (c.req.method === "POST") {
      // Native form navigation under no-referrer sends Origin: null. Fetch metadata
      // is browser-controlled and still proves the form came from this origin.
      const requestOrigin = c.req.header("origin");
      const privateNavigation =
        requestOrigin === "null" &&
        c.req.header("sec-fetch-site") === "same-origin";
      if (requestOrigin !== origin && !privateNavigation)
        throw new AppError(403, "Invalid origin");
      const limit = await limiter.consume(
        `newsletter-submit:${(await publication(c)).id}`,
        { window: 60, max: 60 },
      );
      if (!limit.allowed) {
        c.header("Retry-After", String(limit.retryAfter));
        throw new AppError(429, "Please try again in a minute");
      }
    }
    await next();
  });
  app.onError((err, c) => {
    const status =
      err instanceof AppError
        ? err.status
        : err instanceof z.ZodError
          ? 400
          : 500;
    const message =
      err instanceof AppError
        ? err.message
        : status === 400
          ? "Check the submitted values and try again"
          : "Unable to load this page. Please try again.";
    return c.html(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Newsletter</title><main><h1>${e(message)}</h1><p>Return to the previous page to continue.</p></main></html>`,
      status as 400,
    );
  });

  app.get(`${route}/about`, async (c) => {
    const pub = await publication(c),
      editorial = new PublicationEditorial(runtime),
      value = await editorial.snapshot(pub, "about");
    if (!value.published) throw new AppError(404, "About page not found");
    const content = value.published.content;
    const rendered = renderIssue(
      {
        ...content,
        document: editorDocument.parse(content.document),
        slug: "about",
        subtitle: "",
        subject: "",
        preheader: "",
      },
      { target: "web", origin: publicOrigin(runtime.config) },
    );
    const site = siteFor(pub);
    const signup =
      pub.status === "active"
        ? newsletterSignup(
            pub,
            (await runtime.forms.publicForm(pub.formId)).form.version,
            randomUUID(),
            false,
            site,
          )
        : "";
    return c.html(
      await pages.page(
        pub,
        `<article>${customSite ? publicationContentLinks(rendered.html, new URL(`/n/${pub.settings.slug}/about`, publicOrigin(runtime.config)).href) : rendered.html}</article>${signup ? `<section class="signup"><h2>Subscribe</h2>${signup}</section>` : ""}`,
        {
          site,
          origin,
          path: `${site.pathPrefix}/about`,
          title: content.title,
        },
      ),
    );
  });
  app.get(`${route}/c/:collectionSlug`, async (c) => {
    const pub = await publication(c),
      editorial = new PublicationEditorial(runtime),
      col = await editorial.collectionBySlug(
        pub,
        c.req.param("collectionSlug"),
      );
    const page = await editorial.collectionIssues(pub, col.id, {
        cursor: c.req.query("cursor"),
      }),
      site = siteFor(pub);
    const cards = await Promise.all(
      page.data.map(async (card) =>
        newsletterCard(
          { ...card, cover: await pages.image(pub, card.coverAssetId) },
          site.pathPrefix,
        ),
      ),
    );
    const path = `${site.pathPrefix}/c/${col.slug}`;
    return c.html(
      await pages.page(
        pub,
        `<div class="archive-heading"><h1>${e(col.name)}</h1><p>${e(col.description)}</p></div>${cards.join("") || "<p>No public issues in this collection yet.</p>"}${page.nextCursor ? `<p><a href="${e(path)}?cursor=${encodeURIComponent(page.nextCursor)}">Older issues</a></p>` : ""}`,
        { site, origin, path, title: col.name, description: col.description },
      ),
    );
  });
  app.get(`${route}/subscribe`, async (c) => {
    const pub = await publication(c);
    if (pub.status !== "active")
      throw new AppError(
        410,
        "This publication is no longer accepting subscriptions",
      );
    const { form } = await runtime.forms.publicForm(pub.formId);
    const body = `<section class="signup"><h1>${e(pub.branding?.signupHeading?.trim() || `Subscribe to ${pub.settings.name}`)}</h1><p>${e(pub.branding?.signupDescription || pub.settings.description)}</p>${newsletterSignup(pub, form.version, randomUUID(), false, siteFor(pub))}</section>`;
    return c.html(
      await pages.page(pub, body, {
        site: siteFor(pub),
        origin,
        path: c.req.path,
        private: true,
      }),
    );
  });
  app.post(`${route}/subscribe`, async (c) => {
    const pub = await publication(c);
    if (pub.status !== "active")
      throw new AppError(
        410,
        "This publication is no longer accepting subscriptions",
      );
    const input = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        name: z.string().max(80).default(""),
        website: z.string().max(500).default(""),
        submissionId: z.uuid(),
        version: z.coerce.number().int().positive(),
      })
      .strict()
      .parse(await c.req.parseBody());
    if (!input.website) {
      const cooldown = await limiter.consume(
        `newsletter-email:${pub.id}:${input.email}`,
        { window: 60, max: 1 },
      );
      if (cooldown.allowed) {
        try {
          await runtime.forms.submit(pub.formId, {
            version: input.version,
            submissionId: input.submissionId,
            answers: { email: input.email, name: input.name, consent: true },
          });
        } catch (err) {
          if (!(err instanceof AppError && err.status === 429)) throw err;
        }
      }
    }
    return c.html(
      await pages.page(
        pub,
        "<h1>Check your email</h1><p>If this address can receive a confirmation, a link will arrive shortly. Check your spam folder, or try again later.</p>",
        { site: siteFor(pub), origin, path: c.req.path, private: true },
      ),
    );
  });
  app.get(`${route}/confirm`, async (c) => {
    const pub = await publication(c),
      token = z.string().max(300).parse(c.req.query("token"));
    return c.html(
      await pages.page(
        pub,
        `<h1>Confirm your subscription</h1><p>Confirm that you requested emails from ${e(pub.settings.name)}.</p><form method="post"><input type="hidden" name="token" value="${e(token)}"><button>Confirm subscription</button></form>`,
        { site: siteFor(pub), origin, path: c.req.path, private: true },
      ),
    );
  });
  app.post(`${route}/confirm`, async (c) => {
    const pub = await publication(c);
    if (pub.status !== "active")
      throw new AppError(
        410,
        "This publication is no longer accepting subscriptions",
      );
    const { token } = z
      .object({ token: z.string().max(300) })
      .strict()
      .parse(await c.req.parseBody());
    const row = await runtime.forms.confirmation(token);
    if (row.formId !== pub.formId)
      throw new AppError(
        400,
        "This confirmation belongs to a different publication",
      );
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await runtime.forms.confirm(token);
        await runtime.forms.sync(
          await runtime.forms.response(row.id),
          (await runtime.forms.version(pub.formId, row.version)).content,
        );
        break;
      } catch (err) {
        if (
          attempt === 2 ||
          !(conditional(err) || (err instanceof AppError && err.status === 409))
        )
          throw err;
      }
    }
    const preferences = await runtime.subscriptions.preferences(row.email!);
    const subscribed =
      preferences.topics.some((t) => t.id === pub.topicId && t.subscribed) &&
      !preferences.unsubscribedAll;
    const url = `${new URL(publicOrigin(runtime.config)).origin}/api/unsubscribe/${unsubscribeToken(runtime.config.BETTER_AUTH_SECRET, pub.audienceId, row.email!, pub.topicId)}?preferences=1`;
    return c.html(
      await pages.page(
        pub,
        `<h1>${subscribed ? "Subscribed" : "Your email is confirmed"}</h1><p>${subscribed ? "Thank you for subscribing." : "Your previous email preferences have been preserved. You can update them to subscribe."}</p><a href="${e(url)}">Manage email preferences</a>`,
        { site: siteFor(pub), origin, path: c.req.path, private: true },
      ),
    );
  });
  app.get(`${route}/p/:issueSlug`, async (c) => {
    const pub = await publication(c),
      issue = await runtime.issues.publicIssue(pub, c.req.param("issueSlug"));
    const cover = await pages.image(pub, issue.coverAssetId);
    return c.html(
      await pages.page(
        pub,
        `<article>${cover ? `<img class="issue-cover" src="${e(cover.url)}" alt="${e(issue.coverAlt || "")}" width="${cover.width}" height="${cover.height}">` : ""}<p class="muted">${e(issue.author)} · Published ${e(issue.publishedAt!.slice(0, 10))}${issue.updatedAt !== issue.publishedAt ? ` · Updated ${e(issue.updatedAt!.slice(0, 10))}` : ""}</p>${customSite ? publicationContentLinks(issue.html, new URL(`/n/${pub.settings.slug}/p/${issue.slug}`, publicOrigin(runtime.config)).href) : issue.html}</article>`,
        {
          site: siteFor(pub),
          origin,
          path: c.req.path,
          article: true,
          socialImage: cover,
          title: issue.title,
          description: issue.subtitle || pub.settings.description,
        },
      ),
    );
  });
  app.get(route || "/", async (c) => {
    const pub = await publication(c);
    return c.html(await pages.home(pub, false, siteFor(pub)));
  });
  for (const path of [`${route}/archive`])
    app.get(path, async (c) => {
      const pub = await publication(c),
        scope = `archive#${pub.id}`,
        cursor = decodeCursor(scope, c.req.query("cursor"));
      const position =
        cursor === undefined
          ? undefined
          : z
              .object({
                pk: z.string().startsWith("ARCHIVE#"),
                sk: z.literal("META"),
                scope: z.literal(scope),
                sort: z.string(),
              })
              .strict()
              .parse(cursor);
      const page = await runtime.issues.archive(pub, position),
        base = siteFor(pub).pathPrefix;
      return c.html(
        await pages.page(
          pub,
          `<div class="archive-heading"><p class="eyebrow">${e(pub.settings.name)}</p><h1>Archive</h1><p>Explore every published issue.</p></div>${page.data.length ? (await Promise.all(page.data.map(async (i) => newsletterCard({ ...i, cover: await pages.image(pub, i.coverAssetId) }, base)))).join("") : "<p>No public issues yet.</p>"}${page.cursor ? `<p><a href="${base}/archive?cursor=${encodeURIComponent(encodeCursor(scope, page.cursor))}">Older issues</a></p>` : ""}`,
          { site: siteFor(pub), origin, path: c.req.path },
        ),
      );
    });
  return app;
}
