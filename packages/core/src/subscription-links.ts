import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError, hash } from "./model.js";

// Keep key formats and signatures stable: previously sent links must remain valid.
export const unsubscribeKey = (audienceId: string, email: string) =>
  `UNSUB#${audienceId}#${hash(email.toLowerCase())}`;
export function unsubscribeToken(
  secret: string,
  audienceId: string,
  email: string,
  topicId?: string,
) {
  const payload = Buffer.from(
    JSON.stringify({ audienceId, email, ...(topicId ? { topicId } : {}) }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`narada-unsubscribe:${payload}`).digest("base64url")}`;
}
export function readUnsubscribeToken(secret: string, token: string) {
  if (token.length > 1500) throw new AppError(400, "Invalid unsubscribe link");
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length)
    throw new AppError(400, "Invalid unsubscribe link");
  const expected = createHmac("sha256", secret)
    .update(`narada-unsubscribe:${payload}`)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new AppError(400, "Invalid unsubscribe link");
  try {
    return z
      .object({
        audienceId: z.uuid(),
        email: z.email(),
        topicId: z.uuid().optional(),
      })
      .parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  } catch {
    throw new AppError(400, "Invalid unsubscribe link");
  }
}
