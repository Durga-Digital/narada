import { type BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { dynamoAdapter } from "./auth-database.js";
import type { Config } from "./config.js";
import type { Store } from "./store.js";
import { createTransport } from "./transport.js";
import { randomUUID } from "node:crypto";
import { createRateLimitStorage } from "./rate-limit.js";
import { resolveRecoverySender } from "./recovery-sender.js";

export function baseAuthOptions(
  config: Config,
  store: Store,
  bootstrap = false,
): BetterAuthOptions {
  return {
    appName: "Narada",
    baseURL: config.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(config.BETTER_AUTH_URL).origin],
    database: dynamoAdapter({
      tableName: config.AUTH_TABLE,
      documentClient: store.client,
      atomicUniqueness: true,
      ttl: { defaultField: "expiresAt" },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !bootstrap,
      minPasswordLength: 12,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        try {
          await createTransport(config, false).send(
            {
              from: await resolveRecoverySender(store),
              to: [user.email],
              subject: "Reset your Narada password",
              text: `Reset your password: ${url}`,
              expires_in: 3600,
            },
            randomUUID(),
          );
        } catch {
          // Keep the public reset response identical for unknown accounts and
          // delivery failures. Never log reset URLs, tokens or provider payloads.
          console.warn(
            JSON.stringify({ event: "password_reset_delivery_failed" }),
          );
        }
      },
    },
    session: { expiresIn: 86400, cookieCache: { enabled: false } },
    verification: { disableCleanup: true },
    rateLimit: {
      enabled: true,
      customStorage: createRateLimitStorage(store),
      window: 60,
      max: 30,
    },
    plugins: [twoFactor({ issuer: "Narada" })],
    advanced: { useSecureCookies: config.NARADA_MODE === "aws" },
  };
}
