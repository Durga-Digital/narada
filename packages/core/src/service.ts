import { ContactService } from "./contacts.js";
import type { Audience } from "./broadcast-model.js";
import { assertApprovalPart } from "./send-approval-context.js";
import {
  activityRecord,
  activityWrites,
  finishActivity,
  type ActivityContext,
} from "./activity-records.js";
import {
  delegationSelection,
  type OperationAccess,
} from "@narada/contracts/delegation";
import { SubscriptionService } from "./subscriptions.js";
import { WorkDispatcher } from "./work-dispatcher.js";
import { commitMutation, type MutationCommit } from "./idempotency.js";
import { findKey } from "./resource-lifecycle.js";
import { normalizeDomainName, validDomainName } from "./domain-name.js";
import { apiKeyAccess, type ApiScope } from "./api-permissions.js";
import { webhookJobs } from "./event-outbox.js";
import { metricWrite, eventMetric } from "./metrics.js";
import { randomUUID } from "node:crypto";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import {
  AppError,
  domainOf,
  hash,
  secret,
  type ApiKey,
  type ApiKeyPermission,
  type Domain,
  type EmailInput,
  type Entity,
  type Message,
  type DeliveryEvent,
  nextStatus,
} from "./model.js";
import { conditional, Store } from "./store.js";
import { acceptanceTransaction } from "./acceptance-transaction.js";
import { messageContentPaths } from "./message-retention.js";
import { timed, type SubmissionTiming } from "./submission-timing.js";
import type { Config } from "./config.js";
import type { Transport } from "./transport.js";
import { Queues } from "./queue.js";
import { type BroadcastDelivery, type Broadcast } from "./broadcast-model.js";

export class EmailService {
  constructor(
    readonly config: Config,
    readonly store: Store,
    readonly queues: Queues,
    readonly transport: Transport,
    readonly subscriptions = new SubscriptionService(store),
    readonly dispatcher = new WorkDispatcher(store, queues),
  ) {}
  private async validateKeySettings(
    name: string,
    permission: ApiKeyPermission,
    domain?: string,
    scopes?: ApiScope[],
    operationAccess?: OperationAccess,
  ) {
    apiKeyAccess.parse({ permission, scopes, operationAccess });
    if (operationAccess) {
      const selection = delegationSelection.parse(operationAccess);
      for (const [field, prefix] of [
        ["formIds", "FORM"],
        ["publicationIds", "PUBLICATION"],
        ["senderDomains", "DOMAIN"],
      ] as const)
        for (const id of selection.resources[field] ?? []) {
          const resource = await this.store.get(`${prefix}#${id}`);
          if (!resource || resource.removedAt)
            throw new AppError(422, "Choose existing resources for this key");
        }
    }
    name = name.trim();
    if (!name || name.length > 80)
      throw new AppError(400, "Enter a key name between 1 and 80 characters");
    if (domain !== undefined) {
      domain = normalizeDomainName(domain);
      if (
        permission !== "sending" &&
        !(permission === "scoped" && scopes?.includes("emails:send"))
      )
        throw new AppError(400, "Domain restrictions require sending access");
      const registered = await this.store.get<Domain>(`DOMAIN#${domain}`);
      if (!validDomainName(domain) || !registered || registered.removedAt)
        throw new AppError(422, "Choose a domain already added to Narada");
    }
    return { name, domain };
  }
  async updateKey(
    id: string,
    input: {
      name: string;
      permission: ApiKeyPermission;
      scopes?: ApiScope[];
      operationAccess?: OperationAccess;
      domain?: string;
      revision: number;
    },
  ) {
    const key = await findKey(this.store, id);
    if (key.revoked)
      throw new AppError(409, "Revoked API keys cannot be edited");
    if ((key.revision ?? 0) !== input.revision)
      throw new AppError(
        409,
        "This key has changed. Refresh the list and try again.",
      );
    const { name, domain } = await this.validateKeySettings(
      input.name,
      input.permission,
      input.domain,
      input.scopes,
      input.operationAccess,
    );
    const values: Record<string, unknown> = {
      ":name": name,
      ":permission": input.permission,
      ":revision": input.revision + 1,
      ":expected": input.revision,
      ":false": false,
    };
    const sets = [
      "#name = :name",
      "#permission = :permission",
      "revision = :revision",
    ];
    const removes: string[] = [];
    for (const [field, value] of Object.entries({
      scopes: input.scopes,
      operationAccess: input.operationAccess,
      domain,
    })) {
      if (value === undefined) removes.push(`#${field}`);
      else {
        sets.push(`#${field} = :${field}`);
        values[`:${field}`] = value;
      }
    }
    try {
      await this.store.transaction([
        {
          Update: {
            TableName: this.config.APP_TABLE,
            Key: { pk: key.pk, sk: "META" },
            UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
            ConditionExpression: `attribute_exists(pk) AND revoked = :false AND (revision = :expected${input.revision === 0 ? " OR attribute_not_exists(revision)" : ""})`,
            ExpressionAttributeNames: {
              "#name": "name",
              "#permission": "permission",
              "#scopes": "scopes",
              "#domain": "domain",
              "#operationAccess": "operationAccess",
            },
            ExpressionAttributeValues: values,
          },
        },
      ]);
    } catch (error) {
      if (conditional(error))
        throw new AppError(
          409,
          "This key has changed or was revoked. Refresh the list and try again.",
        );
      throw error;
    }
    return apiKeyMetadata({
      ...key,
      name,
      permission: input.permission,
      scopes: input.scopes,
      operationAccess: input.operationAccess,
      domain,
      revision: input.revision + 1,
    });
  }
  async createKey(
    name: string,
    permission: ApiKeyPermission = "sending",
    domain?: string,
    scopes?: ApiScope[],
    commit?: MutationCommit,
    operationAccess?: OperationAccess,
  ) {
    ({ name, domain } = await this.validateKeySettings(
      name,
      permission,
      domain,
      scopes,
      operationAccess,
    ));
    const createdAt = new Date().toISOString();
    const token = secret("na_");
    const id = randomUUID();
    const key: ApiKey = {
      pk: `KEY#${hash(token)}`,
      sk: "META",
      scope: "keys",
      sort: new Date().toISOString(),
      id,
      name,
      prefix: token.slice(0, 10),
      hash: hash(token),
      project: "default",
      permission,
      revision: 0,
      ...(scopes ? { scopes } : {}),
      ...(operationAccess
        ? { operationAccess: delegationSelection.parse(operationAccess) }
        : {}),
      ...(domain ? { domain } : {}),
      createdAt,
      usageTrackingSince: createdAt,
      revoked: false,
    };
    return commitMutation(
      this.store,
      [this.store.create(key)],
      { ...apiKeyMetadata(key), token },
      commit,
    );
  }

  async authenticate(token: string) {
    if (!token.startsWith("na_")) throw new AppError(401, "Invalid API key");
    const key = await this.store.get<ApiKey>(`KEY#${hash(token)}`);
    if (!key || key.revoked)
      throw new AppError(401, "Invalid or revoked API key");
    return key;
  }
  async recordKeyUse(key: ApiKey) {
    // Authentication already reads this record. Avoid another write for every API request.
    const now = new Date().toISOString();
    if (key.lastUsedAt && Date.now() - Date.parse(key.lastUsedAt) < 60_000)
      return;
    try {
      await this.store.transaction([
        {
          Update: {
            TableName: this.config.APP_TABLE,
            Key: { pk: key.pk, sk: "META" },
            UpdateExpression:
              "SET lastUsedAt = :now, usageTrackingSince = if_not_exists(usageTrackingSince, :now)",
            ConditionExpression:
              "attribute_exists(pk) AND revoked = :false AND (attribute_not_exists(lastUsedAt) OR lastUsedAt < :cutoff)",
            ExpressionAttributeValues: {
              ":now": now,
              ":false": false,
              ":cutoff": new Date(Date.now() - 60_000).toISOString(),
            },
          },
        },
      ]);
    } catch (error) {
      // Observability must not turn an otherwise valid API request into a failed email submission.
      if (!conditional(error))
        console.error("Could not update API key usage timestamp");
    }
  }
  assertKeyDomain(key: ApiKey, from: string) {
    if (key.domain && domainOf(from) !== key.domain)
      throw new AppError(
        403,
        "This API key cannot access emails from that sending domain",
      );
  }
  async accept(
    input: EmailInput,
    project: string,
    idempotency?: string,
    broadcast?: BroadcastDelivery,
    timing?: SubmissionTiming,
    commit?: MutationCommit,
    activity?: { context: ActivityContext; onOperation: (id: string) => void },
  ) {
    assertApprovalPart("email", input);
    if (broadcast && (await this.store.get(`MSG#${broadcast.messageId}`)))
      return { id: broadcast.messageId, replayed: true };
    if (
      idempotency &&
      (idempotency.length > 128 || !/^[\x21-\x7E]+$/.test(idempotency))
    )
      throw new AppError(400, "Invalid Idempotency-Key");
    const digest = hash(JSON.stringify(input));
    const idem = idempotency
      ? `IDEM#${project}#${hash(idempotency)}`
      : undefined;
    if (idem) {
      const old = await timed(timing, "idempotencyRead", () =>
        this.store.get(idem),
      );
      if (old && Number(old.ttl) > Date.now() / 1000) {
        if (old.digest !== digest)
          throw new AppError(
            409,
            "Idempotency key was used for different content",
          );
        if (
          activity &&
          old.activityPrincipal === activity.context.principal &&
          typeof old.activityId === "string"
        )
          activity.onOperation(old.activityId);
        return { id: String(old.messageId), replayed: true };
      }
    }
    const domainKey = `DOMAIN#${domainOf(input.from)}`;
    const eligibility = await timed(timing, "eligibilityRead", () =>
      this.store.getMany([
        domainKey,
        "SETTINGS",
        ...(broadcast ? [] : input.to.map((to) => `SUPPRESS#${to}`)),
      ]),
    );
    const byKey = new Map(eligibility.map((row) => [row.pk, row]));
    const domain = byKey.get(domainKey) as Domain | undefined;
    if (!domain?.verified || domain.removedAt)
      throw new AppError(422, "Verify the sender domain first");
    for (const to of broadcast ? [] : input.to)
      if (byKey.has(`SUPPRESS#${to}`))
        throw new AppError(422, `Recipient is suppressed: ${to}`);
    const settings = byKey.get("SETTINGS");
    if (settings?.paused) throw new AppError(503, "Sending is paused");
    const id = broadcast?.messageId ?? randomUUID(),
      now = Date.now();
    const message: Message = {
      pk: `MSG#${id}`,
      sk: "META",
      scope: `messages#${project}`,
      sort: new Date(now).toISOString(),
      id,
      project,
      input,
      senderDomainRegistration: domain.registrationId ?? "legacy",
      ...(broadcast ? { broadcast } : {}),
      metricsVersion: 1,
      status: "queued",
      createdAt: new Date(now).toISOString(),
      expiresAt: now + input.expires_in * 1000,
      events: [],
      attempts: 0,
      state: "send",
      due: now,
      ttl: Math.floor(now / 1000) + 30 * 86400,
    };
    const items: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
      this.store.create(message),
      ...metricWrite(this.store, message, { accepted: input.to.length }),
      {
        Update: {
          TableName: this.config.APP_TABLE,
          Key: { pk: "METRICS", sk: "META" },
          UpdateExpression: "SET startedAt = if_not_exists(startedAt, :now)",
          ExpressionAttributeValues: { ":now": message.createdAt },
        },
      },
    ];
    if (broadcast)
      items.push({
        ConditionCheck: {
          TableName: this.config.APP_TABLE,
          Key: { pk: `BROADCAST#${broadcast.broadcastId}`, sk: "META" },
          ConditionExpression: "#status = :sending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":sending": "sending" },
        },
      });
    const tracked = activity
      ? finishActivity(
          this.store,
          activityRecord(randomUUID(), {
            ...activity.context,
            resources: [{ senderDomain: domainOf(input.from) }],
            targets: [{ kind: "message", id }],
          }),
          "succeeded",
          { id },
          items,
        )
      : undefined;
    if (tracked) items.push(...activityWrites(this.store, tracked));
    if (idem)
      items.push({
        Put: {
          TableName: this.config.APP_TABLE,
          Item: {
            pk: idem,
            sk: "META",
            digest,
            messageId: id,
            ...(tracked
              ? { activityId: tracked.id, activityPrincipal: tracked.principal }
              : {}),
            ttl: Math.floor(now / 1000) + 86400,
          },
          ConditionExpression: "attribute_not_exists(pk) OR #ttl < :now",
          ExpressionAttributeNames: { "#ttl": "ttl" },
          ExpressionAttributeValues: { ":now": Math.floor(now / 1000) },
        },
      } as (typeof items)[number]);
    try {
      await timed(timing, "persist", () =>
        commit
          ? commitMutation(
              this.store,
              items,
              { id, replayed: false },
              commit,
            ).then(() => {})
          : acceptanceTransaction(this.store, items),
      );
    } catch (e) {
      if (
        broadcast &&
        conditional(e) &&
        (await this.store.get(`MSG#${broadcast.messageId}`))
      )
        return { id: broadcast.messageId, replayed: true };
      if (idem && conditional(e)) {
        const old = await timed(timing, "idempotencyRaceRead", () =>
          this.store.get(idem),
        );
        if (old && old.digest === digest) {
          if (
            activity &&
            old.activityPrincipal === activity.context.principal &&
            typeof old.activityId === "string"
          )
            activity.onOperation(old.activityId);
          return { id: String(old.messageId), replayed: true };
        }
        if (old)
          throw new AppError(
            409,
            "Idempotency key was used for different content",
          );
      }
      throw e;
    }
    if (tracked) activity!.onOperation(tracked.id);
    return { id, replayed: false };
  }
  /** @deprecated Use the runtime dispatcher; retained for existing core consumers. */
  dispatch() {
    return this.dispatcher.dispatch();
  }
  async send(id: string) {
    const msg = await this.store.get<Message>(`MSG#${id}`);
    if (!msg || msg.status !== "queued") return;
    if (Date.now() >= msg.expiresAt) {
      await this.finish(msg, "expired", "Message expired before submission");
      return;
    }
    if ((await this.store.get("SETTINGS"))?.paused) return;
    const sender = await this.store.get<Domain>(
      `DOMAIN#${domainOf(msg.input.from)}`,
    );
    if (
      !sender?.verified ||
      sender.removedAt ||
      (sender.registrationId ?? "legacy") !==
        (msg.senderDomainRegistration ?? "legacy")
    ) {
      await this.finish(
        msg,
        "failed",
        "Sender domain removed or no longer verified before submission",
      );
      return;
    }
    const broadcast = msg.broadcast as BroadcastDelivery | undefined;
    if (broadcast) {
      const campaign = await this.store.get<Broadcast>(
        `BROADCAST#${broadcast.broadcastId}`,
      );
      if (!campaign || campaign.status === "cancelled") {
        await this.finish(
          msg,
          "failed",
          "Broadcast cancelled before submission",
        );
        return;
      }
      const segment = await this.store.get<Audience>(
        `AUDIENCE#${broadcast.audienceId}`,
      );
      if (segment && (segment.schemaVersion ?? 1) < 3)
        await new ContactService(this.store).migrate(segment);
      const membershipMissing =
        !segment ||
        (segment.kind !== "dynamic" &&
          !(await this.store.get(
            `AUDIENCE#${broadcast.audienceId}`,
            `CONTACT#${hash(msg.input.to[0]!)}`,
          )));
      const block = membershipMissing
        ? "unsubscribed"
        : await this.subscriptions.deliveryBlock(msg.input.to[0]!, broadcast);
      if (block) {
        await this.finish(
          msg,
          "failed",
          block === "suppressed"
            ? "Recipient suppressed before submission"
            : "Recipient unsubscribed before submission",
        );
        return;
      }
    } else {
      for (const to of msg.input.to)
        if (await this.store.get(`SUPPRESS#${to}`)) {
          await this.finish(
            msg,
            "failed",
            "Recipient suppressed before submission",
          );
          return;
        }
    }

    try {
      await this.store.patch(
        msg.pk,
        {
          status: "submitting",
          state: "submitting",
          due: Date.now() + 120000,
          attempts: msg.attempts + 1,
        },
        { field: "status", value: "queued" },
      );
    } catch (e) {
      if (conditional(e)) return;
      throw e;
    }
    try {
      const result = await this.transport.send(
        msg.input,
        id,
        broadcast?.unsubscribeUrl,
      );
      if (msg.metricsVersion === 1) {
        try {
          await this.store.transaction([
            this.store.create({
              pk: `METRIC_SUBMISSION#${msg.id}`,
              sk: "META",
              ttl: msg.ttl,
            }),
            ...metricWrite(this.store, msg, {
              [result.captured ? "captured" : "submitted"]: msg.input.to.length,
            }),
          ]);
        } catch (error) {
          if (!(
            conditional(error) &&
            (await this.store.get(`METRIC_SUBMISSION#${msg.id}`))
          ))
            throw error;
        }
      }
      try {
        await this.store.patch(
          msg.pk,
          {
            status: result.captured ? "captured" : "sent",
            providerId: result.id,
            contentPurgedAt: new Date().toISOString(),
            state: "complete",
          },
          { field: "status", value: "submitting" },
          messageContentPaths(msg),
        );
      } catch (e) {
        if (!conditional(e)) throw e;
      } // A feedback event can arrive before the transport returns.
    } catch (e) {
      const name = e instanceof Error ? e.name : "UnknownError";
      const retryable = [
        "TooManyRequestsException",
        "LimitExceededException",
      ].includes(name);
      const rejected = [
        "MessageRejected",
        "MailFromDomainNotVerifiedException",
        "BadRequestException",
        "AccountSuspendedException",
      ].includes(name);
      const status =
        retryable && msg.attempts < 5
          ? "queued"
          : rejected
            ? "failed"
            : "unknown";
      try {
        await this.store.patch(
          msg.pk,
          {
            status,
            ...(status === "queued"
              ? {}
              : { contentPurgedAt: new Date().toISOString() }),
            state: status === "queued" ? "send" : "complete",
            due: Date.now() + Math.min(60000, 1000 * 2 ** msg.attempts),
            error:
              status === "unknown"
                ? "Submission outcome uncertain; no automatic retry"
                : name,
          },
          { field: "status", value: "submitting" },
          status === "queued" ? [] : messageContentPaths(msg),
        );
      } catch (err) {
        if (!conditional(err)) throw err;
      }
    }
  }
  private async finish(msg: Message, status: Message["status"], error: string) {
    try {
      await this.store.patch(
        msg.pk,
        {
          status,
          state: "complete",
          error,
          contentPurgedAt: new Date().toISOString(),
        },
        { field: "status", value: msg.status },
        messageContentPaths(msg),
      );
    } catch (e) {
      if (!conditional(e)) throw e;
    }
  }
  async event(messageId: string, event: DeliveryEvent): Promise<void> {
    if (await this.store.get(`EVENT#${event.id}`)) return;
    const msg = await this.store.get<Message>(`MSG#${messageId}`);
    if (!msg) throw new AppError(404, "Message not found for event");
    const endpoints = await this.store.list<Entity>("webhooks", 5);
    const now = Date.now(),
      expires = Math.floor(now / 1000) + 30 * 86400;
    const events = [...msg.events, event].slice(-100);
    const metric = eventMetric(msg, event);
    const writes: NonNullable<TransactWriteCommandInput["TransactItems"]> = [
      this.store.create({ pk: `EVENT#${event.id}`, sk: "META", ttl: expires }),
      ...metricWrite(this.store, msg, metric.increments),
      {
        Update: {
          TableName: this.config.APP_TABLE,
          Key: { pk: msg.pk, sk: "META" },
          UpdateExpression:
            "SET events = :events, metricOutcomes = :outcomes, #status = :next, #state = :complete, contentPurgedAt = if_not_exists(contentPurgedAt, :purged) REMOVE #input.#html, #input.#text" +
            (msg.broadcast ? ", broadcast.unsubscribeUrl" : ""),
          ConditionExpression: "events = :previous AND #status = :status",
          ExpressionAttributeNames: {
            "#status": "status",
            "#state": "state",
            "#input": "input",
            "#html": "html",
            "#text": "text",
          },
          ExpressionAttributeValues: {
            ":previous": msg.events,
            ":status": msg.status,
            ":events": events,
            ":outcomes": metric.outcomes,
            ":next": nextStatus(msg.status, event),
            ":complete": "complete",
            ":purged": new Date().toISOString(),
          },
        },
      },
    ];
    if (
      event.type === "complained" ||
      (event.type === "bounced" && event.permanent !== false)
    )
      for (const recipient of new Set(
        event.recipients.map((r) => r.toLowerCase()),
      )) {
        if (!msg.input.to.includes(recipient.toLowerCase())) continue;
        writes.push(
          ...(await webhookJobs(
            this.store,
            {
              id: hash(`${event.id}:suppression:${recipient}`),
              type: "suppression.added",
              created_at: event.at,
              data: { email: recipient, reason: event.type },
            },
            endpoints,
          )),
        );
        writes.push({
          Put: {
            TableName: this.config.APP_TABLE,
            Item: {
              pk: `SUPPRESS#${recipient.toLowerCase()}`,
              sk: "META",
              scope: "suppressions",
              sort: new Date(now).toISOString(),
              email: recipient.toLowerCase(),
              reason: event.type,
              createdAt: new Date(now).toISOString(),
            },
          },
        });
      }
    writes.push(
      ...(await webhookJobs(
        this.store,
        {
          id: event.id,
          type: `email.${event.type}`,
          created_at: event.at,
          data: {
            email_id: messageId,
            recipients: event.recipients,
            ...(event.bounceType ? { bounce_type: event.bounceType } : {}),
          },
        },
        endpoints,
      )),
    );
    try {
      await this.store.transaction(writes);
    } catch (e) {
      if (conditional(e) && (await this.store.get(`EVENT#${event.id}`))) return;
      throw e;
    }
  }
}

// Explicit allowlist: never expose the stored hash, primary key, or token on reads/edits.
export function apiKeyMetadata(key: ApiKey) {
  const {
    id,
    name,
    prefix,
    createdAt,
    revoked,
    scopes,
    operationAccess,
    domain,
    lastUsedAt,
    usageTrackingSince,
  } = key;
  return {
    id,
    name,
    prefix,
    createdAt,
    revoked,
    scopes,
    operationAccess,
    domain,
    lastUsedAt,
    usageTrackingSince,
    permission: key.permission ?? "sending",
    revision: key.revision ?? 0,
  };
}
