import { mutationJson } from "./idempotency.js";
import { Hono } from "hono";
import { z } from "zod";
import type { Runtime } from "@narada/core/runtime";
import { AppError, emailInput } from "@narada/core/model";
import {
  templateDto,
  renderTemplate,
  variableValues,
  type Template,
} from "@narada/core/template-model";
import { broadcastDto } from "./public-dto.js";
import { listQuery, decodeCursor, encodeCursor } from "./public-pagination.js";
const revision = z.number().int().nonnegative();
const version = z.number().int().positive().optional();
export function templateRoutes(runtime: Runtime, publicApi = false) {
  const app = new Hono(),
    service = runtime.templates,
    dto = (t: Template) => templateDto(t, !publicApi);
  app.get("/templates", async (c) => {
    const query = listQuery.parse(c.req.query()),
      position = decodeCursor("templates", query.cursor);
    const cursor =
      position === undefined
        ? undefined
        : z
            .object({
              pk: z.string().startsWith("TEMPLATE#"),
              sk: z.literal("META"),
              scope: z.literal("templates"),
              sort: z.string(),
            })
            .strict()
            .parse(position);
    const result = await runtime.store.listPage<Template>(
      "templates",
      query.limit,
      cursor,
    );
    return c.json({
      data: result.items.map(dto),
      nextCursor: result.cursor
        ? encodeCursor("templates", result.cursor)
        : null,
    });
  });
  app.post("/templates", async (c) =>
    mutationJson(
      c,
      async (commit) => service.create(await c.req.json(), commit),
      dto,
      201,
    ),
  );
  app.get("/templates/:id", async (c) =>
    c.json(dto(await service.get(c.req.param("id")))),
  );
  app.put("/templates/:id", async (c) => {
    const input = z
      .object({ draft: z.unknown(), revision })
      .strict()
      .parse(await c.req.json());
    return c.json(
      dto(await service.update(c.req.param("id"), input.draft, input.revision)),
    );
  });
  app.post("/templates/:id/publish", async (c) => {
    const input = z
      .object({ revision })
      .strict()
      .parse(await c.req.json());
    return mutationJson(
      c,
      (commit) => service.publish(c.req.param("id"), input.revision, commit),
      dto,
    );
  });
  app.post("/templates/:id/archive", async (c) => {
    const input = z
      .object({ archived: z.boolean(), revision })
      .strict()
      .parse(await c.req.json());
    return c.json(
      dto(
        await service.archive(
          c.req.param("id"),
          input.archived,
          input.revision,
        ),
      ),
    );
  });
  app.post("/templates/:id/duplicate", async (c) => {
    const { alias } = z
        .object({ alias: z.string() })
        .strict()
        .parse(await c.req.json()),
      t = await service.get(c.req.param("id"));
    return mutationJson(
      c,
      (commit) =>
        service.create(
          { ...t.draft, alias, name: `${t.draft.name.slice(0, 110)} (copy)` },
          commit,
        ),
      dto,
      201,
    );
  });
  app.post("/templates/:id/preview", async (c) => {
    const input = z
      .object({ variables: variableValues.default({}), version })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await service.preview(c.req.param("id"), input.variables, input.version),
    );
  });
  app.post("/templates/:id/test", async (c) => {
    const input = z
      .object({
        from: z.string(),
        to: z.email(),
        variables: variableValues.default({}),
      })
      .strict()
      .parse(await c.req.json());
    const content = await service.preview(c.req.param("id"), input.variables);
    return mutationJson(
      c,
      (commit) =>
        runtime.service.accept(
          emailInput.parse({
            ...content,
            from: input.from,
            to: input.to,
            subject: `[Test] ${content.subject}`,
          }),
          "default",
          undefined,
          undefined,
          undefined,
          commit,
        ),
      undefined,
      202,
    );
  });
  app.post("/templates/:id/broadcasts", async (c) => {
    const input = z
      .object({
        variables: variableValues.default({}),
        version,
        name: z.string().optional(),
        audienceId: z.string().default(""),
        topicId: z.string().optional(),
        from: z.string().default(""),
        organization: z.string().default(""),
        postalAddress: z.string().default(""),
      })
      .strict()
      .parse(await c.req.json());
    const published = await service.published(c.req.param("id"), input.version);
    if (published.content.kind !== "broadcast")
      throw new AppError(422, "Choose a broadcast template");
    const { variables, version: _, name, ...fields } = input;
    const content = renderTemplate(published.content, variables);
    return mutationJson(
      c,
      (commit) =>
        runtime.broadcasts.create(
          {
            name: name ?? published.content.name,
            ...fields,
            ...content,
            ...(published.content.variables.length === 0 &&
            published.content.document
              ? { document: published.content.document }
              : {}),
          },
          commit,
        ),
      (broadcast) => (publicApi ? broadcastDto(broadcast) : broadcast),
      201,
    );
  });
  return app;
}
