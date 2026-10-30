import { mutationJson } from "./idempotency.js";
import { Hono } from "hono";
import { z } from "zod";
import type { Runtime } from "@narada/core/runtime";
export function audienceRoutes(runtime: Runtime) {
  const app = new Hono(),
    directory = runtime.contacts;
  app.get("/properties", async (c) => c.json(await directory.properties()));
  app.post("/properties", async (c) =>
    mutationJson(
      c,
      async (commit) =>
        directory.saveProperty(await c.req.json(), undefined, commit),
      undefined,
      201,
    ),
  );
  app.put("/properties/:key", async (c) => {
    const { property, revision } = z
      .object({
        property: z.record(z.string(), z.unknown()),
        revision: z.number().int().nonnegative(),
      })
      .parse(await c.req.json());
    return c.json(
      await directory.saveProperty(
        { ...property, key: c.req.param("key") },
        revision,
      ),
    );
  });
  app.get("/segments", async (c) => c.json(await directory.summaries()));
  app.post("/segments", async (c) =>
    mutationJson(
      c,
      async (commit) => directory.createSegment(await c.req.json(), commit),
      undefined,
      201,
    ),
  );
  app.put("/segments/:id", async (c) => {
    const { segment, revision } = z
      .object({
        segment: z.unknown(),
        revision: z.number().int().nonnegative(),
      })
      .parse(await c.req.json());
    return c.json(
      await directory.updateSegment(c.req.param("id"), segment, revision),
    );
  });
  app.delete("/segments/:id/contacts/:email", async (c) => {
    await directory.removeMember(
      c.req.param("id"),
      z.email().parse(c.req.param("email")),
    );
    return c.json({ ok: true });
  });
  app.get("/topics", async (c) => c.json(await directory.topics()));
  app.post("/topics", async (c) =>
    mutationJson(
      c,
      async (commit) =>
        directory.saveTopic(await c.req.json(), undefined, undefined, commit),
      undefined,
      201,
    ),
  );
  app.put("/topics/:id", async (c) => {
    const { topic, revision } = z
      .object({ topic: z.unknown(), revision: z.number().int().nonnegative() })
      .parse(await c.req.json());
    return c.json(
      await directory.saveTopic(topic, c.req.param("id"), revision),
    );
  });
  app.get("/contacts/:email", async (c) =>
    c.json(await directory.details(c.req.param("email"))),
  );
  app.put("/contacts/:email", async (c) => {
    const { contact, revision } = z
      .object({
        contact: z.unknown(),
        revision: z.number().int().nonnegative(),
      })
      .parse(await c.req.json());
    return c.json(
      await directory.updateContact(c.req.param("email"), contact, revision),
    );
  });
  app.post("/contacts/:email/topics/:id", async (c) => {
    const { subscribed, source, confirmed } = z
      .object({
        subscribed: z.boolean(),
        source: z.string(),
        confirmed: z.literal(true),
      })
      .parse(await c.req.json());
    await runtime.subscriptions.subscribe(
      c.req.param("email"),
      c.req.param("id"),
      subscribed,
      source,
    );
    return c.json({ ok: true });
  });
  app.post("/contacts/:email/unsubscribe", async (c) => {
    const contact = await directory.contact(c.req.param("email"));
    await runtime.subscriptions.unsubscribeAll(contact.email);
    return c.json({ ok: true });
  });
  return app;
}
