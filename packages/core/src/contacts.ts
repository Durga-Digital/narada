import { SubscriptionService } from "./subscriptions.js";
import {
  commitMutation,
  commitRevisionPatch,
  type MutationCommit,
} from "./idempotency.js";
import { putWithEvent, webhookJobs } from "./event-outbox.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { AppError, hash, type Entity } from "./model.js";
import { conditional, type Store } from "./store.js";
import {
  MAX_CONTACTS,
  memberAddedAt,
  unsubscribeKey,
  type Audience,
  type Contact,
} from "./broadcast-model.js";
import {
  builtInProperties,
  contactKey,
  marketingKey,
  segmentConsentKey,
  matchesRules,
  propertyInput,
  propertyValue,
  segmentInput,
  topicInput,
  validateValue,
  type PropertyDefinition,
  type SharedContact,
  type Topic,
  type PropertyValue,
} from "./audience-model.js";
type Membership = Entity & Contact;
export class ContactService {
  constructor(
    readonly store: Store,
    readonly subscriptions = new SubscriptionService(store),
  ) {}
  async audienceDetail(id: string) {
    const audience = await this.audience(id);
    const unsubscribed = await this.store.getMany(
      audience.contacts.flatMap((c) => [
        unsubscribeKey(id, c.email),
        marketingKey(c.email),
        segmentConsentKey(id, c.email),
      ]),
    );
    const keys = new Set(unsubscribed.map((c) => c.pk));
    const consent = new Map(unsubscribed.map((c) => [c.pk, c]));
    return {
      ...audience,
      contacts: audience.contacts.map((c) => ({
        ...c,
        addedAt: memberAddedAt(c),
        consentSource: String(
          consent.get(segmentConsentKey(id, c.email))?.source ?? "",
        ),
        subscribed:
          consent.get(segmentConsentKey(id, c.email))?.subscribed === true &&
          !keys.has(unsubscribeKey(id, c.email)) &&
          !keys.has(marketingKey(c.email)),
      })),
    };
  }
  async directoryView() {
    const segmentRows = await this.segments();
    const audiences: Audience[] = [];
    const sharedContacts = await this.all();
    for (let offset = 0; offset < segmentRows.length; offset += 10)
      audiences.push(
        ...(await Promise.all(
          segmentRows
            .slice(offset, offset + 10)
            .map((row) => this.audience(row.id, sharedContacts)),
        )),
      );
    const profiles = new Map(sharedContacts.map((c) => [c.email, c]));
    const preferences = await this.store.getMany(
      audiences.flatMap((a) =>
        a.contacts.flatMap((c) => [
          unsubscribeKey(a.id, c.email),
          marketingKey(c.email),
          segmentConsentKey(a.id, c.email),
        ]),
      ),
    );
    const byKey = new Map(preferences.map((p) => [p.pk, p]));
    const unsubscribed = new Set(preferences.map((p) => p.pk));
    const contacts = new Map<
      string,
      {
        email: string;
        name: string;
        addedAt: string;
        memberships: {
          audienceId: string;
          name: string;
          subscribed: boolean;
          consentSource: string;
          addedAt: string;
        }[];
      }
    >();
    for (const profile of profiles.values())
      contacts.set(profile.email, {
        email: profile.email,
        name: profile.name,
        addedAt: profile.addedAt,
        memberships: [],
      });
    for (const audience of audiences) {
      for (const contact of audience.contacts) {
        const row = contacts.get(contact.email) ?? {
          email: contact.email,
          name: profiles.get(contact.email)?.name ?? contact.name,
          addedAt: memberAddedAt(contact),
          memberships: [],
        };
        if (memberAddedAt(contact) < row.addedAt)
          row.addedAt = memberAddedAt(contact);
        if (!row.name) row.name = contact.name;
        row.memberships.push({
          audienceId: audience.id,
          name: audience.name,
          subscribed:
            byKey.get(segmentConsentKey(audience.id, contact.email))
              ?.subscribed === true &&
            !unsubscribed.has(unsubscribeKey(audience.id, contact.email)) &&
            !unsubscribed.has(marketingKey(contact.email)),
          consentSource: String(
            byKey.get(segmentConsentKey(audience.id, contact.email))?.source ??
              "",
          ),
          addedAt: memberAddedAt(contact),
        });
        contacts.set(contact.email, row);
      }
    }
    return {
      audiences: audiences.map(
        ({ id, name, contacts, updatedAt, kind, rules, match, revision }) => ({
          id,
          name,
          total: contacts.length,
          kind,
          rules,
          match,
          revision,
          updatedAt,
        }),
      ),
      contacts: [...contacts.values()].sort(
        (a, b) =>
          b.addedAt.localeCompare(a.addedAt) || a.email.localeCompare(b.email),
      ),
    };
  }
  async ensureContact(
    contact: Contact & {
      first_name?: string;
      last_name?: string;
      properties?: Record<string, PropertyValue>;
    },
  ) {
    const key = contactKey(contact.email);
    if (await this.store.get(key)) return;
    try {
      await putWithEvent(
        this.store,
        {
          pk: key,
          sk: "META",
          scope: "contacts",
          sort: contact.email,
          email: contact.email,
          name: contact.name,
          first_name: contact.first_name ?? "",
          last_name: contact.last_name ?? "",
          properties: contact.properties ?? {},
          revision: 0,
          addedAt: memberAddedAt(contact),
        },
        "contact.created",
        { email: contact.email },
        { unique: true },
      );
    } catch (error) {
      if (!conditional(error)) throw error;
    }
  }
  async migrate(audience: Audience): Promise<Audience> {
    if ((audience.schemaVersion ?? 1) >= 3) return audience;
    if (audience.schemaVersion === 2) return this.migrateConsent(audience);
    // Idempotent copies precede the version switch. Existing shared records/preferences are never overwritten.
    for (const c of audience.contacts) {
      await this.ensureContact(c);
      try {
        await this.store.put(
          { pk: audience.pk, sk: `CONTACT#${hash(c.email)}`, ...c },
          true,
        );
      } catch (error) {
        if (!conditional(error)) throw error;
      }
    }
    try {
      await this.store.patch(
        audience.pk,
        {
          schemaVersion: 2,
          kind: "manual",
          total: audience.contacts.length,
          revision: audience.revision + 1,
        },
        { field: "revision", value: audience.revision },
      );
    } catch (error) {
      if (!conditional(error)) throw error;
    }
    const fresh = (await this.store.get<Audience>(audience.pk))!;
    if (fresh.schemaVersion !== 2) return this.migrate(fresh);
    return this.migrateConsent(fresh);
  }
  async migrateConsent(audience: Audience): Promise<Audience> {
    // Only pre-v3 manual lists contain explicit consent on membership rows.
    // Conditional creates preserve existing preferences during retries/concurrent migration.
    if (audience.kind !== "dynamic") {
      const members = await this.store.children<Membership>(
        audience.pk,
        "CONTACT#",
      );
      for (const member of members) {
        if (!member.consentSource?.trim() || !member.consentedAt) continue;
        await this.recordListConsent(
          audience.id,
          member.email,
          member.consentSource,
          member.consentedAt,
        );
      }
    }
    try {
      await this.store.patch(
        audience.pk,
        { schemaVersion: 3, revision: audience.revision + 1 },
        { field: "revision", value: audience.revision },
      );
    } catch (error) {
      if (!conditional(error)) throw error;
      return this.migrate((await this.store.get<Audience>(audience.pk))!);
    }
    return (await this.store.get<Audience>(audience.pk))!;
  }
  async recordListConsent(
    id: string,
    email: string,
    source: string,
    at: string,
  ) {
    try {
      await this.store.put(
        {
          pk: segmentConsentKey(id, email),
          sk: "META",
          subscribed: true,
          source,
          updatedAt: at,
        },
        true,
      );
    } catch (error) {
      if (!conditional(error)) throw error;
    }
  }
  async segments() {
    const rows = await this.store.list<Audience>("audiences", 1001);
    if (rows.length > 1000)
      throw new AppError(
        422,
        "This installation supports up to 1,000 segments",
      );
    const result: Audience[] = [];
    for (const row of rows) result.push(await this.migrate(row));
    return result;
  }
  async contact(email: string) {
    const row = await this.store.get<SharedContact>(
      contactKey(z.email().parse(email).toLowerCase()),
    );
    if (!row) throw new AppError(404, "Contact not found");
    return row;
  }
  async all() {
    const rows = await this.store.list<SharedContact>("contacts", 10001);
    if (rows.length > 10000)
      throw new AppError(
        422,
        "This installation supports up to 10,000 contacts in the directory",
      );
    return rows;
  }
  async audience(
    id: string,
    sharedContacts?: SharedContact[],
  ): Promise<Audience> {
    const row = await this.store.get<Audience>(`AUDIENCE#${id}`);
    if (!row) throw new AppError(404, "Audience not found");
    const migrated = await this.migrate(row);
    let contacts: Contact[];
    if (migrated.kind === "dynamic") {
      if (!sharedContacts) await this.segments();
      contacts = (sharedContacts ?? (await this.all()))
        .filter((c) =>
          matchesRules(c, migrated.rules ?? [], migrated.match ?? "all"),
        )
        .map((c) => ({
          email: c.email,
          name: c.name,
          addedAt: c.addedAt,
        }));
    } else contacts = await this.store.children<Membership>(row.pk, "CONTACT#");
    if (contacts.length > MAX_CONTACTS && !migrated.publicationId)
      throw new AppError(
        422,
        "Segment exceeds 1,000 contacts; narrow its rules",
      );
    return { ...migrated, contacts };
  }
  async summaries() {
    const segments = await this.segments();
    const profiles = segments.some((s) => s.kind === "dynamic")
      ? await this.all()
      : [];
    return segments.map(
      ({
        id,
        name,
        kind,
        rules,
        match,
        revision,
        updatedAt,
        total,
        publicationId,
      }) => ({
        publicationId,
        id,
        name,
        kind,
        rules,
        match,
        revision,
        updatedAt,
        total:
          kind === "dynamic"
            ? profiles.filter((c) =>
                matchesRules(c, rules ?? [], match ?? "all"),
              ).length
            : (total ?? 0),
      }),
    );
  }
  async createSegment(input: unknown, commit?: MutationCommit) {
    const data = segmentInput.parse(input);
    if ((await this.store.list("audiences", 1000)).length >= 1000)
      throw new AppError(422, "Up to 1,000 segments are supported");
    await this.validateRules(data);
    const id = randomUUID(),
      now = new Date().toISOString();
    const row: Audience = {
      pk: `AUDIENCE#${id}`,
      sk: "META",
      scope: "audiences",
      sort: now,
      id,
      ...data,
      schemaVersion: 3,
      contacts: [],
      total: 0,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    return commitMutation(this.store, [this.store.create(row)], row, commit);
  }
  async validateRules(data: z.output<typeof segmentInput>) {
    if (data.kind === "manual" && data.rules.length)
      throw new AppError(422, "Manual segments cannot have rules");
    if (data.kind === "dynamic" && !data.rules.length)
      throw new AppError(422, "Add at least one rule");
    const definitions = await this.properties();
    for (const rule of data.rules) {
      const definition =
        definitions.find((p) => p.key === rule.property) ??
        (builtInProperties.includes(
          rule.property as (typeof builtInProperties)[number],
        )
          ? { key: rule.property, type: "string" as const }
          : undefined);
      if (!definition)
        throw new AppError(422, `Unknown property: ${rule.property}`);
      if (["is_set", "is_not_set"].includes(rule.operator)) continue;
      validateValue(definition, rule.value);
      if (rule.operator === "contains" && definition.type !== "string")
        throw new AppError(422, "Contains requires a string property");
      if (
        ["greater_than", "less_than"].includes(rule.operator) &&
        !["number", "date"].includes(definition.type)
      )
        throw new AppError(
          422,
          "Comparisons require a number or date property",
        );
    }
  }
  async updateSegment(
    id: string,
    input: unknown,
    revision: number,
    commit?: MutationCommit,
  ) {
    const current = await this.audience(id),
      data = segmentInput.parse(input);
    if (current.publicationId)
      throw new AppError(409, "Manage this segment from Newsletters");
    if (current.kind !== data.kind)
      throw new AppError(422, "Create a new segment to change its type");
    await this.validateRules(data);
    await this.patch(
      current.pk,
      { ...data, revision: revision + 1, updatedAt: new Date().toISOString() },
      revision,
      commit,
    );
    return this.audience(id);
  }
  async removeMember(id: string, email: string, commit?: MutationCommit) {
    const audience = await this.audience(id);
    if (audience.kind === "dynamic")
      throw new AppError(
        422,
        "Change the rules or contact properties to change dynamic membership",
      );
    const sk = `CONTACT#${hash(email.toLowerCase())}`;
    if (!(await this.store.get(audience.pk, sk))) {
      if (commit) await commit([], { ok: true });
      return;
    }
    try {
      await commitMutation(
        this.store,
        [
          {
            Delete: {
              TableName: this.store.config.APP_TABLE,
              Key: { pk: audience.pk, sk },
            },
          },
          {
            Update: {
              TableName: this.store.config.APP_TABLE,
              Key: { pk: audience.pk, sk: "META" },
              UpdateExpression: "SET #total = :total, revision = :next",
              ConditionExpression: "revision = :revision",
              ExpressionAttributeNames: { "#total": "total" },
              ExpressionAttributeValues: {
                ":total": Math.max(0, Number(audience.total ?? 0) - 1),
                ":next": audience.revision + 1,
                ":revision": audience.revision,
              },
            },
          },
        ],
        { ok: true },
        commit,
      );
    } catch (error) {
      if (conditional(error)) {
        if (!(await this.store.get(audience.pk, sk))) return;
        throw new AppError(409, "Segment changed; reload and try again");
      }
      throw error;
    }
  }
  async addMember(
    id: string,
    email: string,
    input: unknown = {},
    commit?: MutationCommit,
  ): Promise<Contact> {
    z.object({}).strict().parse(input);
    // Membership cannot create a profile or subscribe it to a topic.
    const profile = await this.contact(email);
    const audience = await this.audience(id);
    const existing = audience.contacts.find(
      (contact) => contact.email === profile.email,
    );
    const member: Contact = {
      email: profile.email,
      name: profile.name,
      addedAt: new Date().toISOString(),
    };
    const writes = this.prepareMembership(audience, member);
    if (existing) return commit ? commit([], existing) : existing;
    try {
      await commitMutation(this.store, writes, member, commit);
    } catch (error) {
      if (conditional(error)) {
        const existing = await this.store.get<Membership>(
          audience.pk,
          `CONTACT#${hash(profile.email)}`,
        );
        if (existing) return existing;
        throw new AppError(409, "Segment changed; retry safely to finish");
      }
      throw error;
    }
    return member;
  }
  /** Compose membership with profile and form processing writes in one transaction. */
  private prepareMembership(
    audience: Audience,
    member: Contact,
  ): Parameters<Store["transaction"]>[0] {
    if (audience.kind === "dynamic")
      throw new AppError(
        422,
        "Change the rules or contact properties to change dynamic membership",
      );
    if (audience.contacts.some((contact) => contact.email === member.email))
      return [];
    if (audience.contacts.length >= MAX_CONTACTS)
      throw new AppError(422, "Segment is full");
    return [
      this.store.create({
        pk: audience.pk,
        sk: `CONTACT#${hash(member.email)}`,
        ...member,
      }),
      {
        Update: {
          TableName: this.store.config.APP_TABLE,
          Key: { pk: audience.pk, sk: "META" },
          UpdateExpression:
            "SET #total = :total, revision = :next, updatedAt = :now",
          ConditionExpression: "revision = :revision",
          ExpressionAttributeNames: { "#total": "total" },
          ExpressionAttributeValues: {
            ":total": audience.contacts.length + 1,
            ":next": audience.revision + 1,
            ":revision": audience.revision,
            ":now": memberAddedAt(member),
          },
        },
      },
    ];
  }
  async properties() {
    return this.store.list<PropertyDefinition>("properties", 100);
  }
  async saveProperty(
    input: unknown,
    revision?: number,
    commit?: MutationCommit,
  ) {
    const data = propertyInput.parse(input);
    if (data.fallback !== undefined) validateValue(data, data.fallback);
    const pk = `PROPERTY#${data.key}`,
      current = await this.store.get<PropertyDefinition>(pk);
    if (current) {
      if (revision === undefined)
        throw new AppError(409, "Property already exists");
      if (data.type !== current.type)
        throw new AppError(
          422,
          "Property types cannot be changed after creation",
        );
      try {
        await commitMutation(
          this.store,
          [
            {
              Put: {
                TableName: this.store.config.APP_TABLE,
                Item: {
                  ...current,
                  ...data,
                  fallback: data.fallback,
                  revision: revision + 1,
                },
                ConditionExpression: "revision = :revision",
                ExpressionAttributeValues: { ":revision": revision },
              },
            },
          ],
          {
            ...current,
            ...data,
            fallback: data.fallback,
            revision: revision + 1,
          },
          commit,
        );
      } catch (error) {
        if (conditional(error))
          throw new AppError(409, "Property changed; reload and try again");
        throw error;
      }
    } else {
      if ((await this.properties()).length >= 50)
        throw new AppError(422, "Up to 50 custom properties are supported");
      const item: PropertyDefinition = {
        pk,
        sk: "META",
        scope: "properties",
        sort: data.key,
        ...data,
        revision: 0,
        createdAt: new Date().toISOString(),
      };
      return commitMutation(
        this.store,
        [this.store.create(item)],
        item,
        commit,
      );
    }
    return this.store.get<PropertyDefinition>(pk);
  }
  async saveTopic(
    input: unknown,
    id?: string,
    revision?: number,
    commit?: MutationCommit,
  ) {
    const data = topicInput.parse(input);
    if (id) {
      if ((await this.topic(id)).publicationId)
        throw new AppError(409, "Manage this topic from Newsletters");
      if (revision === undefined) throw new AppError(422, "Revision required");
      await this.patch(
        `TOPIC#${id}`,
        { ...data, revision: revision + 1 },
        revision,
        commit,
      );
    } else {
      if ((await this.topics()).length >= 50)
        throw new AppError(422, "Up to 50 topics are supported");
      id = randomUUID();
      await putWithEvent(
        this.store,
        {
          pk: `TOPIC#${id}`,
          sk: "META",
          scope: "topics",
          sort: new Date().toISOString(),
          id,
          ...data,
          revision: 0,
          createdAt: new Date().toISOString(),
        },
        "topic.created",
        { id, ...data },
        { unique: true, commit },
      );
    }
    return this.topic(id);
  }
  topics() {
    return this.subscriptions.topics();
  }
  topic(id: string) {
    return this.subscriptions.topic(id);
  }
  // Compatibility methods: preference ownership lives in SubscriptionService.
  subscribe(
    email: string,
    topicId: string,
    subscribed: boolean,
    source: string,
  ) {
    return this.subscriptions.subscribe(email, topicId, subscribed, source);
  }
  async details(email: string) {
    const contact = await this.contact(email);
    return { contact, ...(await this.subscriptions.preferences(email)) };
  }
  /** Prepare profile + webhook writes for a caller-owned verified-signup transaction. */
  async prepareVerifiedProfile(input: {
    email: string;
    updates: Record<string, unknown>;
    addedAt: string;
    eventId: string;
    eventAt: string;
    membership?: {
      audience: Audience;
      consentSource: string;
      consentedAt: string;
    };
  }): Promise<Parameters<Store["transaction"]>[0]> {
    await this.segments();
    const existing = await this.store.get<SharedContact>(
      contactKey(input.email),
    );
    if (!existing && (await this.all()).length >= 10000)
      throw new AppError(422, "Up to 10,000 shared contacts are supported");
    const profile = {
      name: existing?.name ?? "",
      first_name: existing?.first_name ?? "",
      last_name: existing?.last_name ?? "",
      properties: { ...existing?.properties },
    };
    for (const [key, value] of Object.entries(input.updates)) {
      if (["name", "first_name", "last_name"].includes(key))
        profile[key as "name"] = String(value);
      else profile.properties[key] = propertyValue.parse(value);
    }
    await this.validateProfile(profile);
    const contact: SharedContact = {
      ...existing,
      ...profile,
      pk: contactKey(input.email),
      sk: "META",
      scope: "contacts",
      sort: input.email,
      email: input.email,
      revision: (existing?.revision ?? -1) + 1,
      addedAt: existing?.addedAt ?? input.addedAt,
    };
    return [
      {
        Put: {
          TableName: this.store.config.APP_TABLE,
          Item: contact,
          ConditionExpression: existing
            ? "revision = :revision"
            : "attribute_not_exists(pk)",
          ...(existing
            ? { ExpressionAttributeValues: { ":revision": existing.revision } }
            : {}),
        },
      },
      ...(await webhookJobs(this.store, {
        id: input.eventId,
        type: existing ? "contact.updated" : "contact.created",
        created_at: input.eventAt,
        data: { email: input.email },
      })),
      ...(input.membership &&
      !(await this.store.get(
        segmentConsentKey(input.membership.audience.id, input.email),
      ))
        ? [
            this.store.create({
              pk: segmentConsentKey(input.membership.audience.id, input.email),
              sk: "META",
              subscribed: true,
              source: input.membership.consentSource,
              updatedAt: input.membership.consentedAt,
            }),
          ]
        : []),
      ...(input.membership
        ? this.prepareMembership(input.membership.audience, {
            email: contact.email,
            name: contact.name,
            consentSource: input.membership.consentSource,
            consentedAt: input.membership.consentedAt,
          })
        : []),
    ];
  }
  async validateProfile(input: unknown) {
    const data = z
      .object({
        name: z.string().max(80),
        first_name: z.string().max(80),
        last_name: z.string().max(80),
        properties: z.record(z.string(), propertyValue),
      })
      .strict()
      .parse(input);
    const definitions = await this.properties();
    for (const [key, value] of Object.entries(data.properties)) {
      const definition = definitions.find((p) => p.key === key);
      if (!definition) throw new AppError(422, `Unknown property: ${key}`);
      validateValue(definition, value);
    }
    if (Buffer.byteLength(JSON.stringify(data.properties)) > 20000)
      throw new AppError(422, "Contact properties exceed 20 KB");
    return data;
  }
  async createContact(input: unknown, commit?: MutationCommit) {
    const { email, ...profile } = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        name: z.string().default(""),
        first_name: z.string().default(""),
        last_name: z.string().default(""),
        properties: z.record(z.string(), propertyValue).default({}),
      })
      .strict()
      .parse(input);
    const data = await this.validateProfile(profile);
    await this.segments();
    if ((await this.all()).length >= 10000)
      throw new AppError(422, "Up to 10,000 shared contacts are supported");
    const contact: SharedContact = {
      pk: contactKey(email),
      sk: "META",
      scope: "contacts",
      sort: email,
      email,
      ...data,
      revision: 0,
      addedAt: new Date().toISOString(),
    };
    try {
      await putWithEvent(
        this.store,
        contact,
        "contact.created",
        { email, ...data },
        { unique: true, commit },
      );
    } catch (error) {
      if (conditional(error)) throw new AppError(409, "Contact already exists");
      throw error;
    }
    return contact;
  }
  async updateContact(
    email: string,
    input: unknown,
    revision: number,
    commit?: MutationCommit,
  ) {
    const data = await this.validateProfile(input);
    const contact = await this.contact(email);
    await this.patch(
      contact.pk,
      { ...data, revision: revision + 1 },
      revision,
      commit,
    );
    return this.contact(email);
  }
  async patchProperties(
    email: string,
    input: unknown,
    commit?: MutationCommit,
  ) {
    const { properties, revision } = z
      .object({
        properties: z.record(
          z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
          propertyValue.nullable(),
        ),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(input);
    const current = await this.contact(email);
    if (current.revision !== revision)
      throw new AppError(409, "Contact changed; reload and try again");
    const next = { ...current.properties };
    for (const [key, value] of Object.entries(properties)) {
      if (
        [
          "constructor",
          "prototype",
          "__proto__",
          ...builtInProperties,
        ].includes(key)
      )
        throw new AppError(400, "Reserved property name");
      if (value === null) delete next[key];
      else next[key] = value;
    }
    return this.updateContact(
      email,
      {
        name: current.name,
        first_name: current.first_name,
        last_name: current.last_name,
        properties: next,
      },
      revision,
      commit,
    );
  }
  async patch(
    pk: string,
    fields: Record<string, unknown>,
    revision: number,
    commit?: MutationCommit,
  ) {
    try {
      if (pk.startsWith("CONTACT#") || pk.startsWith("TOPIC#")) {
        const current = await this.store.get(pk);
        if (!current) throw new AppError(404, "Record not found");
        const contact = pk.startsWith("CONTACT#");
        await putWithEvent(
          this.store,
          { ...current, ...fields },
          contact ? "contact.updated" : "topic.updated",
          {
            ...(contact ? { email: current.email } : { id: current.id }),
            ...fields,
          },
          { revision, commit },
        );
      } else {
        const current = await this.store.get(pk);
        if (!current) throw new AppError(404, "Record not found");
        await commitRevisionPatch(
          this.store,
          current,
          fields,
          revision,
          commit,
        );
      }
    } catch (error) {
      if (conditional(error))
        throw new AppError(409, "Record changed; reload and try again");
      throw error;
    }
  }
  async import(
    id: string,
    csv: string,
    source: string,
    topicIds: string[] = [],
  ) {
    const audience = await this.audience(id);
    if (audience.kind === "dynamic")
      throw new AppError(
        422,
        "Import into a manual segment; dynamic membership is determined by rules",
      );
    const consentSource = z.string().trim().min(3).max(200).parse(source),
      definitions = await this.properties();
    for (const topicId of topicIds)
      if (!(await this.topic(topicId)).active)
        throw new AppError(422, "Cannot import into an archived topic");
    let records: string[][];
    try {
      records = parse(csv, {
        bom: true,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: true,
        max_record_size: 25000,
      });
    } catch {
      throw new AppError(400, "Invalid CSV");
    }
    if (!records.length || records.length > MAX_CONTACTS + 1)
      throw new AppError(422, "Import 1–1,000 contacts at a time");
    const hasHeader = records[0]?.[0]?.toLowerCase() === "email";
    const headers = hasHeader ? records.shift()! : ["email", "name"];
    if (new Set(headers).size !== headers.length)
      throw new AppError(422, "Duplicate CSV columns");
    for (const key of headers)
      if (
        !builtInProperties.includes(
          key as (typeof builtInProperties)[number],
        ) &&
        !definitions.some((d) => d.key === key)
      )
        throw new AppError(
          422,
          `Create the property ${key} before importing it`,
        );
    const incoming = new Map<
      string,
      Contact & {
        first_name: string;
        last_name: string;
        properties: Record<string, PropertyValue>;
      }
    >();
    for (const row of records) {
      if (row.length > headers.length)
        throw new AppError(422, "CSV columns do not match the header");
      const data = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""]));
      const email = z.email().max(254).parse(data.email).toLowerCase(),
        properties: Record<string, PropertyValue> = {};
      for (const definition of definitions)
        if (data[definition.key] !== undefined && data[definition.key] !== "") {
          const value = data[definition.key]!;
          properties[definition.key] = validateValue(
            definition,
            definition.type === "number"
              ? Number(value)
              : definition.type === "boolean"
                ? value === "true"
                  ? true
                  : value === "false"
                    ? false
                    : value
                : value,
          );
        }
      if (Buffer.byteLength(JSON.stringify(properties)) > 20000)
        throw new AppError(422, "Contact properties exceed 20 KB");
      incoming.set(email, {
        email,
        name: z
          .string()
          .max(80)
          .parse(data.name ?? ""),
        first_name: z
          .string()
          .max(80)
          .parse(data.first_name ?? ""),
        last_name: z
          .string()
          .max(80)
          .parse(data.last_name ?? ""),
        properties,
        consentSource,
        consentedAt: new Date().toISOString(),
      });
    }
    if (!incoming.size) throw new AppError(422, "Add at least one contact");
    const directoryEmails = new Set((await this.all()).map((c) => c.email));
    if (new Set([...directoryEmails, ...incoming.keys()]).size > 10000)
      throw new AppError(
        422,
        "The contact directory supports up to 10,000 contacts",
      );
    const existing = new Set(audience.contacts.map((c) => c.email));
    if (new Set([...existing, ...incoming.keys()]).size > MAX_CONTACTS)
      throw new AppError(422, "A segment supports up to 1,000 contacts");
    let added = 0;
    for (const contact of incoming.values()) {
      await this.ensureContact(contact);
      if (!existing.has(contact.email)) {
        const current = (await this.store.get<Audience>(audience.pk))!;
        if (Number(current.total ?? 0) >= MAX_CONTACTS)
          throw new AppError(422, "Segment is full");
        try {
          await this.store.transaction([
            this.store.create({
              pk: audience.pk,
              sk: `CONTACT#${hash(contact.email)}`,
              email: contact.email,
              name: contact.name,
              addedAt: memberAddedAt(contact),
            }),
            {
              Update: {
                TableName: this.store.config.APP_TABLE,
                Key: { pk: audience.pk, sk: "META" },
                UpdateExpression:
                  "SET #total = :total, revision = :next, updatedAt = :now",
                ConditionExpression: "revision = :revision",
                ExpressionAttributeNames: { "#total": "total" },
                ExpressionAttributeValues: {
                  ":total": Number(current.total ?? 0) + 1,
                  ":next": current.revision + 1,
                  ":revision": current.revision,
                  ":now": new Date().toISOString(),
                },
              },
            },
          ]);
          added++;
        } catch (error) {
          if (conditional(error))
            throw new AppError(
              409,
              "Segment changed during import; retry safely to finish",
            );
          throw error;
        }
      }
      await this.recordListConsent(
        id,
        contact.email,
        consentSource,
        memberAddedAt(contact),
      );
      await this.subscriptions.importOptIns(
        contact.email,
        id,
        topicIds,
        consentSource,
      );
    }
    return {
      added,
      duplicates: incoming.size - added,
      total: (await this.audience(id)).contacts.length,
    };
  }
}
