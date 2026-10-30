import { betterAuth } from "better-auth";
import { requireMcpAuth } from "@better-auth/mcp";
import { oauthAuthOptions } from "./oauth-auth.js";
import type { Config } from "./config.js";
import type { Store } from "./store.js";
import type { AuthService } from "./auth-service.js";
export type { AuthService } from "./auth-service.js";
export const createAuth = (
  config: Config,
  store: Store,
  bootstrap = false,
): AuthService => {
  const auth = betterAuth(oauthAuthOptions(config, store, bootstrap));
  return Object.assign(auth, {
    protectMcp: ((handler, options) =>
      requireMcpAuth(
        auth,
        handler,
        options,
      )) satisfies AuthService["protectMcp"],
  });
};
export type Auth = ReturnType<typeof createAuth>;
