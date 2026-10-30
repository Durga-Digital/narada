import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { z } from "zod";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import { createPublicationSite } from "../../apps/api/src/publication-site.js";
import type { Runtime } from "@narada/core/runtime";
import {
  PublicationDomains,
  type DomainConnection,
} from "@narada/core/publication-domains";
import {
  FakeDomainProvider,
  FakePublicationDns,
} from "../helpers/publication-domains.js";
import { operationSchemas } from "@narada/contracts/discovery";
import { scopes, type Scope } from "@narada/contracts/scopes";
import { Narada } from "../../packages/sdk/src/index.js";
import { hash } from "@narada/core/model";
import { workHandler } from "../../apps/worker/src/handlers.js";
import type { Publication } from "@narada/core/newsletter-model";
const prefix = `narada-pubdomains-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`,
  origin = "http://localhost:5173";
let runtime: Runtime,
  app: ReturnType<typeof createApp>,
  api: Narada,
  cookie: string;
let dns: FakePublicationDns, provider: FakeDomainProvider;
async function key(allowed: readonly Scope[] = scopes, resources = {}) {
  const key = await runtime.service.createKey(
    "Domain test",
    "operations",
    undefined,
    undefined,
    undefined,
    { scopes: [...allowed], resources },
  );
  return {
    ...key,
    api: new Narada({
      apiKey: key.token,
      baseUrl: origin,
      fetch: async (url, init) => app.request(new Request(url, init)),
    }),
  };
}
async function publication(active = true) {
  const pub = await runtime.publications.create({
    name: "Domain newsletter",
    slug: `domain-${randomUUID().slice(0, 8)}`,
    from: "hello@narada.test",
    organization: "Narada",
    postalAddress: "1 Test Street",
  });
  return active
    ? runtime.publications.update(pub.id, pub.settings, pub.revision, "active")
    : pub;
}
async function connect(pub: Publication) {
  const result = await api.publications.domain.configure(
    pub.id,
    { hostname: `news-${randomUUID().slice(0, 8)}.example.com`, revision: 0 },
    { idempotencyKey: randomUUID() },
  );
  const row = result.domain!;
  dns.set(row.records[0]!.name, "TXT", row.records[0]!.value);
  return row;
}
async function pass(id: string, count = 1) {
  for (let i = 0; i < count; i++)
    await workHandler(
      runtime,
      JSON.stringify({ kind: "publication-domain", id }),
    );
}
async function ready(pub: Publication) {
  const d = await connect(pub);
  await pass(d.id, 3);
  let row = (await runtime.publicationDomains.connection(pub.id))!;
  expect(row.distributionHostname).toBeTruthy();
  dns.set(row.hostname, "CNAME", row.distributionHostname!);
  dns.set(`_acm.${row.hostname}`, "CNAME", "_validation.acm-validations.aws.");
  await pass(row.id);
  row = (await runtime.publicationDomains.connection(pub.id))!;
  expect(row.status).toBe("ready");
  return row;
}
async function active(pub: Publication) {
  const row = await ready(pub);
  await api.publications.domain.activate(pub.id, { revision: row.revision });
  await pass(row.id);
  return (await runtime.publicationDomains.connection(pub.id))!;
}
function siteRequest(
  row: DomainConnection,
  path = "/",
  data?: Record<string, string>,
  extra: Record<string, string> = {},
) {
  return createPublicationSite(runtime).request(
    `https://origin.example.com${path}`,
    {
      method: data ? "POST" : "GET",
      headers: {
        "x-narada-binding": row.id,
        "x-narada-origin-secret": row.secret,
        "x-narada-public-host": row.hostname,
        ...(data
          ? {
              origin: `https://${row.hostname}`,
              "content-type": "application/x-www-form-urlencoded",
            }
          : {}),
        ...extra,
      },
      body: data ? new URLSearchParams(data) : undefined,
    },
  );
}
beforeAll(async () => {
  vi.stubEnv("APP_TABLE", `${prefix}-app`);
  vi.stubEnv("AUTH_TABLE", `${prefix}-auth`);
  runtime = await initialize(credentials);
  runtime.config.PUBLICATION_DOMAIN_LIMIT = 100;
  dns = new FakePublicationDns();
  provider = new FakeDomainProvider();
  runtime.publicationDomains = new PublicationDomains(
    runtime.store,
    dns,
    provider,
  );
  app = createApp(runtime);
  api = (await key()).api;
  const login = await app.request(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: await readFile(credentials, "utf8"),
  });
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});
afterAll(async () => {
  if (runtime)
    for (const TableName of [
      runtime.config.APP_TABLE,
      runtime.config.AUTH_TABLE,
    ])
      await runtime.store.client.send(new DeleteTableCommand({ TableName }));
  await rm(credentials, { force: true });
  vi.unstubAllEnvs();
});
it("accepts once through REST/SDK, projects safe schemas and activity, and preserves publication revisions", async () => {
  const pub = await publication(false),
    k = await key();
  expect((await k.api.publications.domain.get(pub.id)).domain).toBeNull();
  const body = { hostname: "News.First.Example.Com.", revision: 0 },
    idem = randomUUID();
  const response = await app.request(
    `${origin}/api/v1/publications/${pub.id}/domain`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${k.token}`,
        "content-type": "application/json",
        "idempotency-key": idem,
      },
      body: JSON.stringify(body),
    },
  );
  expect(response.status).toBe(202);
  expect(response.headers.get("operation-location")).toMatch(
    /^\/api\/v1\/operations\//,
  );
  const result = await response.json();
  z.fromJSONSchema(
    operationSchemas["publications.domain.configure"].output,
  ).parse(result);
  expect(result.domain.hostname).toBe("news.first.example.com");
  expect(JSON.stringify(result)).not.toMatch(
    /secret|certificateArn|distributionId/,
  );
  expect(
    await k.api.publications.domain.configure(pub.id, body, {
      idempotencyKey: idem,
    }),
  ).toEqual(result);
  expect((await runtime.publications.get(pub.id)).revision).toBe(pub.revision);
  const status = await k.api.operations.get(
    response.headers.get("x-operation-id")!,
  );
  expect(status.status).toBe("succeeded");
  expect(status.work).toContainEqual({
    kind: "publication-domain",
    status: "awaiting_ownership",
  });
  await expect(
    k.api.publications.domain.activate(pub.id, { revision: 1 }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    k.api.publications.domain.configure(pub.id, { ...body, revision: 1 }),
  ).rejects.toMatchObject({ status: 409 });
  const other = await publication(false);
  await expect(
    k.api.publications.domain.configure(other.id, { ...body, revision: 0 }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await k.api.publications.domain.get(other.id)).domain).toBeNull();
});
it("enforces new scopes, publication/sender restrictions, legacy exclusion, revocation and receipt privacy", async () => {
  const pub = await publication(),
    other = await publication();
  const allowed: Scope[] = [
    "narada:publications:read",
    "narada:publications:domains:write",
  ];
  const k = await key(allowed, {
    publicationIds: [pub.id],
    senderDomains: ["narada.test"],
  });
  const input = {
      hostname: `manual-${randomUUID().slice(0, 8)}.example.org`,
      revision: 0,
    },
    idem = randomUUID();
  const response = await k.api.publications.domain.configure(pub.id, input, {
    idempotencyKey: idem,
  });
  expect(response.domain?.hostname).toBe(input.hostname); // sender restriction is not a website parent restriction
  await expect(k.api.publications.domain.get(other.id)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    k.api.publications.domain.configure(other.id, input),
  ).rejects.toMatchObject({ status: 403 });
  for (const readScopes of [
    ["narada:publications:read"],
    ["narada:publications:write"],
    ["narada:publications:branding:write"],
  ] as Scope[][]) {
    const denied = await key(readScopes);
    await expect(
      denied.api.publications.domain.disconnect(pub.id, { revision: 1 }),
    ).rejects.toMatchObject({ status: 403 });
  }
  await runtime.store.put({
    pk: "DOMAIN#another.example",
    sk: "META",
    name: "another.example",
    verified: true,
  });
  const wrongSender = await key(allowed, {
    publicationIds: [pub.id],
    senderDomains: ["another.example"],
  });
  await expect(
    wrongSender.api.publications.domain.get(pub.id),
  ).rejects.toMatchObject({ status: 403 });
  const legacy = await runtime.service.createKey("Legacy full", "full");
  const denied = await app.request(
    `${origin}/api/v1/publications/${pub.id}/domain`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${legacy.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  expect(denied.status).toBe(403);
  await runtime.store.patch(`KEY#${hash(k.token)}`, { revoked: true });
  await expect(
    k.api.publications.domain.configure(pub.id, input, {
      idempotencyKey: idem,
    }),
  ).rejects.toMatchObject({ status: 401 });
});
it("requires fresh proof and guards competing configure requests atomically", async () => {
  const pub = await publication(false),
    other = await publication(false),
    hostname = `race-${randomUUID().slice(0, 8)}.example.com`;
  const results = await Promise.allSettled([
    api.publications.domain.configure(pub.id, { hostname, revision: 0 }),
    api.publications.domain.configure(other.id, { hostname, revision: 0 }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const winner = results[0]!.status === "fulfilled" ? pub : other;
  const row = (await runtime.publicationDomains.connection(winner.id))!;
  await pass(row.id);
  expect(provider.certificates.has(row.id)).toBe(false);
  await api.publications.domain.disconnect(winner.id, {
    revision: row.revision,
  });
  await pass(row.id);
  const disconnected = (await api.publications.domain.get(winner.id)).domain!;
  expect(disconnected.state).toBe("disconnected");
  dns.set(row.records[0]!.name, "TXT", row.records[0]!.value);
  const next = (
    await api.publications.domain.configure(winner.id, {
      hostname,
      revision: disconnected.revision,
    })
  ).domain!;
  expect(next.id).not.toBe(row.id);
  expect(next.records[0]!.value).not.toBe(row.records[0]!.value);
  await pass(next.id);
  expect(provider.certificates.has(next.id)).toBe(false);
  await expect(
    api.publications.domain.disconnect(winner.id, { revision: row.revision }),
  ).rejects.toMatchObject({ status: 409 });
});
it("recovers lost certificate/distribution responses without duplicates, and retains disabled hosting until DNS detaches", async () => {
  const pub = await publication(),
    d = await connect(pub),
    beforeCert = provider.certCreates,
    beforeDist = provider.distributionCreates;
  await pass(d.id);
  provider.loseCertificate = true;
  await pass(d.id);
  await pass(d.id);
  provider.loseDistribution = true;
  await pass(d.id);
  await pass(d.id);
  let row = (await runtime.publicationDomains.connection(pub.id))!;
  expect(provider.certCreates - beforeCert).toBe(1);
  expect(provider.distributionCreates - beforeDist).toBe(1);
  dns.set(row.hostname, "CNAME", row.distributionHostname!);
  await pass(d.id);
  row = (await runtime.publicationDomains.connection(pub.id))!;
  await api.publications.domain.activate(pub.id, { revision: row.revision });
  await pass(d.id);
  row = (await runtime.publicationDomains.connection(pub.id))!;
  expect(row.status).toBe("active");
  const result = await api.publications.domain.disconnect(pub.id, {
    revision: row.revision,
  });
  expect(result.preferredUrl).toBe(result.defaultUrl);
  expect((await siteRequest(row)).status).toBe(404);
  await pass(d.id);
  expect(provider.distributions.get(d.id)?.status).toBe("disabled");
  expect((await api.publications.domain.get(pub.id)).domain?.state).toBe(
    "disconnecting",
  );
  dns.set(row.hostname, "CNAME");
  await pass(d.id, 2);
  expect(provider.distributions.has(d.id)).toBe(false);
  expect(provider.certificates.has(d.id)).toBe(false);
  expect((await api.publications.domain.get(pub.id)).domain?.state).toBe(
    "disconnected",
  );
});
it("does not resurrect a disconnected generation after a concurrent provider response", async () => {
  const pub = await publication(),
    d = await connect(pub);
  await pass(d.id, 2);
  provider.beforeDistribution = async () => {
    await api.publications.domain.disconnect(pub.id, { revision: d.revision });
  };
  try {
    await pass(d.id);
  } finally {
    provider.beforeDistribution = undefined;
  }
  const row = (await runtime.publicationDomains.connection(pub.id))!;
  expect(row.desired).toBe("disconnected");
  expect(row.status).toBe("disconnecting");
  expect((await siteRequest(row)).status).toBe(404);
  // Expired worker lease models crash recovery; reconciles the created distribution.
  await runtime.store.patch(row.pk, { leaseUntil: 0 });
  await pass(d.id, 4);
  expect((await api.publications.domain.get(pub.id)).domain?.state).toBe(
    "disconnected",
  );
});
it("requires valid origin binding and preserves custom/default navigation, signup, stable confirmation links and private pages", async () => {
  const pub = await publication(),
    row = await active(pub),
    site = createPublicationSite(runtime);
  expect((await site.request("https://origin.example.com/")).status).toBe(404);
  for (const extra of [
    { "x-narada-public-host": row.distributionHostname! },
    { "x-narada-origin-secret": "a".repeat(64) },
    { "x-narada-binding": randomUUID() },
  ] as Record<string, string>[])
    expect((await siteRequest(row, "/", undefined, extra)).status).toBe(404);
  for (const path of [
    "/api/admin/publications",
    "/api/v1/publications",
    "/oauth/authorize",
    `/n/${pub.settings.slug}`,
    "/p/private",
  ])
    expect((await siteRequest(row, path)).status).toBe(404);
  const home = await siteRequest(row),
    html = await home.text();
  expect(html).toContain('action="/subscribe"');
  expect(html).toContain('href="/archive"');
  expect(html).toContain(`rel="canonical" href="https://${row.hostname}"`);
  expect(home.headers.get("content-security-policy")).toContain(origin);
  const fallback = await app.request(origin + `/n/${pub.settings.slug}`);
  expect(await fallback.text()).toContain(
    `rel="canonical" href="https://${row.hostname}"`,
  );
  expect((await siteRequest(row, "/archive")).status).toBe(200);
  const submissionId = randomUUID(),
    email = `${randomUUID()}@example.com`,
    form = await runtime.forms.get(pub.formId);
  const input = {
    email,
    name: "Reader",
    website: "",
    version: String(form.version),
    submissionId,
  };
  expect(
    (
      await siteRequest(row, "/subscribe", input, {
        origin: "https://evil.example.com",
      })
    ).status,
  ).toBe(403);
  expect((await siteRequest(row, "/subscribe", input)).status).toBe(200);
  const response = await runtime.forms.response(
      hash(`${pub.formId}:${submissionId}`),
    ),
    token = runtime.forms.token(response);
  expect((await runtime.publications.subscribers(pub.id)).eligible).toBe(0);
  const confirmation = await siteRequest(row, "/confirm", { token });
  expect(await confirmation.text()).toContain(`${origin}/api/unsubscribe/`);
  expect(confirmation.headers.get("cache-control")).toBe("no-store");
  expect((await runtime.publications.subscribers(pub.id)).eligible).toBe(1);
  const other = await publication(),
    otherRow = await active(other);
  expect((await siteRequest(otherRow, "/confirm", { token })).status).toBe(400);
  const draft = await publication(false),
    draftRow = await active(draft);
  expect((await siteRequest(draftRow)).status).toBe(404);
  await api.publications.domain.disconnect(pub.id, { revision: row.revision });
  expect(
    (
      await app.request(
        origin + `/n/${pub.settings.slug}/confirm?token=${token}`,
      )
    ).status,
  ).toBe(200);
  expect((await app.request(origin + `/n/${pub.settings.slug}`)).status).toBe(
    200,
  );
});
it("handles unknown DNS, confirmed loss and certificate invalidation without granting ownership", async () => {
  const pub = await publication(),
    row = await active(pub),
    owner = row.records.find((r) => r.purpose === "ownership")!;
  dns.answers.set(`TXT:${owner.name}`, { status: "unknown", values: [] });
  await pass(row.id);
  expect((await api.publications.domain.get(pub.id)).preferredUrl).toBe(
    `https://${row.hostname}`,
  );
  dns.set(owner.name, "TXT");
  await pass(row.id, 3);
  await runtime.store.patch(row.pk, { ownershipLossAt: Date.now() - 301_000 });
  await pass(row.id);
  expect((await api.publications.domain.get(pub.id)).domain?.state).toBe(
    "suspended",
  );
  expect((await siteRequest(row)).status).toBe(404);
  dns.set(owner.name, "TXT", owner.value);
  await pass(row.id);
  expect((await api.publications.domain.get(pub.id)).domain?.state).toBe(
    "active",
  );
  provider.certificateStatus = "invalid";
  try {
    await pass(row.id);
    expect((await api.publications.domain.get(pub.id)).domain?.state).toBe(
      "suspended",
    );
  } finally {
    provider.certificateStatus = "issued";
  }
});
it("dashboard uses the same revisions and requires same-origin owner requests", async () => {
  const pub = await publication();
  const body = JSON.stringify({
    hostname: `owner-${randomUUID().slice(0, 8)}.example.com`,
    revision: 0,
  });
  const url = `${origin}/api/admin/publications/${pub.id}/domain`;
  const response = await app.request(url, {
    method: "PUT",
    headers: {
      cookie,
      origin,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body,
  });
  expect(response.status).toBe(202);
  expect(response.headers.get("operation-location")).toBeTruthy();
  expect(
    (
      await app.request(url, {
        method: "PUT",
        headers: {
          cookie,
          origin: "https://evil.example.com",
          "content-type": "application/json",
        },
        body,
      })
    ).status,
  ).toBe(403);
});

it("blocks occupied DNS hosts, pending certificates, early activation and excessive checks", async () => {
  const occupied = await publication(),
    d = await connect(occupied);
  dns.set(d.hostname, "MX", "mail.example.com");
  await pass(d.id);
  expect((await api.publications.domain.get(occupied.id)).domain?.state).toBe(
    "failed",
  );
  expect(provider.certificates.has(d.id)).toBe(false);
  const pub = await publication(),
    pending = await connect(pub);
  await expect(
    api.publications.domain.check(pub.id, { revision: pending.revision }),
  ).rejects.toMatchObject({ status: 429 });
  provider.certificateStatus = "pending";
  try {
    await pass(pending.id, 2);
  } finally {
    provider.certificateStatus = "issued";
  }
  expect((await api.publications.domain.get(pub.id)).domain?.state).toBe(
    "awaiting_certificate",
  );
  expect(provider.distributions.has(pending.id)).toBe(false);
  await expect(
    api.publications.domain.activate(pub.id, { revision: pending.revision }),
  ).rejects.toMatchObject({ status: 409 });
  await runtime.store.patch(`PUBLICATIONDOMAIN#${pending.id}`, {
    checkRequestedAt: 0,
  });
  const checks = await Promise.allSettled([
    api.publications.domain.check(pub.id, { revision: pending.revision }),
    api.publications.domain.check(pub.id, { revision: pending.revision }),
  ]);
  expect(checks.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("rechecks readiness before activation, keeps archives public and hides withdrawn issues", async () => {
  const pub = await publication(),
    row = await ready(pub);
  await api.publications.domain.activate(pub.id, { revision: row.revision });
  dns.probeOk = false;
  try {
    await pass(row.id);
  } finally {
    dns.probeOk = true;
  }
  expect((await api.publications.domain.get(pub.id)).domain?.state).toBe(
    "degraded",
  );
  expect((await siteRequest(row)).status).toBe(404);
  await pass(row.id);
  const issue = await runtime.issues.create(pub.id, {
    title: "Public story",
    slug: "public-story",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Story content" }],
        },
      ],
    },
  });
  const published = await runtime.issues.publish(
    pub.id,
    issue.id,
    issue.revision,
    "web",
  );
  expect(await (await siteRequest(row, "/p/public-story")).text()).toContain(
    "Story content",
  );
  await runtime.issues.withdraw(pub.id, issue.id, published.revision);
  expect((await siteRequest(row, "/p/public-story")).status).toBe(404);
  await runtime.publications.update(
    pub.id,
    pub.settings,
    pub.revision,
    "archived",
  );
  expect((await siteRequest(row, "/archive")).status).toBe(200);
  expect((await siteRequest(row, "/subscribe")).status).toBe(410);
});

it("preserves the owner domain array and offers the shared bounded selector projection", async () => {
  const old = await app.request(origin + "/api/admin/domains", {
    headers: { cookie },
  });
  expect(old.status).toBe(200);
  expect(Array.isArray(await old.json())).toBe(true);
  const page = await app.request(origin + "/api/admin/domains?view=page", {
    headers: { cookie },
  });
  expect(page.status).toBe(200);
  const data = await page.json();
  z.fromJSONSchema(operationSchemas["domains.list"].output).parse(data);
  expect(data.data.length).toBeLessThanOrEqual(20);
  expect(
    data.data.some((d: { name: string }) => d.name === "narada.test"),
  ).toBe(true);
});

it("reauthorizes the historical sender on replay after both publication and grant sender change", async () => {
  const pub = await publication();
  const allowed: Scope[] = [
    "narada:publications:read",
    "narada:publications:domains:write",
  ];
  const k = await key(allowed, {
    publicationIds: [pub.id],
    senderDomains: ["narada.test"],
  });
  const input = {
      hostname: `history-${randomUUID().slice(0, 8)}.example.com`,
      revision: 0,
    },
    idempotencyKey = randomUUID();
  await k.api.publications.domain.configure(pub.id, input, { idempotencyKey });
  await runtime.store.put({
    pk: "DOMAIN#second.test",
    sk: "META",
    name: "second.test",
    verified: true,
    scope: "domains",
    sort: "second.test",
    records: [],
    local: true,
  });
  await runtime.publications.update(
    pub.id,
    { ...pub.settings, from: "hello@second.test" },
    pub.revision,
  );
  await runtime.store.patch(`KEY#${hash(k.token)}`, {
    operationAccess: {
      scopes: allowed,
      resources: { publicationIds: [pub.id], senderDomains: ["second.test"] },
    },
  });
  expect((await k.api.publications.domain.get(pub.id)).domain).not.toBeNull();
  await expect(
    k.api.publications.domain.configure(pub.id, input, { idempotencyKey }),
  ).rejects.toMatchObject({ status: 403 });
});

it("reports renewal warnings once per day and recovers cleanup after bounded provider failures", async () => {
  const pub = await publication(),
    row = await active(pub);
  provider.certificates.get(row.id)!.expiresAt = new Date(
    Date.now() + 10 * 86400_000,
  ).toISOString();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await pass(row.id, 2);
    expect(
      warn.mock.calls.filter((args) =>
        String(args[0]).includes("publication_domain_certificate_expiring"),
      ),
    ).toHaveLength(1);
  } finally {
    warn.mockRestore();
  }
  expect((await api.publications.domain.get(pub.id)).domain?.message).toContain(
    "expires within 30 days",
  );
  await api.publications.domain.disconnect(pub.id, { revision: row.revision });
  const disable = vi
    .spyOn(provider, "disable")
    .mockRejectedValue(new Error("Provider temporarily unavailable"));
  try {
    await pass(row.id, 8);
  } finally {
    disable.mockRestore();
  }
  const failed = (await runtime.publicationDomains.connection(pub.id))!;
  expect(failed.status).toBe("failed");
  expect(failed.desired).toBe("disconnected");
  expect(failed.state).toBe("complete");
  expect((await siteRequest(row)).status).toBe(404);
  await runtime.store.patch(failed.pk, { checkRequestedAt: 0 });
  await api.publications.domain.check(pub.id, { revision: failed.revision });
  await pass(row.id);
  expect((await api.publications.domain.get(pub.id)).domain?.state).toBe(
    "disconnecting",
  );
});

it("serves About and collection pages through the authenticated custom-domain origin", async () => {
  const pub = await publication(),
    row = await active(pub);
  const about = await api.publications.about.update(pub.id, {
    revision: 0,
    draft: {
      title: "About our newsletter",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Independent reporting" }],
          },
        ],
      },
    },
  });
  await api.publications.about.publish(pub.id, { revision: about.revision });
  const col = await api.publications.collections.create(pub.id, {
    name: "Research",
    slug: "research",
    description: "Deep analysis",
  });
  const site = await api.publications.site.update(pub.id, {
    revision: 0,
    draft: {
      navigation: [
        { type: "home", label: "Home" },
        { type: "about", label: "About" },
        { type: "collection", label: "Research", collectionId: col.id },
      ],
      featuredIssueId: null,
      collectionIds: [col.id],
    },
  });
  await api.publications.site.publish(pub.id, { revision: site.revision });
  for (const path of ["/about", "/c/research"]) {
    const response = await siteRequest(row, path);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("index");
    const html = await response.text();
    expect(html).toContain(`href="https://${row.hostname}${path}"`);
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/c/research"');
    expect(
      (
        await siteRequest(row, path, undefined, {
          "x-narada-origin-secret": "invalid",
        })
      ).status,
    ).toBe(404);
  }
  for (const path of [
    "/api/admin/publications",
    "/c/research/admin",
    "/about/preview",
    "/site",
  ]) {
    expect((await siteRequest(row, path)).status).toBe(404);
  }
});
