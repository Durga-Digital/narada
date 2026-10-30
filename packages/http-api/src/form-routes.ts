import { publicOrigin } from "@narada/core/origins";
import { mutationJson } from "./idempotency.js";
import { Hono } from "hono";
import { z } from "zod";
import type { Runtime } from "@narada/core/runtime";
import { AppError } from "@narada/core/model";
import { escapeHtml } from "@narada/core/broadcast-model";
import { publicContent } from "@narada/core/form-content";
import type { FormRecord, FormResponse } from "@narada/core/form-model";
import { createRateLimitStorage } from "@narada/core/rate-limit";
import { listQuery, decodeCursor, encodeCursor } from "./public-pagination.js";
const revisionInput = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  // Spreadsheet applications must not interpret submitted answers as formulas.
  return `"${(/^[\s]*[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}
export function formRoutes(runtime: Runtime) {
  const app = new Hono(),
    service = runtime.forms;
  async function listing<T extends FormRecord | FormResponse>(
    scope: string,
    query: Record<string, string>,
  ) {
    const { limit, cursor } = listQuery
      .extend({ limit: z.coerce.number().int().min(1).max(20).default(20) })
      .parse(query);
    const raw = decodeCursor(scope, cursor);
    const position =
      raw === undefined
        ? undefined
        : z
            .object({
              pk: z
                .string()
                .startsWith(scope === "forms" ? "FORM#" : "FORMRESPONSE#"),
              sk: z.literal("META"),
              scope: z.literal(scope),
              sort: z.string(),
            })
            .strict()
            .parse(raw);
    const result = await runtime.store.listPage<T>(scope, limit, position);
    return {
      data: result.items,
      nextCursor: result.cursor ? encodeCursor(scope, result.cursor) : null,
    };
  }
  app.get("/forms", async (c) =>
    c.json(await listing<FormRecord>("forms", c.req.query())),
  );
  app.post("/forms", async (c) =>
    mutationJson(
      c,
      async (commit) => service.create(await c.req.json(), commit),
      undefined,
      201,
    ),
  );
  app.get("/forms/:id", async (c) =>
    c.json(await service.get(c.req.param("id"))),
  );
  app.put("/forms/:id", async (c) => {
    const input = revisionInput
      .extend({ draft: z.unknown() })
      .parse(await c.req.json());
    return c.json(
      await service.update(c.req.param("id"), input.draft, input.revision),
    );
  });
  app.post("/forms/:id/publish", async (c) =>
    mutationJson(c, async (commit) =>
      service.publish(
        c.req.param("id"),
        revisionInput.parse(await c.req.json()).revision,
        commit,
      ),
    ),
  );
  app.post("/forms/:id/close", async (c) =>
    c.json(
      await service.close(
        c.req.param("id"),
        revisionInput.parse(await c.req.json()).revision,
      ),
    ),
  );
  app.get("/forms/:id/responses", async (c) => {
    const form = await service.get(c.req.param("id"));
    const page = await listing<FormResponse>(
      `formResponses#${form.id}`,
      c.req.query(),
    );
    return c.json({
      ...page,
      data: page.data.map(({ answers: _, digest: __, ...row }) => row),
    });
  });
  app.get("/forms/:id/responses/:responseId", async (c) => {
    const row = await service.response(c.req.param("responseId"));
    if (row.formId !== c.req.param("id"))
      throw new AppError(404, "Response not found");
    const published = await service.version(row.formId, row.version);
    return c.json({ response: row, content: published.content });
  });
  app.post("/forms/:id/responses/:responseId/retry", async (c) => {
    const row = await service.response(c.req.param("responseId"));
    if (row.formId !== c.req.param("id"))
      throw new AppError(404, "Response not found");
    return c.json(await service.retry(row.id));
  });
  app.get("/forms/:id/export", async (c) => {
    const form = await service.get(c.req.param("id"));
    // Fetch small chunks so exports also work behind Lambda/API Gateway response limits.
    const query = z
      .object({ cursor: z.string().max(2000).optional() })
      .strict()
      .parse(c.req.query());
    const page = await listing<FormResponse>(`formResponses#${form.id}`, {
      limit: "5",
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const versions = new Map<
      number,
      Awaited<ReturnType<typeof service.version>>
    >();
    const lines: string[] = query.cursor
      ? []
      : [
          "\uFEFFresponse_id,submitted_at,version,email,question_id,question,answer,processing_status",
        ];
    for (const r of page.data) {
      let v = versions.get(r.version);
      if (!v) {
        v = await service.version(form.id, r.version);
        versions.set(r.version, v);
      }
      for (const q of v.content.questions)
        lines.push(
          [
            r.id,
            r.createdAt,
            r.version,
            r.email,
            q.id,
            q.label,
            r.answers[q.id],
            r.status,
          ]
            .map(csvCell)
            .join(","),
        );
    }
    return new Response(lines.join("\r\n") + "\r\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="form-${form.id}-responses.csv"`,
        "cache-control": "no-store",
        "x-next-cursor": page.nextCursor ?? "",
      },
    });
  });
  app.post("/forms/:id/broadcasts", async (c) => {
    const { form, published } = await service.publicForm(c.req.param("id"));
    const url = `${new URL(publicOrigin(runtime.config)).origin}/forms/${form.id}`;
    const content = published.content;
    return mutationJson(
      c,
      (commit) =>
        runtime.broadcasts.create(
          {
            name: `Invitation: ${content.name}`,
            audienceId: "",
            from: content.from,
            subject: content.name,
            html: `<h1>${escapeHtml(content.name)}</h1><p>${escapeHtml(content.description)}</p><p><a href="${escapeHtml(url)}">Open form</a></p>`,
            text: `${content.name}\n\n${content.description}\n\nOpen form: ${url}`,
            organization: content.brand,
            postalAddress: "",
          },
          commit,
        ),
      undefined,
      201,
    );
  });
  return app;
}
export function publicFormRoutes(runtime: Runtime) {
  const app = new Hono(),
    limiter = createRateLimitStorage(runtime.store);
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    if (c.req.method === "POST") {
      if (
        c.req.header("origin") !== new URL(publicOrigin(runtime.config)).origin
      )
        throw new AppError(403, "Invalid origin");
      if (!c.req.header("content-type")?.startsWith("application/json"))
        throw new AppError(415, "Use JSON to submit this form");
      const key =
        c.req.path === "/api/forms/confirm"
          ? "confirmation"
          : c.req.param("id");
      const result = await limiter.consume(`form-submit:${key}`, {
        window: 60,
        max: 60,
      });
      if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfter));
        throw new AppError(
          429,
          "Too many submissions. Please try again in a minute",
        );
      }
    }
    await next();
  });
  app.post("/confirm", async (c) => {
    const { token } = z
      .object({ token: z.string().max(300) })
      .strict()
      .parse(await c.req.json());
    return c.json(await runtime.forms.confirm(token));
  });
  app.get("/:id", async (c) => {
    const { form, published } = await runtime.forms.publicForm(
      c.req.param("id"),
    );
    return c.json({
      id: form.id,
      version: form.version,
      content: publicContent(published.content),
    });
  });
  app.post("/:id/responses", async (c) =>
    c.json(
      await runtime.forms.submit(c.req.param("id"), await c.req.json()),
      201,
    ),
  );
  return app;
}
