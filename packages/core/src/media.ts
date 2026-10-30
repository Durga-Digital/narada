import { assetOrigin } from "./origins.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Config } from "./config.js";
import { AppError, type Entity } from "./model.js";
import { conditional, type Store } from "./store.js";
import { ProductPagination } from "./product-pagination.js";
import {
  MAX_IMAGE_BYTES,
  mediaKeyPattern,
  type MediaAsset,
} from "./media-content.js";

/** Header/dimension validation, not a decoder. Only raster types are served, with nosniff. */
export function inspectImage(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new AppError(413, "Choose an image under 3 MB");
  const b = Buffer.from(bytes);
  let width = 0,
    height = 0,
    extension = "",
    contentType = "";
  if (
    b.length >= 45 &&
    b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    b.toString("ascii", 12, 16) === "IHDR" &&
    b.readUInt32BE(8) === 13 &&
    b.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))
  ) {
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
    extension = "png";
    contentType = "image/png";
  } else if (
    b.length >= 14 &&
    /^GIF8[79]a$/.test(b.toString("ascii", 0, 6)) &&
    b.at(-1) === 0x3b
  ) {
    width = b.readUInt16LE(6);
    height = b.readUInt16LE(8);
    extension = "gif";
    contentType = "image/gif";
  } else if (
    b[0] === 0xff &&
    b[1] === 0xd8 &&
    b.at(-2) === 0xff &&
    b.at(-1) === 0xd9
  ) {
    let offset = 2;
    while (offset + 4 <= b.length) {
      if (b[offset++] !== 0xff) break;
      while (b[offset] === 0xff) offset++;
      const marker = b[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > b.length) break;
      const length = b.readUInt16BE(offset);
      if (length < 2 || offset + length > b.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker!) && length >= 8) {
        height = b.readUInt16BE(offset + 3);
        width = b.readUInt16BE(offset + 5);
        extension = "jpg";
        contentType = "image/jpeg";
        break;
      }
      offset += length;
    }
  }
  if (!extension || !width || !height)
    throw new AppError(422, "Upload a valid PNG, JPEG or GIF image");
  if (width > 8000 || height > 8000 || width * height > 16_000_000)
    throw new AppError(
      422,
      "Images must be at most 8,000 pixels per side and 16 megapixels",
    );
  return { width, height, extension, contentType };
}
export interface MediaStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}
export class S3MediaStorage implements MediaStorage {
  constructor(
    private bucket: string,
    private client: Pick<S3Client, "send">,
  ) {}
  async put(key: string, bytes: Uint8Array, contentType: string) {
    if (!mediaKeyPattern.test(key)) throw new Error("Invalid media key");
    await this.client
      .send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
          ContentDisposition: "inline",
          IfNoneMatch: "*",
        }),
      )
      .catch((error: unknown) => {
        // Content addressed objects never change. Retrying an upload is safe.
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode !== 412
        )
          throw error;
      });
  }
}
export class LocalMediaStorage implements MediaStorage {
  constructor(private directory: string) {}
  private path(key: string) {
    if (!mediaKeyPattern.test(key)) throw new AppError(404, "Image not found");
    return resolve(this.directory, key);
  }
  async put(key: string, bytes: Uint8Array) {
    const path = this.path(key);
    await mkdir(resolve(this.directory, "media"), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" }).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code !== "EEXIST") throw e;
      },
    );
  }
  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new AppError(404, "Image not found");
      throw e;
    }
  }
}
export function mediaStorage(config: Config): MediaStorage {
  if (config.NARADA_MODE === "local")
    return new LocalMediaStorage(config.MEDIA_DIRECTORY ?? ".local/media");
  // Fail on use rather than initialization: older workers have no media bucket.
  return {
    put: async (...args) => {
      if (!config.MEDIA_BUCKET)
        throw new AppError(503, "Image storage is not configured");
      return new S3MediaStorage(
        config.MEDIA_BUCKET,
        new S3Client({ region: config.AWS_REGION }),
      ).put(...args);
    },
  };
}
type StoredAsset = Entity & Omit<MediaAsset, "url"> & { key: string };
export class MediaService {
  constructor(
    private store: Store,
    readonly storage: MediaStorage,
  ) {}
  private dto(row: StoredAsset): MediaAsset {
    const { id, name, contentType, bytes, width, height, createdAt } = row;
    return {
      id,
      name,
      contentType,
      bytes,
      width,
      height,
      createdAt,
      url: new URL("/" + row.key, assetOrigin(this.store.config)).href,
    };
  }
  async prepareUpload(bytes: Uint8Array, filename: string) {
    const image = inspectImage(bytes),
      id = createHash("sha256").update(bytes).digest("hex");
    const existing = await this.store.get<StoredAsset>(`MEDIA#${id}`);
    if (existing) return { asset: this.dto(existing), row: undefined };
    const key = `media/${id}.${image.extension}`,
      createdAt = new Date().toISOString();
    const row: StoredAsset = {
      pk: `MEDIA#${id}`,
      sk: "META",
      scope: "media",
      sort: `${createdAt}#${id}`,
      id,
      key,
      name:
        filename.replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 160) ||
        `Image.${image.extension}`,
      bytes: bytes.length,
      width: image.width,
      height: image.height,
      contentType: image.contentType,
      createdAt,
    };
    // Write bytes first. A failed metadata write can be retried without changing any URL.
    await this.storage.put(key, bytes, image.contentType);
    return { asset: this.dto(row), row };
  }
  async upload(bytes: Uint8Array, filename: string) {
    const { asset, row } = await this.prepareUpload(bytes, filename);
    if (!row) return asset;
    try {
      await this.store.put(row, true);
    } catch (error) {
      if (!conditional(error)) throw error;
      const saved = await this.store.get<StoredAsset>(row.pk);
      if (!saved) throw error;
      return this.dto(saved);
    }
    return this.dto(row);
  }
  async list(input: unknown) {
    const page = await new ProductPagination(this.store).records<StoredAsset>(
      "media",
      "MEDIA#",
      input,
      () => true,
    );
    return { ...page, data: page.data.map((row) => this.dto(row)) };
  }
}
