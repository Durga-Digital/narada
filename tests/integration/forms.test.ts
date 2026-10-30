import { afterAll, beforeAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import type { Runtime } from "@narada/core/runtime";
import { formStarters } from "@narada/core/form-content";
import type { FormResponse } from "@narada/core/form-model";
import {
  contactKey,
  marketingKey,
  topicPreferenceKey,
} from "@narada/core/audience-model";
import { hash, type Message } from "@narada/core/model";
import {
  MAX_CONTACTS,
  unsubscribeKey,
  type Audience,
} from "@narada/core/broadcast-model";
let runtime: Runtime,
  app: ReturnType<typeof createApp>,
  cookie = "";
const origin = "http://localhost:5173";
const testId = randomUUID();
const appTable = `narada-forms-test-${testId}`;
const authTable = `narada-forms-auth-test-${testId}`;
const credentialsPath = `.local/forms-test-${testId}.json`;
const request = (
  path: string,
  body?: unknown,
  admin = false,
  method = body === undefined ? "GET" : "POST",
) =>
  app.request(`${origin}${path}`, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      ...(admin ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
beforeAll(async () => {
  process.env.APP_TABLE = appTable;
  process.env.AUTH_TABLE = authTable;
  runtime = await initialize(credentialsPath);
  app = createApp(runtime);
  const owner = JSON.parse(await readFile(credentialsPath, "utf8"));
  const login = await request("/api/auth/sign-in/email", owner);
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});
afterAll(async () => {
  try {
    if (runtime)
      await Promise.all(
        [appTable, authTable].map((TableName) =>
          runtime.store.client.send(new DeleteTableCommand({ TableName })),
        ),
      );
  } finally {
    await rm(credentialsPath, { force: true });
  }
});
async function submit(id: string, version: number, answers: unknown) {
  const submissionId = randomUUID();
  const body = { version, submissionId, answers };
  const result = await request(`/api/forms/${id}/responses`, body);
  expect(result.status, await result.clone().text()).toBe(201);
  const responseId = hash(`${id}:${submissionId}`);
  return { row: await runtime.forms.response(responseId), body };
}
async function audienceSignup() {
  const audience = await runtime.forms.directory.createSegment({
    name: `Launch ${randomUUID()}`,
    kind: "manual",
  });
  const form = await runtime.forms.create({
    ...formStarters.signup,
    syncContacts: true,
    audienceId: audience.id,
    from: "hello@narada.test",
  });
  await runtime.forms.publish(form.id, 0);
  return { audience, form };
}

it("routes only confirmed, consenting responses and deduplicates repeat submissions", async () => {
  const { audience, form } = await audienceSignup();
  const email = `${randomUUID()}@example.com`;
  const { row } = await submit(form.id, 1, {
    email,
    name: "Launch reader",
    consent: true,
  });
  await runtime.forms.run(row.id);
  expect(
    (await runtime.forms.directory.audience(audience.id)).contacts,
  ).toHaveLength(0);
  await runtime.forms.confirm(runtime.forms.token(row));
  await runtime.forms.run(row.id);
  const first = await runtime.forms.directory.audience(audience.id);
  expect(first.total).toBe(1);
  expect(first.contacts).toEqual([
    expect.objectContaining({
      email,
      name: "Launch reader",
      consentSource: expect.stringContaining(`Form ${form.id} v1`),
    }),
  ]);
  expect((await runtime.forms.response(row.id)).status).toBe("complete");
  await runtime.forms.run(row.id);
  const duplicate = await submit(form.id, 1, {
    email: email.toUpperCase(),
    consent: true,
  });
  await runtime.forms.confirm(runtime.forms.token(duplicate.row));
  await runtime.forms.run(duplicate.row.id);
  expect((await runtime.forms.directory.audience(audience.id)).total).toBe(1);
  expect(
    (await runtime.forms.directory.audience(audience.id)).contacts,
  ).toEqual(first.contacts);
  const declined = await submit(form.id, 1, {
    email: `${randomUUID()}@example.com`,
    consent: false,
  });
  await runtime.forms.confirm(runtime.forms.token(declined.row));
  await runtime.forms.run(declined.row.id);
  expect(
    await runtime.forms.directory.contact(declined.row.email!),
  ).toBeTruthy();
  expect(
    (await runtime.forms.directory.audience(audience.id)).contacts,
  ).toHaveLength(1);
});

it("preserves audience/global opt-outs and suppression when routing a confirmed contact", async () => {
  const { audience, form } = await audienceSignup();
  const email = `${randomUUID()}@example.com`;
  const keys = [
    unsubscribeKey(audience.id, email),
    marketingKey(email),
    `SUPPRESS#${email}`,
  ];
  for (const pk of keys)
    await runtime.store.put({ pk, sk: "META", reason: "Existing opt-out" });
  const { row } = await submit(form.id, 1, { email, consent: true });
  await runtime.forms.confirm(runtime.forms.token(row));
  await runtime.forms.run(row.id);
  expect(
    (await runtime.forms.directory.audience(audience.id)).contacts,
  ).toHaveLength(1);
  expect(
    (await runtime.broadcasts.audienceDetail(audience.id)).contacts[0]
      ?.subscribed,
  ).toBe(false);
  for (const pk of keys) expect(await runtime.store.get(pk)).toBeTruthy();
});

it("uses the submitted version's audience even after republishing a different destination", async () => {
  const { audience, form } = await audienceSignup();
  const nextAudience = await runtime.forms.directory.createSegment({
    name: "Next launch",
    kind: "manual",
  });
  const { row } = await submit(form.id, 1, {
    email: `${randomUUID()}@example.com`,
    consent: true,
  });
  const saved = await runtime.forms.update(
    form.id,
    { ...form.draft, audienceId: nextAudience.id },
    1,
  );
  await runtime.forms.publish(form.id, saved.revision);
  await runtime.forms.confirm(runtime.forms.token(row));
  await runtime.forms.run(row.id);
  expect(
    (await runtime.forms.directory.audience(audience.id)).contacts,
  ).toHaveLength(1);
  expect(
    (await runtime.forms.directory.audience(nextAudience.id)).contacts,
  ).toHaveLength(0);
});

it("rejects invalid destinations and retains a retryable response if the destination disappears", async () => {
  const dynamic = await runtime.forms.directory.createSegment({
    name: "Dynamic",
    kind: "dynamic",
    rules: [{ property: "name", operator: "is_set" }],
  });
  const managed = await runtime.forms.directory.createSegment({
    name: "Newsletter managed",
    kind: "manual",
  });
  await runtime.store.patch(managed.pk, { publicationId: randomUUID() });
  for (const audienceId of [dynamic.id, managed.id, randomUUID()]) {
    const form = await runtime.forms.create({
      ...formStarters.signup,
      syncContacts: true,
      audienceId,
      from: "hello@narada.test",
    });
    await expect(runtime.forms.publish(form.id, 0)).rejects.toMatchObject({
      status:
        audienceId === dynamic.id || audienceId === managed.id ? 422 : 404,
    });
  }
  const { audience, form } = await audienceSignup();
  const { row } = await submit(form.id, 1, {
    email: `${randomUUID()}@example.com`,
    consent: true,
  });
  await runtime.forms.confirm(runtime.forms.token(row));
  const original = await runtime.store.get<Audience>(audience.pk);
  await runtime.store.remove(audience.pk);
  for (let i = 0; i < 6; i++) {
    await runtime.store.patch(row.pk, { availableAt: 0 });
    await runtime.forms.run(row.id);
  }
  expect(await runtime.forms.response(row.id)).toMatchObject({
    status: "failed",
    answers: row.answers,
  });
  expect((await runtime.forms.response(row.id)).syncedAt).toBeUndefined();
  expect(await runtime.store.get(contactKey(row.email!))).toBeUndefined();
  await runtime.store.put(original!);
  await runtime.forms.retry(row.id);
  await runtime.forms.run(row.id);
  expect((await runtime.forms.response(row.id)).status).toBe("complete");
  expect((await runtime.forms.directory.audience(audience.id)).total).toBe(1);
});

it("commits membership, profile and processing atomically across audience conflicts and capacity limits", async () => {
  const { audience, form } = await audienceSignup();
  const { row } = await submit(form.id, 1, {
    email: `${randomUUID()}@example.com`,
    consent: true,
  });
  await runtime.forms.confirm(runtime.forms.token(row));
  const confirmed = await runtime.forms.response(row.id);
  const original = runtime.store.transaction.bind(runtime.store);
  const spy = vi
    .spyOn(runtime.store, "transaction")
    .mockImplementationOnce(async (writes) => {
      await runtime.store.patch(audience.pk, {
        revision: audience.revision + 1,
      });
      return original(writes);
    });
  try {
    await expect(
      runtime.forms.sync(confirmed, form.draft),
    ).rejects.toMatchObject({ name: "TransactionCanceledException" });
  } finally {
    spy.mockRestore();
  }
  expect(await runtime.store.get(contactKey(row.email!))).toBeUndefined();
  expect((await runtime.forms.response(row.id)).syncedAt).toBeUndefined();
  expect((await runtime.forms.directory.audience(audience.id)).total).toBe(0);
  // Exercise the real full-audience check without writing 1,000 unrelated fixtures.
  const getAudience = runtime.forms.directory.audience.bind(
    runtime.forms.directory,
  );
  const full = vi
    .spyOn(runtime.forms.directory, "audience")
    .mockImplementationOnce(async (id) => ({
      ...(await getAudience(id)),
      contacts: Array.from({ length: MAX_CONTACTS }, (_, i) => ({
        email: `full-${i}@example.com`,
        name: "",
        consentSource: "Test",
        consentedAt: row.createdAt,
      })),
    }));
  try {
    await expect(
      runtime.forms.sync(confirmed, form.draft),
    ).rejects.toMatchObject({ status: 422 });
  } finally {
    full.mockRestore();
  }
  expect(await runtime.store.get(contactKey(row.email!))).toBeUndefined();
  await runtime.forms.run(row.id);
  expect((await runtime.forms.response(row.id)).status).toBe("complete");
  expect((await runtime.forms.directory.audience(audience.id)).total).toBe(1);
});
it("guards administration, private drafts, origins, validation, immutable versions and closed forms", async () => {
  expect((await request("/api/admin/forms")).status).toBe(401);
  const created = await request(
    "/api/admin/forms",
    formStarters.feedback,
    true,
  );
  expect(created.status).toBe(201);
  const form = await created.json();
  expect((await request(`/api/forms/${form.id}`)).status).toBe(404);
  const published = await runtime.forms.publish(form.id, 0);
  const publicResult = await request(`/api/forms/${form.id}`);
  expect(publicResult.headers.get("cache-control")).toBe("no-store");
  expect(await publicResult.json()).not.toHaveProperty("draft");
  const badOrigin = await app.request(`/api/forms/${form.id}/responses`, {
    method: "POST",
    headers: {
      origin: "https://foreign.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  expect(badOrigin.status).toBe(403);
  expect(
    (
      await request(`/api/forms/${form.id}/responses`, {
        submissionId: randomUUID(),
        version: 1,
        answers: { rating: 10 },
      })
    ).status,
  ).toBe(422);
  const { row, body } = await submit(form.id, 1, {
    rating: 5,
    feedback: '=HYPERLINK("https://example.com")',
  });
  expect(row.status).toBe("complete");
  expect((await request(`/api/forms/${form.id}/responses`, body)).status).toBe(
    201,
  );
  expect(
    (
      await request(`/api/forms/${form.id}/responses`, {
        ...body,
        answers: { rating: 4 },
      })
    ).status,
  ).toBe(409);
  const edit = await runtime.forms.update(
    form.id,
    {
      ...formStarters.feedback,
      questions: formStarters.feedback.questions.map((q) => ({
        ...q,
        label: `Changed ${q.label}`,
      })),
    },
    published.revision,
  );
  expect(
    (await runtime.forms.version(form.id, 1)).content.questions[0]?.label,
  ).toBe("How was your experience?");
  await expect(
    runtime.forms.publish(form.id, published.revision),
  ).rejects.toMatchObject({ status: 409 });
  const next = await runtime.forms.publish(form.id, edit.revision);
  expect(
    (
      await request(`/api/forms/${form.id}/responses`, {
        submissionId: randomUUID(),
        version: 1,
        answers: { rating: 5 },
      })
    ).status,
  ).toBe(409);
  const detail = await request(
    `/api/admin/forms/${form.id}/responses/${row.id}`,
    undefined,
    true,
  );
  expect((await detail.json()).content.questions[0].label).toBe(
    "How was your experience?",
  );
  const csv = await request(
    `/api/admin/forms/${form.id}/export`,
    undefined,
    true,
  );
  expect(csv.headers.get("content-type")).toContain("text/csv");
  expect(await csv.text()).toContain("'=HYPERLINK");
  await runtime.forms.close(form.id, next.revision);
  expect((await request(`/api/forms/${form.id}`)).status).toBe(404);
  expect(
    (
      await request(`/api/forms/${form.id}/responses`, {
        submissionId: randomUUID(),
        version: 2,
        answers: { rating: 5 },
      })
    ).status,
  ).toBe(404);
});
it("confirms signup before syncing contacts and subscriptions, and queues each email once", async () => {
  const directory = runtime.broadcasts.directory;
  const audience = await directory.createSegment({
    name: "Confirmed subscribers",
    kind: "manual",
  });
  const topic = await directory.saveTopic({
    name: `Form topic ${randomUUID()}`,
  });
  const email = `${randomUUID()}@example.com`;
  const draft = {
    ...formStarters.signup,
    syncContacts: true,
    topicId: topic.id,
    audienceId: audience.id,
    acknowledgment: true,
    from: "hello@narada.test",
  };
  const form = await runtime.forms.create(draft);
  await runtime.forms.publish(form.id, 0);
  const { row } = await submit(form.id, 1, {
    name: "New reader",
    email,
    consent: true,
  });
  expect(await runtime.store.get(contactKey(email))).toBeUndefined();
  await Promise.all([runtime.forms.run(row.id), runtime.forms.run(row.id)]);
  const awaiting = await runtime.forms.response(row.id);
  expect(awaiting.status).toBe("awaiting_verification");
  expect(await runtime.store.get(contactKey(email))).toBeUndefined();
  const message = await runtime.store.get<Message>(
    `MSG#${awaiting.verificationMessageId}`,
  );
  expect(message?.input.text).toContain("/forms/confirm?token=");
  await expect(
    runtime.forms.confirm(runtime.forms.token(row) + "x"),
  ).rejects.toMatchObject({ status: 400 });
  // A GET (including a mail scanner) cannot confirm or mutate a contact.
  expect(
    (await request(`/api/forms/confirm?token=${runtime.forms.token(row)}`)).ok,
  ).toBe(false);
  expect(await runtime.store.get(contactKey(email))).toBeUndefined();
  expect(
    (await request("/api/forms/confirm", { token: runtime.forms.token(row) }))
      .status,
  ).toBe(200);
  await Promise.all([runtime.forms.run(row.id), runtime.forms.run(row.id)]);
  let completed = await runtime.forms.response(row.id);
  // A conflicting worker can leave the durable job for the next dispatcher pass.
  if (completed.status === "pending") await runtime.forms.run(row.id);
  completed = await runtime.forms.response(row.id);
  expect(completed.status).toBe("complete");
  expect(await directory.contact(email)).toMatchObject({ name: "New reader" });
  expect((await directory.audience(audience.id)).contacts).toEqual([
    expect.objectContaining({ email, name: "New reader" }),
  ]);
  expect(
    await runtime.store.get(topicPreferenceKey(topic.id, email)),
  ).toMatchObject({ subscribed: true });
  expect(completed.acknowledgmentMessageId).toBeTruthy();
  await runtime.forms.run(row.id);
  expect((await runtime.forms.response(row.id)).acknowledgmentMessageId).toBe(
    completed.acknowledgmentMessageId,
  );
  const messages = (
    await runtime.store.list<Message>("messages#default", 10000)
  ).filter((m) => m.input.to.includes(email));
  expect(messages).toHaveLength(2);
  const token = runtime.forms.token(row);
  expect(await runtime.forms.confirm(token)).toEqual({ ok: true });
});
it("preserves existing unsubscribe choices and unrelated contact properties", async () => {
  const directory = runtime.broadcasts.directory,
    email = `${randomUUID()}@example.com`;
  const topic = await directory.saveTopic({
    name: `Preserved ${randomUUID()}`,
  });
  await directory.createContact({
    email,
    name: "Old name",
    first_name: "Keep me",
  });
  await directory.subscribe(email, topic.id, false, "Existing unsubscribe");
  await runtime.store.put({ pk: marketingKey(email), sk: "META" });
  const form = await runtime.forms.create({
    ...formStarters.signup,
    syncContacts: true,
    topicId: topic.id,
    from: "hello@narada.test",
  });
  await runtime.forms.publish(form.id, 0);
  const { row } = await submit(form.id, 1, {
    name: "New name",
    email,
    consent: true,
  });
  await runtime.forms.confirm(runtime.forms.token(row));
  await runtime.forms.run(row.id);
  expect(await directory.contact(email)).toMatchObject({
    name: "New name",
    first_name: "Keep me",
  });
  expect(
    await runtime.store.get(topicPreferenceKey(topic.id, email)),
  ).toMatchObject({ subscribed: false });
  expect(await runtime.store.get(marketingKey(email))).toBeTruthy();
});
it("does not subscribe without consent; retains responses when email processing fails", async () => {
  const directory = runtime.broadcasts.directory,
    email = `${randomUUID()}@example.com`;
  const topic = await directory.saveTopic({
    name: `No consent ${randomUUID()}`,
  });
  const form = await runtime.forms.create({
    ...formStarters.signup,
    syncContacts: true,
    topicId: topic.id,
    from: "hello@narada.test",
  });
  await runtime.forms.publish(form.id, 0);
  const { row } = await submit(form.id, 1, { email });
  await runtime.forms.confirm(runtime.forms.token(row));
  await runtime.forms.run(row.id);
  expect(
    await runtime.store.get(topicPreferenceKey(topic.id, email)),
  ).toBeUndefined();
  const suppressed = `${randomUUID()}@example.com`;
  await runtime.store.put({
    pk: `SUPPRESS#${suppressed}`,
    sk: "META",
    reason: "test",
  });
  const failure = await submit(form.id, 1, { email: suppressed });
  for (let i = 0; i < 6; i++) {
    await runtime.store.patch(failure.row.pk, { availableAt: 0 });
    await runtime.forms.run(failure.row.id);
  }
  const failed = await runtime.forms.response(failure.row.id);
  expect(failed.status).toBe("failed");
  expect(failed.answers.email).toBe(suppressed);
  expect(failed.error).toContain("suppressed");
  await runtime.store.remove(`SUPPRESS#${suppressed}`);
  await runtime.forms.retry(failed.id);
  await runtime.forms.run(failed.id);
  expect((await runtime.forms.response(failed.id)).status).toBe(
    "awaiting_verification",
  );
});
it("paginates responses, creates invitation drafts, and rate limits repeated email submissions", async () => {
  const form = await runtime.forms.create({
    ...formStarters.intake,
    acknowledgment: true,
    from: "hello@narada.test",
  });
  await runtime.forms.publish(form.id, 0);
  const email = `${randomUUID()}@example.com`;
  for (let i = 0; i < 3; i++)
    await submit(form.id, 1, { name: "Client", email, project: "Website" });
  const limited = await request(`/api/forms/${form.id}/responses`, {
    submissionId: randomUUID(),
    version: 1,
    answers: { name: "Client", email, project: "Website" },
  });
  expect(limited.status).toBe(429);
  const first = await (
    await request(
      `/api/admin/forms/${form.id}/responses?limit=1`,
      undefined,
      true,
    )
  ).json();
  expect(first.data).toHaveLength(1);
  expect(first.nextCursor).toBeTruthy();
  const second = await (
    await request(
      `/api/admin/forms/${form.id}/responses?limit=1&cursor=${first.nextCursor}`,
      undefined,
      true,
    )
  ).json();
  expect(second.data[0].id).not.toBe(first.data[0].id);
  const invitation = await request(
    `/api/admin/forms/${form.id}/broadcasts`,
    {},
    true,
  );
  expect(invitation.status).toBe(201);
  const broadcast = await invitation.json();
  expect(broadcast.draft.text).toContain(`/forms/${form.id}`);
  expect(broadcast.status).toBe("draft");
});
it("maps text and numeric answers into compatible properties and rejects expired verification", async () => {
  const key = `form_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const directory = runtime.broadcasts.directory;
  await directory.saveProperty({ key, type: "number" });
  const draft = {
    ...formStarters.intake,
    syncContacts: true,
    from: "hello@narada.test",
    questions: [
      ...formStarters.intake.questions,
      {
        id: "score",
        type: "rating" as const,
        label: "Priority",
        description: "",
        required: true,
        options: [],
        property: key,
      },
    ],
  };
  const form = await runtime.forms.create(draft);
  await runtime.forms.publish(form.id, 0);
  const email = `${randomUUID()}@example.com`;
  const { row } = await submit(form.id, 1, {
    name: "Client",
    email,
    project: "A project",
    score: 4,
  });
  await runtime.forms.confirm(runtime.forms.token(row));
  await runtime.forms.run(row.id);
  expect((await directory.contact(email)).properties[key]).toBe(4);
  const old = await submit(form.id, 1, {
    name: "Client",
    email: `${randomUUID()}@example.com`,
    project: "A project",
    score: 2,
  });
  const expired = {
    ...old.row,
    createdAt: new Date(Date.now() - 86401000).toISOString(),
  };
  await runtime.store.put(expired);
  await expect(
    runtime.forms.confirm(runtime.forms.token(expired)),
  ).rejects.toMatchObject({ status: 410 });
  expect(await runtime.store.get(contactKey(expired.email!))).toBeUndefined();
  const incompatible = await runtime.forms.create({
    ...draft,
    questions: draft.questions.map((q) =>
      q.id === "score" ? { ...q, type: "text" as const } : q,
    ),
  });
  await expect(runtime.forms.publish(incompatible.id, 0)).rejects.toMatchObject(
    { status: 422 },
  );
});

it("persists unfinished drafts without weakening publication or changing the live version", async () => {
  const form = await runtime.forms.create(formStarters.feedback);
  const published = await runtime.forms.publish(form.id, form.revision);
  const draft = {
    ...published.draft,
    name: "",
    questions: published.draft.questions.map((q, i) =>
      i === 0 ? { ...q, label: "" } : q,
    ),
  };
  const saved = await runtime.forms.update(form.id, draft, published.revision);
  expect(saved.draft.name).toBe("");
  expect(saved.revision).toBe(published.revision + 1);
  await expect(
    runtime.forms.publish(form.id, saved.revision),
  ).rejects.toThrow();
  expect(
    (await runtime.forms.version(form.id, published.version)).content.name,
  ).toBe(formStarters.feedback.name);
  expect((await runtime.forms.get(form.id)).version).toBe(published.version);
});
