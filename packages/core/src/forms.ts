import { publicOrigin } from "./origins.js";
import { lifecycleJobs } from "./event-outbox.js";
import { commitMutation, type MutationCommit } from "./idempotency.js";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, hash, domainOf, emailInput, type Domain } from "./model.js";
import { conditional, type Store } from "./store.js";
import type { Config } from "./config.js";
import type { EmailService } from "./service.js";
import { ContactService } from "./contacts.js";
import {
  formInput,
  formDraftInput,
  validateAnswers,
  type FormContent,
} from "./form-content.js";
import type { FormRecord, FormVersion, FormResponse } from "./form-model.js";
import { createRateLimitStorage } from "./rate-limit.js";

export class FormService {
  constructor(
    readonly store: Store,
    readonly config: Config,
    readonly emailService: EmailService,
    readonly directory = new ContactService(store, emailService.subscriptions),
    readonly subscriptions = directory.subscriptions,
  ) {}
  async get(id: string) {
    const row = await this.store.get<FormRecord>(`FORM#${z.uuid().parse(id)}`);
    if (!row) throw new AppError(404, "Form not found");
    return row;
  }
  async version(id: string, version: number) {
    const row = await this.store.get<FormVersion>(
      `FORM#${id}`,
      `VERSION#${version}`,
    );
    if (!row) throw new AppError(404, "Published form not found");
    return row;
  }
  async create(input: unknown, commit?: MutationCommit) {
    const draft = formInput.parse(input),
      id = randomUUID(),
      now = new Date().toISOString();
    const row: FormRecord = {
      pk: `FORM#${id}`,
      sk: "META",
      scope: "forms",
      sort: now,
      id,
      draft,
      revision: 0,
      version: 0,
      accepting: false,
      createdAt: now,
      updatedAt: now,
    };
    return commitMutation(this.store, [this.store.create(row)], row, commit);
  }
  async update(
    id: string,
    input: unknown,
    revision: number,
    commit?: MutationCommit,
  ) {
    const current = await this.get(id),
      draft = formDraftInput.parse(input);
    if (current.publicationId)
      throw new AppError(409, "Manage this form from Newsletters");
    return this.save(
      {
        ...current,
        draft,
        revision: revision + 1,
        updatedAt: new Date().toISOString(),
      },
      revision,
      commit,
    );
  }
  private async save<T extends FormRecord | FormResponse>(
    row: T,
    revision: number,
    commit?: MutationCommit,
  ): Promise<T> {
    try {
      return await commitMutation(
        this.store,
        [
          {
            Put: {
              TableName: this.config.APP_TABLE,
              Item: row,
              ConditionExpression: "revision = :revision",
              ExpressionAttributeValues: { ":revision": revision },
            },
          },
          ...("formId" in row &&
          (row.status === "complete" || row.status === "failed")
            ? await this.responseEvents(row as FormResponse)
            : []),
        ],
        row,
        commit,
      );
    } catch (error) {
      if (conditional(error))
        throw new AppError(409, "Form changed; reload before trying again");
      throw error;
    }
  }
  async patch(pk: string, fields: Record<string, unknown>, revision: number) {
    try {
      await this.store.patch(pk, fields, {
        field: "revision",
        value: revision,
      });
    } catch (e) {
      if (conditional(e))
        throw new AppError(409, "Form changed; reload before trying again");
      throw e;
    }
  }
  async publish(id: string, revision: number, commit?: MutationCommit) {
    const current = await this.get(id),
      content = formInput.parse(current.draft);
    if (current.publicationId)
      throw new AppError(409, "Manage this form from Newsletters");
    if (current.revision !== revision)
      throw new AppError(409, "Form changed; reload before publishing");
    if (content.syncContacts || content.acknowledgment) {
      emailInput.parse({
        from: content.from,
        to: "validation@example.com",
        subject: "Form",
        text: "Form",
      });
      const domain = await this.store.get<Domain>(
        `DOMAIN#${domainOf(content.from)}`,
      );
      if (!domain?.verified || domain.removedAt)
        throw new AppError(422, "Choose a sender from a verified domain");
    }
    if (
      content.kind === "signup" &&
      (!content.syncContacts || (!content.topicId && !content.audienceId))
    )
      throw new AppError(
        422,
        "Signup forms need contact sync and an audience or topic for confirmed subscribers",
      );
    if (content.audienceId) await this.destinationAudience(content.audienceId);
    if (content.syncContacts) {
      const properties = await this.directory.properties();
      for (const q of content.questions.filter((q) => q.property)) {
        if (["email"].includes(q.property))
          throw new AppError(
            422,
            "The email question identifies the contact automatically",
          );
        const target = ["name", "first_name", "last_name"].includes(q.property)
          ? { type: "string" }
          : properties.find((p) => p.key === q.property);
        if (
          !target ||
          target.type !== (q.type === "rating" ? "number" : "string")
        )
          throw new AppError(
            422,
            `Choose a compatible contact property for ${q.label}`,
          );
      }
    }
    if (content.topicId) {
      const topic = await this.directory.topic(content.topicId);
      if (!topic.active || topic.visibility !== "public")
        throw new AppError(422, "Choose an active public topic");
    }
    const next: FormRecord = {
      ...current,
      accepting: true,
      version: current.version + 1,
      revision: revision + 1,
      publishedRevision: revision + 1,
      updatedAt: new Date().toISOString(),
    };
    try {
      await commitMutation(
        this.store,
        [
          this.store.create({
            pk: current.pk,
            sk: `VERSION#${next.version}`,
            version: next.version,
            content,
          }),
          {
            Put: {
              TableName: this.config.APP_TABLE,
              Item: next,
              ConditionExpression: "revision = :revision",
              ExpressionAttributeValues: { ":revision": revision },
            },
          },
        ],
        next,
        commit,
      );
    } catch (e) {
      if (conditional(e))
        throw new AppError(409, "Form changed; reload before publishing");
      throw e;
    }
    return next;
  }
  async close(id: string, revision: number, commit?: MutationCommit) {
    const current = await this.get(id);
    if (current.publicationId)
      throw new AppError(409, "Manage this form from Newsletters");
    return this.save(
      { ...current, accepting: false, revision: revision + 1 },
      revision,
      commit,
    );
  }
  private async destinationAudience(id: string) {
    const audience = await this.directory.audience(id);
    if (audience.kind === "dynamic" || audience.publicationId)
      throw new AppError(
        422,
        "Choose a manual audience that is not managed by Newsletters",
      );
    return audience;
  }
  async publicForm(id: string) {
    const form = await this.get(id);
    if (!form.accepting || !form.version)
      throw new AppError(404, "This form is not accepting responses");
    return { form, published: await this.version(id, form.version) };
  }
  async response(id: string) {
    const row = await this.store.get<FormResponse>(`FORMRESPONSE#${id}`);
    if (!row) throw new AppError(404, "Response not found");
    return row;
  }
  responseEvents(row: FormResponse, received = false) {
    const data = {
      form_id: row.formId,
      response_id: row.id,
      version: row.version,
      revision: row.revision,
      status: row.status,
    };
    return Promise.all([
      ...(received
        ? [
            lifecycleJobs(
              this.store,
              "form.response.received",
              row.id,
              data,
              row.createdAt,
            ),
          ]
        : []),
      ...(row.status === "complete" || row.status === "failed"
        ? [
            lifecycleJobs(
              this.store,
              row.status === "complete"
                ? "form.response.completed"
                : "form.response.failed",
              `${row.id}:${row.revision}`,
              data,
            ),
          ]
        : []),
    ]).then((writes) => writes.flat());
  }
  async submit(formId: string, input: unknown) {
    const data = z
      .object({
        version: z.number().int().positive(),
        submissionId: z.uuid(),
        answers: z.unknown(),
        website: z.string().max(500).default(""),
      })
      .strict()
      .parse(input);
    if (data.website) throw new AppError(422, "Unable to submit this response");
    const id = hash(`${formId}:${data.submissionId}`),
      digest = hash(
        JSON.stringify({ version: data.version, answers: data.answers }),
      );
    const old = await this.store.get<FormResponse>(`FORMRESPONSE#${id}`);
    if (old) {
      if (old.digest !== digest)
        throw new AppError(
          409,
          "This submission was already received with different answers",
        );
      return { ok: true };
    }
    const { form, published } = await this.publicForm(formId);
    if (form.publicationId) {
      const limiter = createRateLimitStorage(this.store);
      const limit = await limiter.consume(
        `newsletter-confirmations:${form.publicationId}`,
        { window: 3600, max: 300 },
      );
      if (!limit.allowed) throw new AppError(429, "Please try again later");
    }
    if (data.version !== form.version)
      throw new AppError(
        409,
        "This form has changed. Reload it before submitting",
      );
    let answers;
    try {
      answers = validateAnswers(published.content, data.answers);
    } catch (e) {
      throw new AppError(
        422,
        e instanceof Error ? e.message : "Invalid answers",
      );
    }
    const content = published.content;
    const emailQuestion = content.questions.find((q) => q.type === "email"),
      email = emailQuestion
        ? (answers[emailQuestion.id] as string | undefined)
        : undefined;
    if (email && (content.syncContacts || content.acknowledgment)) {
      const limit = await createRateLimitStorage(this.store).consume(
        `form-email:${email}`,
        { window: 3600, max: 3 },
      );
      if (!limit.allowed)
        throw new AppError(
          429,
          "Please wait before submitting another response with this email address",
        );
    }
    const now = new Date().toISOString(),
      pending = content.syncContacts || content.acknowledgment;
    const row: FormResponse = {
      pk: `FORMRESPONSE#${id}`,
      sk: "META",
      scope: `formResponses#${formId}`,
      sort: `${now}#${id}`,
      id,
      formId,
      version: form.version,
      answers,
      digest,
      email,
      createdAt: now,
      status: pending ? "pending" : "complete",
      state: pending ? "form" : "complete",
      due: Date.now(),
      attempts: 0,
      availableAt: 0,
      revision: 0,
    };
    try {
      await this.store.transaction([
        this.store.create(row),
        ...(await this.responseEvents(row, true)),
        {
          ConditionCheck: {
            TableName: this.config.APP_TABLE,
            Key: { pk: form.pk, sk: "META" },
            ConditionExpression: "accepting = :yes AND #v = :version",
            ExpressionAttributeNames: { "#v": "version" },
            ExpressionAttributeValues: {
              ":yes": true,
              ":version": form.version,
            },
          },
        },
      ]);
    } catch (e) {
      if (conditional(e)) {
        const saved = await this.store.get<FormResponse>(row.pk);
        if (saved?.digest === digest) return { ok: true };
        throw new AppError(
          409,
          "The form or submission changed. Reload before trying again",
        );
      }
      throw e;
    }
    return { ok: true };
  }
  token(row: FormResponse) {
    const payload = `${row.id}.${Date.parse(row.createdAt) + 86400000}`;
    return `${payload}.${createHmac("sha256", this.config.BETTER_AUTH_SECRET).update(`form:${payload}`).digest("base64url")}`;
  }
  async confirmation(token: string) {
    const [id, expires, signature, extra] = token.split(".");
    if (!id || !expires || !signature || extra || !/^[a-f0-9]{64}$/.test(id))
      throw new AppError(400, "Invalid confirmation link");
    const expected = createHmac("sha256", this.config.BETTER_AUTH_SECRET)
      .update(`form:${id}.${expires}`)
      .digest("base64url");
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new AppError(400, "Invalid confirmation link");
    const row = await this.response(id);
    if (row.verifiedAt && !(await this.get(row.formId)).publicationId)
      return row;
    if (!Number.isFinite(Number(expires)) || Date.now() > Number(expires))
      throw new AppError(
        410,
        "This confirmation link has expired. Please submit the form again",
      );
    return row;
  }
  async confirm(token: string) {
    const row = await this.confirmation(token);
    if (row.verifiedAt) return { ok: true };
    await this.patch(
      row.pk,
      {
        verifiedAt: new Date().toISOString(),
        state: "form",
        status: "pending",
        attempts: 0,
        availableAt: 0,
        error: "",
        due: Date.now(),
        revision: row.revision + 1,
      },
      row.revision,
    );
    return { ok: true };
  }
  async sync(row: FormResponse, content: FormContent): Promise<FormResponse> {
    if (!row.email || !row.verifiedAt || row.syncedAt) return row;
    const managedForm = await this.get(row.formId);
    if (
      managedForm.publicationId &&
      (await this.store.get(`PUBLICATION#${managedForm.publicationId}`))
        ?.status !== "active"
    )
      throw new AppError(
        409,
        "This publication is no longer accepting subscribers",
      );
    const updates: Record<string, unknown> = {};
    for (const q of content.questions) {
      if (q.property && row.answers[q.id] !== undefined)
        updates[q.property] = row.answers[q.id];
    }
    const next = {
      ...row,
      syncedAt: new Date().toISOString(),
      revision: row.revision + 1,
    };
    const consent = content.questions.find((q) => q.type === "consent");
    const membership =
      content.audienceId && consent && row.answers[consent.id] === true
        ? {
            audience: await this.destinationAudience(content.audienceId),
            consentSource: `Form ${row.formId} v${row.version}; consent checked; email confirmed`,
            consentedAt: row.verifiedAt,
          }
        : undefined;
    const writes: Parameters<Store["transaction"]>[0] = [
      ...(await this.directory.prepareVerifiedProfile({
        email: row.email,
        updates,
        addedAt: row.createdAt,
        eventId: `form-contact:${row.id}`,
        eventAt: next.syncedAt,
        membership,
      })),
      {
        Put: {
          TableName: this.config.APP_TABLE,
          Item: next,
          ConditionExpression: "revision = :revision",
          ExpressionAttributeValues: { ":revision": row.revision },
        },
      },
    ];
    if (content.topicId && consent && row.answers[consent.id] === true) {
      writes.push(
        ...(await this.subscriptions.prepareSignup({
          email: row.email,
          topicId: content.topicId,
          source: `Form ${row.formId} v${row.version}; email confirmed`,
          verifiedAt: row.verifiedAt,
          eventId: `form-topic:${row.id}`,
          eventAt: next.syncedAt,
        })),
      );
    }
    if (managedForm.publicationId)
      writes.push({
        ConditionCheck: {
          TableName: this.config.APP_TABLE,
          Key: { pk: `PUBLICATION#${managedForm.publicationId}`, sk: "META" },
          ConditionExpression: "#status = :active",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":active": "active" },
        },
      });
    await this.store.transaction(writes);
    return next;
  }
  async run(id: string) {
    let row = await this.response(id);
    if (row.status !== "pending" || Number(row.availableAt ?? 0) > Date.now())
      return;
    // Jobs may be delivered more than once; revisions fence database writes and mail uses idempotency keys.
    try {
      if (Date.now() - Date.parse(row.createdAt) >= 86400000)
        throw new AppError(
          410,
          "Response processing expired; review this response manually",
        );
      const { content } = await this.version(row.formId, row.version);
      if (content.syncContacts && !row.verifiedAt) {
        const form = await this.get(row.formId);
        const publication = form.publicationId
          ? await this.store.get(`PUBLICATION#${form.publicationId}`)
          : undefined;
        if (form.publicationId && publication?.status !== "active")
          throw new AppError(
            409,
            "This publication is no longer accepting subscribers",
          );
        const path = publication
          ? `/n/${(publication.settings as { slug: string }).slug}/confirm`
          : "/forms/confirm";
        const url = `${new URL(publicOrigin(this.config)).origin}${path}?token=${encodeURIComponent(this.token(row))}`;
        const message = await this.emailService.accept(
          emailInput.parse({
            from: content.from,
            to: row.email,
            subject: `Confirm your response: ${content.name}`.slice(0, 200),
            text: `Please confirm your email address for ${content.name}:\n\n${url}\n\nThis link expires 24 hours after submission. Your contact details and any selected subscription will be saved after confirmation. If you did not submit this form, ignore this email.`,
          }),
          "default",
          `form-verify:${row.id}`,
        );
        await this.patch(
          row.pk,
          {
            status: "awaiting_verification",
            state: "complete",
            verificationMessageId: message.id,
            revision: row.revision + 1,
            error: "",
          },
          row.revision,
        );
        return;
      }
      if (content.syncContacts) row = await this.sync(row, content);
      let acknowledgmentMessageId = row.acknowledgmentMessageId;
      if (content.acknowledgment && !acknowledgmentMessageId) {
        const message = await this.emailService.accept(
          emailInput.parse({
            from: content.from,
            to: row.email,
            subject: `Response received: ${content.name}`.slice(0, 200),
            text: `Thank you for completing ${content.name}. Your response has been received.\n\n${content.brand || "The team"}`,
          }),
          "default",
          `form-ack:${row.id}`,
        );
        acknowledgmentMessageId = message.id;
      }
      await this.save(
        {
          ...row,
          status: "complete",
          state: "complete",
          acknowledgmentMessageId,
          revision: row.revision + 1,
          error: "",
        },
        row.revision,
      );
    } catch (e) {
      const latest = await this.response(id);
      if (latest.revision !== row.revision) return;
      const attempts = row.attempts + 1;
      try {
        await this.save(
          {
            ...row,
            attempts,
            revision: row.revision + 1,
            status: attempts >= 6 ? "failed" : "pending",
            state: attempts >= 6 ? "complete" : "form",
            due: Date.now() + 30000 * 2 ** attempts,
            availableAt: Date.now() + 30000 * 2 ** attempts,
            error:
              e instanceof AppError
                ? e.message
                : "Processing failed; retry after checking configuration",
          },
          row.revision,
        );
      } catch (error) {
        if (!(error instanceof AppError && error.status === 409)) throw error;
      }
    }
  }
  async retry(id: string, commit?: MutationCommit) {
    const row = await this.response(id);
    if (row.status !== "failed")
      throw new AppError(409, "Only failed responses can be retried");
    if (Date.now() - Date.parse(row.createdAt) >= 86400000)
      throw new AppError(
        422,
        "Automatic processing is limited to 24 hours after submission",
      );
    return this.save(
      {
        ...row,
        status: "pending",
        state: "form",
        attempts: 0,
        availableAt: 0,
        due: Date.now(),
        revision: row.revision + 1,
        error: "",
      },
      row.revision,
      commit,
    );
  }
}
