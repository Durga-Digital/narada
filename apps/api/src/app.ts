import { createHttpApp } from "@narada/http-api/app";
import { mcpRoutes, oauthRoutes } from "@narada/mcp";
import type { Runtime } from "@narada/core/runtime";
export function createApp(runtime: Runtime) {
  return createHttpApp(runtime, (app) => {
    app.route("/", mcpRoutes(runtime));
    app.route("/", oauthRoutes(runtime));
  });
}
export { createPublicApi } from "@narada/http-api";
