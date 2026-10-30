import { commitMutation, type MutationCommit } from "./idempotency.js";
import { z } from "zod";
import { AppError, type Entity } from "./model.js";
import { conditional, type Store } from "./store.js";
import { putWithEvent, webhookJobs } from "./event-outbox.js";
import {
  contactKey,
  marketingKey,
  segmentConsentKey,
  topicPreferenceKey,
  type Topic,
  type TopicPreference,
} from "./audience-model.js";
import { unsubscribeKey, readUnsubscribeToken } from "./subscription-links.js";

export interface SubscriptionAudience {
  audienceId: string;
  topicId?: string;
}
export type RecipientBlock = "unsubscribed" | "suppressed";

/** Owns marketing preferences. Transactional delivery only checks suppressions. */
export class SubscriptionService {
  constructor(readonly store: Store) {}

  async topic(id: string) {
    const row = await this.store.get<Topic>(`TOPIC#${id}`);
    if (!row) throw new AppError(404, "Topic not found");
    return row;
  }
  topics() {
    return this.store.list<Topic>("topics", 100);
  }
  /** Directory status reflects audience/global opt-outs, independently of delivery suppression. */
  async membershipStatus(
    audiences: { id: string; contacts: { email: string }[] }[],
  ) {
    const records = await this.store.getMany(
      audiences.flatMap((a) =>
        a.contacts.flatMap((c) => [
          unsubscribeKey(a.id, c.email),
          marketingKey(c.email),
          segmentConsentKey(a.id, c.email),
        ]),
      ),
    );
    const blocked = new Set(records.map((row) => row.pk));
    const byKey = new Map(records.map((row) => [row.pk, row]));
    return new Map(
      audiences.map((a) => [
        a.id,
        new Set(
          a.contacts
            .filter(
              (c) =>
                byKey.get(segmentConsentKey(a.id, c.email))?.subscribed ===
                  true &&
                !blocked.has(unsubscribeKey(a.id, c.email)) &&
                !blocked.has(marketingKey(c.email)),
            )
            .map((c) => c.email),
        ),
      ]),
    );
  }
  async preferences(email: string) {
    const topics = await this.topics();
    const records = await this.store.getMany<TopicPreference>(
      topics.map((t) => topicPreferenceKey(t.id, email)),
    );
    const byKey = new Map(records.map((row) => [row.pk, row]));
    return {
      topics: topics.map((t) => ({
        ...t,
        subscribed:
          byKey.get(topicPreferenceKey(t.id, email))?.subscribed === true,
      })),
      unsubscribedAll: !!(await this.store.get(marketingKey(email))),
    };
  }
  async subscribe(
    email: string,
    topicId: string,
    subscribed: boolean,
    source: string,
    commit?: MutationCommit,
  ) {
    if (
      !(await this.store.get(contactKey(z.email().parse(email).toLowerCase())))
    )
      throw new AppError(404, "Contact not found");
    const topic = await this.topic(topicId);
    if (subscribed && !topic.active)
      throw new AppError(422, "This topic is archived");
    await putWithEvent(
      this.store,
      {
        pk: topicPreferenceKey(topicId, email),
        scope: `subscriptions#${topicId}`,
        sort: email.toLowerCase(),
        sk: "META",
        subscribed,
        source: z.string().trim().min(3).max(200).parse(source),
        updatedAt: new Date().toISOString(),
      },
      "contact.topics.updated",
      { email, topic_id: topicId, subscribed },
      { commit },
    );
  }
  async unsubscribe(token: string, secret: string) {
    const { audienceId, email, topicId } = readUnsubscribeToken(secret, token);
    if (topicId) {
      // Signed links remain usable even if the contact or topic no longer exists.
      await putWithEvent(
        this.store,
        {
          pk: topicPreferenceKey(topicId, email),
          scope: `subscriptions#${topicId}`,
          sort: email.toLowerCase(),
          sk: "META",
          subscribed: false,
          source: "Email unsubscribe",
          updatedAt: new Date().toISOString(),
        },
        "contact.topics.updated",
        { email, topic_id: topicId, subscribed: false },
      );
      return;
    }
    await this.store.put({
      pk: unsubscribeKey(audienceId, email),
      sk: "META",
      scope: `unsubscribes#${audienceId}`,
      sort: email,
      audienceId,
      email,
      createdAt: new Date().toISOString(),
    });
  }
  async unsubscribeAll(email: string, commit?: MutationCommit) {
    await commitMutation(
      this.store,
      [
        {
          Put: {
            TableName: this.store.config.APP_TABLE,
            Item: {
              pk: marketingKey(email),
              sk: "META",
              createdAt: new Date().toISOString(),
            },
          },
        },
      ],
      { ok: true },
      commit,
    );
  }
  async resume(email: string) {
    await this.store.remove(marketingKey(email));
  }

  /** Builds guarded writes, so a caller can commit consent and its own state atomically. */
  async prepareSignup(input: {
    email: string;
    topicId: string;
    source: string;
    verifiedAt: string;
    eventId: string;
    eventAt: string;
  }): Promise<Parameters<Store["transaction"]>[0]> {
    const topic = await this.topic(input.topicId);
    const pk = topicPreferenceKey(input.topicId, input.email);
    if (
      !topic.active ||
      topic.visibility !== "public" ||
      (await this.store.get(pk))
    )
      return [];
    return [
      this.store.create({
        pk,
        sk: "META",
        scope: `subscriptions#${input.topicId}`,
        sort: input.email.toLowerCase(),
        subscribed: true,
        source: input.source,
        updatedAt: input.verifiedAt,
      }),
      ...(await webhookJobs(this.store, {
        id: input.eventId,
        type: "contact.topics.updated",
        created_at: input.eventAt,
        data: { email: input.email, topic_id: input.topicId, subscribed: true },
      })),
    ];
  }

  async importOptIns(
    email: string,
    audienceId: string,
    topicIds: string[],
    source: string,
  ) {
    // Imports cannot resume marketing or reverse any existing topic preference.
    if (
      (await this.store.get(marketingKey(email))) ||
      (await this.store.get(unsubscribeKey(audienceId, email)))
    )
      return;
    for (const topicId of topicIds) {
      try {
        await putWithEvent(
          this.store,
          {
            pk: topicPreferenceKey(topicId, email),
            scope: `subscriptions#${topicId}`,
            sort: email.toLowerCase(),
            sk: "META",
            subscribed: true,
            source,
            updatedAt: new Date().toISOString(),
          },
          "contact.topics.updated",
          { email, topic_id: topicId, subscribed: true },
          { unique: true },
        );
      } catch (error) {
        if (!conditional(error)) throw error;
      }
    }
  }

  private preferenceKeys(email: string, audience: SubscriptionAudience) {
    return [
      unsubscribeKey(audience.audienceId, email),
      marketingKey(email),
      `SUPPRESS#${email}`,
      ...(audience.topicId
        ? [topicPreferenceKey(audience.topicId, email)]
        : [segmentConsentKey(audience.audienceId, email)]),
    ];
  }
  private block(
    email: string,
    audience: SubscriptionAudience,
    rows: Map<string, Entity>,
    topicActive: boolean,
  ): RecipientBlock | undefined {
    if (
      !topicActive ||
      (!audience.topicId &&
        rows.get(segmentConsentKey(audience.audienceId, email))?.subscribed !==
          true) ||
      rows.has(marketingKey(email)) ||
      rows.has(unsubscribeKey(audience.audienceId, email)) ||
      (audience.topicId &&
        rows.get(topicPreferenceKey(audience.topicId, email))?.subscribed !==
          true)
    )
      return "unsubscribed";
    if (rows.has(`SUPPRESS#${email}`)) return "suppressed";
  }
  async eligible<T extends { email: string }>(
    audience: SubscriptionAudience,
    contacts: T[],
  ): Promise<T[]> {
    if (audience.topicId && !(await this.topic(audience.topicId)).active)
      throw new AppError(422, "The selected topic is archived");
    const records = await this.store.getMany(
      contacts.flatMap((c) => this.preferenceKeys(c.email, audience)),
    );
    const rows = new Map(records.map((row) => [row.pk, row]));
    return contacts.filter((c) => !this.block(c.email, audience, rows, true));
  }
  async deliveryBlock(
    email: string,
    audience: SubscriptionAudience,
  ): Promise<RecipientBlock | undefined> {
    // Fresh reads at delivery time are required; never reuse the launch snapshot.
    const topicActive =
      !audience.topicId ||
      !!(await this.store.get<Topic>(`TOPIC#${audience.topicId}`))?.active;
    const records = await this.store.getMany(
      this.preferenceKeys(email, audience),
    );
    return this.block(
      email,
      audience,
      new Map(records.map((row) => [row.pk, row])),
      topicActive,
    );
  }
}
