import { AsyncLocalStorage } from "node:async_hooks";
import type { ResourceRestrictions } from "@narada/contracts/delegation";
export type OAuthApproval = {
  userId: string;
  clientId: string;
  query: string;
  scopes: string[];
  resources: ResourceRestrictions;
};
export const oauthApproval = new AsyncLocalStorage<OAuthApproval>();
