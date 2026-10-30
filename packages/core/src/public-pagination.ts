import { z } from "zod";
import { AppError } from "./model.js";
export const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(2000).optional(),
  })
  .strict();
export function encodeCursor(resource: string, position: unknown) {
  return Buffer.from(JSON.stringify({ resource, position })).toString(
    "base64url",
  );
}
export function decodeCursor(resource: string, cursor?: string): unknown {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (value.resource !== resource || value.position === undefined)
      throw new Error();
    return value.position;
  } catch {
    throw new AppError(400, "Invalid pagination cursor");
  }
}
/** Bounded collections use a stable identity cursor, never a mutable array offset. */
export function page<T>(
  rows: T[],
  resource: string,
  query: unknown,
  identity: (row: T) => string,
) {
  const { limit, cursor } = listQuery.parse(query);
  const position = decodeCursor(resource, cursor);
  if (position !== undefined && typeof position !== "string")
    throw new AppError(400, "Invalid pagination cursor");
  const sorted = rows
    .sort((a, b) =>
      identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0,
    )
    .filter(
      (r) => position === undefined || identity(r) > (position as string),
    );
  const data = sorted.slice(0, limit);
  return {
    data,
    nextCursor:
      sorted.length > limit
        ? encodeCursor(resource, identity(data.at(-1)!))
        : null,
  };
}
