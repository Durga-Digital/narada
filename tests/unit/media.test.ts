import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectImage,
  LocalMediaStorage,
  S3MediaStorage,
} from "@narada/core/media";
import {
  MAX_IMAGE_BYTES,
  hostedImageUrl,
  youtubeVideo,
} from "@narada/core/media-content";
import { renderIssue } from "@narada/core/newsletter-content";
import { issueInput } from "@narada/core/newsletter-model";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=",
  "base64",
);
const origin = "https://news.example.com";
const key = "media/" + "a".repeat(64) + ".png";
const src = origin + "/" + key;
const draft = (node: unknown) =>
  issueInput.parse({
    title: "Media story",
    slug: "media-story",
    document: { type: "doc", content: [node] },
  });
it("identifies raster types from bytes, with size and pixel limits", () => {
  expect(inspectImage(png)).toMatchObject({
    contentType: "image/png",
    width: 1,
    height: 1,
  });
  const gif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );
  expect(inspectImage(gif)).toMatchObject({
    contentType: "image/gif",
    width: 1,
    height: 1,
  });
  expect(() => inspectImage(Buffer.alloc(MAX_IMAGE_BYTES + 1))).toThrow(
    "under 3 MB",
  );
  const large = Buffer.from(png);
  large.writeUInt32BE(5000, 16);
  large.writeUInt32BE(5000, 20);
  expect(() => inspectImage(large)).toThrow("16 megapixels");
});
it.each([
  Buffer.from('<svg onload="alert(1)"/>'),
  Buffer.from("<html>image.png</html>"),
  png.subarray(0, 35),
  Buffer.alloc(0),
])("rejects unsafe or incomplete uploads", (bytes) =>
  expect(() => inspectImage(bytes)).toThrow(),
);
it("stores immutable local objects and refuses traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "narada-media-"));
  try {
    const storage = new LocalMediaStorage(dir);
    await storage.put(key, png);
    await storage.put(key, Buffer.from("changed"));
    expect(await storage.get(key)).toEqual(png);
    await expect(storage.get("../../secret")).rejects.toThrow("not found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("sends private, immutable typed objects to S3 and tolerates an existing object", async () => {
  const send = vi.fn().mockResolvedValue({});
  const storage = new S3MediaStorage("stage-media", { send } as never);
  await storage.put(key, png, "image/png");
  expect(send.mock.calls[0]![0].input).toMatchObject({
    Bucket: "stage-media",
    Key: key,
    ContentType: "image/png",
    IfNoneMatch: "*",
    CacheControl: "public, max-age=31536000, immutable",
  });
  expect(send.mock.calls[0]![0].input.ACL).toBeUndefined();
  send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 412 } });
  await expect(storage.put(key, png, "image/png")).resolves.toBeUndefined();
  send.mockRejectedValueOnce(new Error("denied"));
  await expect(storage.put(key, png, "image/png")).rejects.toThrow("denied");
});
it.each([
  "https://youtu.be/dQw4w9WgXcQ?t=20",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
  "https://youtube.com/shorts/dQw4w9WgXcQ",
  "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
])("normalizes YouTube URLs: %s", (url) =>
  expect(youtubeVideo(url)?.id).toBe("dQw4w9WgXcQ"),
);
it.each([
  "javascript:alert(1)",
  "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
  "https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ",
  "https://user@youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtube.com/watch?v=<script>",
  "https://youtube.com/playlist?list=abc",
])("does not embed arbitrary URLs: %s", (url) =>
  expect(youtubeVideo(url)).toBeNull(),
);
it("restricts newsletter images to immutable media in the current environment", () => {
  expect(hostedImageUrl(src, origin)).toBe(src);
  for (const value of [
    src + "?download=1",
    src.replace("news.", "staging."),
    "data:image/png;base64,abc",
    origin + "/api/auth",
    "https://user@news.example.com/" + key,
  ])
    expect(hostedImageUrl(value, origin)).toBeNull();
  const content = draft({
    type: "image",
    attrs: {
      src,
      alt: "A <mountain>",
      width: 1200,
      height: 600,
      onerror: "evil()",
    },
  });
  const rendered = renderIssue(content, { origin });
  expect(rendered.html).toContain('width="680" height="340"');
  expect(rendered.html).toContain('alt="A &lt;mountain&gt;"');
  expect(rendered.html).not.toContain("onerror");
  expect(rendered.text).toContain(src);
  expect(() =>
    renderIssue(content, { origin: "https://other.example.com" }),
  ).toThrow("image library");
});
it("separates web video players from email thumbnails and escapes titles", () => {
  const content = draft({
    type: "youtube",
    attrs: { src: "https://youtu.be/dQw4w9WgXcQ", title: "Demo <script>" },
  });
  const web = renderIssue(content, { target: "web" }),
    email = renderIssue(content);
  expect(web.html).toContain(
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  expect(web.html).toContain(
    'referrerpolicy="strict-origin-when-cross-origin"',
  );
  expect(web.html).not.toContain("<script>");
  expect(email.html).not.toMatch(/iframe|youtube-nocookie/);
  expect(email.html).toContain(
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  expect(email.text).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  expect(() =>
    renderIssue(draft({ type: "youtube", attrs: { src: "https://evil.com" } })),
  ).toThrow("valid YouTube");
});
