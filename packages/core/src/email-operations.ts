import { z } from "zod";
import { operationSchemas } from "@narada/contracts/discovery";
import { AppError, domainOf, type Message } from "./model.js";
import {
  assertOperationAccess,
  authorizeOperation,
  type Caller,
} from "./authorization.js";
import { assertSendApproval } from "./send-approval-context.js";
import type { MutationCommit } from "./idempotency.js";
import type { Runtime } from "./runtime.js";
import { deliveryMetadata } from "./message-metadata.js";

/** Server-supplied REST context preserves the existing transactional receipt contract. */
export type EmailSubmissionContext = {
  project: string;
  idempotencyKey?: string;
  timing?: Parameters<Runtime["service"]["accept"]>[4];
  activity?: Parameters<Runtime["service"]["accept"]>[6];
  onAccepted?: (result: { id: string; replayed: boolean }) => void;
};

/** Shared transactional email boundary for REST, MCP and owner-approved execution. */
export class EmailOperations {
  constructor(private runtime: Runtime) {}
  async prepare(
    caller: Caller,
    operation: "emails.send" | "emails.get",
    raw: unknown,
    submission?: EmailSubmissionContext,
  ) {
    assertOperationAccess(caller, operation);
    const input = z
      .fromJSONSchema(operationSchemas[operation].input)
      .parse(raw) as {
      body?: unknown;
      params?: { id: string };
    };
    const message =
      operation === "emails.send"
        ? await this.runtime.templates.resolveEmailInput(input.body)
        : undefined;
    const saved =
      operation === "emails.get"
        ? await this.message(input.params!.id)
        : undefined;
    const resources = {
      senderDomain: domainOf((message ?? saved!.input).from),
    };
    authorizeOperation(caller, operation, resources);
    return {
      activity: {
        resources: [resources],
        targets: saved ? [{ kind: "message", id: saved.id }] : [],
        requiredScopes: [] as string[],
      },
      authorizeReplay: async (value: unknown) => {
        const saved = await this.message((value as { id: string }).id);
        authorizeOperation(caller, operation, {
          senderDomain: domainOf(saved.input.from),
        });
      },
      run: async (commit?: MutationCommit) => {
        assertSendApproval(caller, operation, raw);
        if (operation === "emails.send") {
          const result = await this.runtime.service.accept(
            message!,
            submission?.project ?? "default",
            submission?.idempotencyKey,
            undefined,
            submission?.timing,
            commit,
            submission?.activity,
          );
          submission?.onAccepted?.(result);
          return result;
        }
        return {
          id: saved!.id,
          status: saved!.status,
          created_at: saved!.createdAt,
          tags: saved!.input.tags ?? {},
          priority: saved!.input.priority ?? "normal",
          events: saved!.events.map(deliveryMetadata),
        };
      },
    };
  }
  private async message(id: string) {
    const message = await this.runtime.store.get<Message>(`MSG#${id}`);
    if (!message) throw new AppError(404, "Message not found");
    return message;
  }
}
