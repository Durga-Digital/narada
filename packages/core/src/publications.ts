import { unsubscribeKey } from "./subscription-links.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AppError,
  domainOf,
  emailInput,
  type Domain,
  type Entity,
} from "./model.js";
import { conditional, type Store } from "./store.js";
import { commitMutation, type MutationCommit } from "./idempotency.js";
import {
  publicationInput,
  slugInput,
  type Publication,
  type PublicationSettings,
} from "./newsletter-model.js";
import { formInput, formStarters } from "./form-content.js";
import type { FormRecord } from "./form-model.js";
import type { Topic } from "./audience-model.js";
import type { Audience } from "./broadcast-model.js";
import type { ContactService } from "./contacts.js";
import {
  topicPreferenceKey,
  marketingKey,
  type TopicPreference,
} from "./audience-model.js";
export function replaceRevision(
  store: Store,
  item: Entity & { revision: number },
  revision: number,
) {
  return {
    Put: {
      TableName: store.config.APP_TABLE,
      Item: item,
      ConditionExpression: "revision = :revision",
      ExpressionAttributeValues: { ":revision": revision },
    },
  };
}
export function reserveNewsletterSlug(store: Store, pk: string, id: string) {
  return {
    Put: {
      TableName: store.config.APP_TABLE,
      Item: { pk, sk: "META", id },
      ConditionExpression: "attribute_not_exists(pk) OR #id = :id",
      ExpressionAttributeNames: { "#id": "id" },
      ExpressionAttributeValues: { ":id": id },
    },
  };
}
export function publicationGuard(store: Store, pub: Publication) {
  return {
    ConditionCheck: {
      TableName: store.config.APP_TABLE,
      Key: { pk: pub.pk, sk: "META" },
      ConditionExpression: "revision = :revision AND #status = :active",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":revision": pub.revision,
        ":active": "active",
      },
    },
  };
}
export async function newsletterCommit<T>(
  store: Store,
  writes: Parameters<Store["transaction"]>[0],
  result: T,
  commit?: MutationCommit,
) {
  try {
    return await commitMutation(store, writes, result, commit);
  } catch (e) {
    if (conditional(e))
      throw new AppError(
        409,
        "Newsletter changed or URL is already reserved; reload and try again",
      );
    throw e;
  }
}
function signupContent(settings: PublicationSettings, topicId: string) {
  return formInput.parse({
    ...formStarters.signup,
    name: settings.name,
    brand: settings.author || settings.name.slice(0, 80),
    description: settings.description,
    color: settings.color,
    from: settings.from,
    topicId,
    syncContacts: true,
  });
}
export class PublicationService {
  constructor(
    readonly store: Store,
    readonly contacts: ContactService,
  ) {}
  list() {
    return this.store.list<Publication>("publications", 50);
  }
  async summaries() {
    const publications = await this.list();
    return Promise.all(
      publications.map(async (pub) => ({
        ...pub,
        subscriberCount: (
          await this.store.list<TopicPreference>(
            `subscriptions#${pub.topicId}`,
            10001,
          )
        ).filter((p) => p.subscribed).length,
      })),
    );
  }
  async get(id: string) {
    const pub = await this.store.get<Publication>(
      `PUBLICATION#${z.uuid().parse(id)}`,
    );
    if (!pub) throw new AppError(404, "Publication not found");
    return pub;
  }
  async bySlug(slug: string) {
    if (!slugInput.safeParse(slug).success)
      throw new AppError(404, "Publication not found");
    const reservation = await this.store.get(`PUBLICATIONSLUG#${slug}`);
    if (!reservation) throw new AppError(404, "Publication not found");
    const pub = await this.get(String(reservation.id));
    if (pub.status === "draft" || pub.settings.slug !== slug)
      throw new AppError(404, "Publication not found");
    return pub;
  }
  async ready(settings: PublicationSettings) {
    emailInput.parse({
      from: settings.from,
      to: "validation@example.com",
      subject: "Newsletter",
      text: "Newsletter",
    });
    const domain = await this.store.get<Domain>(
      `DOMAIN#${domainOf(settings.from)}`,
    );
    if (!domain?.verified || domain.removedAt)
      throw new AppError(422, "Choose a sender from a verified domain");
    if (!settings.organization.trim() || !settings.postalAddress.trim())
      throw new AppError(422, "Add an organization and postal address");
  }
  async create(input: unknown, commit?: MutationCommit) {
    const settings = publicationInput.parse(input),
      id = randomUUID(),
      now = new Date().toISOString();
    if ((await this.contacts.topics()).length >= 50)
      throw new AppError(422, "Up to 50 topics are supported");
    const pub: Publication = {
      pk: `PUBLICATION#${id}`,
      sk: "META",
      scope: "publications",
      sort: now,
      id,
      settings,
      status: "draft",
      topicId: randomUUID(),
      audienceId: randomUUID(),
      formId: randomUUID(),
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    const topic: Topic = {
      pk: `TOPIC#${pub.topicId}`,
      sk: "META",
      scope: "topics",
      sort: now,
      id: pub.topicId,
      name: settings.name,
      description: settings.description,
      active: false,
      visibility: "private",
      revision: 0,
      createdAt: now,
      publicationId: id,
    };
    const audience: Audience = {
      pk: `AUDIENCE#${pub.audienceId}`,
      sk: "META",
      scope: "audiences",
      sort: now,
      id: pub.audienceId,
      name: settings.name,
      kind: "dynamic",
      schemaVersion: 2,
      match: "all",
      rules: [{ property: "email", operator: "is_set" }],
      contacts: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
      publicationId: id,
    };
    const form: FormRecord = {
      pk: `FORM#${pub.formId}`,
      sk: "META",
      scope: "forms",
      sort: now,
      id: pub.formId,
      draft: signupContent(settings, pub.topicId),
      version: 0,
      revision: 0,
      accepting: false,
      createdAt: now,
      updatedAt: now,
      publicationId: id,
    };
    return newsletterCommit(
      this.store,
      [
        pub,
        topic,
        audience,
        form,
        { pk: `PUBLICATIONSLUG#${settings.slug}`, sk: "META", id },
      ].map((row) => this.store.create(row)),
      pub,
      commit,
    );
  }
  async update(
    id: string,
    input: unknown,
    revision: number,
    status?: Publication["status"],
    commit?: MutationCommit,
  ) {
    const pub = await this.get(id),
      settings = publicationInput.parse(input);
    if (pub.revision !== revision)
      throw new AppError(409, "Publication changed; reload before saving");
    if (pub.status === "archived")
      throw new AppError(409, "This publication is archived");
    if (pub.status !== "draft" && settings.slug !== pub.settings.slug)
      throw new AppError(422, "Active publication URLs cannot change");
    const nextStatus = status ?? pub.status;
    if (nextStatus === "active") await this.ready(settings);
    const topic = await this.contacts.topic(pub.topicId),
      form = (await this.store.get<FormRecord>(`FORM#${pub.formId}`))!;
    const next: Publication = {
      ...pub,
      settings,
      status: nextStatus,
      ...(nextStatus === "archived"
        ? { state: "publication", due: Date.now() + 1000 }
        : {}),
      revision: revision + 1,
      updatedAt: new Date().toISOString(),
    };
    const content = signupContent(settings, pub.topicId),
      active = nextStatus === "active";
    const nextForm: FormRecord = {
      ...form,
      draft: content,
      revision: form.revision + 1,
      accepting: active,
      version: active ? form.version + 1 : form.version,
      updatedAt: next.updatedAt,
    };
    const writes: Parameters<Store["transaction"]>[0] = [
      replaceRevision(this.store, next, revision),
      replaceRevision(
        this.store,
        {
          ...topic,
          name: settings.name,
          description: settings.description,
          active,
          visibility: active ? "public" : "private",
          revision: topic.revision + 1,
        },
        topic.revision,
      ),
      replaceRevision(this.store, nextForm, form.revision),
    ];
    if (active)
      writes.push(
        this.store.create({
          pk: form.pk,
          sk: `VERSION#${nextForm.version}`,
          version: nextForm.version,
          content,
        }),
      );
    if (settings.slug !== pub.settings.slug)
      writes.push(
        reserveNewsletterSlug(
          this.store,
          `PUBLICATIONSLUG#${settings.slug}`,
          id,
        ),
      );
    return newsletterCommit(this.store, writes, next, commit);
  }
  async subscribers(id: string) {
    const pub = await this.get(id),
      audience = await this.contacts.audience(pub.audienceId);
    const prefs = new Map(
      (
        await this.store.getMany<TopicPreference>(
          audience.contacts.map((c) =>
            topicPreferenceKey(pub.topicId, c.email),
          ),
        )
      ).map((p) => [p.pk, p]),
    );
    const eligible =
      pub.status === "active"
        ? await this.contacts.subscriptions.eligible(
            { audienceId: pub.audienceId, topicId: pub.topicId },
            audience.contacts,
          )
        : [];
    const allowed = new Set(eligible.map((c) => c.email));
    const blockers = new Set(
      (
        await this.store.getMany(
          audience.contacts.flatMap((c) => [
            marketingKey(c.email),
            `SUPPRESS#${c.email}`,
            unsubscribeKey(pub.audienceId, c.email),
          ]),
          ["pk"],
        )
      ).map((row) => row.pk),
    );
    const subscribers = audience.contacts
      .filter((c) => prefs.has(topicPreferenceKey(pub.topicId, c.email)))
      .map((c) => ({
        email: c.email,
        name: c.name,
        subscribed: prefs.get(topicPreferenceKey(pub.topicId, c.email))!
          .subscribed,
        eligible: allowed.has(c.email),
        deliveryStatus: allowed.has(c.email)
          ? "Eligible"
          : pub.status !== "active"
            ? "Publication inactive"
            : blockers.has(`SUPPRESS#${c.email}`)
              ? "Suppressed"
              : blockers.has(marketingKey(c.email))
                ? "Global opt-out"
                : "Opted out",
      }));
    return {
      confirmed: subscribers.filter((c) => c.subscribed).length,
      eligible: eligible.length,
      subscribers,
    };
  }
}
