import { dashboardOrigin, installationIdentity } from "./origins.js";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { z } from "zod";
import type {
  SendApproval,
  SendApprovalRequest,
  SendApprovalReview,
} from "@narada/contracts/types";
import { operationSchemas } from "@narada/contracts/discovery";
import { AppError, emailInput, domainOf, type Entity } from "./model.js";
import {
  apiKeyCaller,
  authorizeOperation,
  assertOperationAccess,
  callerIdentity,
  callerScopes,
  oauthCaller,
  requireScopes,
  type Caller,
} from "./authorization.js";
import { GrantStore, hashOAuthToken } from "./oauth-grants.js";
import { findKey } from "./resource-lifecycle.js";
import { SharedOperations } from "./shared-operations.js";
import { ProductPagination } from "./product-pagination.js";
import {
  MutationReceipt,
  mutationReceiptKey,
  commitMutation,
  type MutationCommit,
  type MutationRecord,
} from "./idempotency.js";
import { activityContext } from "./activity.js";
import type { ActivityContext } from "./activity-records.js";
import type { Runtime } from "./runtime.js";
import {
  approvalDigest,
  assertApprovalComplete,
  withSendApproval,
} from "./send-approval-context.js";
import { renderBroadcast } from "./broadcast-model.js";
import { personalize } from "./personalization.js";
import { variableValues } from "./template-model.js";
import type { Publication } from "./newsletter-model.js";

type Plan = Awaited<ReturnType<Runtime["broadcasts"]["reviewLaunch"]>>;
type Payload = {
  request: SendApprovalRequest;
  parts: Record<string, string>;
  email?: ReturnType<typeof emailInput.parse>;
  plan?: Plan;
  web?: { html: string; text: string };
  from?: string;
  subject?: string;
  channels?: "web" | "email" | "both";
};
type RecordRow = Entity & {
  id: string;
  operation: SendApprovalRequest["operation"];
  status: "pending" | "succeeded" | "rejected";
  actor: Exclude<ReturnType<typeof callerIdentity>, { kind: "session" }>;
  scopes: string[];
  details: Pick<
    ActivityContext,
    "resources" | "targets" | "requiredScopes" | "authorizationOperation"
  >;
  digest: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  operationId?: string;
  messageId?: string;
};
type PayloadRow = Entity & { ciphertext: Uint8Array };
const payloadKey = (id: string) => `SENDREVIEW#${id}`;
const recordKey = (id: string) => `SENDAPPROVAL#${id}`;
const receiptPrincipal = (id: string) => `send-approval:${id}`;
const receiptKey = (row: RecordRow) =>
  mutationReceiptKey(receiptPrincipal(row.id), row.operation, row.id);
const ownerInput = z.object({ digest: z.string().min(1) }).strict();

export class SendApprovals {
  private key: Buffer;
  constructor(private runtime: Runtime) {
    this.key = createHash("sha256")
      .update(`narada-send-review-v1:${runtime.config.BETTER_AUTH_SECRET}`)
      .digest();
  }
  private seal(id: string, payload: Payload) {
    const raw = JSON.stringify(payload);
    if (Buffer.byteLength(raw) > 3_000_000)
      throw new AppError(
        413,
        "Review is too large; use a smaller audience or message",
      );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const body = Buffer.concat([
      cipher.update(deflateSync(raw)),
      cipher.final(),
    ]);
    if (body.length > 350_000)
      throw new AppError(
        413,
        "Review is too large; use a smaller audience or message",
      );
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }
  private async payload(row: RecordRow) {
    if (Date.parse(row.expiresAt) <= Date.now())
      throw new AppError(409, "Approval expired; request a new review");
    const saved = await this.runtime.store.get<PayloadRow>(payloadKey(row.id));
    if (!saved || Number(saved.ttl) <= Date.now() / 1000)
      throw new AppError(409, "Review content expired");
    const data = Buffer.from(saved.ciphertext),
      cipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(row.id));
    cipher.setAuthTag(data.subarray(12, 28));
    const payload = JSON.parse(
      inflateSync(
        Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]),
        { maxOutputLength: 3_000_000 },
      ).toString(),
    ) as Payload;
    if (approvalDigest(payload) !== row.digest)
      throw new AppError(409, "Review content does not match its approval");
    return payload;
  }
  private async row(id: string) {
    const row = await this.runtime.store.get<RecordRow>(
      recordKey(z.uuid().parse(id)),
    );
    if (!row || Number(row.ttl) <= Date.now() / 1000)
      throw new AppError(404, "Approval not found");
    return row;
  }
  private owner(caller: Caller, row: RecordRow) {
    const identity = callerIdentity(caller);
    if (identity.kind !== "session")
      throw new AppError(
        403,
        "Only the signed-in owner can decide an approval",
      );
    if (row.actor.kind === "oauth" && row.actor.userId !== identity.userId)
      throw new AppError(404, "Approval not found");
    return identity.userId;
  }
  private async authorized(caller: Caller, row: RecordRow) {
    const identity = callerIdentity(caller);
    if (identity.kind === "session") {
      this.owner(caller, row);
      return;
    }
    if (approvalDigest(identity) !== approvalDigest(row.actor))
      throw new AppError(404, "Approval not found");
    assertOperationAccess(caller, row.operation);
    requireScopes(caller, row.details.requiredScopes ?? []);
    for (const facts of row.details.resources.length
      ? row.details.resources
      : [{}])
      authorizeOperation(caller, row.operation, facts);
    for (const target of row.details.targets) {
      if (target.kind === "publication") {
        const publication = await this.runtime.store.get<Publication>(
          `PUBLICATION#${target.id}`,
        );
        if (!publication)
          throw new AppError(404, "Approval resource is unavailable");
        authorizeOperation(caller, row.operation, {
          publicationId: publication.id,
          senderDomain: domainOf(publication.settings.from),
        });
      }
    }
  }
  private async dto(row: RecordRow): Promise<SendApproval> {
    const receipt =
      row.status === "pending"
        ? await this.runtime.store.get<MutationRecord>(receiptKey(row))
        : undefined;
    const status =
      receipt?.outcome === "pending"
        ? receipt.busyUntil > Date.now()
          ? "executing"
          : "unknown"
        : row.status === "pending" && Date.parse(row.expiresAt) <= Date.now()
          ? "expired"
          : row.status;
    return {
      id: row.id,
      operation: row.operation,
      status,
      requestedBy:
        row.actor.kind === "oauth"
          ? {
              kind: "oauth",
              userId: row.actor.userId,
              clientId: row.actor.clientId,
            }
          : { kind: "api-key", keyId: row.actor.keyId },
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      reviewUrl: new URL(
        `/?page=approvals&approvalId=${row.id}`,
        dashboardOrigin(this.runtime.config),
      ).href,
      ...(row.messageId ? { messageId: row.messageId } : {}),
      ...(row.operationId
        ? { operationId: row.operationId }
        : receipt
          ? { operationId: receipt.operationId }
          : {}),
      ...(row.decidedAt
        ? { decidedAt: row.decidedAt, decidedBy: row.decidedBy }
        : {}),
    };
  }
  async get(caller: Caller, id: string) {
    assertOperationAccess(caller, "approvals.get");
    const row = await this.row(id);
    await this.authorized(caller, row);
    return this.dto(row);
  }
  async list(caller: Caller, query: unknown) {
    assertOperationAccess(caller, "approvals.list");
    const page = await new ProductPagination(
      this.runtime.store,
    ).records<RecordRow>(
      "sendApprovals",
      "SENDAPPROVAL#",
      query,
      async (row) => {
        if (Number(row.ttl) <= Date.now() / 1000) return false;
        try {
          await this.authorized(caller, row);
          return true;
        } catch (e) {
          if (e instanceof AppError && [401, 403, 404].includes(e.status))
            return false;
          throw e;
        }
      },
    );
    return {
      data: await Promise.all(page.data.map((row) => this.dto(row))),
      nextCursor: page.nextCursor,
    };
  }
  private async prepareReview(request: SendApprovalRequest): Promise<Payload> {
    const { broadcasts: b, issues, templates } = this.runtime;
    const payload: Payload = { request, parts: {} };
    switch (request.operation) {
      case "emails.send": {
        payload.email = await templates.resolveEmailInput(request.input.body);
        break;
      }
      case "broadcasts.send": {
        const { params, body } = request.input,
          broadcast = await b.get(params.id);
        if (
          broadcast.publicationId ||
          broadcast.status !== "draft" ||
          broadcast.revision !== body.revision
        )
          throw new AppError(
            409,
            "Broadcast changed; reload before requesting review",
          );
        z.literal(true).parse(body.confirmed);
        payload.plan = await b.reviewLaunch(broadcast.draft, body.scheduledAt);
        break;
      }
      case "broadcasts.test": {
        const { params, body } = request.input;
        payload.email = await b.testInput(
          params.id,
          body.to,
          body.previewEmail,
        );
        break;
      }
      case "templates.test": {
        const { params, body } = request.input;
        const content = await templates.preview(
          params.id,
          variableValues.parse(body.variables ?? {}),
        );
        payload.email = emailInput.parse({
          ...content,
          from: body.from,
          to: body.to,
          subject: `[Test] ${content.subject}`,
        });
        break;
      }
      case "issues.test": {
        const { params, body } = request.input;
        payload.email = await issues.testInput(
          params.id,
          params.issueId,
          body.to,
          body.revision,
        );
        break;
      }
      case "issues.publish": {
        const { params, body } = request.input;
        z.literal(true).parse(body.confirmed);
        const pub = await issues.active(params.id),
          issue = await issues.get(params.id, params.issueId);
        issues.editable(issue, body.revision);
        if (body.channels !== "web" && issue.emailReleased)
          throw new AppError(409, "This issue has already been distributed");
        payload.parts.issue = approvalDigest(
          issues.approvalBinding(pub, issue, body.channels, body.scheduledAt),
        );
        const preview = await issues.preview(params.id, params.issueId);
        payload.web = preview.web;
        payload.from = preview.from;
        payload.subject = preview.subject;
        payload.channels = body.channels;
        if (body.channels !== "web")
          payload.plan = await b.reviewLaunch(
            issues.draft(pub, issue),
            body.scheduledAt,
            true,
          );
        break;
      }
      default:
        throw new Error(`Unsupported review: ${request satisfies never}`);
    }
    if (payload.plan) payload.parts.audience = approvalDigest(payload.plan);
    if (payload.email) payload.parts.email = approvalDigest(payload.email);
    return payload;
  }
  async prepare(
    caller: Caller,
    id: "approvals.request" | "approvals.list" | "approvals.get",
    raw: unknown,
  ) {
    assertOperationAccess(caller, id);
    const input = z.fromJSONSchema(operationSchemas[id].input).parse(raw) as {
      body?: SendApprovalRequest;
      params?: { id: string };
      query?: unknown;
    };
    const details: Pick<
      ActivityContext,
      "resources" | "targets" | "requiredScopes" | "authorizationOperation"
    > = { resources: [], targets: [], requiredScopes: [] };
    let target: Awaited<ReturnType<SharedOperations["prepare"]>> | undefined;
    if (id === "approvals.request") {
      if (callerIdentity(caller).kind === "session")
        throw new AppError(
          400,
          "Send reviews are requested by connected clients",
        );
      target = await new SharedOperations(this.runtime).prepare(
        caller,
        input.body!.operation,
        input.body!.input,
      );
      Object.assign(details, target.activity);
      details.authorizationOperation = input.body!.operation;
    }
    return {
      activity: details,
      authorizeReplay: async (value: unknown) => {
        if (id === "approvals.request")
          await this.authorized(
            caller,
            await this.row((value as SendApproval).id),
          );
      },
      run: async (commit?: MutationCommit) => {
        if (id === "approvals.get") return this.get(caller, input.params!.id);
        if (id === "approvals.list") return this.list(caller, input.query);
        const actor = callerIdentity(caller);
        if (actor.kind === "session")
          throw new AppError(400, "Connected client required");
        const payload = await this.prepareReview(input.body!);
        const approvalId = randomUUID(),
          now = Date.now();
        const row: RecordRow = {
          pk: recordKey(approvalId),
          sk: "META",
          scope: "sendApprovals",
          sort: new Date(now).toISOString() + "#" + approvalId,
          id: approvalId,
          operation: input.body!.operation,
          status: "pending",
          actor,
          scopes: callerScopes(caller),
          details,
          digest: approvalDigest(payload),
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 86400_000).toISOString(),
          ttl: Math.floor(now / 1000) + 30 * 86400,
        };
        const saved: PayloadRow = {
          pk: payloadKey(approvalId),
          sk: "META",
          ciphertext: this.seal(approvalId, payload),
          ttl: Math.floor(now / 1000) + 86400,
        };
        return commitMutation(
          this.runtime.store,
          [this.runtime.store.create(row), this.runtime.store.create(saved)],
          await this.dto(row),
          commit,
        );
      },
    };
  }
  async review(
    caller: Caller,
    id: string,
    recipient?: string,
  ): Promise<SendApprovalReview> {
    const row = await this.row(id);
    this.owner(caller, row);
    const summary = await this.dto(row);
    if (summary.status !== "pending") return summary;
    const p = await this.payload(row);
    let preview = p.email
      ? {
          from: p.email.from,
          replyTo: p.email.reply_to,
          subject: p.email.subject,
          html: p.email.html,
          text: p.email.text,
          recipients: p.email.to,
          previewRecipient: p.email.to[0],
        }
      : {
          from: p.from,
          subject: p.subject,
          html: p.web?.html,
          text: p.web?.text,
          recipients: [] as string[],
          previewRecipient: undefined as string | undefined,
        };
    if (p.plan) {
      const contact = recipient
        ? p.plan.contacts.find((c) => c.email === recipient)
        : p.plan.contacts[0];
      if (!contact) throw new AppError(404, "Preview recipient not found");
      const draft = personalize(p.plan.draft, contact.values);
      preview = {
        from: draft.from,
        replyTo: draft.replyTo,
        subject: draft.subject,
        ...renderBroadcast(
          draft,
          "#unsubscribe-preview",
          "#preferences-preview",
        ),
        recipients: p.plan.contacts.map((c) => c.email),
        previewRecipient: contact.email,
      };
    }
    const body = p.request.input.body;
    return {
      ...summary,
      digest: row.digest,
      ...preview,
      ...(p.email
        ? {
            priority: p.email.priority,
            tags: p.email.tags,
            expiresInSeconds: p.email.expires_in,
          }
        : {}),
      ...(p.channels
        ? { channels: p.channels, webHtml: p.web?.html, webText: p.web?.text }
        : {}),
      ...("scheduledAt" in body && body.scheduledAt !== undefined
        ? { scheduledAt: body.scheduledAt }
        : {}),
    };
  }
  private async liveCaller(row: RecordRow) {
    const { store, config } = this.runtime;
    if (row.actor.kind === "api-key") {
      const key = await findKey(store, row.actor.keyId);
      const caller = apiKeyCaller(key);
      return {
        caller,
        guards: [
          {
            ConditionCheck: {
              TableName: config.APP_TABLE,
              Key: { pk: key.pk, sk: key.sk },
              ConditionExpression:
                "revoked = :false AND (revision = :revision OR (attribute_not_exists(revision) AND :revision = :zero))",
              ExpressionAttributeValues: {
                ":false": false,
                ":revision": key.revision ?? 0,
                ":zero": 0,
              },
            },
          },
        ],
      };
    }
    const actor = row.actor,
      resource = `${config.BETTER_AUTH_URL}/api/mcp`,
      grants = new GrantStore(store, resource);
    const grant = await grants.active(
      actor.grantId,
      actor.userId,
      actor.clientId,
    );
    if (!grant)
      throw new AppError(
        403,
        "The connection was revoked or replaced; request a new review after reconnecting",
      );
    const { adapter } = await this.runtime.auth.$context;
    const client = await adapter.findOne<{ disabled?: boolean }>({
      model: "oauthClient",
      where: [{ field: "clientId", value: actor.clientId }],
    });
    const consent = await adapter.findOne<{
      userId: string;
      clientId: string;
      scopes: string[];
      referenceId?: string;
    }>({
      model: "oauthConsent",
      where: [
        { field: "userId", value: actor.userId },
        { field: "clientId", value: actor.clientId },
        { field: "referenceId", value: actor.grantId },
      ],
    });
    if (
      !client ||
      client.disabled ||
      !consent ||
      consent.referenceId !== actor.grantId
    )
      throw new AppError(403, "Current connection consent is unavailable");
    const caller = oauthCaller({
      subject: actor.userId,
      clientId: actor.clientId,
      resource,
      tokenScopes: row.scopes,
      tokenGrantId: actor.grantId,
      grant: { ...grant, id: actor.grantId },
      consent,
    });
    return {
      caller,
      guards: [
        {
          ConditionCheck: {
            TableName: config.APP_TABLE,
            Key: { pk: grant.pk, sk: grant.sk },
            ConditionExpression:
              "active = :active AND epoch = :epoch AND revision = :revision",
            ExpressionAttributeValues: {
              ":active": true,
              ":epoch": grant.epoch,
              ":revision": grant.revision,
            },
          },
        },
        {
          ConditionCheck: {
            TableName: config.APP_TABLE,
            Key: {
              pk: `OAUTH_USER#${hashOAuthToken(actor.userId)}`,
              sk: "META",
            },
            ConditionExpression:
              grant.userGeneration === "initial"
                ? "attribute_not_exists(pk)"
                : "generation = :generation",
            ...(grant.userGeneration === "initial"
              ? {}
              : {
                  ExpressionAttributeValues: {
                    ":generation": grant.userGeneration,
                  },
                }),
          },
        },
      ],
    };
  }
  async decide(
    caller: Caller,
    id: string,
    raw: unknown,
    approve: boolean,
  ): Promise<SendApproval> {
    const row = await this.row(id),
      owner = this.owner(caller, row),
      { digest } = ownerInput.parse(raw);
    if (digest !== row.digest)
      throw new AppError(409, "Reload the review before deciding");
    if (row.status !== "pending") return this.dto(row);
    const payload = await this.payload(row);
    if (!approve) {
      await this.runtime.store.transaction([
        {
          Update: {
            TableName: this.runtime.config.APP_TABLE,
            Key: { pk: row.pk, sk: row.sk },
            UpdateExpression:
              "SET #status = :rejected, decidedBy = :owner, decidedAt = :now",
            ConditionExpression: "#status = :pending",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "pending",
              ":rejected": "rejected",
              ":owner": owner,
              ":now": new Date().toISOString(),
            },
          },
        },
        {
          Delete: {
            TableName: this.runtime.config.APP_TABLE,
            Key: { pk: payloadKey(id), sk: "META" },
          },
        },
      ]);
      return this.dto(await this.row(id));
    }
    const live = await this.liveCaller(row);
    assertOperationAccess(live.caller, "approvals.request");
    await this.authorized(live.caller, row);
    const prepared = await new SharedOperations(this.runtime).prepare(
      live.caller,
      payload.request.operation,
      payload.request.input,
    );
    const acquisition = await MutationReceipt.acquire(
      this.runtime.store,
      receiptPrincipal(row.id),
      row.operation,
      row.id,
      { digest: row.digest },
      activityContext(
        live.caller,
        installationIdentity(this.runtime.config),
        row.operation,
        randomUUID(),
        prepared.activity,
      ),
    );
    if ("replay" in acquisition) return this.dto(await this.row(id));
    const receipt = acquisition.receipt!;
    try {
      await receipt.run(() =>
        withSendApproval(
          live.caller,
          row.operation,
          payload.request.input,
          payload.parts,
          async () => {
            const commit: MutationCommit = async (writes, result) => {
              assertApprovalComplete();
              const next: RecordRow = {
                ...row,
                status: "succeeded",
                decidedBy: owner,
                decidedAt: new Date().toISOString(),
                operationId: receipt.record.operationId,
                ...(row.operation === "emails.send" ||
                row.operation.endsWith(".test")
                  ? { messageId: (result as { id: string }).id }
                  : {}),
              };
              await receipt.commit(
                [
                  ...writes,
                  ...live.guards,
                  {
                    Put: {
                      TableName: this.runtime.config.APP_TABLE,
                      Item: next,
                      ConditionExpression:
                        "#status = :pending AND digest = :digest AND expiresAt > :now",
                      ExpressionAttributeNames: { "#status": "status" },
                      ExpressionAttributeValues: {
                        ":pending": "pending",
                        ":digest": row.digest,
                        ":now": new Date().toISOString(),
                      },
                    },
                  },
                  {
                    Delete: {
                      TableName: this.runtime.config.APP_TABLE,
                      Key: { pk: payloadKey(id), sk: "META" },
                    },
                  },
                ],
                {
                  body: JSON.stringify(result),
                  status: 200,
                  contentType: "application/json",
                },
              );
              return result;
            };
            await prepared.run(commit);
            if (!receipt.completed)
              throw new AppError(
                409,
                "Send did not commit its approval atomically",
              );
          },
        ),
      );
    } catch (error) {
      await receipt.failed();
      if (!receipt.completed) {
        if (receipt.uncertain) throw receipt.unknownError();
        throw error;
      }
    }
    return this.dto(await this.row(id));
  }
}
