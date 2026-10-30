import { dashboardOrigin, installationIdentity } from "@narada/core/origins";
import { DomainSetup } from "@narada/core/domain-setup";

import { SendApprovals } from "@narada/core/send-approvals";
import { mediaRoutes } from "./media-routes.js";
import { Activity, activityContext } from "@narada/core/activity";
import { SharedOperations } from "@narada/core/shared-operations";

import { newsletterRoutes } from "./newsletter-routes.js";
import { idempotency, mutationJson } from "./idempotency.js";

import { apiKeyMetadata } from "@narada/core/service";
import { formRoutes } from "./form-routes.js";

import { apiKeyAccess } from "@narada/core/api-permissions";
import { ownerCaller } from "@narada/core/authorization";
import { matchHttpOperation, operations } from "@narada/contracts/operations";

import { messageMetadata } from "@narada/core/message-metadata";
import {
  confirmName,
  findKey,
  deleteKey,
  removeDomain,
} from "@narada/core/resource-lifecycle";
import { domainNamePattern } from "@narada/core/domain-name";
import { readMetrics } from "@narada/core/metrics";
import {
  webhookEvents,
  legacyWebhookEvents,
} from "@narada/core/webhook-events";
import { templateRoutes } from "./template-routes.js";

import { Hono, type Context } from "hono";

import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  AppError,
  emailInput,
  type Message,
  type Domain,
  type ApiKey,
  type Entity,
  type DeliveryEvent,
} from "@narada/core/model";
import {
  deliveryView,
  listDeliveries,
  deliveryHistory,
  retryWebhook,
} from "@narada/core/webhooks";
import type { Runtime } from "@narada/core/runtime";
import { broadcastRoutes } from "./broadcast-routes.js";
import {
  getRecoverySender,
  saveRecoverySender,
  authorizeRecoverySenderReplay,
} from "@narada/core/recovery-sender";
import { ownerSecurityOperations } from "@narada/contracts/owner-security";

import type { ApiEnvironment } from "./context.js";
export function ownerRoutes(runtime: Runtime): Hono<ApiEnvironment> {
  const { config, store, service, auth } = runtime;
  const app = new Hono<ApiEnvironment>();
  const products = new SharedOperations(runtime);
  const operational = runtime.operational;
  const sesStatus = operational.diagnostics;
  const emailActivity = (c: Context) => ({
    context: activityContext(
      c.get("caller"),
      installationIdentity(config),
      "emails.send",
      c.res.headers.get("x-request-id") ?? randomUUID(),
      undefined,
      !!c.req.header("idempotency-key"),
    ),
    onOperation: (id: string) => {
      c.header("x-operation-id", id);
      c.header("operation-location", `/api/v1/operations/${id}`);
    },
  });
  app.use("/api/admin/*", async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Sign in to continue" }, 401);
    if (
      c.req.method !== "GET" &&
      c.req.header("origin") !== dashboardOrigin(config)
    )
      return c.json({ error: "Invalid origin" }, 403);
    // Binary uploads are content addressed and retry safe, not JSON mutations.
    if (c.req.path === "/api/admin/media") return next();
    const caller = ownerCaller(session.user.id);
    c.set("caller", caller);
    if (c.req.path.startsWith("/api/admin/approvals")) return next();
    const operation = matchHttpOperation(
      c.req.method,
      c.req.path.replace("/api/admin/", "/api/v1/"),
    );
    if (operation?.effect === "read") return next();
    const requestId = randomUUID();
    c.header("x-request-id", requestId);
    await idempotency(
      c,
      next,
      store,
      `user:${session.user.id}`,
      c.req.method === "POST" && c.req.path === "/api/admin/webhooks"
        ? async (body) => {
            const saved = body as { id: string; secret: string };
            const current = await operational.endpoint(saved.id);
            if (current.secret !== saved.secret)
              throw new AppError(409, "The webhook signing secret has changed");
          }
        : c.req.method === "PUT" &&
            c.req.path === ownerSecurityOperations[1].http.path
          ? (body) => authorizeRecoverySenderReplay(store, body)
          : undefined,
      operation
        ? activityContext(
            caller,
            installationIdentity(config),
            operation.id,
            requestId,
            undefined,
            !!c.req.header("idempotency-key"),
          )
        : undefined,
    );
  });
  const [recoveryRead, recoveryUpdate] = ownerSecurityOperations;
  app.get(recoveryRead.http.path, async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(recoveryRead.output.parse(await getRecoverySender(store)));
  });
  app.put(recoveryUpdate.http.path, async (c) => {
    c.header("Cache-Control", "no-store");
    const input = recoveryUpdate.input.parse(await c.req.json());
    return mutationJson(
      c,
      (commit) => saveRecoverySender(store, input, commit),
      (result) => recoveryUpdate.output.parse(result),
    );
  });
  const sendApprovals = new SendApprovals(runtime);
  app.get("/api/admin/approvals", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await sendApprovals.list(c.get("caller"), c.req.query()));
  });
  app.get("/api/admin/approvals/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(
      await sendApprovals.review(
        c.get("caller"),
        c.req.param("id"),
        c.req.query("recipient"),
      ),
    );
  });
  for (const decision of ["approve", "reject"] as const) {
    app.post(`/api/admin/approvals/:id/${decision}`, async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(
        await sendApprovals.decide(
          c.get("caller"),
          c.req.param("id"),
          await c.req.json(),
          decision === "approve",
        ),
      );
    });
  }
  const activity = new Activity(runtime);
  app.get("/api/admin/operations", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await activity.list(c.get("caller"), c.req.query()));
  });
  app.get("/api/admin/operations/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await activity.get(c.get("caller"), c.req.param("id")));
  });
  app.post("/api/admin/operations/lookup", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await activity.lookup(c.get("caller"), await c.req.json()));
  });
  app.route("/api/admin", broadcastRoutes(runtime));
  app.route("/api/admin", templateRoutes(runtime));
  app.route("/api/admin", formRoutes(runtime));
  app.route("/api/admin", newsletterRoutes(runtime));
  app.route("/api/admin", mediaRoutes(runtime));
  app.get("/api/admin/overview", async (c) => {
    c.header("Cache-Control", "no-store");
    const messages = await store.list<Message>("messages#default");
    const settings = await store.get("SETTINGS");
    return c.json({
      mode: config.NARADA_MODE,
      paused: !!settings?.paused,
      messages: messages.map(({ id, status, createdAt, input }) => ({
        id,
        status,
        createdAt,
        input: {
          from: input.from,
          to: input.to,
          subject: input.subject,
          tags: input.tags,
          priority: input.priority ?? "normal",
        },
      })),
      stats: {
        total: messages.length,
        queued: messages.filter((x) => x.status === "queued").length,
        delivered: messages.filter((x) =>
          ["delivered", "captured", "sent"].includes(x.status),
        ).length,
        failed: messages.filter((x) =>
          ["failed", "bounced", "complained", "unknown", "expired"].includes(
            x.status,
          ),
        ).length,
      },
    });
  });
  app.get("/api/admin/messages/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    const msg = await store.get<Message>(`MSG#${c.req.param("id")}`);
    if (!msg) throw new AppError(404, "Message not found");
    return c.json(messageMetadata(msg));
  });
  app.post("/api/admin/send", async (c) =>
    c.json(
      await service.accept(
        await runtime.templates.resolveEmailInput(await c.req.json()),
        "default",
        c.req.header("idempotency-key"),
        undefined,
        undefined,
        undefined,
        emailActivity(c),
      ),
      202,
    ),
  );
  app.get("/api/admin/keys", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json((await store.list<ApiKey>("keys")).map(apiKeyMetadata));
  });
  const keySettings = z
    .object({
      name: z.string().trim().min(1).max(80),
      domain: z
        .string()
        .trim()
        .toLowerCase()
        .regex(domainNamePattern)
        .max(253)
        .optional(),
    })
    .and(apiKeyAccess);
  app.put("/api/admin/keys/:id", async (c) => {
    const input = keySettings
      .and(
        z.object({
          permission: z.enum(["sending", "scoped", "full", "operations"]),
          revision: z.number().int().nonnegative(),
        }),
      )
      .parse(await c.req.json());
    c.header("Cache-Control", "no-store");
    return c.json(await service.updateKey(c.req.param("id"), input));
  });
  app.post("/api/admin/keys", async (c) => {
    const { name, permission, domain, scopes, operationAccess } =
      keySettings.parse(await c.req.json());
    c.header("Cache-Control", "no-store");
    return mutationJson(
      c,
      (commit) =>
        service.createKey(
          name,
          permission,
          domain,
          scopes,
          commit,
          operationAccess,
        ),
      undefined,
      201,
    );
  });
  const confirmationBody = z.object({
    confirmation: z.string().min(1).max(253),
  });
  app.post("/api/admin/keys/:id/revoke", async (c) => {
    const { confirmation } = confirmationBody.parse(await c.req.json());
    const key = await findKey(store, c.req.param("id"));
    confirmName(key.name, confirmation);
    await store.patch(key.pk, { revoked: true });
    return c.json({ ok: true });
  });
  app.delete("/api/admin/keys/:id", async (c) => {
    const { confirmation } = confirmationBody.parse(await c.req.json());
    await deleteKey(store, c.req.param("id"), confirmation);
    return c.json({ ok: true });
  });
  app.delete("/api/admin/domains/:name", async (c) => {
    const { confirmation } = confirmationBody.parse(await c.req.json());
    await removeDomain(store, c.req.param("name"), confirmation);
    return c.json({ ok: true });
  });
  app.get("/api/admin/domains", async (c) => {
    // Preserve the legacy dashboard array while allowing the publication selector
    // to use the same bounded, authorized domain catalog as REST and MCP.
    if (c.req.query("view") === "page") {
      const prepared = await products.prepare(c.get("caller"), "domains.list", {
        query: {
          limit: 20,
          ...(c.req.query("cursor") ? { cursor: c.req.query("cursor") } : {}),
        },
      });
      return c.json(await prepared.run());
    }
    return c.json(await store.list("domains"));
  });
  app.post("/api/admin/domains", async (c) => {
    const { name } = z
      .object({ name: z.string() })
      .strict()
      .parse(await c.req.json());
    return mutationJson(
      c,
      (commit) => new DomainSetup(store).create(name, commit),
      undefined,
      201,
    );
  });
  app.post("/api/admin/domains/:name/verify", (c) =>
    mutationJson(c, (commit) =>
      operational.refreshDomain(c.req.param("name"), commit),
    ),
  );
  app.put("/api/admin/domains/:name/mail-from", async (c) => {
    const name = c.req.param("name");
    const previous = await operational.domain(name);
    const body = z
      .object({
        domain: z.string().nullable(),
        behavior: z.enum(["USE_DEFAULT_VALUE", "REJECT_MESSAGE"]),
      })
      .strict()
      .parse(await c.req.json());
    return mutationJson(c, (commit) =>
      new DomainSetup(store).configure(
        name,
        "mailFrom",
        { ...body, revision: Number(previous.revision ?? 0) },
        commit,
      ),
    );
  });
  app.post("/api/admin/domains/:name/dkim", async (c) => {
    const name = c.req.param("name");
    const previous = await operational.domain(name);
    return mutationJson(c, (commit) =>
      new DomainSetup(store).configure(
        name,
        "dkim",
        { revision: Number(previous.revision ?? 0) },
        commit,
      ),
    );
  });
  app.post("/api/admin/domains/:name/test", async (c) => {
    const name = c.req.param("name");
    const domain = await store.get<Domain>(`DOMAIN#${name}`);
    if (!domain || domain.removedAt)
      throw new AppError(404, "Domain not found");
    const { to, localPart } = z
      .object({
        to: z.email().toLowerCase(),
        localPart: z
          .string()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/)
          .default("hello"),
      })
      .parse(await c.req.json());
    const result = await service.accept(
      emailInput.parse({
        from: `Narada <${localPart}@${name}>`,
        to,
        subject: `Narada domain check: ${name}`,
        text: `This is your requested domain setup test for ${name}.\n\nInspect the message headers in your inbox for SPF, DKIM, and DMARC results. A delivery notification does not confirm inbox placement.`,
        expires_in: 3600,
      }),
      "default",
      c.req.header("idempotency-key"),
      undefined,
      undefined,
      undefined,
      emailActivity(c),
    );
    return c.json(result, 202);
  });
  app.get("/api/admin/suppressions", async (c) =>
    c.json(await store.list("suppressions")),
  );
  app.post("/api/admin/suppressions", async (c) => {
    const { email } = z
      .object({ email: z.email().toLowerCase() })
      .parse(await c.req.json());
    return mutationJson(
      c,
      (commit) => operational.addSuppression(email, commit),
      () => ({ ok: true }),
    );
  });
  app.delete("/api/admin/suppressions/:email", (c) =>
    mutationJson(c, (commit) =>
      operational.removeSuppression(
        z.email().parse(c.req.param("email")).toLowerCase(),
        commit,
      ),
    ),
  );
  app.get("/api/admin/metrics", async (c) => {
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .default(15)
      .parse(c.req.query("days"));
    const domain = z
      .string()
      .regex(/^[a-z0-9.-]+$/)
      .max(253)
      .optional()
      .parse(c.req.query("domain"));
    return c.json(await readMetrics(store, days, domain));
  });
  app.get("/api/admin/settings/ses", async (c) => c.json(await sesStatus()));
  app.get("/api/admin/settings", async (c) =>
    c.json(await operational.sending()),
  );
  app.post("/api/admin/settings", async (c) => {
    const { paused } = z
      .object({ paused: z.boolean() })
      .parse(await c.req.json());
    return mutationJson(
      c,
      (commit) => operational.setSending(paused, undefined, commit),
      (value) => ({ paused: value.paused }),
    );
  });
  app.get("/api/admin/webhooks", async (c) =>
    c.json({
      mode: config.NARADA_MODE,
      endpoints: (await store.list<Entity>("webhooks")).map(
        ({ id, url, createdAt, events }) => ({
          id,
          url,
          createdAt,
          events: events ?? legacyWebhookEvents,
        }),
      ),
      attempts: (await store.list("webhookAttempts"))
        .filter((row) => !row.ttl || Number(row.ttl) > Date.now() / 1000)
        .map(deliveryView),
    }),
  );
  const webhookInput = z
    .object({
      url: z.url(),
      events: z
        .array(z.enum(webhookEvents.map((e) => e.type)))
        .min(1)
        .max(webhookEvents.length)
        .transform((events) => [...new Set(events)])
        .default(legacyWebhookEvents),
    })
    .strict();
  app.post("/api/admin/webhooks", async (c) => {
    const input = webhookInput.parse(await c.req.json());
    return mutationJson(
      c,
      (commit) => operational.createWebhook(input, commit),
      undefined,
      201,
    );
  });
  app.patch("/api/admin/webhooks/:id", async (c) => {
    const input = webhookInput.parse(await c.req.json());
    return mutationJson(c, (commit) =>
      operational.updateWebhook(c.req.param("id"), input, undefined, commit),
    );
  });
  app.delete("/api/admin/webhooks/:id", (c) =>
    mutationJson(c, (commit) =>
      operational.deleteWebhook(c.req.param("id"), commit),
    ),
  );
  app.get("/api/admin/webhooks/deliveries", async (c) =>
    c.json(await listDeliveries(store, c.req.query())),
  );
  app.get("/api/admin/webhooks/deliveries/:id", async (c) =>
    c.json(await deliveryHistory(store, c.req.param("id"), c.req.query())),
  );
  app.post("/api/admin/webhooks/attempts/:id/retry", async (c) => {
    return mutationJson(c, (commit) =>
      retryWebhook(store, c.req.param("id"), commit),
    );
  });
  if (config.NARADA_MODE === "local") {
    app.post("/api/admin/events", async (c) => {
      const input = z
        .object({
          messageId: z.uuid(),
          type: z.enum(["delivered", "bounced", "complained", "delayed"]),
          eventId: z.string().optional(),
        })
        .parse(await c.req.json());
      const msg = await store.get<Message>(`MSG#${input.messageId}`);
      if (!msg) throw new AppError(404, "Message not found");
      const event: DeliveryEvent = {
        id: input.eventId ?? randomUUID(),
        type: input.type,
        at: new Date().toISOString(),
        recipients: msg.input.to,
        permanent: true,
      };
      await runtime.queues.send("events", { messageId: msg.id, event });
      return c.json({ ok: true });
    });
    app.post("/api/dev/webhook-receiver", async (c) => {
      const payload = await c.req.json();
      await store.put({
        pk: `CAPTURE#${randomUUID()}`,
        sk: "META",
        scope: "webhookCaptures",
        sort: new Date().toISOString(),
        payload,
        headers: {
          signature: c.req.header("webhook-signature"),
          timestamp: c.req.header("webhook-timestamp"),
        },
      });
      return c.json({ ok: true });
    });
    app.get("/api/admin/webhook-captures", async (c) =>
      c.json(await store.list("webhookCaptures")),
    );
  }
  return app;
}
