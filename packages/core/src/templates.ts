import {
  commitMutation,
  commitRevisionPatch,
  type MutationCommit,
} from "./idempotency.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emailOptions } from "./email-options.js";
import { AppError, emailInput, mailbox } from "./model.js";
import { conditional, type Store } from "./store.js";
import {
  templateInput,
  validateTemplate,
  renderTemplate,
  variableValues,
  type Template,
  type TemplateVersion,
} from "./template-model.js";
const aliasInput = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
export class TemplateService {
  constructor(readonly store: Store) {}
  async get(ref: string) {
    let row = await this.store.get<Template>(`TEMPLATE#${ref}`);
    if (!row) {
      const alias = await this.store.get(`TEMPLATE_ALIAS#${ref}`);
      if (alias) row = await this.store.get<Template>(`TEMPLATE#${alias.id}`);
    }
    if (!row) throw new AppError(404, "Template not found");
    return row;
  }
  async create(input: unknown, commit?: MutationCommit) {
    const { alias, ...rest } = z
        .object({ alias: aliasInput })
        .passthrough()
        .parse(input),
      draft = templateInput.parse(rest);
    validateTemplate(draft);
    const id = randomUUID(),
      now = new Date().toISOString();
    const template: Template = {
      pk: `TEMPLATE#${id}`,
      sk: "META",
      scope: "templates",
      sort: now,
      id,
      alias,
      draft,
      revision: 0,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await commitMutation(
        this.store,
        [
          this.store.create(template),
          this.store.create({ pk: `TEMPLATE_ALIAS#${alias}`, sk: "META", id }),
        ],
        template,
        commit,
      );
    } catch (e) {
      if (conditional(e))
        throw new AppError(409, "Template alias already exists");
      throw e;
    }
    return template;
  }
  async update(
    ref: string,
    input: unknown,
    revision: number,
    commit?: MutationCommit,
  ) {
    const t = await this.get(ref);
    if (t.archived)
      throw new AppError(409, "Restore this template before editing");
    const draft = templateInput.parse(input);
    validateTemplate(draft);
    await this.patch(
      t,
      { draft, revision: revision + 1, updatedAt: new Date().toISOString() },
      revision,
      commit,
    );
    return this.get(t.id);
  }
  private async patch(
    t: Template,
    fields: Record<string, unknown>,
    revision: number,
    commit?: MutationCommit,
  ) {
    try {
      await commitRevisionPatch(this.store, t, fields, revision, commit);
    } catch (e) {
      if (conditional(e))
        throw new AppError(409, "Template changed; reload and try again");
      throw e;
    }
  }
  async publish(ref: string, revision: number, commit?: MutationCommit) {
    const t = await this.get(ref);
    if (t.archived)
      throw new AppError(409, "Restore this template before publishing");
    if (t.revision !== revision)
      throw new AppError(409, "Template changed; reload and try again");
    validateTemplate(t.draft, true);
    const version = (t.publishedVersion ?? 0) + 1,
      now = new Date().toISOString();
    const published: Template = {
      ...t,
      revision: revision + 1,
      publishedRevision: revision + 1,
      publishedVersion: version,
      updatedAt: now,
    };
    try {
      await commitMutation(
        this.store,
        [
          {
            Put: {
              TableName: this.store.config.APP_TABLE,
              Item: {
                ...t,
                revision: revision + 1,
                publishedRevision: revision + 1,
                publishedVersion: version,
                updatedAt: now,
              },
              ConditionExpression: "revision = :revision",
              ExpressionAttributeValues: { ":revision": revision },
            },
          },
          this.store.create({
            pk: `TEMPLATE_VERSION#${t.id}#${version}`,
            sk: "META",
            version,
            content: t.draft,
            publishedAt: now,
          }),
        ],
        published,
        commit,
      );
    } catch (e) {
      if (conditional(e))
        throw new AppError(409, "Template changed; reload and try again");
      throw e;
    }
    return published;
  }
  async archive(
    ref: string,
    archived: boolean,
    revision: number,
    commit?: MutationCommit,
  ) {
    const t = await this.get(ref);
    await this.patch(
      t,
      {
        archived,
        revision: revision + 1,
        updatedAt: new Date().toISOString(),
        ...(t.publishedRevision === t.revision
          ? { publishedRevision: revision + 1 }
          : {}),
      },
      revision,
      commit,
    );
    return this.get(t.id);
  }
  async published(ref: string, version?: number) {
    const t = await this.get(ref);
    if (t.archived) throw new AppError(422, "Template is archived");
    const selected = version ?? t.publishedVersion;
    if (!selected)
      throw new AppError(422, "Publish the template before using it");
    const row = await this.store.get<TemplateVersion>(
      `TEMPLATE_VERSION#${t.id}#${selected}`,
    );
    if (!row) throw new AppError(404, "Published template version not found");
    return { template: t, ...row };
  }
  async preview(ref: string, variables: unknown, version?: number) {
    const t = await this.get(ref),
      content =
        version === undefined
          ? t.draft
          : (await this.published(ref, version)).content;
    return renderTemplate(content, variables);
  }
  async resolveEmailInput(input: unknown) {
    if (input && typeof input === "object" && Object.hasOwn(input, "template"))
      return this.email(input);
    return emailInput.parse(input);
  }
  async email(input: unknown) {
    const data = z
      .object({
        from: mailbox,
        ...emailOptions,
        to: z.union([z.email(), z.array(z.email()).min(1).max(10)]),
        reply_to: z.email().optional(),
        expires_in: z.number().optional(),
        template: z
          .object({
            id: z.string().min(1).max(80),
            version: z.number().int().positive().optional(),
            variables: variableValues.default({}),
          })
          .strict(),
      })
      .strict()
      .parse(input);
    const selected = await this.published(
      data.template.id,
      data.template.version,
    );
    if (selected.content.kind !== "transactional")
      throw new AppError(422, "Use a broadcast template through a broadcast");
    const content = renderTemplate(selected.content, data.template.variables),
      { template, ...envelope } = data;
    return emailInput.parse({ ...envelope, ...content });
  }
}
/** @deprecated Use runtime.templates.resolveEmailInput. */
export async function resolveEmailInput(store: Store, input: unknown) {
  return new TemplateService(store).resolveEmailInput(input);
}
