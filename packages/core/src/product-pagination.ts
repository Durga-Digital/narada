import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { AppError, type Entity } from "./model.js";
import type { Store } from "./store.js";
export const productListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(20),
    cursor: z.string().max(2000).optional(),
  })
  .strict();
export class ProductPagination {
  private key: Buffer;
  constructor(private store: Store) {
    this.key = createHash("sha256")
      .update(`narada-product-cursor-v1:${store.config.BETTER_AUTH_SECRET}`)
      .digest();
  }
  encode(scope: string, position: unknown) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify({ scope, position })),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
  }
  decode(scope: string, cursor?: string): unknown {
    if (!cursor) return undefined;
    try {
      const bytes = Buffer.from(cursor, "base64url"),
        decipher = createDecipheriv(
          "aes-256-gcm",
          this.key,
          bytes.subarray(0, 12),
        );
      decipher.setAuthTag(bytes.subarray(12, 28));
      const value = JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString(),
      );
      if (value.scope !== scope || value.position === undefined)
        throw new Error();
      return value.position;
    } catch {
      throw new AppError(400, "Invalid pagination cursor");
    }
  }
  async records<T extends Entity>(
    scope: string,
    prefix: string,
    input: unknown,
    allowed: (row: T) => boolean | Promise<boolean>,
    cursorScope = scope,
  ) {
    const { limit, cursor } = productListQuery.parse(input ?? {});
    const raw = this.decode(cursorScope, cursor);
    let position =
      raw === undefined
        ? undefined
        : z
            .object({
              pk: z.string().startsWith(prefix),
              sk: z.literal("META"),
              scope: z.literal(scope),
              sort: z.string(),
            })
            .strict()
            .parse(raw);
    const data: T[] = [];
    // Bounded work, even when permissions exclude every scanned row. An empty
    // page may carry a cursor; clients follow it until null. Cursors reveal no IDs.
    for (let pages = 0; pages < 10 && data.length < limit; pages++) {
      const page = await this.store.listPage<T>(
        scope,
        limit - data.length,
        position,
      );
      const fresh = new Map(
        (await this.store.getMany<T>(page.items.map((r) => r.pk))).map((r) => [
          r.pk,
          r,
        ]),
      );
      for (const item of page.items) {
        const row = fresh.get(item.pk);
        if (row && row.scope === scope && (await allowed(row))) data.push(row);
      }
      position = page.cursor as typeof position;
      if (!position) break;
    }
    return {
      data,
      nextCursor: position ? this.encode(cursorScope, position) : null,
    };
  }
  rows<T>(
    scope: string,
    rows: T[],
    input: unknown,
    identity: (row: T) => string,
  ) {
    const { limit, cursor } = productListQuery.parse(input ?? {}),
      raw = this.decode(scope, cursor);
    const position = raw === undefined ? undefined : z.string().parse(raw);
    const sorted = rows
      .filter((row) => position === undefined || identity(row) > position)
      .sort((a, b) =>
        identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0,
      );
    const data = sorted.slice(0, limit);
    return {
      data,
      nextCursor:
        sorted.length > limit
          ? this.encode(scope, identity(data.at(-1)!))
          : null,
    };
  }
}
