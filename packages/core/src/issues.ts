import { publicOrigin } from "./origins.js";
import { collectionEdgeWrites } from "./publication-editorial.js";
import { escapeHtml } from "./message-content.js";
import { issueStatus, canDeleteIssue } from "@narada/contracts/issue-state";
import type { IssueStatus } from "@narada/contracts/types";
import { assertApprovalPart } from "./send-approval-context.js";
import { lifecycleJobs } from "./event-outbox.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, emailInput, type Entity } from "./model.js";
import type { Store } from "./store.js";
import { conditional } from "./store.js";
import type { MutationCommit } from "./idempotency.js";
import {
  draftInput,
  broadcastMessageId,
  renderBroadcast,
  type Broadcast,
} from "./broadcast-model.js";
import type { BroadcastService } from "./broadcasts.js";
import {
  PublicationService,
  reserveNewsletterSlug,
  newsletterCommit,
  publicationGuard,
  replaceRevision,
} from "./publications.js";
import {
  issueInput,
  type Issue,
  type IssueDraft,
  type IssueVersion,
  type Publication,
  type PublicationOperation,
  type Channels,
} from "./newsletter-model.js";
import { renderIssue } from "./newsletter-content.js";
export class IssueService {
  constructor(
    readonly store: Store,
    readonly publications: PublicationService,
    readonly broadcasts: BroadcastService,
  ) {}
  async get(publicationId: string, id: string, includeDeleted = false) {
    const issue = await this.store.get<Issue>(`ISSUE#${z.uuid().parse(id)}`);
    if (
      !issue ||
      issue.publicationId !== publicationId ||
      (issue.deletedAt && !includeDeleted)
    )
      throw new AppError(404, "Issue not found");
    return issue;
  }
  async list(
    publicationId: string,
    cursor?: Record<string, unknown>,
    status?: IssueStatus,
  ) {
    await this.publications.get(publicationId);
    const page = await this.store.listPage<Issue>(
      `issues#${publicationId}`,
      20,
      cursor,
    );
    const current = await this.store.getMany<Issue>(
      page.items.map((i) => i.pk),
    );
    const byId = new Map(current.map((i) => [i.id, i]));
    return {
      data: page.items
        .map((i) => byId.get(i.id))
        .filter(
          (i): i is Issue =>
            !!i && !i.deletedAt && (!status || issueStatus(i) === status),
        )
        .map((i) => ({
          id: i.id,
          publicationId: i.publicationId,
          revision: i.revision,
          draft: { title: i.draft.title, slug: i.draft.slug },
          publicVersionId: i.publicVersionId,
          scheduledAt: i.scheduledAt,
          emailReleased: i.emailReleased,
          updatedAt: i.updatedAt,
          status: issueStatus(i),
          canDelete: canDeleteIssue(i),
        })),
      cursor: page.cursor,
    };
  }
  async validateCover(publicationId: string, draft: IssueDraft) {
    if (!draft.coverAssetId) return;
    const asset = await this.store.get(
      `PUBLICATIONLOGO#${publicationId}#${draft.coverAssetId}`,
    );
    if (!asset || asset.publicationId !== publicationId)
      throw new AppError(
        422,
        "Upload the cover image for this publication before using it",
      );
  }
  async delete(
    publicationId: string,
    id: string,
    revision: number,
    commit?: MutationCommit,
    expectedPublicationRevision?: number,
  ) {
    const pub = await this.publications.get(publicationId);
    if (
      expectedPublicationRevision !== undefined &&
      pub.revision !== expectedPublicationRevision
    )
      throw new AppError(409, "Publication changed; reload before continuing");
    const issue = await this.get(publicationId, id);
    this.editable(issue, revision);
    if (!canDeleteIssue(issue))
      throw new AppError(
        409,
        "Only private drafts without publication or delivery history can be deleted",
      );
    const next = {
      ...issue,
      revision: revision + 1,
      deletedAt: new Date().toISOString(),
      // Keep only routing/revision metadata for authorization and receipt replay.
      draft: issueInput.parse({
        title: "Deleted draft",
        slug: issue.draft.slug,
        document: { type: "doc", content: [] },
      }),
    };
    delete next.scope;
    delete next.sort;
    return newsletterCommit(
      this.store,
      [
        publicationGuard(this.store, pub),
        replaceRevision(this.store, next, revision),
      ],
      { id, deleted: true as const },
      commit,
    );
  }
  async active(id: string, expectedRevision?: number) {
    const p = await this.publications.get(id);
    if (expectedRevision !== undefined && p.revision !== expectedRevision)
      throw new AppError(409, "Publication changed; reload before continuing");
    if (p.status !== "active")
      throw new AppError(409, "Activate this publication first");
    return p;
  }
  async create(
    publicationId: string,
    input: unknown,
    commit?: MutationCommit,
    expectedPublicationRevision?: number,
  ) {
    const pub = await this.active(publicationId, expectedPublicationRevision),
      draft = issueInput.parse(input),
      id = randomUUID(),
      now = new Date().toISOString();
    await this.validateCover(publicationId, draft);
    const issue: Issue = {
      pk: `ISSUE#${id}`,
      sk: "META",
      scope: `issues#${publicationId}`,
      sort: now,
      id,
      publicationId,
      draft,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    return newsletterCommit(
      this.store,
      [
        publicationGuard(this.store, pub),
        this.store.create(issue),
        this.reservation(issue),
      ],
      issue,
      commit,
    );
  }
  reservation(issue: Issue) {
    return reserveNewsletterSlug(
      this.store,
      `ISSUESLUG#${issue.publicationId}#${issue.draft.slug}`,
      issue.id,
    );
  }
  async update(
    publicationId: string,
    id: string,
    input: unknown,
    revision: number,
    commit?: MutationCommit,
    expectedPublicationRevision?: number,
  ) {
    const pub = await this.active(publicationId, expectedPublicationRevision),
      issue = await this.get(publicationId, id),
      draft = issueInput.parse({ ...issue.draft, ...issueInput.parse(input) });
    await this.validateCover(publicationId, draft);
    this.editable(issue, revision);
    if (issue.slugLocked && draft.slug !== issue.draft.slug)
      throw new AppError(
        422,
        "Published or scheduled issue URLs cannot change",
      );
    const next = {
      ...issue,
      draft,
      revision: revision + 1,
      updatedAt: new Date().toISOString(),
    };
    const writes: Parameters<Store["transaction"]>[0] = [
      publicationGuard(this.store, pub),
      replaceRevision(this.store, next, revision),
    ];
    if (draft.slug !== issue.draft.slug) writes.push(this.reservation(next));
    return newsletterCommit(this.store, writes, next, commit);
  }
  editable(issue: Issue, revision: number) {
    if (issue.revision !== revision)
      throw new AppError(409, "Issue changed; reload before continuing");
    if (issue.scheduledAt)
      throw new AppError(409, "Cancel the pending schedule before editing");
  }
  draft(pub: Publication, issue: Issue) {
    const content = renderIssue(issue.draft, {
      origin: publicOrigin(this.store.config),
    });
    return draftInput.parse({
      name: issue.draft.title.slice(0, 120),
      audienceId: pub.audienceId,
      topicId: pub.topicId,
      from: pub.settings.from,
      replyTo: pub.settings.replyTo,
      subject: issue.draft.subject || issue.draft.title,
      organization: pub.settings.organization,
      postalAddress: pub.settings.postalAddress,
      ...content,
    });
  }
  async preview(
    publicationId: string,
    id: string,
    expectedPublicationRevision?: number,
  ) {
    const pub = await this.publications.get(publicationId),
      issue = await this.get(publicationId, id),
      draft = this.draft(pub, issue);
    if (
      expectedPublicationRevision !== undefined &&
      pub.revision !== expectedPublicationRevision
    )
      throw new AppError(409, "Publication changed; reload before previewing");
    const audience = await this.broadcasts.audience(pub.audienceId);
    const eligible =
      pub.status === "active"
        ? await this.broadcasts.eligible(
            pub.audienceId,
            audience.contacts,
            pub.topicId,
          )
        : [];
    const web = renderIssue(issue.draft, {
      target: "web",
      origin: publicOrigin(this.store.config),
    });
    if (issue.draft.coverAssetId) {
      const asset = await this.store.get(
        `PUBLICATIONLOGO#${pub.id}#${issue.draft.coverAssetId}`,
      );
      if (!asset) throw new AppError(422, "Cover image is unavailable");
      const url = new URL(
        `/media/${issue.draft.coverAssetId}.${asset.contentType === "image/png" ? "png" : "jpg"}`,
        publicOrigin(this.store.config),
      ).href;
      web.html =
        `<img src="${escapeHtml(url)}" alt="${escapeHtml(issue.draft.coverAlt || "")}" style="max-width:100%;height:auto">` +
        web.html;
    }
    return {
      web,
      email: renderBroadcast(
        draft,
        "#unsubscribe-preview",
        "#preferences-preview",
      ),
      eligible: eligible.length,
      excluded: audience.contacts.length - eligible.length,
      subject: draft.subject,
      from: draft.from,
      url: `/n/${pub.settings.slug}/p/${issue.draft.slug}`,
    };
  }
  async testInput(
    publicationId: string,
    id: string,
    to: string,
    revision: number,
    expectedPublicationRevision?: number,
  ) {
    const pub = await this.active(publicationId, expectedPublicationRevision),
      issue = await this.get(publicationId, id);
    if (issue.revision !== revision)
      throw new AppError(409, "Issue changed; reload before testing");
    const draft = this.draft(pub, issue);
    await this.broadcasts.ready(draft);
    return emailInput.parse({
      from: draft.from,
      reply_to: draft.replyTo || undefined,
      to: z.email().parse(to),
      subject: `[Test] ${draft.subject}`,
      ...renderBroadcast(draft, "#unsubscribe-preview"),
    });
  }
  async test(
    publicationId: string,
    id: string,
    to: string,
    revision: number,
    commit?: MutationCommit,
    expectedPublicationRevision?: number,
  ) {
    return this.broadcasts.emails.accept(
      await this.testInput(
        publicationId,
        id,
        to,
        revision,
        expectedPublicationRevision,
      ),
      "default",
      undefined,
      undefined,
      undefined,
      commit,
    );
  }
  approvalBinding(
    pub: Publication,
    issue: Issue,
    channels: Channels,
    scheduledAt?: number,
  ) {
    return {
      publicationId: pub.id,
      publicationRevision: pub.revision,
      issueId: issue.id,
      revision: issue.revision,
      draft: issue.draft,
      settings: pub.settings,
      channels,
      scheduledAt,
    };
  }
  async publish(
    publicationId: string,
    id: string,
    revision: number,
    channels: Channels,
    scheduledAt?: number,
    commit?: MutationCommit,
    expectedPublicationRevision?: number,
  ) {
    const pub = await this.active(publicationId, expectedPublicationRevision),
      issue = await this.get(publicationId, id);
    this.editable(issue, revision);
    assertApprovalPart(
      "issue",
      this.approvalBinding(pub, issue, channels, scheduledAt),
    );
    const email = channels !== "web",
      now = Date.now();
    if (email && issue.emailReleased)
      throw new AppError(
        409,
        "This issue has already been distributed. Duplicate it to send again",
      );
    if (
      scheduledAt !== undefined &&
      (scheduledAt < now + 1000 || scheduledAt > now + 90 * 86400000)
    )
      throw new AppError(422, "Schedule must be in the next 90 days");
    const operationId = broadcastMessageId(issue.id, String(revision)),
      content = renderIssue(issue.draft, {
        target: "web",
        origin: publicOrigin(this.store.config),
      }),
      timestamp = new Date(now).toISOString();
    const version: IssueVersion = {
      pk: `ISSUEVERSION#${operationId}`,
      sk: "META",
      id: operationId,
      issueId: id,
      publicationId,
      draft: issue.draft,
      ...content,
      settings: pub.settings,
      createdAt: timestamp,
    };
    const operation: PublicationOperation = {
      pk: `PUBLICATIONOP#${operationId}`,
      sk: "META",
      id: operationId,
      publicationId,
      issueId: id,
      versionId: version.id,
      channels,
      broadcastId: email ? operationId : undefined,
      status: scheduledAt ? "pending" : "released",
      state: scheduledAt ? "publication" : "complete",
      due: scheduledAt ?? now,
      scheduledAt: scheduledAt ?? now,
    };
    const next: Issue = {
      ...issue,
      revision: revision + 1,
      slugLocked: true,
      operationId,
      scheduledAt,
      updatedAt: timestamp,
      ...(email
        ? { broadcastId: operationId, emailReleased: !scheduledAt }
        : {}),
    };
    const writes: Parameters<Store["transaction"]>[0] = [
      publicationGuard(this.store, pub),
      this.store.create(version),
      this.store.create(operation),
    ];
    if (!scheduledAt && channels !== "email")
      this.makePublic(next, version, writes);
    writes.push(replaceRevision(this.store, next, revision));
    if (email) {
      const broadcast: Broadcast = {
        pk: `BROADCAST#${operationId}`,
        sk: "META",
        id: operationId,
        scope: "broadcasts",
        sort: timestamp,
        publicationId,
        issueId: id,
        draft: this.draft(pub, issue),
        status: "draft",
        revision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        cursor: 0,
        total: 0,
      };
      const prepared = await this.broadcasts.prepareLaunch(
        broadcast,
        scheduledAt,
        true,
      );
      if (scheduledAt) {
        prepared.broadcast.state = "publication-held";
      }
      writes.push(...prepared.writes);
    }
    if (!scheduledAt)
      writes.push(
        ...(await this.releaseEvents(operation, next.revision, timestamp)),
      );
    return newsletterCommit(this.store, writes, next, commit);
  }
  releaseEvents(
    op: PublicationOperation,
    revision: number,
    at = new Date().toISOString(),
  ) {
    return lifecycleJobs(
      this.store,
      "issue.published",
      op.id,
      {
        publication_id: op.publicationId,
        issue_id: op.issueId,
        version_id: op.versionId,
        release_id: op.id,
        revision,
        channels: op.channels,
        ...(op.broadcastId ? { broadcast_id: op.broadcastId } : {}),
      },
      at,
    );
  }
  makePublic(
    issue: Issue,
    version: IssueVersion,
    writes: Parameters<Store["transaction"]>[0],
  ) {
    issue.publicVersionId = version.id;
    issue.publishedAt ??= new Date().toISOString();
    issue.webUpdatedAt = new Date().toISOString();
    writes.push(...collectionEdgeWrites(this.store, issue));
    writes.push({
      Put: {
        TableName: this.store.config.APP_TABLE,
        Item: {
          pk: `ARCHIVE#${issue.id}`,
          sk: "META",
          scope: `archive#${issue.publicationId}`,
          sort: `${issue.publishedAt}#${issue.id}`,
          id: issue.id,
        },
      },
    });
  }
  async version(id: string) {
    const version = await this.store.get<IssueVersion>(`ISSUEVERSION#${id}`);
    if (!version) throw new AppError(404, "Issue not found");
    return version;
  }
  async run(id: string) {
    const op = await this.store.get<PublicationOperation>(
      `PUBLICATIONOP#${id}`,
    );
    if (!op) {
      await this.archivePending(id);
      return;
    }
    if (op.status !== "pending" || op.scheduledAt > Date.now()) return;
    const pub = await this.publications.get(op.publicationId),
      issue = await this.get(op.publicationId, op.issueId);
    if (issue.operationId !== id || !issue.scheduledAt) return;
    if (pub.status !== "active") {
      await this.cancel(op.publicationId, issue.id, issue.revision);
      return;
    }
    const next = {
      ...issue,
      revision: issue.revision + 1,
      scheduledAt: undefined,
      ...(op.broadcastId ? { emailReleased: true } : {}),
    };
    const writes: Parameters<Store["transaction"]>[0] = [
      publicationGuard(this.store, pub),
      this.operationWrite(op, "released"),
    ];
    if (op.channels !== "email")
      this.makePublic(next, await this.version(op.versionId), writes);
    writes.push(replaceRevision(this.store, next, issue.revision));
    if (op.broadcastId)
      writes.push(this.releaseBroadcast(op.broadcastId, false));
    writes.push(...(await this.releaseEvents(op, next.revision)));
    try {
      await this.store.transaction(writes);
    } catch (e) {
      if (!conditional(e)) throw e;
    }
  }
  /** The archived topic blocks delivery immediately; this durable job cleans up pending work in bounded pages. */
  async archivePending(id: string) {
    const pub = await this.store.get<Publication>(`PUBLICATION#${id}`);
    if (!pub || pub.status !== "archived" || pub.state !== "publication")
      return;
    const page = await this.store.listPage<Issue>(
      `issues#${id}`,
      20,
      pub.archiveCursor as Record<string, unknown> | undefined,
    );
    for (const row of page.items) {
      const issue = await this.get(id, row.id);
      if (issue.scheduledAt) {
        try {
          await this.cancel(id, issue.id, issue.revision);
        } catch (e) {
          if (!(e instanceof AppError && e.status === 409)) throw e;
        }
      } else if (issue.broadcastId) {
        const broadcast = await this.broadcasts.get(issue.broadcastId);
        if (["scheduled", "sending"].includes(broadcast.status)) {
          try {
            await this.store.patch(
              broadcast.pk,
              {
                status: "cancelled",
                state: "complete",
                runToken: randomUUID(),
                revision: broadcast.revision + 1,
              },
              { field: "revision", value: broadcast.revision },
            );
          } catch (e) {
            if (!conditional(e)) throw e;
          }
        }
      }
    }
    // A retry may repeat a page, but cancellations are fenced and safe to repeat.
    await this.store.patch(
      pub.pk,
      {
        state: page.cursor ? "publication" : "complete",
        due: Date.now() + 1000,
        archiveCursor: page.cursor,
      },
      { field: "revision", value: pub.revision },
    );
  }
  operationWrite(
    op: PublicationOperation,
    status: PublicationOperation["status"],
  ) {
    return {
      Put: {
        TableName: this.store.config.APP_TABLE,
        Item: { ...op, status, state: "complete" },
        ConditionExpression: "#status = :pending",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":pending": "pending" },
      },
    };
  }
  releaseBroadcast(id: string, cancel: boolean) {
    return {
      Update: {
        TableName: this.store.config.APP_TABLE,
        Key: { pk: `BROADCAST#${id}`, sk: "META" },
        UpdateExpression: "SET #state = :state, #status = :status, due = :due",
        ConditionExpression: "#state = :held",
        ExpressionAttributeNames: { "#state": "state", "#status": "status" },
        ExpressionAttributeValues: {
          ":state": cancel ? "complete" : "broadcast",
          ":status": cancel ? "cancelled" : "sending",
          ":due": Date.now(),
          ":held": "publication-held",
        },
      },
    };
  }
  async cancel(
    publicationId: string,
    id: string,
    revision: number,
    commit?: MutationCommit,
  ) {
    const issue = await this.get(publicationId, id);
    if (issue.revision !== revision || !issue.scheduledAt || !issue.operationId)
      throw new AppError(409, "The schedule has changed or already published");
    const op = (await this.store.get<PublicationOperation>(
      `PUBLICATIONOP#${issue.operationId}`,
    ))!;
    const next = {
      ...issue,
      revision: revision + 1,
      scheduledAt: undefined,
      operationId: undefined,
      ...(op.broadcastId ? { broadcastId: undefined } : {}),
    };
    const writes: Parameters<Store["transaction"]>[0] = [
      replaceRevision(this.store, next, revision),
      this.operationWrite(op, "cancelled"),
    ];
    if (op.broadcastId)
      writes.push(this.releaseBroadcast(op.broadcastId, true));
    return newsletterCommit(this.store, writes, next, commit);
  }
  async withdraw(
    publicationId: string,
    id: string,
    revision: number,
    commit?: MutationCommit,
  ) {
    const issue = await this.get(publicationId, id);
    this.editable(issue, revision);
    const next = {
      ...issue,
      revision: revision + 1,
      publicVersionId: undefined,
    };
    return newsletterCommit(
      this.store,
      [
        replaceRevision(this.store, next, revision),
        {
          Delete: {
            TableName: this.store.config.APP_TABLE,
            Key: { pk: `ARCHIVE#${id}`, sk: "META" },
          },
        },
      ],
      next,
      commit,
    );
  }
  async publicIssue(pub: Publication, slug: string) {
    const reservation = await this.store.get(`ISSUESLUG#${pub.id}#${slug}`);
    if (!reservation) throw new AppError(404, "Issue not found");
    const issue = await this.get(pub.id, String(reservation.id));
    if (!issue.publicVersionId || issue.draft.slug !== slug)
      throw new AppError(404, "Issue not found");
    const version = await this.version(issue.publicVersionId);
    return {
      title: version.draft.title,
      subtitle: version.draft.subtitle,
      slug,
      html: version.html,
      coverAssetId: version.draft.coverAssetId,
      coverAlt: version.draft.coverAlt,
      author: version.settings.author,
      publishedAt: issue.publishedAt,
      updatedAt: issue.webUpdatedAt,
    };
  }
  async archive(pub: Publication, cursor?: Record<string, unknown>) {
    const page = await this.store.listPage<Entity>(
      `archive#${pub.id}`,
      20,
      cursor,
    );
    const issues = await this.store.getMany<Issue>(
      page.items.map((i) => `ISSUE#${i.id}`),
    );
    const byId = new Map(issues.map((i) => [i.id, i]));
    const data = [];
    for (const row of page.items) {
      const issue = byId.get(String(row.id));
      if (issue?.publicVersionId) {
        const version = await this.version(issue.publicVersionId);
        data.push({
          title: version.draft.title,
          subtitle: version.draft.subtitle,
          slug: version.draft.slug,
          publishedAt: issue.publishedAt,
          coverAssetId: version.draft.coverAssetId,
          coverAlt: version.draft.coverAlt,
        });
      }
    }
    return { data, cursor: page.cursor };
  }
}
