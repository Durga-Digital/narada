import { Hono } from "hono";
import { Application } from "@narada/core/application";
import {
  apiKeyCaller,
  assertOperationAccess,
} from "@narada/core/authorization";
import { createRateLimitStorage } from "@narada/core/rate-limit";
import { timed } from "@narada/core/submission-timing";
import { AppError } from "@narada/core/model";
import type { Runtime } from "@narada/core/runtime";
import { matchHttpOperation, operations } from "@narada/contracts/operations";
import type { ApiEnvironment } from "./context.js";
import { createBaseApp } from "./base.js";
const restOperations = operations.filter((op) => "http" in op);
export function restRoutes(runtime: Runtime): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  const application = new Application(runtime);
  app.use("/api/v1/*", async (c, next) => {
    const token = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    const timing = c.get("submissionTiming");
    const key = await timed(timing, "authenticate", () =>
      runtime.service.authenticate(token),
    );
    const rate = await timed(timing, "rateLimit", () =>
      createRateLimitStorage(runtime.store).consume(`api:${key.id}`, {
        window: 60,
        max: 120,
      }),
    );
    if (!rate.allowed) {
      c.header("retry-after", String(rate.retryAfter));
      throw new AppError(429, "API rate limit exceeded");
    }
    const operation = matchHttpOperation(c.req.method, c.req.path);
    if (!operation)
      throw new AppError(
        key.permission === "full" ? 404 : 403,
        key.permission === "full"
          ? "Endpoint not found"
          : "No scoped access is available for this operation",
      );
    const caller = apiKeyCaller(key);
    assertOperationAccess(caller, operation.id);
    c.set("caller", caller);
    c.set("apiKey", key);
    const usage = timed(timing, "keyUsage", () =>
      runtime.service.recordKeyUse(key),
    );
    try {
      await Promise.all([usage, next()]);
    } finally {
      await usage;
    }
  });
  for (const operation of restOperations) {
    app.on(operation.http.method, operation.http.path, async (c) => {
      const params: Record<string, string> = {};
      try {
        operation.http.path.split("/").forEach((part, index) => {
          if (part.startsWith(":"))
            params[part.slice(1)] = decodeURIComponent(
              c.req.path.split("/")[index]!,
            );
        });
      } catch {
        throw new AppError(400, "Invalid path parameter");
      }
      const query = Object.fromEntries(
        Object.entries(c.req.query()).map(([key, value]) => [
          key,
          ["limit", "days"].includes(key) ? Number(value) : value,
        ]),
      );
      const text =
        ["POST", "PUT", "PATCH"].includes(c.req.method) ||
        operation.id === "issues.delete"
          ? await c.req.text()
          : "";
      let body: unknown;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new AppError(400, "Invalid JSON body");
        }
      } else if (operation.id === "segments.members.add") body = {};
      c.header("Cache-Control", "no-store");
      const result = await application.executeUnknown(
        c.get("caller"),
        operation.id,
        {
          ...(Object.keys(params).length ? { params } : {}),
          ...(Object.keys(query).length ? { query } : {}),
          ...(body !== undefined ? { body } : {}),
        },
        {
          requestId: c.res.headers.get("x-request-id") ?? undefined,
          idempotencyKey: c.req.header("idempotency-key"),
          http: {
            path: c.req.path,
            query: new URL(c.req.url).search,
            body: text ? JSON.parse(text) : null,
          },
          availableOperations: restOperations.map((op) => op.id),
          onOperation: (id) => {
            c.header("x-operation-id", id);
            c.header("operation-location", `/api/v1/operations/${id}`);
          },
          submission: {
            project: c.get("apiKey").project,
            timing: c.get("submissionTiming"),
            onAccepted: (accepted) => {
              c.set("acceptedMessageId", accepted.id);
              c.set("replayed", accepted.replayed);
            },
          },
        },
      );
      if (result.replayed !== undefined)
        c.header("idempotency-replayed", String(result.replayed));
      return c.json(result.value, result.status);
    });
  }
  return app;
}
/** REST-only server: no owner/session/OAuth initialization or dashboard routes. */
export function createPublicApi(runtime: Runtime): Hono<ApiEnvironment> {
  return createBaseApp(runtime).route("/", restRoutes(runtime));
}
