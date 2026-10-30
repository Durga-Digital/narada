import { serve, type ServerType } from "@hono/node-server";
import type { Runtime } from "@narada/core/runtime";
import { createPublicApi } from "@narada/http-api";
/** Host the public REST surface in any long-lived Node process. */
export function startServer(
  runtime: Runtime,
  options: { port?: number; hostname?: string } = {},
): ServerType {
  return serve({
    fetch: createPublicApi(runtime).fetch,
    port: options.port ?? 3001,
    hostname: options.hostname ?? "127.0.0.1",
  });
}
