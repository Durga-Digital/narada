import { apiOrigin } from "@narada/core/origins";
import {
  agentInstructions,
  integrationGuide,
} from "@narada/core/integration-guide";
import { Hono } from "hono";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Runtime } from "@narada/core/runtime";
import { GrantStore } from "@narada/core/oauth-grants";
import {
  oauthCaller,
  assertOperationAccess,
  callerIdentity,
} from "@narada/core/authorization";
import { executeMcpOperation, mcpInputSchema, mcpError } from "./operations.js";
import {
  mcpOperations,
  mcpToolName,
  mcpProductScopes,
} from "@narada/contracts/mcp";
import { operationSchemas } from "@narada/contracts/discovery";
import { createRateLimitStorage } from "@narada/core/rate-limit";
import { randomUUID } from "node:crypto";

export function mcpRoutes(runtime: Runtime) {
  const { auth, config, store } = runtime,
    resource = `${config.BETTER_AUTH_URL}/api/mcp`,
    grants = new GrantStore(store, resource);
  const app = new Hono();
  const protectedMcp = auth.protectMcp(
    async (request, claims) => {
      const requestId = randomUUID(),
        ctx = await auth.$context;
      const grant =
        typeof claims.narada_grant === "string" &&
        typeof claims.sub === "string" &&
        typeof claims.azp === "string"
          ? await grants.active(claims.narada_grant, claims.sub, claims.azp)
          : undefined;
      const consent =
        typeof claims.narada_consent_id === "string"
          ? await ctx.adapter.findOne<{
              userId: string;
              clientId: string;
              scopes: string[];
              referenceId?: string;
            }>({
              model: "oauthConsent",
              where: [{ field: "id", value: claims.narada_consent_id }],
            })
          : null;
      const client =
        typeof claims.azp === "string"
          ? await ctx.adapter.findOne<{ disabled?: boolean }>({
              model: "oauthClient",
              where: [{ field: "clientId", value: claims.azp }],
            })
          : null;
      if (
        !client ||
        client.disabled ||
        !grant ||
        !consent ||
        consent.referenceId !== claims.narada_grant ||
        consent.userId !== claims.sub ||
        consent.clientId !== claims.azp
      )
        return Response.json(
          { error: "invalid_token" },
          {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${config.BETTER_AUTH_URL}/.well-known/oauth-protected-resource/api/mcp"`,
            },
          },
        );
      const caller = oauthCaller({
        subject: claims.sub!,
        clientId: claims.azp as string,
        resource,
        tokenScopes:
          typeof claims.scope === "string" ? claims.scope.split(" ") : [],
        tokenGrantId: claims.narada_grant as string,
        grant: { ...grant, id: grants.referenceOf(grant) },
        consent,
      });
      const rate = await createRateLimitStorage(store).consume(
        `mcp:${grant.userId}:${grant.clientId}`,
        { window: 60, max: 120 },
      );
      if (!rate.allowed)
        return Response.json(
          { error: "Rate limit exceeded" },
          { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
        );
      const handler = createMcpHandler(
        () => {
          const server = new McpServer(
            { name: "narada", version: "1.0.0" },
            { instructions: agentInstructions },
          );
          let guideAllowed = false;
          try {
            assertOperationAccess(caller, "integration.guide");
            guideAllowed = true;
          } catch {
            /* Grant has no onboarding capability. */
          }
          if (guideAllowed) {
            server.registerResource(
              "project-integration",
              "narada://guides/project-integration",
              {
                title: "Set up Narada or migrate from Resend",
                mimeType: "text/markdown",
                description:
                  "Domain setup, DNS handoff, owner-supplied secrets, code migration and verification.",
              },
              async (uri) => {
                assertOperationAccess(caller, "integration.guide");
                return {
                  contents: [
                    {
                      uri: uri.href,
                      mimeType: "text/markdown",
                      text: integrationGuide(apiOrigin(config)).markdown,
                    },
                  ],
                };
              },
            );
            server.registerPrompt(
              "migrate_from_resend",
              {
                title: "Set up Narada or migrate from Resend",
                description:
                  "Inspect this project, prepare Narada domains and code changes, then report DNS and owner-secret handoffs.",
              },
              async () => {
                assertOperationAccess(caller, "integration.guide");
                return {
                  messages: [
                    {
                      role: "user",
                      content: {
                        type: "text",
                        text: integrationGuide(apiOrigin(config)).markdown,
                      },
                    },
                  ],
                };
              },
            );
          }
          for (const op of mcpOperations) {
            const tool = server.registerTool(
              mcpToolName(op.id),
              {
                description: `${"description" in op ? op.description : `Narada ${op.id}.`} ${op.effect === "read" ? "Read permitted resources." : "Requires an idempotencyKey; repeat the same key and arguments to recover a lost response."}${op.effect === "send" ? " Human approval is required: use approvals_request, open reviewUrl, and check approvals_get. Calling this tool directly cannot send." : ""}${op.id === "issues.publish" ? " Web requires issues:publish, email requires issues:send, both requires both scopes. confirmed must be true." : ""}`,
                inputSchema: mcpInputSchema(op.id),
                outputSchema: z.fromJSONSchema(operationSchemas[op.id].output),
                annotations: {
                  readOnlyHint: op.effect === "read",
                  destructiveHint: op.effect !== "read",
                  idempotentHint: true,
                  openWorldHint:
                    op.effect === "send" ||
                    [
                      "domains.refresh",
                      "domains.create",
                      "domains.mailFrom.update",
                      "domains.dkim.enable",
                      "webhooks.create",
                      "webhooks.update",
                      "webhooks.deliveries.retry",
                    ].includes(op.id),
                },
              },
              async (input) => {
                const started = performance.now();
                let outcome = "success";
                let operationId: string | undefined;
                try {
                  const result = await executeMcpOperation(
                    runtime,
                    caller,
                    op.id,
                    input as Record<string, unknown>,
                    {
                      requestId,
                      onOperation: (id) => {
                        operationId = id;
                      },
                    },
                  );
                  return {
                    _meta: {
                      requestId,
                      ...(operationId
                        ? {
                            operationId,
                            statusUrl: `/api/v1/operations/${operationId}`,
                          }
                        : {}),
                    },
                    structuredContent: result as Record<string, unknown>,
                    content: [
                      { type: "text" as const, text: JSON.stringify(result) },
                    ],
                  };
                } catch (error) {
                  outcome = "error";
                  return {
                    isError: true,
                    content: [
                      {
                        type: "text" as const,
                        text: JSON.stringify(mcpError(error, requestId)),
                      },
                    ],
                  };
                } finally {
                  console.info(
                    JSON.stringify({
                      event: "mcp_operation",
                      requestId,
                      actor: callerIdentity(caller),
                      operation: op.id,
                      outcome,
                      durationMs: Math.round(performance.now() - started),
                    }),
                  );
                }
              },
            );
            try {
              assertOperationAccess(caller, op.id);
            } catch {
              tool.disable();
            }
          }
          return server;
        },
        { legacy: "stateless" },
      );
      const response = await handler.fetch(request);
      response.headers.set("x-request-id", requestId);
      return response;
    },
    { resource, challengeScopes: mcpProductScopes },
  );
  app.on(["POST", "GET", "DELETE"], "/api/mcp", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    const origin = c.req.header("origin");
    if (origin && origin !== config.BETTER_AUTH_URL)
      return c.json({ error: "Invalid origin" }, 403);
    const response = await protectedMcp(c.req.raw);
    // Apply after the SDK: its SSE response otherwise overwrites Hono headers.
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  });
  return app;
}
