import { publicNewsletterRoutes } from "../../apps/api/src/newsletter-routes.js";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { z } from "zod";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import type { Runtime } from "@narada/core/runtime";
import { MediaService, LocalMediaStorage } from "@narada/core/media";
import { PublicationBrandingService } from "@narada/core/publication-branding";
import { hash } from "@narada/core/model";
import { defaultBranding } from "@narada/contracts/branding";
import { operations } from "@narada/contracts/operations";
import { operationSchemas } from "@narada/contracts/discovery";
import { scopes, type Scope } from "@narada/contracts/scopes";
import { Narada, type Publication } from "../../packages/sdk/src/index.js";

const prefix = `narada-site-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`;
const origin = "http://localhost:5173";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=",
  "base64",
);
const input = { fileName: "logo.png", contentBase64: png.toString("base64") };
let r: Runtime,
  app: ReturnType<typeof createApp>,
  api: Narada,
  token: string,
  cookie: string,
  directory: string;
const request = (
  key: string,
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
  retry?: string,
) =>
  app.request(origin + "/api/v1" + path, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(retry ? { "idempotency-key": retry } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
function client(key: string) {
  return new Narada({
    baseUrl: origin,
    apiKey: key,
    fetch: async (url, init) => {
      const response = await app.request(new Request(url, init));
      const op = operations.find(
        (op) =>
          "http" in op &&
          op.http.method === (init?.method ?? "GET") &&
          new RegExp(`^${op.http.path.replace(/:[a-zA-Z]+/g, "[^/]+")}$`).test(
            new URL(String(url)).pathname,
          ),
      );
      if (response.ok && op)
        expect(
          z
            .fromJSONSchema(operationSchemas[op.id].output)
            .safeParse(await response.clone().json()).success,
          op.id,
        ).toBe(true);
      return response;
    },
  });
}
async function key(
  allowed: readonly Scope[] = scopes,
  publicationIds?: string[],
) {
  const k = await r.service.createKey(
    "Branding test",
    "operations",
    undefined,
    undefined,
    undefined,
    {
      scopes: [...allowed],
      resources: publicationIds ? { publicationIds } : {},
    },
  );
  return { ...k, api: client(k.token) };
}
async function publication(active = false) {
  let p = await api.publications.create({
    name: "Studio",
    slug: `studio-${randomUUID().slice(0, 8)}`,
    from: "hello@narada.test",
    author: "Editor",
    organization: "Studio",
    postalAddress: "1 Test Street",
  });
  if (active)
    p = await api.publications.activate(p.id, { revision: p.revision });
  return p;
}
beforeAll(async () => {
  vi.stubEnv("APP_TABLE", `${prefix}-app`);
  vi.stubEnv("AUTH_TABLE", `${prefix}-auth`);
  r = await initialize(credentials);
  directory = await mkdtemp(join(tmpdir(), "narada-site-"));
  r.media = new MediaService(r.store, new LocalMediaStorage(directory));
  app = createApp(r);
  const owner = await readFile(credentials, "utf8");
  const login = await app.request(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: owner,
  });
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const k = await key();
  api = k.api;
  token = k.token;
});
// Separate callers keep the integration fixtures below the real per-key API limit.
beforeEach(async () => {
  const fresh = await key();
  api = fresh.api;
  token = fresh.token;
});
afterAll(async () => {
  if (r)
    for (const TableName of [r.config.APP_TABLE, r.config.AUTH_TABLE])
      await r.store.client.send(new DeleteTableCommand({ TableName }));
  await rm(credentials, { force: true });
  if (directory) await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const document = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
async function issue(
  p: Publication,
  title = "A public letter",
  publish = true,
) {
  let i = await api.issues.create(p.id, {
    title,
    slug: `letter-${randomUUID().slice(0, 8)}`,
    document: document("The original public content"),
  });
  if (publish)
    i = await api.issues.publish(p.id, i.id, {
      revision: i.revision,
      channels: "web",
      confirmed: true,
    });
  return i;
}
async function web(p: Publication, path = "") {
  const res = await app.request(`${origin}/n/${p.settings.slug}${path}`);
  return { status: res.status, html: await res.text() };
}
it("allows the configured asset host in public page image policy", async () => {
  const p = await publication(true);
  const routes = publicNewsletterRoutes({
    ...r,
    config: { ...r.config, ASSET_ORIGIN: "https://assets.example.test" },
  });
  const response = await routes.request(`${origin}/${p.settings.slug}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-security-policy")).toContain(
    `img-src 'self' ${origin} https://assets.example.test https://i.ytimg.com;`,
  );
});
it("publishes About snapshots, preserves draft privacy and recovers exact mutations", async () => {
  const p = await publication(true);
  expect((await api.publications.about.get(p.id)).revision).toBe(0);
  let saved = await api.publications.about.update(p.id, {
    revision: 0,
    draft: { title: "Our story", document: document("Public introduction") },
  });
  expect((await web(p, "/about")).status).toBe(404);
  const preview = await api.publications.about.preview(p.id, {
    revision: saved.revision,
  });
  expect(preview.html).toContain("Public introduction");
  expect(preview.html).toContain("noindex");
  const retry = randomUUID(),
    request = { revision: saved.revision };
  const live = await api.publications.about.publish(p.id, request, {
    idempotencyKey: retry,
  });
  expect((await web(p, "/about")).html).toContain("Public introduction");
  saved = await api.publications.about.update(p.id, {
    revision: live.revision,
    draft: {
      title: "Private revision",
      document: document("Secret new draft"),
    },
  });
  expect(
    await api.publications.about.publish(p.id, request, {
      idempotencyKey: retry,
    }),
  ).toEqual(live);
  expect((await web(p, "/about")).html).not.toContain("Secret new draft");
  await expect(
    api.publications.about.update(p.id, {
      revision: live.revision,
      draft: saved.draft,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await api.publications.about.withdraw(p.id, { revision: saved.revision });
  expect((await web(p, "/about")).status).toBe(404);
});
it("curates published content, filters collections and removes withdrawn/archived targets", async () => {
  const p = await publication(true),
    col = await api.publications.collections.create(p.id, {
      name: "Deep Dives",
      slug: "deep-dives",
      description: "Careful research",
    });
  let a = await issue(p),
    b = await issue(p, "PRIVATE ARTICLE", false);
  const assignment = await api.issues.collections.update(p.id, a.id, {
    revision: 0,
    issueRevision: a.revision,
    collectionIds: [col.id],
  });
  await api.issues.collections.update(p.id, b.id, {
    revision: 0,
    issueRevision: b.revision,
    collectionIds: [col.id],
  });
  const filtered = await api.issues.list(p.id, {
    collectionId: col.id,
    status: "draft",
  });
  expect(filtered.data.map((i) => i.id)).toEqual([b.id]);
  expect(
    (await api.issues.list(p.id, { collectionId: col.id })).data,
  ).toHaveLength(2);
  let publicPage = await web(p, "/c/deep-dives");
  expect(publicPage.status).toBe(200);
  expect(publicPage.html).toContain(a.draft.title);
  expect(publicPage.html).not.toContain("PRIVATE ARTICLE");
  a = await api.issues.update(p.id, a.id, {
    revision: assignment.issueRevision,
    draft: {
      ...a.draft,
      title: "PRIVATE TITLE",
      document: document("PRIVATE BODY"),
    },
  });
  let site = await api.publications.site.update(p.id, {
    revision: 0,
    draft: {
      navigation: [
        { type: "home", label: "Home" },
        { type: "collection", label: "Research", collectionId: col.id },
        {
          type: "external",
          label: "Books <safe>",
          url: "https://example.com/?a=1&b=2",
        },
      ],
      featuredIssueId: a.id,
      collectionIds: [col.id],
    },
  });
  expect((await web(p)).html).not.toContain("View all Deep Dives");
  const preview = await api.publications.site.preview(p.id, {
    revision: site.revision,
  });
  expect(preview.html).toContain("View all Deep Dives");
  expect(preview.html).not.toContain("PRIVATE TITLE");
  site = await api.publications.site.publish(p.id, { revision: site.revision });
  const home = await web(p);
  expect(home.html).toContain("View all Deep Dives");
  expect(home.html).toContain('href="/n/' + p.settings.slug + '/c/deep-dives"');
  expect(home.html).toContain("Books &lt;safe&gt;");
  expect(home.html).not.toContain("PRIVATE TITLE");
  a = await api.issues.withdraw(p.id, a.id, { revision: a.revision });
  publicPage = await web(p, "/c/deep-dives");
  expect(publicPage.html).not.toContain("A public letter");
  expect((await web(p)).html).not.toContain("A public letter");
  await api.publications.collections.archive(p.id, col.id, {
    revision: col.revision,
  });
  expect((await web(p, "/c/deep-dives")).status).toBe(404);
  expect((await web(p)).html).not.toContain("View all Deep Dives");
  const fallback = await api.publications.site.preview(p.id, {
    revision: site.revision,
  });
  expect(fallback.html).not.toContain("A public letter");
  expect(fallback.html).not.toContain("View all Deep Dives");
  await expect(
    api.publications.collections.create(p.id, {
      name: "Another",
      slug: col.slug,
      description: "",
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("guards linked resources, scopes, unsafe navigation and old clients", async () => {
  const p = await publication(true),
    other = await publication(true),
    c = await api.publications.collections.create(other.id, {
      name: "Foreign",
      slug: "foreign",
      description: "",
    });
  const reader = await key(["narada:publications:read"], [p.id]);
  await expect(
    reader.api.publications.site.update(p.id, {
      revision: 0,
      draft: { navigation: [], featuredIssueId: null, collectionIds: [] },
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    reader.api.publications.about.get(other.id),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api.publications.site.update(p.id, {
      revision: 0,
      draft: { navigation: [], featuredIssueId: null, collectionIds: [c.id] },
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    api.publications.site.update(p.id, {
      revision: 0,
      draft: {
        navigation: [
          { type: "external", label: "Bad", url: "javascript:alert(1)" },
        ],
        featuredIssueId: null,
        collectionIds: [],
      },
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    api.publications.site.update(p.id, {
      revision: 0,
      draft: {
        navigation: [
          {
            type: "external",
            label: "Bad",
            url: "https://user:secret@example.com",
          },
        ],
        featuredIssueId: null,
        collectionIds: [],
      },
    }),
  ).rejects.toMatchObject({ status: 400 });
  const site = await api.publications.site.update(p.id, {
    revision: 0,
    draft: {
      navigation: [{ type: "about", label: "About" }],
      featuredIssueId: null,
      collectionIds: [],
    },
  });
  await expect(
    api.publications.site.publish(p.id, { revision: site.revision }),
  ).rejects.toMatchObject({ status: 422 });
  const old = await r.service.createKey("Legacy", "full");
  await expect(
    client(old.token).publications.site.update(p.id, {
      revision: site.revision,
      draft: site.draft,
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect((await api.publications.get(p.id)).settings).toEqual(p.settings);
});
it("serializes classification races and keeps subscriptions and email content untouched", async () => {
  const p = await publication(true),
    col = await api.publications.collections.create(p.id, {
      name: "Series",
      slug: "series",
      description: "",
    }),
    a = await issue(p);
  const before = await r.publications.get(p.id),
    version = await r.issues.version(
      (await r.issues.get(p.id, a.id)).publicVersionId!,
    );
  const input = {
      revision: 0,
      issueRevision: a.revision,
      collectionIds: [col.id],
    },
    retry = randomUUID();
  const assigned = await api.issues.collections.update(p.id, a.id, input, {
    idempotencyKey: retry,
  });
  expect(
    await api.issues.collections.update(p.id, a.id, input, {
      idempotencyKey: retry,
    }),
  ).toEqual(assigned);
  await expect(
    api.issues.collections.update(p.id, a.id, input),
  ).rejects.toMatchObject({ status: 409 });
  const current = await api.issues.get(p.id, a.id);
  const results = await Promise.allSettled([
    api.issues.collections.update(p.id, a.id, {
      revision: assigned.revision,
      issueRevision: current.revision,
      collectionIds: [],
    }),
    api.issues.update(p.id, a.id, {
      revision: current.revision,
      draft: { ...current.draft, title: "Concurrent draft" },
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const after = await r.publications.get(p.id);
  expect(after).toEqual(before);
  expect(await r.issues.version(version.id)).toEqual(version);
  expect(await r.store.list(`subscribers#${p.id}`)).toEqual([]);
});
it("paginates assignments and rejects cursors reused with a different filter", async () => {
  const p = await publication(true),
    col = await api.publications.collections.create(p.id, {
      name: "Series",
      slug: "series",
      description: "",
    });
  for (let n = 0; n < 3; n++) {
    const a = await issue(p, `Issue ${n}`, false);
    await api.issues.collections.update(p.id, a.id, {
      revision: 0,
      issueRevision: a.revision,
      collectionIds: [col.id],
    });
  }
  const page = await api.issues.list(p.id, {
    collectionId: col.id,
    status: "draft",
    limit: 1,
  });
  expect(page.data).toHaveLength(1);
  expect(page.nextCursor).toBeTruthy();
  const next = await api.issues.list(p.id, {
    collectionId: col.id,
    status: "draft",
    limit: 1,
    cursor: page.nextCursor!,
  });
  expect(next.data[0]!.id).not.toBe(page.data[0]!.id);
  await expect(
    api.issues.list(p.id, { status: "draft", cursor: page.nextCursor! }),
  ).rejects.toMatchObject({ status: 400 });
});
it("uses root-relative routes on custom domains and rechecks replay permissions", async () => {
  const p = await publication(true),
    col = await api.publications.collections.create(p.id, {
      name: "Deep dives",
      slug: "deep-dives",
      description: "",
    });
  const a = await issue(p);
  await api.issues.collections.update(p.id, a.id, {
    revision: 0,
    issueRevision: a.revision,
    collectionIds: [col.id],
  });
  let about = await api.publications.about.update(p.id, {
    revision: 0,
    draft: { title: "About us", document: document("Our story") },
  });
  await api.publications.about.publish(p.id, { revision: about.revision });
  let site = await api.publications.site.update(p.id, {
    revision: 0,
    draft: {
      navigation: [
        { type: "home", label: "Home" },
        { type: "about", label: "About" },
        { type: "collection", label: "Research", collectionId: col.id },
      ],
      featuredIssueId: a.id,
      collectionIds: [col.id],
    },
  });
  await api.publications.site.publish(p.id, { revision: site.revision });
  const routes = publicNewsletterRoutes(r, {
    publicationId: p.id,
    origin: "https://news.example.test",
    pathPrefix: "",
  });
  for (const path of [
    "/",
    "/about",
    "/c/deep-dives",
    "/p/" + a.draft.slug,
    "/archive",
  ]) {
    const res = await routes.request("https://news.example.test" + path);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/c/deep-dives"');
    expect(html).not.toContain(`href="/n/${p.settings.slug}`);
  }
  const writer = await key(
    ["narada:publications:read", "narada:publications:site:write"],
    [p.id],
  );
  about = await api.publications.about.get(p.id);
  const input = {
      revision: about.revision,
      draft: { title: "Saved draft", document: document("Not public") },
    },
    retry = randomUUID();
  await writer.api.publications.about.update(p.id, input, {
    idempotencyKey: retry,
  });
  const record = await r.store.get(`KEY#${hash(writer.token)}`);
  await r.store.put({
    ...record!,
    operationAccess: {
      scopes: ["narada:publications:read"],
      resources: { publicationIds: [p.id] },
    },
  });
  await expect(
    writer.api.publications.about.update(p.id, input, {
      idempotencyKey: retry,
    }),
  ).rejects.toMatchObject({ status: 403 });
});
it("caps active collections atomically and keeps removed assignments out of stale indexes", async () => {
  const p = await publication(true);
  const cols = [];
  for (let n = 0; n < 19; n++)
    cols.push(
      await api.publications.collections.create(p.id, {
        name: `Series ${n}`,
        slug: `series-${n}`,
        description: "",
      }),
    );
  const race = await Promise.allSettled(
    ["a", "b"].map((suffix) =>
      api.publications.collections.create(p.id, {
        name: suffix,
        slug: suffix,
        description: "",
      }),
    ),
  );
  expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(
    api.publications.collections.create(p.id, {
      name: "Excess",
      slug: "excess",
      description: "",
    }),
  ).rejects.toMatchObject({ status: 422 });
  const c = cols[0]!,
    a = await issue(p);
  const assigned = await api.issues.collections.update(p.id, a.id, {
    revision: 0,
    issueRevision: a.revision,
    collectionIds: [c.id],
  });
  const edge = await r.store.get(`COLLECTIONISSUE#${p.id}#${c.id}#${a.id}`);
  await api.issues.collections.update(p.id, a.id, {
    revision: assigned.revision,
    issueRevision: assigned.issueRevision,
    collectionIds: [],
  });
  await r.store.put(edge!); // Simulate a stale membership/index candidate.
  expect((await web(p, `/c/${c.slug}`)).html).not.toContain("A public letter");
  await api.publications.collections.archive(p.id, c.id, {
    revision: c.revision,
  });
  expect(
    (
      await api.publications.collections.create(p.id, {
        name: "Replacement",
        slug: "replacement",
        description: "",
      })
    ).status,
  ).toBe("active");
});
it("allows empty private About drafts but refuses publication and unsafe document nodes", async () => {
  const p = await publication(true),
    draft = await api.publications.about.update(p.id, {
      revision: 0,
      draft: {
        title: "About",
        document: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });
  expect(
    (await api.publications.about.preview(p.id, { revision: draft.revision }))
      .html,
  ).toContain("<h1>About</h1>");
  await expect(
    api.publications.about.publish(p.id, { revision: draft.revision }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    api.publications.about.update(p.id, {
      revision: draft.revision,
      draft: {
        title: "About",
        document: {
          type: "doc",
          content: [{ type: "script", text: "alert(1)" }],
        },
      },
    }),
  ).rejects.toMatchObject({ status: 422 });
  const saved = await api.publications.about.update(p.id, {
    revision: draft.revision,
    draft: { title: "About", document: document("Real introduction") },
  });
  await api.publications.about.publish(p.id, { revision: saved.revision });
  expect((await web(p, "/about")).html.match(/<h1>/g)).toHaveLength(1);
});
it("indexes collection membership when a draft is published or a scheduled issue releases", async () => {
  const p = await publication(true),
    c = await api.publications.collections.create(p.id, {
      name: "Series",
      slug: "series",
      description: "",
    });
  let a = await issue(p, "Scheduled story", false);
  let assignment = await api.issues.collections.update(p.id, a.id, {
    revision: 0,
    issueRevision: a.revision,
    collectionIds: [c.id],
  });
  a = await api.issues.publish(p.id, a.id, {
    revision: assignment.issueRevision,
    channels: "web",
    confirmed: true,
    scheduledAt: Date.now() + 120000,
  });
  expect((await web(p, "/c/series")).html).not.toContain("Scheduled story");
  const internal = await r.issues.get(p.id, a.id);
  await r.store.patch(`PUBLICATIONOP#${internal.operationId}`, {
    scheduledAt: Date.now() - 1,
  });
  await r.issues.run(internal.operationId!);
  expect((await web(p, "/c/series")).html).toContain("Scheduled story");
  a = await api.issues.get(p.id, a.id);
  a = await api.issues.update(p.id, a.id, {
    revision: a.revision,
    draft: { ...a.draft, title: "Corrected story" },
  });
  expect((await web(p, "/c/series")).html).not.toContain("Corrected story");
  await api.issues.publish(p.id, a.id, {
    revision: a.revision,
    channels: "web",
    confirmed: true,
  });
  expect((await web(p, "/c/series")).html).toContain("Corrected story");
  expect((await api.issues.collections.get(p.id, a.id)).collectionIds).toEqual([
    c.id,
  ]);
});
