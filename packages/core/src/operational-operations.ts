import { DomainSetup, setupDomainName } from "./domain-setup.js";
import { z } from "zod";
import type { Runtime } from "./runtime.js";
import { AppError, hash, type Domain, type Entity } from "./model.js";
import {
  assertOperationAccess,
  authorizeOperation,
  callerRestrictions,
  resourceAllowed,
  type Caller,
  type AuthorizationResources,
} from "./authorization.js";
import { operationSchemas } from "@narada/contracts/discovery";
import type { OperationId } from "@narada/contracts/operations";
import type { MutationCommit } from "./idempotency.js";
import { ProductPagination } from "./product-pagination.js";
import { readMetrics } from "./metrics.js";
import {
  domainDiagnostic,
  diagnosticDomain,
  suppression,
  webhookEndpoint,
} from "./operational-service.js";
import { listDeliveries, deliveryHistory, retryWebhook } from "./webhooks.js";
import { webhookEvents } from "./webhook-events.js";
export type OperationalOperationId = Extract<
  OperationId,
  | `sending.${string}`
  | `metrics.${string}`
  | `domains.${string}`
  | `suppressions.${string}`
  | `webhooks.${string}`
>;
export const isOperationalOperation = (
  id: string,
): id is OperationalOperationId =>
  /^(sending|metrics|domains|suppressions|webhooks)\./.test(id);
export class OperationalOperations {
  constructor(private runtime: Runtime) {}
  async prepare(caller: Caller, id: OperationalOperationId, raw: unknown) {
    assertOperationAccess(caller, id);
    const input = z.fromJSONSchema(operationSchemas[id].input).parse(raw) as {
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
    };
    const params = input.params ?? {},
      body = input.body ?? {},
      query = input.query ?? {};
    const service = this.runtime.operational,
      store = this.runtime.store,
      pagination = new ProductPagination(store);
    const resources: AuthorizationResources[] = [],
      targets: { kind: string; id: string }[] = [];
    const authorize = (facts: AuthorizationResources = {}) => {
      authorizeOperation(caller, id, facts);
      resources.push(facts);
    };
    let domain: string | undefined, email: string | undefined;
    if (id === "domains.create") {
      domain = setupDomainName.parse(body.name);
      authorize({ senderDomain: domain });
      targets.push({ kind: "domain", id: domain });
    } else if (id.startsWith("domains.") && params.name) {
      domain = diagnosticDomain.parse(params.name);
      authorize({ senderDomain: domain });
      await service.domain(domain);
      targets.push({ kind: "domain", id: domain });
    } else if (id === "metrics.get") {
      domain =
        query.domain === undefined
          ? undefined
          : diagnosticDomain.parse(query.domain);
      if (callerRestrictions(caller).senderDomains && !domain)
        throw new AppError(
          400,
          "Select an allowed sender domain for metrics with this restricted grant",
        );
      authorize({ senderDomain: domain });
    } else if (id !== "domains.list") authorize();
    if (
      id.startsWith("suppressions.") &&
      (params.email || body.email || query.email)
    ) {
      email = z
        .email()
        .max(320)
        .parse(params.email ?? body.email ?? query.email)
        .toLowerCase();
      targets.push({ kind: "suppression", id: hash(email) });
    }
    if (params.id) {
      if (id.startsWith("webhooks.deliveries."))
        z.string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(params.id);
      else z.uuid().parse(params.id);
      targets.push({
        kind: id.startsWith("webhooks.deliveries.")
          ? "webhook-delivery"
          : "webhook",
        id: params.id,
      });
    }
    return {
      activity: { resources, targets, requiredScopes: [] as string[] },
      authorizeReplay: async (value: unknown) => {
        assertOperationAccess(caller, id);
        for (const facts of resources) authorizeOperation(caller, id, facts);
        if (id === "webhooks.create") {
          const saved = value as { id: string; secret: string };
          const current = await service.endpoint(saved.id);
          if (current.secret !== saved.secret)
            throw new AppError(409, "The webhook signing secret has changed");
        }
        if (
          id.startsWith("domains.") &&
          id !== "domains.list" &&
          id !== "domains.get"
        )
          await service.domain(domain!);
      },
      run: async (commit?: MutationCommit): Promise<unknown> => {
        switch (id) {
          case "sending.get":
            return service.sending();
          case "sending.update":
            return service.setSending(
              z.boolean().parse(body.paused),
              z.number().int().nonnegative().parse(body.revision),
              commit,
            );
          case "sending.diagnostics":
            return service.diagnostics();
          case "metrics.get": {
            const days = z.coerce
              .number()
              .int()
              .min(1)
              .max(90)
              .default(15)
              .parse(query.days);
            const { cloudWatchUrl: _, ...metrics } = await readMetrics(
              store,
              days,
              domain,
            );
            return metrics;
          }
          case "domains.create":
          case "domains.mailFrom.update":
          case "domains.dkim.enable": {
            const setup = new DomainSetup(store);
            const project: MutationCommit | undefined = commit
              ? async (writes, value) => {
                  await commit(writes, domainDiagnostic(value as Domain));
                  return value;
                }
              : undefined;
            const row =
              id === "domains.create"
                ? await setup.create(domain!, project)
                : await setup.configure(
                    domain!,
                    id === "domains.mailFrom.update" ? "mailFrom" : "dkim",
                    body,
                    project,
                  );
            return domainDiagnostic(row);
          }
          case "domains.list": {
            const page = await pagination.records<Domain>(
              "domains",
              "DOMAIN#",
              query,
              (row) =>
                !row.removedAt &&
                resourceAllowed(caller, id, { senderDomain: row.name }),
            );
            return { ...page, data: page.data.map(domainDiagnostic) };
          }
          case "domains.get":
            return domainDiagnostic(await service.domain(domain!));
          case "domains.refresh":
            return service.refreshDomain(domain!, commit);
          case "suppressions.list": {
            if (email) {
              const row = await store.get(`SUPPRESS#${email}`);
              const { email: _, ...options } = query;
              return pagination.rows(
                `suppression#${hash(email)}`,
                row ? [suppression(row)] : [],
                options,
                (row) => row.email,
              );
            }
            const page = await pagination.records<Entity>(
              "suppressions",
              "SUPPRESS#",
              query,
              () => true,
            );
            return { ...page, data: page.data.map(suppression) };
          }
          case "suppressions.get":
            return service.getSuppression(email!);
          case "suppressions.create":
            return service.addSuppression(email!, commit);
          case "suppressions.delete":
            return service.removeSuppression(email!, commit);
          case "webhooks.events":
            return { data: webhookEvents };
          case "webhooks.list": {
            const page = await pagination.records<Entity>(
              "webhooks",
              "WEBHOOK#",
              query,
              () => true,
            );
            return { ...page, data: page.data.map(webhookEndpoint) };
          }
          case "webhooks.get":
            return webhookEndpoint(await service.endpoint(params.id!));
          case "webhooks.create":
            return service.createWebhook(body, commit);
          case "webhooks.update": {
            const { revision, ...config } = body;
            return service.updateWebhook(
              params.id!,
              config,
              z.number().int().nonnegative().parse(revision),
              commit,
            );
          }
          case "webhooks.delete":
            return service.deleteWebhook(params.id!, commit);
          case "webhooks.deliveries.list":
            return listDeliveries(store, query);
          case "webhooks.deliveries.get":
            return deliveryHistory(store, params.id!, query);
          case "webhooks.deliveries.retry":
            return retryWebhook(store, params.id!, commit);
          default:
            throw new Error(`Unhandled operation: ${id satisfies never}`);
        }
      },
    };
  }
}
