import { publicOrigin } from "./origins.js";
import { assertApprovalPart } from "./send-approval-context.js";
import { lifecycleJobs } from "./event-outbox.js";
import {
  commitMutation,
  commitRevisionPatch,
  type MutationCommit,
} from "./idempotency.js";
import { ContactService } from "./contacts.js";
import { contactKey, type SharedContact } from "./audience-model.js";
import {
  personalize,
  personalizationKeys,
  personalizationValues,
} from "./personalization.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  emailInput,
  domainOf,
  type Domain,
  type Entity,
  type Message,
} from "./model.js";
import { conditional, type Store } from "./store.js";
import type { Config } from "./config.js";
import type { EmailService } from "./service.js";
import {
  MAX_CONTACTS,
  memberAddedAt,
  draftInput,
  importContacts,
  unsubscribeToken,
  renderBroadcast,
  broadcastMessageId,
  type Audience,
  type Broadcast,
  type Snapshot,
  type DraftInput,
} from "./broadcast-model.js";
export class BroadcastService {
  constructor(
    readonly config: Config,
    readonly store: Store,
    readonly emails: EmailService,
    readonly directory = new ContactService(store, emails.subscriptions),
    readonly subscriptions = directory.subscriptions,
  ) {}
  async audience(id: string) {
    return this.directory.audience(id);
  }
  async createAudience(name: string, commit?: MutationCommit) {
    return this.directory.createSegment({ name, kind: "manual" }, commit);
  }
  async importAudience(
    id: string,
    csv: string,
    source: string,
    topicIds: string[] = [],
  ) {
    return this.directory.import(id, csv, source, topicIds);
  }
  audienceDetail(id: string) {
    return this.directory.audienceDetail(id);
  }
  contacts() {
    return this.directory.directoryView();
  }
  unsubscribe(token: string) {
    return this.subscriptions.unsubscribe(
      token,
      this.config.BETTER_AUTH_SECRET,
    );
  }
  async get(id: string) {
    const item = await this.store.get<Broadcast>(`BROADCAST#${id}`);
    if (!item) throw new AppError(404, "Broadcast not found");
    return item;
  }
  async create(input: unknown, commit?: MutationCommit) {
    const draft = draftInput.parse(input),
      id = randomUUID(),
      now = new Date().toISOString();
    const item: Broadcast = {
      pk: `BROADCAST#${id}`,
      sk: "META",
      scope: "broadcasts",
      sort: now,
      id,
      draft,
      status: "draft",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      cursor: 0,
      total: 0,
    };
    return commitMutation(this.store, [this.store.create(item)], item, commit);
  }
  async update(
    id: string,
    input: unknown,
    revision: number,
    commit?: MutationCommit,
  ) {
    const current = await this.get(id);
    if (current.status !== "draft")
      throw new AppError(409, "Only drafts can be edited");
    if (current.revision !== revision)
      throw new AppError(409, "Draft changed; reload before saving");
    try {
      await commitRevisionPatch(
        this.store,
        current,
        {
          draft: draftInput.parse(input),
          revision: revision + 1,
          updatedAt: new Date().toISOString(),
        },
        revision,
        commit,
      );
    } catch (e) {
      if (conditional(e))
        throw new AppError(409, "Draft changed; reload before saving");
      throw e;
    }
    return this.get(id);
  }
  async ready(draft: DraftInput) {
    if (!draft.organization.trim() || !draft.postalAddress.trim())
      throw new AppError(
        422,
        "Add your organization and postal address for the email footer",
      );
    emailInput.parse({
      from: draft.from,
      reply_to: draft.replyTo || undefined,
      to: "preview@example.com",
      subject: draft.subject,
      text: draft.text || undefined,
      html: draft.html || undefined,
    });
    const sender = await this.store.get<Domain>(
      `DOMAIN#${domainOf(draft.from)}`,
    );
    if (!sender?.verified || sender.removedAt)
      throw new AppError(422, "Verify the sender domain first");
  }
  async preview(id: string, previewEmail?: string) {
    const { draft } = await this.get(id);
    const contacts = draft.audienceId
      ? (await this.audience(draft.audienceId)).contacts
      : [];
    const eligible = await this.eligible(
      draft.audienceId,
      contacts,
      draft.topicId,
    );
    const chosen = previewEmail || eligible[0]?.email;
    const contact = chosen ? await this.directory.contact(chosen) : undefined;
    const values = personalizationValues(
      draft,
      contact,
      await this.directory.properties(),
    );
    const rendered = personalize(draft, values);
    return {
      ...renderBroadcast(rendered, "#unsubscribe-preview"),
      subject: rendered.subject,
      previewEmail: chosen,
      eligible: eligible.length,
      total: contacts.length,
      excluded: contacts.length - eligible.length,
    };
  }
  eligible(
    audienceId: string,
    contacts: Audience["contacts"],
    topicId?: string,
  ) {
    return this.subscriptions.eligible({ audienceId, topicId }, contacts);
  }
  async start(
    id: string,
    revision: number,
    scheduledAt?: number,
    commit?: MutationCommit,
  ) {
    const broadcast = await this.get(id);
    if (
      broadcast.publicationId ||
      broadcast.status !== "draft" ||
      broadcast.revision !== revision
    )
      throw new AppError(409, "Broadcast changed; reload before sending");
    const prepared = await this.prepareLaunch(broadcast, scheduledAt);
    try {
      return await commitMutation(
        this.store,
        prepared.writes,
        prepared.broadcast,
        commit,
      );
    } catch (e) {
      if (conditional(e))
        throw new AppError(409, "Broadcast already started or changed");
      throw e;
    }
  }
  async reviewLaunch(draft: DraftInput, scheduledAt?: number, managed = false) {
    if ((await this.store.get("SETTINGS"))?.paused)
      throw new AppError(503, "Sending is paused");
    const now = Date.now();
    if (
      scheduledAt !== undefined &&
      (scheduledAt < now + 1000 || scheduledAt > now + 90 * 86400000)
    )
      throw new AppError(422, "Schedule must be in the next 90 days");
    await this.ready(draft);
    const audience = await this.audience(draft.audienceId);
    if (audience.kind === "dynamic" && !draft.topicId)
      throw new AppError(422, "Choose a topic for a dynamic segment");
    const contacts = await this.eligible(
      audience.id,
      audience.contacts,
      draft.topicId,
    );
    if (contacts.length > MAX_CONTACTS)
      throw new AppError(
        422,
        "A broadcast supports up to 1,000 recipients; narrow the segment rules",
      );
    if (!contacts.length)
      throw new AppError(
        422,
        "This audience has no subscribed, unsuppressed recipients",
      );
    if (
      Buffer.byteLength(
        JSON.stringify(contacts.map(({ email, name }) => ({ email, name }))),
      ) > 300000
    )
      throw new AppError(
        422,
        "Recipient snapshot exceeds 300 KB; use a smaller segment",
      );
    if (audience.publicationId && !managed)
      throw new AppError(
        422,
        "Publish issues from Newsletters to use this managed audience",
      );
    const keys = personalizationKeys(draft);
    const profiles = new Map(
      (
        await this.store.getMany<SharedContact>(
          keys.length ? contacts.map((c) => contactKey(c.email)) : [],
        )
      ).map((c) => [c.email, c]),
    );
    const definitions = keys.length ? await this.directory.properties() : [];
    return {
      draft,
      scheduledAt,
      audienceId: audience.id,
      contacts: contacts
        .map(({ email, name }) => ({
          email,
          name,
          values: keys.length
            ? personalizationValues(draft, profiles.get(email), definitions)
            : {},
        }))
        .sort((a, b) => a.email.localeCompare(b.email)),
    };
  }
  async prepareLaunch(
    broadcast: Broadcast,
    scheduledAt?: number,
    managed = false,
  ) {
    const { id, revision } = broadcast;
    const plan = await this.reviewLaunch(broadcast.draft, scheduledAt, managed);
    assertApprovalPart("audience", plan);
    const { contacts } = plan;
    const audience = { id: plan.audienceId };
    const now = Date.now();
    const keys = personalizationKeys(broadcast.draft);
    let renderToken: string | undefined;
    if (keys.length) {
      renderToken = randomUUID();
      const frozen = contacts.map((c) => {
        const values = c.values;
        const rendered = personalize(broadcast.draft, values);
        emailInput.parse({
          from: rendered.from,
          to: c.email,
          subject: rendered.subject,
          ...renderBroadcast(
            rendered,
            new URL(
              `/api/unsubscribe/${unsubscribeToken(this.config.BETTER_AUTH_SECRET, audience.id, c.email, broadcast.draft.topicId)}`,
              publicOrigin(this.config),
            ).href,
          ),
        });
        return {
          pk: `RENDER#${id}#${renderToken}#${broadcastMessageId(id, c.email)}`,
          sk: "META",
          values,
          ttl: Math.ceil((scheduledAt ?? now) / 1000) + 30 * 86400,
        };
      });
      await this.store.putMany(frozen);
    }
    const updated: Broadcast = {
      ...broadcast,
      status: scheduledAt ? "scheduled" : "sending",
      state: "broadcast",
      due: scheduledAt ?? now,
      scheduledAt: scheduledAt ?? now,
      revision: revision + 1,
      total: contacts.length,
      updatedAt: new Date(now).toISOString(),
    };
    return {
      broadcast: updated,
      writes: [
        {
          Put: {
            TableName: this.config.APP_TABLE,
            Item: updated,
            ...(managed
              ? { ConditionExpression: "attribute_not_exists(pk)" }
              : {
                  ConditionExpression:
                    "#revision = :revision AND #status = :draft",
                  ExpressionAttributeNames: {
                    "#revision": "revision",
                    "#status": "status",
                  },
                  ExpressionAttributeValues: {
                    ":revision": revision,
                    ":draft": "draft",
                  },
                }),
          },
        },
        this.store.create({
          pk: `SNAPSHOT#${id}`,
          sk: "META",
          audienceId: audience.id,
          renderToken,
          contacts: contacts.map(({ email, name }) => ({ email, name })),
        }),
      ],
    };
  }
  async cancel(id: string, commit?: MutationCommit) {
    const current = await this.get(id);
    if (current.publicationId)
      throw new AppError(409, "Manage issue delivery from Newsletters");
    if (!["scheduled", "sending"].includes(current.status))
      throw new AppError(409, "Only active broadcasts can be cancelled");
    try {
      await commitRevisionPatch(
        this.store,
        current,
        {
          status: "cancelled",
          runToken: randomUUID(),
          state: "complete",
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        },
        current.revision,
        commit,
      );
    } catch (e) {
      if (conditional(e))
        throw new AppError(409, "Broadcast changed; try again");
      throw e;
    }
    return this.get(id);
  }
  async testInput(id: string, to: string, previewEmail?: string) {
    const broadcast = await this.get(id);
    await this.ready(broadcast.draft);
    const rendered = await this.preview(id, previewEmail);
    return emailInput.parse({
      from: broadcast.draft.from,
      reply_to: broadcast.draft.replyTo || undefined,
      to: z.email().parse(to),
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
    });
  }
  async test(
    id: string,
    to: string,
    previewEmail?: string,
    commit?: MutationCommit,
  ) {
    return this.emails.accept(
      await this.testInput(id, to, previewEmail),
      "default",
      undefined,
      undefined,
      undefined,
      commit,
    );
  }
  async results(id: string) {
    const broadcast = await this.get(id),
      snapshot = await this.store.get<Snapshot>(`SNAPSHOT#${id}`);
    if (!snapshot) return { broadcast, counts: {}, recipients: [] };
    const messages = await this.store.getMany<Message>(
      snapshot.contacts.map((c) => `MSG#${broadcastMessageId(id, c.email)}`),
      ["pk", "id", "status", "error"],
    );
    const byId = new Map(messages.map((m) => [m.id, m]));
    const counts: Record<string, number> = {};
    const recipients = snapshot.contacts.map((c) => {
      const messageId = broadcastMessageId(id, c.email),
        msg = byId.get(messageId);
      const status =
        msg?.status ??
        (broadcast.status === "cancelled"
          ? "cancelled"
          : broadcast.status === "completed"
            ? "history expired"
            : "pending");
      counts[status] = (counts[status] ?? 0) + 1;
      return { ...c, messageId, status, error: msg?.error };
    });
    return { broadcast, counts, recipients };
  }
  async run(id: string) {
    const broadcast = await this.get(id);
    if (
      !["scheduled", "sending"].includes(broadcast.status) ||
      broadcast.state !== "broadcast" ||
      Number(broadcast.scheduledAt) > Date.now()
    )
      return;
    if ((await this.store.get("SETTINGS"))?.paused) return;
    if (
      broadcast.publicationId &&
      (await this.store.get(`PUBLICATION#${broadcast.publicationId}`))
        ?.status !== "active"
    ) {
      await this.store.patch(
        broadcast.pk,
        { status: "cancelled", state: "complete" },
        { field: "revision", value: broadcast.revision },
      );
      return;
    }
    const token = randomUUID();
    try {
      await this.store.patch(
        broadcast.pk,
        {
          state: "broadcast-running",
          status: "sending",
          runToken: token,
          due: Date.now() + 120000,
        },
        { field: "state", value: "broadcast" },
      );
    } catch (e) {
      if (conditional(e)) return;
      throw e;
    }
    const snapshot = await this.store.get<Snapshot>(`SNAPSHOT#${id}`);
    if (!snapshot) throw new Error("Missing broadcast recipient snapshot");
    let cursor = broadcast.cursor;
    try {
      for (const contact of snapshot.contacts.slice(cursor, cursor + 20)) {
        const current = await this.get(id);
        if (current.status === "cancelled" || current.runToken !== token)
          return;
        const messageId = broadcastMessageId(id, contact.email);
        const url = new URL(
          `/api/unsubscribe/${unsubscribeToken(this.config.BETTER_AUTH_SECRET, snapshot.audienceId, contact.email, broadcast.draft.topicId)}`,
          publicOrigin(this.config),
        ).href;
        let personalized = broadcast.draft;
        if (snapshot.renderToken) {
          const frozen = await this.store.get(
            `RENDER#${id}#${snapshot.renderToken}#${messageId}`,
          );
          if (!frozen) throw new Error("Personalization snapshot is missing");
          personalized = personalize(
            broadcast.draft,
            frozen.values as Record<string, string>,
          );
        }
        const input = emailInput.parse({
          from: broadcast.draft.from,
          reply_to: broadcast.draft.replyTo || undefined,
          to: contact.email,
          subject: personalized.subject,
          ...renderBroadcast(personalized, url, `${url}?preferences=1`),
          expires_in: 86400,
        });
        // Bypass acceptance suppression here: the delivery worker records a failed result if eligibility changed after the snapshot.
        await this.emails.accept(input, "default", undefined, {
          broadcastId: id,
          audienceId: snapshot.audienceId,
          topicId: broadcast.draft.topicId || undefined,
          unsubscribeUrl: url,
          messageId,
        });
        cursor++;
      }
      const result =
        cursor === snapshot.contacts.length
          ? await this.results(id)
          : undefined;
      const pending =
        result?.recipients.some((r) =>
          ["pending", "queued", "submitting"].includes(r.status),
        ) ?? true;
      const updatedAt = new Date().toISOString();
      // Completion and its event share the lease-fenced transaction. Repeated workers cannot emit it twice.
      await this.store.transaction([
        {
          Update: {
            TableName: this.store.config.APP_TABLE,
            Key: { pk: broadcast.pk, sk: "META" },
            ConditionExpression:
              "runToken = :token AND #state = :running AND #status = :sending",
            UpdateExpression:
              "SET #cursor = :cursor, #state = :state, #status = :status, due = :due, updatedAt = :at, #counts = :counts, #error = :error",
            ExpressionAttributeNames: {
              "#cursor": "cursor",
              "#state": "state",
              "#status": "status",
              "#counts": "counts",
              "#error": "error",
            },
            ExpressionAttributeValues: {
              ":token": token,
              ":running": "broadcast-running",
              ":sending": "sending",
              ":cursor": cursor,
              ":state": pending ? "broadcast" : "complete",
              ":status": pending ? "sending" : "completed",
              ":due":
                Date.now() + (cursor < snapshot.contacts.length ? 1000 : 5000),
              ":at": updatedAt,
              ":counts": result?.counts ?? broadcast.counts ?? {},
              ":error": "",
            },
          },
        },
        ...(!pending
          ? await lifecycleJobs(
              this.store,
              "broadcast.completed",
              id,
              {
                broadcast_id: id,
                ...(broadcast.publicationId
                  ? {
                      publication_id: broadcast.publicationId,
                      issue_id: broadcast.issueId,
                    }
                  : {}),
                total: snapshot.contacts.length,
                counts: result!.counts,
              },
              updatedAt,
            )
          : []),
      ]);
      if (pending)
        await this.emails.queues.send(
          "work",
          { kind: "broadcast", id },
          cursor < snapshot.contacts.length ? 1 : 10,
        );
    } catch (e) {
      // Releasing the lease lets the durable outbox retry; fixed message IDs make repeated expansion safe.
      const current = await this.get(id);
      if (current.status === "cancelled" || current.status === "completed")
        return;
      try {
        await this.store.patch(
          broadcast.pk,
          {
            cursor,
            state: "broadcast",
            due: Date.now() + 10000,
            error: e instanceof Error ? e.message : "Expansion failed",
          },
          { field: "runToken", value: token },
        );
      } catch (error) {
        if (!conditional(error)) throw error;
      }
      throw e;
    }
  }
}
