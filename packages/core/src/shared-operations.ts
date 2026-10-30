import { apiOrigin } from "./origins.js";
import { resourceSearchInput } from "@narada/contracts/integration";
import { z } from "zod";
import { integrationGuide } from "./integration-guide.js";
import { ProductPagination } from "./product-pagination.js";
import { hash } from "./model.js";
import type { ResourceReference } from "@narada/contracts/types";
import { SendApprovals } from "./send-approvals.js";
import {
  EmailOperations,
  type EmailSubmissionContext,
} from "./email-operations.js";
import { assertSendApproval } from "./send-approval-context.js";
import type { MutationCommit } from "./idempotency.js";
import {
  CampaignOperations,
  isCampaignOperation,
  type CampaignOperationId,
} from "./campaign-operations.js";
import {
  ProductOperations,
  isProductOperation,
  type ProductOperationId,
} from "./product-operations.js";
import {
  OperationalOperations,
  isOperationalOperation,
  type OperationalOperationId,
} from "./operational-operations.js";
import { assertOperationAccess, type Caller } from "./authorization.js";
import type { Runtime } from "./runtime.js";
const searchLists = {
  domains: "domains.list",
  forms: "forms.list",
  publications: "publications.list",
  contacts: "contacts.list",
  templates: "templates.list",
  broadcasts: "broadcasts.list",
  segments: "segments.list",
  topics: "topics.list",
} as const;
export type SharedOperationId =
  | "integration.guide"
  | "resources.search"
  | "emails.send"
  | "emails.get"
  | ProductOperationId
  | OperationalOperationId
  | CampaignOperationId
  | "approvals.request"
  | "approvals.get"
  | "approvals.list";
export const isSharedOperation = (id: string): id is SharedOperationId =>
  [
    "integration.guide",
    "resources.search",
    "emails.send",
    "emails.get",
    "approvals.request",
    "approvals.get",
    "approvals.list",
  ].includes(id) ||
  isProductOperation(id) ||
  isOperationalOperation(id) ||
  isCampaignOperation(id);
export class SharedOperations {
  readonly emails: EmailOperations;
  readonly approvals: SendApprovals;
  readonly campaigns: CampaignOperations;
  readonly products: ProductOperations;
  readonly operational: OperationalOperations;
  constructor(private runtime: Runtime) {
    this.emails = new EmailOperations(runtime);
    this.approvals = new SendApprovals(runtime);
    this.campaigns = new CampaignOperations(runtime);
    this.products = new ProductOperations(runtime);
    this.operational = new OperationalOperations(runtime);
  }
  async prepare(
    caller: Caller,
    id: SharedOperationId,
    input: unknown,
    submission?: EmailSubmissionContext,
  ) {
    if (id === "integration.guide") {
      assertOperationAccess(caller, id);
      return {
        activity: {
          resources: [],
          targets: [],
          requiredScopes: [] as string[],
        },
        authorizeReplay: async () => {
          assertOperationAccess(caller, id);
        },
        run: async (_commit?: MutationCommit): Promise<unknown> =>
          integrationGuide(apiOrigin(this.runtime.config)),
      };
    }
    if (id === "resources.search") {
      assertOperationAccess(caller, id);
      const { query } = z
        .object({
          query: resourceSearchInput.extend({
            text: resourceSearchInput.shape.text.trim().min(1),
            limit: resourceSearchInput.shape.limit.default(20),
          }),
        })
        .strict()
        .parse(input);
      const listId = searchLists[query.kind],
        pagination = new ProductPagination(this.runtime.store),
        scope = `search:${query.kind}:${hash(query.text.toLowerCase())}`;
      const cursor = z
        .string()
        .optional()
        .parse(pagination.decode(scope, query.cursor));
      const listInput = {
        query: { limit: query.limit, ...(cursor ? { cursor } : {}) },
      };
      // Delegate authorization AND filtering to the canonical list operation.
      const prepared = await (isCampaignOperation(listId)
        ? this.campaigns.prepare(caller, listId, listInput)
        : isOperationalOperation(listId)
          ? this.operational.prepare(caller, listId, listInput)
          : this.products.prepare(caller, listId, listInput));
      return {
        ...prepared,
        run: async (_commit?: MutationCommit): Promise<unknown> => {
          const page = (await prepared.run()) as {
            data: Record<string, unknown>[];
            nextCursor: string | null;
          };
          const data: ResourceReference[] = [];
          for (const row of page.data) {
            const settings = row.settings as
                Record<string, unknown> | undefined,
              draft = row.draft as Record<string, unknown> | undefined;
            const names = [
              row.name,
              row.email,
              row.slug,
              row.alias,
              row.title,
              settings?.name,
              settings?.slug,
              draft?.name,
              draft?.subject,
            ].filter(
              (v): v is string => typeof v === "string" && v.trim().length > 0,
            );
            if (
              !names.some((v) =>
                v.toLowerCase().includes(query.text.toLowerCase()),
              )
            )
              continue;
            data.push({
              kind: query.kind,
              id: String(row.id ?? row.email ?? row.name),
              name: names[0] ?? String(row.id),
              ...(typeof row.revision === "number"
                ? { revision: row.revision }
                : {}),
              ...(typeof row.status === "string" ? { status: row.status } : {}),
            });
          }
          return {
            data,
            nextCursor: page.nextCursor
              ? pagination.encode(scope, page.nextCursor)
              : null,
          };
        },
      };
    }
    if (id === "emails.send" || id === "emails.get")
      return this.emails.prepare(caller, id, input, submission);
    if (
      id === "approvals.request" ||
      id === "approvals.get" ||
      id === "approvals.list"
    )
      return this.approvals.prepare(caller, id, input);
    const prepared = await (isCampaignOperation(id)
      ? this.campaigns.prepare(caller, id, input)
      : isOperationalOperation(id)
        ? this.operational.prepare(caller, id, input)
        : this.products.prepare(caller, id, input));
    return {
      ...prepared,
      run: (commit?: MutationCommit) => {
        assertSendApproval(caller, id, input);
        return prepared.run(commit);
      },
    };
  }
}
