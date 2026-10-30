import { publicOrigin } from "./origins.js";
import {
  PublicationEditorial,
  isEditorialOperation,
} from "./publication-editorial.js";
import { issueStatus } from "@narada/contracts/issue-state";
import type { ActivityContext } from "./activity-records.js";
import { PublicationBrandingService } from "./publication-branding.js";
import { PublicationPages } from "./publication-pages.js";
import { assertSendApproval } from "./send-approval-context.js";
import { broadcastDto } from "./public-dto.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Runtime } from "./runtime.js";
import { AppError, domainOf } from "./model.js";
import {
  assertOperationAccess,
  callerIdentity,
  authorizeOperation,
  callerRestrictions,
  requireScopes,
  resourceAllowed,
  type Caller,
  type AuthorizationResources,
} from "./authorization.js";
import { operationSchemas } from "@narada/contracts/discovery";
import type { OperationOutput } from "@narada/contracts/operation-types";
import {
  issuePublishScopes,
  type OperationId,
} from "@narada/contracts/operations";
import { formDraftInput, formInput, type FormContent } from "./form-content.js";
import {
  publicationInput,
  type Publication,
  type Issue,
} from "./newsletter-model.js";
import type { FormRecord, FormResponse } from "./form-model.js";
import type { Broadcast } from "./broadcast-model.js";
import type { MutationCommit } from "./idempotency.js";
import {
  formContentDto,
  formDto,
  publicationDto,
  responseDto,
  issueDto,
} from "./product-dto.js";
import { ProductPagination, productListQuery } from "./product-pagination.js";
import { escapeHtml } from "./message-content.js";
export type ProductOperationId = Extract<
  OperationId,
  `forms.${string}` | `publications.${string}` | `issues.${string}`
>;
export const isProductOperation = (id: string): id is ProductOperationId =>
  /^(forms|publications|issues)\./.test(id);
const schemas = new Map<string, z.ZodType>();
const sender = (from: string): string | undefined => {
  try {
    return domainOf(from);
  } catch {
    return undefined;
  }
};
const formResources = (f: FormRecord): AuthorizationResources => ({
  formId: f.id,
  publicationId:
    typeof f.publicationId === "string" ? f.publicationId : undefined,
  senderDomain: sender(f.draft.from),
});
const publicationResources = (p: Publication): AuthorizationResources => ({
  publicationId: p.id,
  senderDomain: sender(p.settings.from),
});
const revision = (body: Record<string, unknown>) =>
  z.number().int().nonnegative().parse(body.revision);
const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  return `"${(/^[\s]*[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
};

/** Shared product handlers. Authentication adapters supply a trusted caller;
 * prepare must run before receipt lookup, and run executes only a non-replayed request.
 */
export class ProductOperations {
  readonly pagination: ProductPagination;
  constructor(private runtime: Runtime) {
    this.pagination = new ProductPagination(runtime.store);
  }
  async prepare<K extends ProductOperationId>(
    caller: Caller,
    id: K,
    raw: unknown,
  ) {
    assertOperationAccess(caller, id);
    const resources: AuthorizationResources[] = [],
      requiredScopes: string[] = [];
    const authorize = (facts: AuthorizationResources) => {
      authorizeOperation(caller, id, facts);
      resources.push(facts);
    };
    let schema = schemas.get(id);
    if (!schema) {
      schema = z.fromJSONSchema(operationSchemas[id].input);
      schemas.set(id, schema);
    }
    const input = schema.parse(raw) as {
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
    };
    const params = input.params ?? {},
      body = input.body ?? {},
      query = input.query ?? {};
    const { forms, publications, issues, store } = this.runtime;
    const restrictions = callerRestrictions(caller);
    let form: FormRecord | undefined,
      publication: Publication | undefined,
      issue: Issue | undefined,
      response: FormResponse | undefined;
    const parentId = params.id;
    if (parentId) {
      if (id.startsWith("forms.")) {
        if (restrictions.formIds && !restrictions.formIds.includes(parentId))
          throw new AppError(403, "Form is outside this grant");
        form = await forms.get(parentId);
        authorize(formResources(form));
        if (params.responseId) {
          response = await forms.response(params.responseId);
          if (response.formId !== form.id)
            throw new AppError(404, "Response not found");
          const version = await forms.version(form.id, response.version);
          authorize({
            ...formResources(form),
            senderDomain: sender(version.content.from),
          });
          if (id === "forms.responses.retry")
            requiredScopes.push(
              ...this.integrationScopes(caller, version.content),
            );
        }
      } else {
        if (
          restrictions.publicationIds &&
          !restrictions.publicationIds.includes(parentId)
        )
          throw new AppError(403, "Publication is outside this grant");
        publication = await publications.get(parentId);
        authorize(publicationResources(publication));
        if (params.issueId) {
          issue = await issues.get(
            publication.id,
            params.issueId,
            id === "issues.delete",
          );
          if (issue.broadcastId) {
            const broadcast = await store.get<Broadcast>(
              `BROADCAST#${issue.broadcastId}`,
            );
            if (
              !broadcast ||
              broadcast.publicationId !== publication.id ||
              broadcast.issueId !== issue.id
            )
              throw new AppError(409, "Issue delivery link is invalid");
            authorize({
              ...publicationResources(publication),
              senderDomain: sender(broadcast.draft.from),
            });
          }
        }
      }
    }
    if (id === "forms.create" || id === "forms.update") {
      const draft = (id === "forms.create" ? formInput : formDraftInput).parse(
        id === "forms.create" ? body : body.draft,
      );
      authorize({
        ...(form ? formResources(form) : {}),
        senderDomain: sender(draft.from),
      });
      requiredScopes.push(...this.integrationScopes(caller, draft));
    }
    if (id === "forms.publish")
      requiredScopes.push(...this.integrationScopes(caller, form!.draft));
    if (
      id === "forms.broadcasts.create" &&
      (restrictions.formIds || restrictions.publicationIds)
    )
      throw new AppError(
        403,
        "Creating an independent broadcast requires an unrestricted resource grant",
      );
    if (id === "publications.create" || id === "publications.update") {
      const settings = publicationInput.parse(
        id === "publications.create" ? body : body.settings,
      );
      authorize({
        ...(publication ? publicationResources(publication) : {}),
        senderDomain: sender(settings.from),
      });
    }
    if (
      id === "publications.branding.update" ||
      id === "publications.branding.preview"
    )
      await new PublicationBrandingService(this.runtime).validate(
        publication!,
        body.branding,
      );
    if (publication && (isEditorialOperation(id) || id === "issues.list")) {
      const linked = await new PublicationEditorial(
        this.runtime,
      ).authorizeLinks(publication, id, params, body, query);
      if (linked?.publicVersionId) {
        const version = await issues.version(linked.publicVersionId);
        if (
          version.publicationId !== publication.id ||
          version.issueId !== linked.id
        )
          throw new AppError(404, "Featured issue not found");
        authorize({
          ...publicationResources(publication),
          senderDomain: sender(version.settings.from),
        });
      }
      if (linked?.broadcastId) {
        const broadcast = await store.get<Broadcast>(
          `BROADCAST#${linked.broadcastId}`,
        );
        if (
          !broadcast ||
          broadcast.publicationId !== publication.id ||
          broadcast.issueId !== linked.id
        )
          throw new AppError(409, "Featured issue delivery link is invalid");
        authorize({
          ...publicationResources(publication),
          senderDomain: sender(broadcast.draft.from),
        });
      }
    }
    if (id === "issues.publish") {
      const channels = z.enum(["web", "email", "both"]).parse(body.channels);
      requireScopes(caller, issuePublishScopes[channels]);
      requiredScopes.push(...issuePublishScopes[channels]);
    }
    if (id.endsWith(".list") || id.endsWith(".export"))
      productListQuery.parse(
        id === "issues.list"
          ? { limit: query.limit, cursor: query.cursor }
          : query,
      );
    // These captured records are authorization snapshots. Domain mutations keep
    // their revision guards, and issue writes bind the authorized publication revision.
    return {
      activity: {
        resources,
        requiredScopes,
        targets: [
          ...(form ? [{ kind: "form", id: form.id }] : []),
          ...(publication ? [{ kind: "publication", id: publication.id }] : []),
          ...(issue ? [{ kind: "issue", id: issue.id }] : []),
          ...(response ? [{ kind: "form-response", id: response.id }] : []),
        ],
      },
      // Stored responses can predate sender changes. Reauthorize the receipt's
      // projection as well as today's resource before disclosing a replay.
      authorizeReplay: (value: unknown, historical?: ActivityContext) => {
        if (
          isEditorialOperation(id) ||
          id.startsWith("publications.domain.") ||
          id === "issues.delete" ||
          id === "publications.assets.upload"
        ) {
          // The public domain DTO intentionally omits sender metadata. Use the
          // receipt's private authorization snapshot, as well as today's parent.
          if (!historical)
            throw new AppError(
              409,
              "Historical authorization is unavailable; read current operation status",
            );
          for (const facts of historical.resources) authorize(facts);
        }
        const result = value as {
          id?: string;
          publicationId?: string;
          draft?: { from?: string };
          settings?: { from?: string };
        };
        if (id === "forms.broadcasts.create")
          authorize({
            ...formResources(form!),
            senderDomain: sender(result.draft?.from ?? ""),
          });
        else if (id.startsWith("forms.") && result.draft)
          authorize({
            formId: result.id,
            publicationId: result.publicationId,
            senderDomain: sender(result.draft?.from ?? ""),
          });
        else if (id.startsWith("publications.") && result.settings)
          authorize({
            publicationId: result.id,
            senderDomain: sender(result.settings.from ?? ""),
          });
      },
      run: (commit?: MutationCommit) => {
        assertSendApproval(caller, id, raw);
        if (
          callerIdentity(caller).kind === "oauth" &&
          id === "forms.responses.retry" &&
          requiredScopes.includes("narada:emails:send")
        )
          throw new AppError(
            403,
            "Retrying form email processing requires the signed-in owner in Narada",
          );
        return this.run(
          caller,
          id,
          { params, body, query, form, publication, issue, response },
          commit,
        ) as Promise<OperationOutput<K>>;
      },
    };
  }
  private integrationScopes(caller: Caller, content: FormContent) {
    const required: string[] = [];
    if (content.syncContacts)
      required.push("narada:contacts:create", "narada:contacts:update");
    if (content.topicId) required.push("narada:subscriptions:write");
    if (content.audienceId) required.push("narada:segments:members:write");
    if (content.syncContacts || content.acknowledgment)
      required.push("narada:emails:send");
    requireScopes(caller, required);
    return required;
  }
  private async run(
    caller: Caller,
    id: ProductOperationId,
    context: {
      params: Record<string, string>;
      body: Record<string, unknown>;
      query: Record<string, unknown>;
      form?: FormRecord;
      publication?: Publication;
      issue?: Issue;
      response?: FormResponse;
    },
    commit?: MutationCommit,
  ): Promise<OperationOutput<ProductOperationId>> {
    const { body, query } = context,
      form = context.form!,
      pub = context.publication!,
      issue = context.issue!,
      response = context.response!;
    const { forms, publications, issues, broadcasts } = this.runtime,
      pagination = this.pagination;
    // Domain transactions pass storage records to their commit callback. Persist
    // the public projection in receipts too, so first responses and replays agree.
    const project = <T>(
      dto: (value: T) => unknown,
    ): MutationCommit | undefined =>
      commit
        ? async (items, result) => {
            await commit(items, dto(result as unknown as T));
            return result;
          }
        : undefined;
    const formCommit = project(formDto),
      publicationCommit = project(publicationDto),
      issueCommit = project(issueDto);
    const origin = new URL(publicOrigin(this.runtime.config)).origin;
    if (isEditorialOperation(id))
      return new PublicationEditorial(this.runtime).run(
        pub,
        context.issue,
        id,
        context.params,
        body,
        query,
        commit,
      ) as Promise<OperationOutput<ProductOperationId>>;
    if (body.revision !== undefined && !id.startsWith("publications.domain.")) {
      const current = context.issue ?? context.form ?? context.publication;
      if (current && revision(body) !== current.revision)
        throw new AppError(409, "Resource changed; reload before continuing");
    }
    switch (id) {
      case "forms.list": {
        const result = await pagination.records<FormRecord>(
          "forms",
          "FORM#",
          query,
          (row) => resourceAllowed(caller, id, formResources(row)),
        );
        return { ...result, data: result.data.map(formDto) };
      }
      case "forms.create":
        return formDto(await forms.create(body, formCommit));
      case "forms.get":
        return formDto(form);
      case "forms.update":
        return formDto(
          await forms.update(form.id, body.draft, revision(body), formCommit),
        );
      case "forms.publish":
        return formDto(
          await forms.publish(form.id, revision(body), formCommit),
        );
      case "forms.close":
        return formDto(await forms.close(form.id, revision(body), formCommit));
      case "forms.preview":
        return {
          content: formContentDto(form.draft),
          version: form.version,
          accepting: form.accepting,
        };
      case "forms.responses.list": {
        const result = await pagination.records<FormResponse>(
          `formResponses#${form.id}`,
          "FORMRESPONSE#",
          query,
          async (row) =>
            row.formId === form.id &&
            resourceAllowed(caller, id, {
              ...formResources(form),
              senderDomain: sender(
                (await forms.version(form.id, row.version)).content.from,
              ),
            }),
        );
        return { ...result, data: result.data.map(responseDto) };
      }
      case "forms.responses.get":
        return {
          response: { ...responseDto(response), answers: response.answers },
          content: formContentDto(
            (await forms.version(form.id, response.version)).content,
          ),
        };
      case "forms.responses.retry":
        return responseDto(
          await forms.retry(response.id, project(responseDto)),
        );
      case "forms.responses.export": {
        const result = await pagination.records<FormResponse>(
          `formResponses#${form.id}`,
          "FORMRESPONSE#",
          { ...query, limit: Math.min(productListQuery.parse(query).limit, 5) },
          async (row) =>
            row.formId === form.id &&
            resourceAllowed(caller, id, {
              ...formResources(form),
              senderDomain: sender(
                (await forms.version(form.id, row.version)).content.from,
              ),
            }),
        );
        const lines: string[] = query.cursor
          ? []
          : [
              "\uFEFFresponse_id,submitted_at,version,email,question_id,question,answer,processing_status",
            ];
        for (const row of result.data) {
          const version = await forms.version(form.id, row.version);
          authorizeOperation(caller, id, {
            ...formResources(form),
            senderDomain: sender(version.content.from),
          });
          for (const question of version.content.questions)
            lines.push(
              [
                row.id,
                row.createdAt,
                row.version,
                row.email,
                question.id,
                question.label,
                row.answers[question.id],
                row.status,
              ]
                .map(csvCell)
                .join(","),
            );
        }
        return {
          csv: lines.join("\r\n") + "\r\n",
          nextCursor: result.nextCursor,
        };
      }
      case "forms.broadcasts.create": {
        const { published } = await forms.publicForm(form.id),
          content = published.content;
        authorizeOperation(caller, id, {
          ...formResources(form),
          senderDomain: sender(content.from),
        });
        const url = `${origin}/forms/${form.id}`;
        const b = await broadcasts.create(
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
          project(broadcastDto),
        );
        return broadcastDto(b);
      }
      case "publications.domain.get":
        return this.runtime.publicationDomains.get(pub);
      case "publications.domain.configure":
        return this.runtime.publicationDomains.configure(pub, body, commit);
      case "publications.domain.check":
      case "publications.domain.activate":
      case "publications.domain.disconnect":
        return this.runtime.publicationDomains.mutate(
          pub,
          id.split(".")[2] as "check" | "activate" | "disconnect",
          body,
          commit,
        );
      case "publications.list": {
        const result = await pagination.records<Publication>(
          "publications",
          "PUBLICATION#",
          query,
          (row) => resourceAllowed(caller, id, publicationResources(row)),
        );
        return { ...result, data: result.data.map(publicationDto) };
      }
      case "publications.create":
        return publicationDto(
          await publications.create(body, publicationCommit),
        );
      case "publications.get":
        return publicationDto(pub);
      case "publications.update":
        return publicationDto(
          await publications.update(
            pub.id,
            body.settings,
            revision(body),
            undefined,
            publicationCommit,
          ),
        );
      case "publications.activate":
      case "publications.archive":
        return publicationDto(
          await publications.update(
            pub.id,
            pub.settings,
            revision(body),
            id === "publications.activate" ? "active" : "archived",
            publicationCommit,
          ),
        );
      case "publications.preview":
        return {
          html: await new PublicationPages(this.runtime).home(pub, true),
        };
      case "publications.branding.preview": {
        const branding = await new PublicationBrandingService(
          this.runtime,
        ).validate(pub, body.branding);
        return {
          html: await new PublicationPages(this.runtime).home(
            { ...pub, branding },
            true,
          ),
        };
      }
      case "publications.branding.update":
        return publicationDto(
          await new PublicationBrandingService(this.runtime).update(
            pub,
            body.branding,
            revision(body),
            publicationCommit,
          ),
        );
      case "publications.assets.upload":
      case "publications.logo.upload":
        return new PublicationBrandingService(this.runtime).upload(
          pub,
          body,
          commit,
        );
      case "publications.subscribers.list":
        return pagination.rows(
          `subscribers#${pub.id}`,
          (await publications.subscribers(pub.id)).subscribers,
          query,
          (row) => row.email,
        );
      case "issues.list": {
        const result = await pagination.records<Issue>(
          `issues#${pub.id}`,
          "ISSUE#",
          { limit: query.limit, cursor: query.cursor },
          async (row) => {
            if (
              row.publicationId !== pub.id ||
              row.deletedAt ||
              (query.status && issueStatus(row) !== query.status) ||
              (query.collectionId &&
                !row.collectionIds?.includes(String(query.collectionId)))
            )
              return false;
            if (!row.broadcastId) return true;
            const broadcast = await this.runtime.store.get<Broadcast>(
              `BROADCAST#${row.broadcastId}`,
            );
            return (
              !!broadcast &&
              broadcast.publicationId === pub.id &&
              broadcast.issueId === row.id &&
              resourceAllowed(caller, id, {
                ...publicationResources(pub),
                senderDomain: sender(broadcast.draft.from),
              })
            );
          },
          query.status || query.collectionId
            ? `issues#${pub.id}#${query.status ?? ""}#${query.collectionId ?? ""}`
            : undefined,
        );
        return { ...result, data: result.data.map(issueDto) };
      }
      case "issues.create":
        return issueDto(
          await issues.create(pub.id, body, issueCommit, pub.revision),
        );
      case "issues.get":
        return issueDto(issue);
      case "issues.delete":
        return issues.delete(
          pub.id,
          issue.id,
          revision(body),
          commit,
          pub.revision,
        );
      case "issues.update":
        return issueDto(
          await issues.update(
            pub.id,
            issue.id,
            body.draft,
            revision(body),
            issueCommit,
            pub.revision,
          ),
        );
      case "issues.preview": {
        const result = await issues.preview(pub.id, issue.id, pub.revision);
        return {
          ...result,
          email: { ...result.email, text: result.email.text ?? "" },
        };
      }
      case "issues.test":
        return issues.test(
          pub.id,
          issue.id,
          z.email().parse(body.to),
          revision(body),
          commit,
          pub.revision,
        );
      case "issues.publish":
        return issueDto(
          await issues.publish(
            pub.id,
            issue.id,
            revision(body),
            z.enum(["web", "email", "both"]).parse(body.channels),
            body.scheduledAt === undefined
              ? undefined
              : z.number().int().parse(body.scheduledAt),
            issueCommit,
            pub.revision,
          ),
        );
      case "issues.cancel":
        return issueDto(
          await issues.cancel(pub.id, issue.id, revision(body), issueCommit),
        );
      case "issues.withdraw":
        return issueDto(
          await issues.withdraw(pub.id, issue.id, revision(body), issueCommit),
        );
      case "issues.duplicate":
        return issueDto(
          await issues.create(
            pub.id,
            {
              ...issue.draft,
              title: `${issue.draft.title.slice(0, 150)} (copy)`,
              slug: `${issue.draft.slug.slice(0, 65)}-${randomUUID().slice(0, 8)}`,
            },
            issueCommit,
            pub.revision,
          ),
        );
      case "issues.delivery.get": {
        if (!issue.broadcastId) return { status: null, counts: {}, total: 0 };
        const result = await broadcasts.results(issue.broadcastId);
        return {
          status: result.broadcast.status,
          counts: result.counts,
          total: result.broadcast.total,
        };
      }
      case "issues.recipients.list": {
        const recipients = issue.broadcastId
          ? (await broadcasts.results(issue.broadcastId)).recipients.map(
              ({ email, name, messageId, status, error }) => ({
                email,
                name,
                messageId,
                status,
                error,
              }),
            )
          : [];
        return pagination.rows(
          `issueRecipients#${issue.id}`,
          recipients,
          query,
          (row) => row.email,
        );
      }
      default:
        throw new Error(`Unhandled operation: ${id satisfies never}`);
    }
  }
}
