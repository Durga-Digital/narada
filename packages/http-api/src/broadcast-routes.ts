import { mutationJson } from "./idempotency.js";
import { audienceRoutes } from "./audience-routes.js";
export { unsubscribeRoutes } from "./preference-routes.js";
import { Hono } from "hono";
import { z } from "zod";
import type { Runtime } from "@narada/core/runtime";

import { type Broadcast } from "@narada/core/broadcast-model";
export function broadcastRoutes(runtime: Runtime) {
  const app = new Hono();
  const service = runtime.broadcasts;
  app.get("/contacts", async (c) =>
    c.json(await runtime.contacts.directoryView()),
  );
  app.get("/audiences", async (c) =>
    c.json(await runtime.contacts.summaries()),
  );
  app.post("/audiences", async (c) => {
    const { name } = z.object({ name: z.string() }).parse(await c.req.json());
    return mutationJson(
      c,
      (commit) => service.createAudience(name, commit),
      undefined,
      201,
    );
  });
  app.get("/audiences/:id", async (c) =>
    c.json(await runtime.contacts.audienceDetail(c.req.param("id"))),
  );
  app.post("/audiences/:id/import", async (c) => {
    const { csv, consentSource, consentConfirmed, topicIds } = z
      .object({
        csv: z.string().max(180000),
        consentSource: z.string(),
        consentConfirmed: z.literal(true),
        topicIds: z.array(z.uuid()).max(50).default([]),
      })
      .parse(await c.req.json());
    return c.json(
      await service.importAudience(
        c.req.param("id"),
        csv,
        consentSource,
        topicIds,
      ),
    );
  });
  app.get("/broadcasts", async (c) =>
    c.json(
      (await runtime.store.list<Broadcast>("broadcasts")).map(
        ({
          id,
          draft,
          status,
          total,
          updatedAt,
          createdAt,
          scheduledAt,
          publicationId,
        }) => ({
          publicationId,
          id,
          name: draft.name,
          subject: draft.subject,
          audienceId: draft.audienceId,
          status,
          total,
          updatedAt,
          createdAt,
          scheduledAt,
        }),
      ),
    ),
  );
  app.post("/broadcasts", async (c) =>
    mutationJson(
      c,
      async (commit) => service.create(await c.req.json(), commit),
      undefined,
      201,
    ),
  );
  app.get("/broadcasts/:id", async (c) =>
    c.json(await service.results(c.req.param("id"))),
  );
  app.put("/broadcasts/:id", async (c) => {
    const { draft, revision } = z
      .object({ draft: z.unknown(), revision: z.number().int().nonnegative() })
      .parse(await c.req.json());
    return c.json(await service.update(c.req.param("id"), draft, revision));
  });
  app.get("/broadcasts/:id/preview", async (c) =>
    c.json(await service.preview(c.req.param("id"), c.req.query("contact"))),
  );
  app.post("/broadcasts/:id/test", async (c) => {
    const { to, previewEmail } = z
      .object({ to: z.email(), previewEmail: z.email().optional() })
      .parse(await c.req.json());
    return mutationJson(
      c,
      (commit) => service.test(c.req.param("id"), to, previewEmail, commit),
      undefined,
      202,
    );
  });
  app.post("/broadcasts/:id/send", async (c) => {
    const { revision, scheduledAt } = z
      .object({
        revision: z.number().int().nonnegative(),
        scheduledAt: z.number().int().optional(),
        confirmed: z.literal(true),
      })
      .parse(await c.req.json());
    return mutationJson(
      c,
      (commit) =>
        service.start(c.req.param("id"), revision, scheduledAt, commit),
      undefined,
      202,
    );
  });
  app.post("/broadcasts/:id/cancel", async (c) =>
    c.json(await service.cancel(c.req.param("id"))),
  );
  app.post("/broadcasts/:id/duplicate", async (c) => {
    const original = await service.get(c.req.param("id"));
    return mutationJson(
      c,
      (commit) =>
        service.create(
          {
            ...original.draft,
            name: `${original.draft.name.slice(0, 110)} (copy)`,
          },
          commit,
        ),
      undefined,
      201,
    );
  });
  app.route("/", audienceRoutes(runtime));
  return app;
}
