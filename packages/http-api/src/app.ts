import { Hono } from "hono";
import type { Runtime } from "@narada/core/runtime";
import { createBaseApp } from "./base.js";
import { ownerRoutes } from "./owner-routes.js";
import { restRoutes } from "./rest-routes.js";
import { publicNewsletterRoutes } from "./newsletter-routes.js";
import { publicFormRoutes } from "./form-routes.js";
import { unsubscribeRoutes } from "./broadcast-routes.js";
import { localMediaRoutes } from "./media-routes.js";
import type { ApiEnvironment } from "./context.js";
/** Full legacy dashboard composition. Public API hosting uses createPublicApi. */
export function createHttpApp(
  runtime: Runtime,
  extensions: (app: Hono<ApiEnvironment>) => void = () => {},
): Hono<ApiEnvironment> {
  const app = createBaseApp(runtime);
  extensions(app);
  app.get("/.well-known/*", (c) => runtime.auth.handler(c.req.raw));
  app.on(["GET", "POST"], "/api/auth/*", (c) =>
    runtime.auth.handler(c.req.raw),
  );
  app.route("/", publicContentRoutes(runtime));
  app.route("/", ownerRoutes(runtime));
  app.route("/", restRoutes(runtime));
  return app;
}
/** Recipient-facing endpoints retain their own consent/token/rate-limit rules. */
export function publicContentRoutes(runtime: Runtime): Hono {
  const app = new Hono();
  app.route("/n", publicNewsletterRoutes(runtime));
  if (runtime.config.NARADA_MODE === "local")
    app.route("/", localMediaRoutes(runtime));
  app.route("/api/forms", publicFormRoutes(runtime));
  app.route("/api/unsubscribe", unsubscribeRoutes(runtime));
  return app;
}
