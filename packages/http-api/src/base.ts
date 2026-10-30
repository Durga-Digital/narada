import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError } from "@narada/core/model";
import { IdempotencyError } from "@narada/core/idempotency";
import { ApprovalRequiredError } from "@narada/core/send-approval-context";
import type { SubmissionTiming } from "@narada/core/submission-timing";
import type { Runtime } from "@narada/core/runtime";
import type { ApiEnvironment } from "./context.js";
export function createBaseApp(runtime: Runtime): Hono<ApiEnvironment> {
  const app = new Hono<ApiEnvironment>();
  app.use("*", (c, next) =>
    secureHeaders({
      crossOriginResourcePolicy: c.req.path.startsWith("/media/")
        ? "cross-origin"
        : "same-origin",
    })(c, next),
  );
  app.use("/api/v1/*", async (c, next) => {
    c.header("x-request-id", randomUUID());
    if (c.req.method !== "POST" || c.req.path !== "/api/v1/emails")
      return next();
    const timing: SubmissionTiming = {};
    c.set("submissionTiming", timing);
    const started = performance.now();
    try {
      await next();
    } finally {
      console.info(
        JSON.stringify({
          event: "email_submission",
          requestId: c.res.headers.get("x-request-id"),
          awsRequestId: c.env?.lambdaContext?.awsRequestId,
          gatewayRequestId: c.env?.requestContext?.requestId,
          status: c.res.status,
          messageId: c.get("acceptedMessageId"),
          replayed: c.get("replayed"),
          totalMs: Math.round((performance.now() - started) * 100) / 100,
          stagesMs: timing,
        }),
      );
    }
  });
  app.use("*", (c, next) =>
    c.req.path === "/api/admin/media" && c.req.method === "POST"
      ? next() // Upload limit runs after owner authentication.
      : bodyLimit({
          maxSize:
            c.req.path === "/api/mcp" ||
            /^\/api\/(admin|v1)\/publications\/[^/]+\/(?:logo|assets)$/.test(
              c.req.path,
            )
              ? 720_000
              : 350_000,
          onError: () => {
            throw new AppError(413, "Request too large");
          },
        })(c, next),
  );
  app.onError((e, c) => {
    const errorBody = (message: string, status: number) => ({
      error: message,
      ...(c.req.path.startsWith("/api/v1/")
        ? {
            code:
              (
                {
                  400: "invalid_request",
                  401: "unauthorized",
                  403: "forbidden",
                  404: "not_found",
                  409: "conflict",
                  413: "payload_too_large",
                  422: "validation_error",
                  429: "rate_limited",
                  503: "unavailable",
                } as Record<number, string>
              )[status] ?? "internal_error",
            requestId: c.res.headers.get("x-request-id"),
          }
        : {}),
    });
    if (e instanceof SyntaxError)
      return c.json(errorBody("Invalid JSON body", 400), 400);
    if (e instanceof ZodError)
      return c.json(
        errorBody(e.issues.map((x) => x.message).join("; "), 400),
        400,
      );
    if (e instanceof ApprovalRequiredError)
      return c.json({ ...errorBody(e.message, 409), code: e.code }, 409);
    if (e instanceof IdempotencyError) {
      if (e.retryAfter) c.header("Retry-After", String(e.retryAfter));
      return c.json(
        {
          ...errorBody(e.message, 409),
          code: e.code,
          ...(e.operationId ? { operationId: e.operationId } : {}),
        },
        409,
      );
    }
    if (e instanceof AppError)
      return c.json(errorBody(e.message, e.status), e.status as 400);
    console.error(
      JSON.stringify({ level: "error", name: e.name, message: e.message }),
    );
    return c.json(errorBody("Internal server error", 500), 500);
  });
  app.get("/api/health", (c) =>
    c.json({ ok: true, mode: runtime.config.NARADA_MODE }),
  );
  app.notFound((c) =>
    c.json(
      {
        error: "Endpoint not found",
        code: "not_found",
        requestId: c.res.headers.get("x-request-id"),
      },
      404,
    ),
  );
  return app;
}
