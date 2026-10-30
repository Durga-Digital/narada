import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Runtime } from "@narada/core/runtime";
import { AppError } from "@narada/core/model";
import { MAX_IMAGE_BYTES } from "@narada/core/media-content";
import { LocalMediaStorage } from "@narada/core/media";

export function mediaRoutes({ media }: Runtime) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/media", async (c) => c.json(await media.list(c.req.query())));
  app.post(
    "/media",
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES,
      onError: () => {
        throw new AppError(413, "Choose an image under 3 MB");
      },
    }),
    async (c) => {
      let name: string;
      try {
        name = decodeURIComponent(c.req.header("x-file-name") ?? "Image");
      } catch {
        throw new AppError(400, "Invalid file name");
      }
      return c.json(
        await media.upload(new Uint8Array(await c.req.arrayBuffer()), name),
        201,
      );
    },
  );
  return app;
}
export function localMediaRoutes({ media }: Runtime) {
  const app = new Hono();
  app.get("/media/:name", async (c) => {
    if (!(media.storage instanceof LocalMediaStorage))
      throw new AppError(404, "Image not found");
    const name = c.req.param("name"),
      bytes = await media.storage.get(`media/${name}`);
    c.header(
      "Content-Type",
      name.endsWith(".png")
        ? "image/png"
        : name.endsWith(".jpg")
          ? "image/jpeg"
          : "image/gif",
    );
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    c.header("X-Content-Type-Options", "nosniff");
    // Images are embedded by webmail and opaque-origin sandboxed previews.
    c.header("Cross-Origin-Resource-Policy", "cross-origin");
    c.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return c.body(new Uint8Array(bytes));
  });
  return app;
}
