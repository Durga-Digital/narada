import type { Config } from "./config.js";
// Defaults preserve every existing link and receipt namespace.
export const apiOrigin = (config: Config) =>
  config.API_ORIGIN ?? config.BETTER_AUTH_URL;
export const dashboardOrigin = (config: Config) =>
  config.DASHBOARD_ORIGIN ?? new URL(config.BETTER_AUTH_URL).origin;
export const publicOrigin = (config: Config) =>
  config.PUBLIC_ORIGIN ?? config.BETTER_AUTH_URL;
export const assetOrigin = (config: Config) =>
  config.ASSET_ORIGIN ?? publicOrigin(config);
export const installationIdentity = (config: Config) =>
  config.NARADA_INSTALLATION_ID ?? config.BETTER_AUTH_URL;
