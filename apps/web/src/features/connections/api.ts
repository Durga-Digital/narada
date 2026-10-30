import { mcpScopeDefinitions } from "@narada/contracts/mcp";
import type { ResourceRestrictions } from "@narada/contracts/delegation";
export interface Connection {
  reference: string;
  clientId: string;
  name: string;
  scopes: string[];
  resources: ResourceRestrictions;
  active: boolean;
  revision: number;
  updatedAt: string;
}
export interface ConnectionPage {
  resource: string;
  data: Connection[];
  nextCursor: string | null;
}
export async function connectionApi<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/oauth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    signal,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error ?? "Could not update connected apps. Refresh and try again.",
    );
  return data;
}

export const permissionLabels = new Map<string, string>([
  ["openid", "Identify your Narada account"],
  ["offline_access", "Keep this connection active"],
  ...mcpScopeDefinitions,
]);
