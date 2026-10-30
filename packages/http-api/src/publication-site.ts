import { Hono } from "hono";
import type { Runtime } from "@narada/core/runtime";
import { domainIsPublic } from "@narada/core/publication-domains";
import { customPublicationSite } from "@narada/core/publication-site";
import { publicNewsletterRoutes } from "./newsletter-routes.js";

/** Deliberately has no session, owner, OAuth, REST or MCP routes. */
export function createPublicationSite(runtime: Runtime) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.onError((_error, c) => c.text("Publication unavailable", 503));
  app.all("*", async (c) => {
    const row = await runtime.publicationDomains.authenticate(
      c.req.header("x-narada-binding") ?? "",
      c.req.header("x-narada-origin-secret") ?? "",
      c.req.header("x-narada-public-host") ?? "",
    );
    if (!row) return c.notFound();
    if (c.req.method === "GET" && c.req.path === "/.well-known/narada-site")
      return c.text(row.nonce);
    if (!domainIsPublic(row)) return c.notFound();
    const pub = await runtime.publications.get(row.publicationId);
    if (pub.status === "draft") return c.notFound();
    if (
      !/^(?:\/|\/archive|\/about|\/subscribe|\/confirm|\/(?:p|c)\/[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(
        c.req.path,
      )
    )
      return c.notFound();
    if (!["GET", "HEAD", "POST"].includes(c.req.method)) return c.notFound();
    c.header(
      "X-Robots-Tag",
      ["/confirm", "/subscribe"].includes(c.req.path) ? "noindex" : "index",
    );
    const response = await publicNewsletterRoutes(
      runtime,
      customPublicationSite(row),
    ).fetch(c.req.raw);
    // A nested router returns its own Response; outer context headers are not
    // merged automatically. Preserve reader indexing policy on that response.
    const headers = new Headers(response.headers);
    headers.set(
      "X-Robots-Tag",
      response.status >= 400 || ["/confirm", "/subscribe"].includes(c.req.path)
        ? "noindex"
        : "index",
    );
    return new Response(response.body, { status: response.status, headers });
  });
  return app;
}
