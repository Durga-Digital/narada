import { assertSendApproval } from "./send-approval-context.js";
import { z } from "zod";
import type { Runtime } from "./runtime.js";
import { AppError, emailInput, hash } from "./model.js";
import {
  assertOperationAccess,
  authorizeOperation,
  callerIdentity,
  type Caller,
} from "./authorization.js";
import { operationSchemas } from "@narada/contracts/discovery";
import type { OperationId } from "@narada/contracts/operations";
import type { MutationCommit } from "./idempotency.js";
import type { PropertyDefinition } from "./audience-model.js";
import {
  memberAddedAt,
  draftInput,
  type Broadcast,
  type Contact,
} from "./broadcast-model.js";
import {
  templateDto,
  renderTemplate,
  variableValues,
  type Template,
} from "./template-model.js";
import {
  broadcastDto,
  contactDto,
  propertyDto,
  segmentDto,
  topicDto,
} from "./public-dto.js";
import {
  page,
  listQuery,
  decodeCursor,
  encodeCursor,
} from "./public-pagination.js";

export type CampaignOperationId = Extract<
  OperationId,
  | `contacts.${string}`
  | `properties.${string}`
  | `topics.${string}`
  | `segments.${string}`
  | `templates.${string}`
  | `broadcasts.${string}`
>;
export const isCampaignOperation = (id: string): id is CampaignOperationId =>
  /^(contacts|properties|topics|segments|templates|broadcasts)\./.test(id);
const revision = (body: Record<string, unknown>) =>
  z.number().int().nonnegative().parse(body.revision);
const address = (value: unknown) =>
  z.email().max(254).parse(value).toLowerCase();
const publicDraft = draftInput.refine(
  (d) => d.document === undefined,
  "document is dashboard-only",
);
const schemas = new Map<string, z.ZodType>();
/** Persist the public result in the same transaction as the service mutation. */
function projected<T>(
  commit: MutationCommit | undefined,
  dto: (value: T) => unknown,
): MutationCommit | undefined {
  return commit
    ? async (writes, value) => {
        await commit(writes, dto(value as unknown as T));
        return value;
      }
    : undefined;
}
const memberDto = (row: Contact) => ({
  email: row.email,
  name: row.name,
  addedAt: memberAddedAt(row),
});
/** Existing audience/campaign REST operations, shared with OAuth MCP. */
export class CampaignOperations {
  constructor(private runtime: Runtime) {}
  async prepare(caller: Caller, id: CampaignOperationId, raw: unknown) {
    // All these operations are workspace-wide, including linked audience reads.
    // Reject unsupported restriction dimensions before parsing or looking up IDs.
    assertOperationAccess(caller, id);
    authorizeOperation(caller, id);
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
    if (callerIdentity(caller).kind === "oauth" && query.limit !== undefined)
      z.number().int().min(1).max(20).parse(query.limit);
    const {
      store,
      contacts: d,
      templates: t,
      broadcasts: b,
      subscriptions,
    } = this.runtime;
    const ref = params.id!;
    const email =
      params.email !== undefined ? address(params.email) : undefined;
    const targets: { kind: string; id: string }[] = [];
    if (email || id === "contacts.create")
      targets.push({ kind: "contact", id: hash(email ?? address(body.email)) });
    if (params.key) targets.push({ kind: "property", id: params.key });
    if (ref)
      targets.push({
        kind: id.startsWith("contacts.")
          ? "topic"
          : id.split(".")[0]!.replace(/s$/, ""),
        id: ref,
      });
    const property = async () => {
      const row = await store.get<PropertyDefinition>(`PROPERTY#${params.key}`);
      if (!row) throw new AppError(404, "Property not found");
      return row;
    };
    const pagedRecords = async <T extends Broadcast | Template>(
      scope: string,
      prefix: string,
      dto: (row: T) => unknown,
    ) => {
      const options = listQuery.parse(query),
        raw = decodeCursor(scope, options.cursor);
      const position =
        raw === undefined
          ? undefined
          : z
              .object({
                pk: z.string().startsWith(prefix),
                sk: z.literal("META"),
                scope: z.literal(scope),
                sort: z.string(),
              })
              .strict()
              .parse(raw);
      const result = await store.listPage<T>(scope, options.limit, position);
      const fresh = new Map(
        (await store.getMany<T>(result.items.map((row) => row.pk))).map(
          (row) => [row.pk, row],
        ),
      );
      return {
        data: result.items.flatMap((row) =>
          fresh.has(row.pk) ? [dto(fresh.get(row.pk)!)] : [],
        ),
        nextCursor: result.cursor ? encodeCursor(scope, result.cursor) : null,
      };
    };
    const ok = { ok: true as const };
    return {
      activity: { resources: [{}], targets, requiredScopes: [] as string[] },
      authorizeReplay: () => authorizeOperation(caller, id),
      run: async (commit?: MutationCommit): Promise<unknown> => {
        assertSendApproval(caller, id, raw);
        switch (id) {
          case "properties.list":
            return page(
              (await d.properties()).map(propertyDto),
              "properties",
              query,
              (row) => row.key,
            );
          case "properties.get":
            return propertyDto(await property());
          case "properties.create":
            return propertyDto(
              (await d.saveProperty(
                body,
                undefined,
                projected(commit, propertyDto),
              ))!,
            );
          case "properties.update": {
            await property();
            const data = z
              .object({
                key: z.string(),
                type: z.string(),
                fallback: z.unknown().optional(),
              })
              .strict()
              .parse(body.property);
            if (data.key !== params.key)
              throw new AppError(400, "Property key must match URL");
            return propertyDto(
              (await d.saveProperty(
                data,
                revision(body),
                projected(commit, propertyDto),
              ))!,
            );
          }
          case "topics.list":
            return page(
              (await d.topics()).map(topicDto),
              "topics",
              query,
              (row) => row.id,
            );
          case "topics.get":
            return topicDto(await d.topic(ref));
          case "topics.create":
            return topicDto(
              await d.saveTopic(
                body,
                undefined,
                undefined,
                projected(commit, topicDto),
              ),
            );
          case "topics.update":
            return topicDto(
              await d.saveTopic(
                body.topic,
                ref,
                revision(body),
                projected(commit, topicDto),
              ),
            );
          case "contacts.list": {
            await d.segments();
            return page(
              (await d.all()).map(contactDto),
              "contacts",
              query,
              (row) => row.email,
            );
          }
          case "contacts.get": {
            const detail = await d.details(email!);
            return {
              contact: contactDto(detail.contact),
              topics: detail.topics.map((row) => ({
                ...topicDto(row),
                subscribed: row.subscribed,
              })),
              unsubscribedAll: detail.unsubscribedAll,
            };
          }
          case "contacts.create":
            return contactDto(
              await d.createContact(body, projected(commit, contactDto)),
            );
          case "contacts.properties.patch":
            return contactDto(
              await d.patchProperties(
                email!,
                body,
                projected(commit, contactDto),
              ),
            );
          case "contacts.topics.unsubscribe": {
            await subscriptions.subscribe(
              email!,
              ref,
              false,
              "API topic unsubscribe",
              projected(commit, () => ok),
            );
            return ok;
          }
          case "contacts.update":
            return contactDto(
              await d.updateContact(
                email!,
                body.contact,
                revision(body),
                projected(commit, contactDto),
              ),
            );
          case "contacts.subscribe": {
            z.literal(true).parse(body.confirmed);
            await subscriptions.subscribe(
              email!,
              ref,
              z.boolean().parse(body.subscribed),
              z.string().parse(body.source),
              projected(commit, () => ok),
            );
            return ok;
          }
          case "contacts.unsubscribe": {
            const contact = await d.contact(email!);
            await subscriptions.unsubscribeAll(
              contact.email,
              projected(commit, () => ok),
            );
            return ok;
          }
          case "segments.list":
            return page(
              (await d.summaries()).map(segmentDto),
              "segments",
              query,
              (row) => row.id,
            );
          case "segments.get": {
            const row = (await d.summaries()).find((row) => row.id === ref);
            if (!row) throw new AppError(404, "Segment not found");
            return segmentDto(row);
          }
          case "segments.create":
            return segmentDto(
              await d.createSegment(body, projected(commit, segmentDto)),
            );
          case "segments.update":
            return segmentDto(
              await d.updateSegment(
                ref,
                body.segment,
                revision(body),
                projected(commit, segmentDto),
              ),
            );
          case "segments.members.list": {
            const segment = await d.audience(ref);
            return page(
              segment.contacts.map(memberDto),
              `segments/${ref}/contacts`,
              query,
              (row) => row.email,
            );
          }
          case "segments.members.add":
            return memberDto(
              await d.addMember(
                ref,
                email!,
                body,
                projected(commit, memberDto),
              ),
            );
          case "segments.members.remove":
            await d.removeMember(
              ref,
              email!,
              projected(commit, () => ok),
            );
            return ok;
          case "segments.import": {
            const data = z
              .object({
                csv: z.string().max(180000),
                consentSource: z.string(),
                consentConfirmed: z.literal(true),
                topicIds: z.array(z.uuid()).max(50).default([]),
              })
              .strict()
              .parse(body);
            // Multi-record imports retain durable unknown-outcome handling. Never rerun automatically.
            return d.import(ref, data.csv, data.consentSource, data.topicIds);
          }
          case "broadcasts.list":
            return pagedRecords<Broadcast>(
              "broadcasts",
              "BROADCAST#",
              broadcastDto,
            );
          case "broadcasts.get":
            return broadcastDto(await b.get(ref));
          case "broadcasts.create":
            return broadcastDto(
              await b.create(
                publicDraft.parse(body),
                projected(commit, broadcastDto),
              ),
            );
          case "broadcasts.update":
            return broadcastDto(
              await b.update(
                ref,
                publicDraft.parse(body.draft),
                revision(body),
                projected(commit, broadcastDto),
              ),
            );
          case "broadcasts.recipients.list": {
            const result = await b.results(ref);
            return page(
              result.recipients.map(
                ({ email, name, messageId, status, error }) => ({
                  email,
                  name,
                  messageId,
                  status,
                  error,
                }),
              ),
              `broadcasts/${ref}/recipients`,
              query,
              (row) => row.email,
            );
          }
          case "broadcasts.preview":
            return b.preview(
              ref,
              query.contact === undefined ? undefined : address(query.contact),
            );
          case "broadcasts.test":
            return b.test(
              ref,
              address(body.to),
              body.previewEmail === undefined
                ? undefined
                : address(body.previewEmail),
              commit,
            );
          case "broadcasts.send": {
            z.literal(true).parse(body.confirmed);
            return broadcastDto(
              await b.start(
                ref,
                revision(body),
                z.number().int().optional().parse(body.scheduledAt),
                projected(commit, broadcastDto),
              ),
            );
          }
          case "broadcasts.cancel":
            return broadcastDto(
              await b.cancel(ref, projected(commit, broadcastDto)),
            );
          case "broadcasts.duplicate": {
            const original = await b.get(ref);
            return broadcastDto(
              await b.create(
                {
                  ...original.draft,
                  name: `${original.draft.name.slice(0, 110)} (copy)`,
                },
                projected(commit, broadcastDto),
              ),
            );
          }
          case "templates.list":
            return pagedRecords<Template>("templates", "TEMPLATE#", (row) =>
              templateDto(row, false),
            );
          case "templates.get":
            return templateDto(await t.get(ref), false);
          case "templates.create":
            return templateDto(
              await t.create(
                body,
                projected(commit, (row: Template) => templateDto(row, false)),
              ),
              false,
            );
          case "templates.update":
            return templateDto(
              await t.update(
                ref,
                body.draft,
                revision(body),
                projected(commit, (row: Template) => templateDto(row, false)),
              ),
              false,
            );
          case "templates.publish":
            return templateDto(
              await t.publish(
                ref,
                revision(body),
                projected(commit, (row: Template) => templateDto(row, false)),
              ),
              false,
            );
          case "templates.archive":
            return templateDto(
              await t.archive(
                ref,
                z.boolean().parse(body.archived),
                revision(body),
                projected(commit, (row: Template) => templateDto(row, false)),
              ),
              false,
            );
          case "templates.duplicate": {
            const original = await t.get(ref);
            return templateDto(
              await t.create(
                {
                  ...original.draft,
                  alias: z.string().parse(body.alias),
                  name: `${original.draft.name.slice(0, 110)} (copy)`,
                },
                projected(commit, (row: Template) => templateDto(row, false)),
              ),
              false,
            );
          }
          case "templates.preview":
            return t.preview(
              ref,
              variableValues.parse(body.variables ?? {}),
              z.number().int().positive().optional().parse(body.version),
            );
          case "templates.test": {
            const content = await t.preview(
              ref,
              variableValues.parse(body.variables ?? {}),
            );
            return this.runtime.service.accept(
              emailInput.parse({
                ...content,
                from: body.from,
                to: address(body.to),
                subject: `[Test] ${content.subject}`,
              }),
              "default",
              undefined,
              undefined,
              undefined,
              commit,
            );
          }
          case "templates.broadcasts.create": {
            const input = z
              .object({
                variables: variableValues.default({}),
                version: z.number().int().positive().optional(),
                name: z.string().optional(),
                audienceId: z.string().default(""),
                topicId: z.string().optional(),
                from: z.string().default(""),
                organization: z.string().default(""),
                postalAddress: z.string().default(""),
              })
              .strict()
              .parse(body);
            const published = await t.published(ref, input.version);
            if (published.content.kind !== "broadcast")
              throw new AppError(422, "Choose a broadcast template");
            const { variables, version: _, name, ...fields } = input;
            const content = renderTemplate(published.content, variables);
            return broadcastDto(
              await b.create(
                {
                  name: name ?? published.content.name,
                  ...fields,
                  ...content,
                  ...(published.content.variables.length === 0 &&
                  published.content.document
                    ? { document: published.content.document }
                    : {}),
                },
                projected(commit, broadcastDto),
              ),
            );
          }
          default:
            throw new Error(`Unhandled operation: ${id satisfies never}`);
        }
      },
    };
  }
}
