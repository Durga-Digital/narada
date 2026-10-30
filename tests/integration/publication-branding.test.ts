import { afterAll, beforeAll, expect, it, vi } from "vitest";
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

const prefix = `narada-branding-${randomUUID().slice(0, 8)}`,
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
  directory = await mkdtemp(join(tmpdir(), "narada-branding-"));
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
afterAll(async () => {
  if (r)
    for (const TableName of [r.config.APP_TABLE, r.config.AUTH_TABLE])
      await r.store.client.send(new DeleteTableCommand({ TableName }));
  await rm(credentials, { force: true });
  if (directory) await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it("SDK uploads, previews, saves and replays without changing emails or older settings behavior", async () => {
  let p = await publication(true);
  const before = await api.publications.preview(p.id);
  expect(before.html).toContain('data-theme="classic"');
  const uploadKey = randomUUID();
  const logo = await api.publications.logo.uploadBytes(
    p.id,
    { fileName: "logo.png", bytes: png },
    { idempotencyKey: uploadKey },
  );
  expect(
    await api.publications.logo.upload(p.id, input, {
      idempotencyKey: uploadKey,
    }),
  ).toEqual(logo);
  expect((await api.publications.get(p.id)).revision).toBe(p.revision);
  expect((await api.publications.get(p.id)).branding).toBeUndefined();
  const branding = {
    ...defaultBranding,
    theme: "editorial" as const,
    logoAssetId: logo.id,
    logoAlt: "Studio mark",
    welcomeText: "Our weekly notes.\nWelcome aboard.",
  };
  const draftPreview = await api.publications.branding.preview(p.id, {
    branding,
    revision: p.revision,
  });
  expect(draftPreview.html).toContain('data-theme="editorial"');
  expect(draftPreview.html).toContain(logo.url);
  expect(draftPreview.html).toContain("<fieldset disabled>");
  expect(draftPreview.html).not.toContain("<a href=");
  expect(
    await (await app.request(origin + `/n/${p.settings.slug}`)).text(),
  ).not.toContain("Our weekly notes.");
  const snapshot = await r.issues.create(p.id, {
    title: "Private issue",
    slug: "private",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello readers" }],
        },
      ],
    },
  });
  const emailBefore = await r.issues.preview(p.id, snapshot.id);
  const saveKey = randomUUID(),
    body = { branding, revision: p.revision };
  p = await api.publications.branding.update(p.id, body, {
    idempotencyKey: saveKey,
  });
  expect(
    await api.publications.branding.update(p.id, body, {
      idempotencyKey: saveKey,
    }),
  ).toEqual(p);
  expect(
    (
      await request(
        token,
        `/publications/${p.id}/branding`,
        { ...body, branding: { ...branding, welcomeText: "changed" } },
        "PUT",
        saveKey,
      )
    ).status,
  ).toBe(409);
  const html = await (
    await app.request(origin + `/n/${p.settings.slug}`)
  ).text();
  expect(html).toContain(logo.url);
  expect(html).toContain("Our weekly notes.");
  expect(html).not.toContain("Private issue");
  const asset = await app.request(logo.url);
  expect(Buffer.from(await asset.arrayBuffer())).toEqual(png);
  expect(asset.headers.get("cache-control")).toContain("immutable");
  p = await api.publications.update(p.id, {
    settings: { ...p.settings, description: "Updated by an older client" },
    revision: p.revision,
  });
  expect(p.branding).toEqual(branding);
  expect(await r.issues.preview(p.id, snapshot.id)).toEqual(emailBefore);
  p = await api.publications.branding.update(p.id, {
    branding: { ...branding, logoAssetId: null, logoAlt: "" },
    revision: p.revision,
  });
  expect((await api.publications.preview(p.id)).html).not.toContain(logo.url);
  expect((await app.request(logo.url)).status).toBe(200);
});
it("denies old grants and cross-publication assets before metadata access, including receipt replay", async () => {
  const a = await publication(),
    b = await publication();
  const reader = await key(
    ["narada:publications:read", "narada:publications:write"],
    [a.id],
  );
  const writer = await key(
    ["narada:publications:read", "narada:publications:branding:write"],
    [a.id],
  );
  const old = await r.service.createKey("Old key", "full");
  expect(
    (await request(old.token, `/publications/${a.id}/logo`, input)).status,
  ).toBe(403);
  expect(
    (await request(reader.token, `/publications/${a.id}/logo`, input)).status,
  ).toBe(403);
  const upload = vi.spyOn(r.media, "prepareUpload");
  expect(
    (await request(writer.token, `/publications/${b.id}/logo`, input)).status,
  ).toBe(403);
  expect(upload).not.toHaveBeenCalled();
  upload.mockRestore();
  const logo = await api.publications.logo.upload(b.id, input);
  const branding = { ...defaultBranding, logoAssetId: logo.id };
  for (const [suffix, method] of [
    ["branding", "PUT"],
    ["branding/preview", "POST"],
  ])
    expect(
      (
        await request(
          writer.token,
          `/publications/${a.id}/${suffix}`,
          { branding, revision: a.revision },
          method,
        )
      ).status,
    ).toBe(422);
  const retry = randomUUID();
  await writer.api.publications.logo.upload(a.id, input, {
    idempotencyKey: retry,
  });
  const record = await r.store.get(`KEY#${hash(writer.token)}`);
  expect(record).toBeDefined();
  await r.store.put({
    ...record!,
    operationAccess: {
      scopes: ["narada:publications:read"],
      resources: { publicationIds: [a.id] },
    },
  });
  expect(
    (
      await request(
        writer.token,
        `/publications/${a.id}/logo`,
        input,
        "POST",
        retry,
      )
    ).status,
  ).toBe(403);
});
it("validates uploads and handles concurrent branding/settings edits without silent overwrites", async () => {
  const p = await publication();
  for (const body of [
    {
      fileName: "evil.svg",
      contentBase64: Buffer.from('<svg onload="bad()"/>').toString("base64"),
    },
    { ...input, contentBase64: "%%%invalid%%%" },
    {
      ...input,
      contentBase64: Buffer.alloc(512 * 1024 + 1).toString("base64"),
    },
    { ...input, fileName: "x".repeat(161) },
    {
      fileName: "a.gif",
      contentBase64: Buffer.from(
        "GIF89a\x01\x00\x01\x00\x00\x00\x00;",
        "binary",
      ).toString("base64"),
    },
  ])
    expect(
      (await request(token, `/publications/${p.id}/logo`, body)).status,
    ).toBeGreaterThanOrEqual(400);
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(2049, 16);
  expect(
    (
      await request(token, `/publications/${p.id}/logo`, {
        ...input,
        contentBase64: oversized.toString("base64"),
      })
    ).status,
  ).toBe(422);
  const responses = await Promise.all([
    request(
      token,
      `/publications/${p.id}/branding`,
      { branding: defaultBranding, revision: p.revision },
      "PUT",
    ),
    request(
      token,
      `/publications/${p.id}`,
      { settings: { ...p.settings, name: "Race" }, revision: p.revision },
      "PUT",
    ),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (
      await request(token, `/publications/${p.id}/branding/preview`, {
        branding: defaultBranding,
        revision: p.revision,
      })
    ).status,
  ).toBe(409);
});
it("commits logo association and media metadata only with successful publication acceptance", async () => {
  const p = await r.publications.get((await publication()).id);
  const service = new PublicationBrandingService(r);
  // A different valid header creates a distinct hash without mutating any existing asset.
  const bytes = Buffer.from(png);
  bytes.writeUInt32BE(2, 16);
  await expect(
    service.upload(
      p,
      { ...input, contentBase64: bytes.toString("base64") },
      async () => {
        throw new Error("acceptance failed");
      },
    ),
  ).rejects.toThrow("acceptance failed");
  const asset = await service.upload(p, {
    ...input,
    contentBase64: bytes.toString("base64"),
  });
  expect(
    await service.logo(p, { ...defaultBranding, logoAssetId: asset.id }),
  ).toEqual(asset);
  expect((await r.publications.get(p.id)).revision).toBe(p.revision);
});
it("serves only public issues, themes all public pages, preserves signup controls and archive states", async () => {
  let p = await publication(true);
  const logo = await api.publications.logo.upload(p.id, input);
  for (let n = 0; n < 8; n++) {
    const issue = await r.issues.create(p.id, {
      title: `Visible ${n}`,
      slug: `visible-${n}`,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello readers" }],
          },
        ],
      },
    });
    await r.issues.publish(p.id, issue.id, issue.revision, "web");
  }
  const hidden = await r.issues.create(p.id, {
    title: "Withdrawn secret",
    slug: "withdrawn",
    document: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello readers" }],
        },
      ],
    },
  });
  await r.issues.publish(p.id, hidden.id, hidden.revision, "web");
  const published = await r.issues.get(p.id, hidden.id);
  await r.issues.withdraw(p.id, hidden.id, published.revision);
  for (const theme of ["classic", "editorial", "minimal"] as const) {
    p = await api.publications.branding.update(p.id, {
      branding: { ...defaultBranding, theme, logoAssetId: logo.id },
      revision: p.revision,
    });
    for (const suffix of ["", "/archive", "/subscribe", "/p/visible-0"]) {
      const res = await app.request(origin + `/n/${p.settings.slug}${suffix}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`data-theme="${theme}"`);
      expect(html).toContain(logo.url);
      expect(html).not.toContain("Withdrawn secret");
      if (!suffix) {
        expect(html.match(/class="issue-card /g)).toHaveLength(6);
        expect(html).toContain('name="submissionId"');
        expect(html).toContain('name="version"');
        expect(html).toContain('action="/n/');
      }
    }
  }
  expect(
    (
      await app.request(origin + `/n/${p.settings.slug}/subscribe`, {
        method: "POST",
        headers: { origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  p = await api.publications.archive(p.id, { revision: p.revision });
  const html = await (
    await app.request(origin + `/n/${p.settings.slug}`)
  ).text();
  expect(html).toContain("archived");
  expect(html).not.toContain("<form");
  expect(html).toContain("Visible");
  expect(
    (await app.request(origin + `/n/${p.settings.slug}/subscribe`)).status,
  ).toBe(410);
  const draft = await publication();
  expect((await app.request(origin + `/n/${draft.settings.slug}`)).status).toBe(
    404,
  );
});
it("dashboard handlers use the same validation and require owner origin", async () => {
  const p = await publication();
  const res = await app.request(
    origin + `/api/admin/publications/${p.id}/logo`,
    {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  expect(res.status).toBe(201);
  const preview = await app.request(
    origin + `/api/admin/publications/${p.id}/branding/preview`,
    {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ branding: defaultBranding, revision: p.revision }),
    },
  );
  expect(preview.status).toBe(200);
  expect(preview.headers.get("cache-control")).toBe("no-store");
  expect(
    (
      await app.request(origin + `/api/admin/publications/${p.id}/logo`, {
        method: "POST",
        headers: {
          cookie,
          origin: "https://evil.test",
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(403);
});
it("supports fixed layouts, scoped assets, signup copy and old-client preservation", async () => {
  let p = await publication(true);
  const other = await publication();
  const retry = randomUUID();
  const asset = await api.publications.assets.upload(p.id, input, {
    idempotencyKey: retry,
  });
  expect(
    await api.publications.assets.upload(p.id, input, {
      idempotencyKey: retry,
    }),
  ).toEqual(asset);
  const restricted = await key(
    ["narada:publications:branding:write"],
    [other.id],
  );
  await expect(
    restricted.api.publications.assets.upload(p.id, input),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api.publications.branding.update(other.id, {
      revision: other.revision,
      branding: { ...defaultBranding, wordmarkAssetId: asset.id },
    }),
  ).rejects.toMatchObject({ status: 422 });
  for (const layout of ["letter", "feature", "grid"] as const) {
    p = await api.publications.branding.update(p.id, {
      revision: p.revision,
      branding: {
        ...defaultBranding,
        layout,
        wordmarkAssetId: asset.id,
        wordmarkAlt: "Studio <mark>",
        coverAssetId: asset.id,
        signupHeading: "Weekly <notes>",
        signupDescription: "Every Friday.",
        signupButton: "Join us",
        signupName: false,
      },
    });
    const html = await (
      await app.request(origin + `/n/${p.settings.slug}`)
    ).text();
    expect(html).toContain(`class="layout-${layout}"`);
    expect(html).toContain('class="publication-wordmark"');
    expect(html).toContain('class="publication-cover"');
    expect(html).toContain("Weekly &lt;notes&gt;");
    expect(html).toContain("Every Friday.");
    expect(html).toContain(">Join us</button>");
    expect(html).not.toContain('name="name"');
    expect(html).toContain('name="submissionId"');
    expect(html).toContain("Confirm your address to join");
    expect(html).toContain('aria-current="page">Home');
    const archive = await (
      await app.request(origin + `/n/${p.settings.slug}/archive`)
    ).text();
    expect(archive).toContain("<h1>Archive</h1>");
    expect(archive).toContain('aria-current="page">Archive');
  }
  p = await api.publications.branding.update(p.id, {
    revision: p.revision,
    branding: { ...defaultBranding, theme: "minimal" },
  });
  expect(p.branding?.layout).toBe("grid");
  expect(p.branding?.wordmarkAssetId).toBe(asset.id);
  expect(p.branding?.signupButton).toBe("Join us");
  await expect(
    api.publications.branding.update(p.id, {
      revision: p.revision,
      branding: { ...defaultBranding, layout: "<script>" as never },
    }),
  ).rejects.toMatchObject({ status: 400 });
});
it("keeps issue cover drafts private, preserves older-client edits and rejects foreign assets", async () => {
  const p = await publication(true),
    other = await publication(true);
  const asset = await api.publications.assets.upload(p.id, input);
  const draft = {
    title: "Cover story",
    slug: "cover-story",
    document: {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    },
  };
  await expect(
    api.issues.create(other.id, { ...draft, coverAssetId: asset.id }),
  ).rejects.toMatchObject({ status: 422 });
  let issue = await api.issues.create(p.id, {
    ...draft,
    coverAssetId: asset.id,
    coverAlt: "Published cover",
  });
  expect((await api.issues.preview(p.id, issue.id)).web.html).toContain(
    asset.url,
  );
  expect((await api.issues.preview(p.id, issue.id)).email.html).not.toContain(
    asset.url,
  );
  issue = await api.issues.publish(p.id, issue.id, {
    revision: issue.revision,
    channels: "web",
    confirmed: true,
  });
  const bytes = Buffer.from(png);
  bytes.writeUInt32BE(3, 16);
  const replacement = await api.publications.assets.upload(p.id, {
    fileName: "cover.png",
    contentBase64: bytes.toString("base64"),
  });
  issue = await api.issues.update(p.id, issue.id, {
    revision: issue.revision,
    draft: {
      ...draft,
      coverAssetId: replacement.id,
      coverAlt: "Private cover",
    },
  });
  issue = await api.issues.update(p.id, issue.id, {
    revision: issue.revision,
    draft: { ...draft, title: "Older client edit" },
  });
  expect(issue.draft.coverAssetId).toBe(replacement.id);
  for (const path of ["", "/archive", "/p/cover-story"]) {
    const html = await (
      await app.request(origin + `/n/${p.settings.slug}${path}`)
    ).text();
    expect(html).toContain(asset.url);
    expect(html).not.toContain(replacement.url);
    expect(html).not.toContain("Private cover");
  }
});
it("deletes only pristine drafts with revision guards, scoped replay and hidden tombstones", async () => {
  const p = await publication(true);
  const draft = {
    title: "Discard me",
    slug: "discard",
    document: {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello readers" }],
        },
      ],
    },
  };
  const issue = await api.issues.create(p.id, draft);
  const writer = await key(
    ["narada:issues:read", "narada:issues:write"],
    [p.id],
  );
  await expect(
    writer.api.issues.delete(p.id, issue.id, { revision: issue.revision }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api.issues.delete(p.id, issue.id, { revision: 99 }),
  ).rejects.toMatchObject({ status: 409 });
  const deleter = await key(["narada:issues:delete"], [p.id]);
  const retry = randomUUID();
  const result = await deleter.api.issues.delete(
    p.id,
    issue.id,
    { revision: issue.revision },
    { idempotencyKey: retry },
  );
  expect(result).toEqual({ id: issue.id, deleted: true });
  expect(
    await deleter.api.issues.delete(
      p.id,
      issue.id,
      { revision: issue.revision },
      { idempotencyKey: retry },
    ),
  ).toEqual(result);
  await expect(api.issues.get(p.id, issue.id)).rejects.toMatchObject({
    status: 404,
  });
  expect((await api.issues.list(p.id)).data).toHaveLength(0);
  expect((await r.issues.list(p.id)).data).toHaveLength(0);
  expect((await r.store.get(`ISSUE#${issue.id}`))?.deletedAt).toBeTruthy();
  expect(
    (await r.issues.get(p.id, issue.id, true)).draft.document.content,
  ).toEqual([]);
  const record = await r.store.get(`KEY#${hash(deleter.token)}`);
  await r.store.put({
    ...record!,
    operationAccess: {
      scopes: ["narada:issues:read"],
      resources: { publicationIds: [p.id] },
    },
  });
  await expect(
    deleter.api.issues.delete(
      p.id,
      issue.id,
      { revision: issue.revision },
      { idempotencyKey: retry },
    ),
  ).rejects.toMatchObject({ status: 403 });
  let published = await api.issues.create(p.id, {
    ...draft,
    slug: "published",
  });
  published = await api.issues.publish(p.id, published.id, {
    revision: published.revision,
    channels: "web",
    confirmed: true,
  });
  expect(published.canDelete).toBe(false);
  await expect(
    api.issues.delete(p.id, published.id, { revision: published.revision }),
  ).rejects.toMatchObject({ status: 409 });
  published = await api.issues.withdraw(p.id, published.id, {
    revision: published.revision,
  });
  expect(published.status).toBe("withdrawn");
  await expect(
    api.issues.delete(p.id, published.id, { revision: published.revision }),
  ).rejects.toMatchObject({ status: 409 });
});
it("filters issues across pages and prevents deletion racing publication", async () => {
  const p = await publication(true);
  const draft = {
    title: "Status test",
    slug: "status",
    document: {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Content" }] },
      ],
    },
  };
  const older = await api.issues.create(p.id, draft);
  for (let n = 0; n < 21; n++) {
    const issue = await api.issues.create(p.id, {
      ...draft,
      slug: `status-${n}`,
    });
    await r.store.put({
      ...(await r.issues.get(p.id, issue.id)),
      emailReleased: true,
    });
  }
  let drafts = await api.issues.list(p.id, { status: "draft", limit: 2 });
  const found = [...drafts.data];
  while (drafts.nextCursor) {
    drafts = await api.issues.list(p.id, {
      status: "draft",
      limit: 2,
      cursor: drafts.nextCursor,
    });
    found.push(...drafts.data);
  }
  expect(found.map((i) => i.id)).toContain(older.id);
  expect(found.every((i) => i.status === "draft")).toBe(true);
  const sent = await api.issues.list(p.id, { status: "sent", limit: 2 });
  expect(sent.data).toHaveLength(2);
  expect(sent.nextCursor).toBeTruthy();
  expect(
    (
      await api.issues.list(p.id, {
        status: "sent",
        limit: 2,
        cursor: sent.nextCursor!,
      })
    ).data.every((i) => i.status === "sent"),
  ).toBe(true);
  const results = await Promise.allSettled([
    api.issues.delete(p.id, older.id, { revision: older.revision }),
    api.issues.publish(p.id, older.id, {
      revision: older.revision,
      channels: "web",
      confirmed: true,
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const current = await r.store.get(`ISSUE#${older.id}`);
  expect(!!current?.deletedAt && !!current?.publicVersionId).toBe(false);
});
it("uses the image upload body budget and rejects oversized or foreign issue covers", async () => {
  const p = await publication(true),
    other = await publication(true);
  const response = await request(token, `/publications/${p.id}/assets`, {
    fileName: "invalid.png",
    contentBase64: Buffer.alloc(300000).toString("base64"),
  });
  expect(response.status).toBe(422); // reaches image validation, not the ordinary 350 KB JSON limit
  const responseTooLarge = await request(
    token,
    `/publications/${p.id}/assets`,
    {
      fileName: "invalid.png",
      contentBase64: Buffer.alloc(600000).toString("base64"),
    },
  );
  expect(responseTooLarge.status).toBe(413);
  const d = await api.issues.create(p.id, {
    title: "Private",
    slug: "private",
    document: { type: "doc", content: [{ type: "paragraph" }] },
  });
  const restricted = await key(["narada:issues:delete"], [other.id]);
  await expect(
    restricted.api.issues.delete(p.id, d.id, { revision: d.revision }),
  ).rejects.toMatchObject({ status: 403 });
});
