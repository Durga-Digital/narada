import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { initialize } from "../../scripts/local.js";
import { createApp } from "../../apps/api/src/app.js";
import type { Runtime } from "@narada/core/runtime";
import { LocalMediaStorage, MediaService } from "@narada/core/media";
import type { MediaAsset } from "@narada/core/media-content";
const prefix = `narada-media-${randomUUID().slice(0, 8)}`,
  credentials = `.local/${prefix}.json`;
const origin = "http://localhost:5173";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=",
  "base64",
);
let r: Runtime,
  app: ReturnType<typeof createApp>,
  cookie: string,
  directory: string;
beforeAll(async () => {
  process.env.APP_TABLE = `${prefix}-app`;
  process.env.AUTH_TABLE = `${prefix}-auth`;
  r = await initialize(credentials);
  directory = await mkdtemp(join(tmpdir(), "narada-media-integration-"));
  r.media = new MediaService(r.store, new LocalMediaStorage(directory));
  app = createApp(r);
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
  if (r)
    for (const TableName of [r.config.APP_TABLE, r.config.AUTH_TABLE])
      await r.store.client.send(new DeleteTableCommand({ TableName }));
  await rm(credentials, { force: true });
  if (directory) await rm(directory, { recursive: true, force: true });
});
function upload(body: Uint8Array = png, headers = { cookie, origin }) {
  return app.request(origin + "/api/admin/media", {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "text/html",
      "x-file-name": encodeURIComponent("hello.png"),
      "idempotency-key": "binary-upload-retry",
    },
    body: new Uint8Array(body),
  });
}
it("requires owner authentication and same-origin upload, with bounded body size", async () => {
  expect((await upload(png, { cookie: "", origin })).status).toBe(401);
  expect(
    (await upload(png, { cookie, origin: "https://evil.test" })).status,
  ).toBe(403);
  expect((await upload(Buffer.alloc(3 * 1024 * 1024 + 1))).status).toBe(413);
  expect((await upload(Buffer.from('<svg onload="evil()"/>'))).status).toBe(
    422,
  );
  expect((await app.request(origin + "/api/admin/media")).status).toBe(401);
});
it("deduplicates retry uploads, lists assets, and serves public immutable bytes with the detected type", async () => {
  const a = await upload();
  expect(a.status).toBe(201);
  const first: MediaAsset = await a.json();
  const second: MediaAsset = await (await upload()).json();
  expect(second).toEqual(first);
  const page = await (
    await app.request(origin + "/api/admin/media", { headers: { cookie } })
  ).json();
  expect(
    page.data.filter((asset: MediaAsset) => asset.id === first.id),
  ).toHaveLength(1);
  expect(
    (
      await app.request(origin + "/api/admin/media?cursor=invalid", {
        headers: { cookie },
      })
    ).status,
  ).toBe(400);
  const image = await app.request(first.url);
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(image.headers.get("x-content-type-options")).toBe("nosniff");
  expect(image.headers.get("cross-origin-resource-policy")).toBe(
    "cross-origin",
  );
  expect(image.headers.get("cache-control")).toContain("immutable");
  expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
  expect((await app.request(origin + "/media/not-an-image.svg")).status).toBe(
    404,
  );
});
it("preserves media through save, preview, web publication and email draft rendering", async () => {
  const asset: MediaAsset = await (await upload()).json();
  let pub = await r.publications.create({
    name: "Media",
    slug: `media-${randomUUID().slice(0, 8)}`,
    from: "hello@narada.test",
    author: "Editor",
    organization: "Narada",
    postalAddress: "1 Test Street",
  });
  pub = await r.publications.update(pub.id, pub.settings, 0, "active");
  let issue = await r.issues.create(pub.id, {
    title: "Media issue",
    slug: "media-issue",
    document: { type: "doc", content: [] },
  });
  const document = {
    type: "doc",
    content: [
      {
        type: "image",
        attrs: { src: asset.url, alt: "A pixel", width: 1, height: 1 },
      },
      {
        type: "youtube",
        attrs: { src: "https://youtu.be/dQw4w9WgXcQ", title: "Demo" },
      },
    ],
  };
  issue = await r.issues.update(
    pub.id,
    issue.id,
    { ...issue.draft, title: "Media issue", document },
    issue.revision,
  );
  const preview = await r.issues.preview(pub.id, issue.id);
  expect(preview.web.html).toContain("<iframe");
  expect(preview.email.html).not.toContain("<iframe");
  expect(preview.email.html).toContain(asset.url);
  const published = await r.issues.publish(
    pub.id,
    issue.id,
    issue.revision,
    "web",
  );
  const article = await app.request(
    origin + `/n/${pub.settings.slug}/p/${published.draft.slug}`,
  );
  // Archive routing and CSP permit only hosted images and the known player origin.
  expect(article.status).toBe(200);
  expect(await article.text()).toContain("youtube-nocookie.com/embed");
  expect(article.headers.get("content-security-policy")).toContain(
    "frame-src https://www.youtube-nocookie.com",
  );
  expect((await r.issues.get(pub.id, issue.id)).draft.document).toEqual(
    document,
  );
  expect(r.issues.draft(pub, published).html).not.toContain("<iframe");
});
