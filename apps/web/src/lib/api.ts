import { withFeedback } from "./feedback.js";
import {
  mutationRequest,
  DefinitiveMutationError,
} from "./mutation-request.js";

export function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  successMessage?: string,
): Promise<T> {
  const request = () =>
    method === "GET" || path.endsWith("/preview")
      ? fetchApi<T>(path, body, method)
      : mutationRequest(JSON.stringify([method, path, body]), (key) =>
          fetchApi<T>(path, body, method, key),
        );
  return successMessage ? withFeedback(request, successMessage) : request();
}

async function fetchApi<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  idempotencyKey?: string,
): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data: unknown;
  try {
    data = raw.trim() ? JSON.parse(raw) : undefined;
  } catch {
    // Proxies and restarting local servers can return HTML or incomplete bodies.
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? (data as { error: unknown }).error
        : undefined;
    const code =
      data && typeof data === "object" && "code" in data
        ? data.code
        : undefined;
    const ErrorType =
      typeof message === "string" &&
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      !["idempotency_in_progress", "idempotency_unknown"].includes(String(code))
        ? DefinitiveMutationError
        : Error;
    throw new ErrorType(
      typeof message === "string"
        ? message
        : `The server could not complete the request (HTTP ${response.status}). ${method === "GET" ? "Please try again." : "Refresh the list before trying again; your change may already have been saved."}`,
    );
  }
  if (response.status === 204) return undefined as T;
  if (data === undefined)
    throw new Error(
      method === "GET"
        ? "The server returned an incomplete response. Please try again."
        : "The server did not confirm the change. Refresh the list before trying again; it may already have been saved.",
    );
  return data as T;
}
export type { OwnerDomain as Domain } from "@narada/contracts/dashboard";
export type { MessageMetadata } from "@narada/contracts/dashboard";
export interface Overview {
  mode: "local" | "aws";
  paused: boolean;
  messages: {
    id: string;
    status: import("@narada/contracts/dashboard").MessageStatus;
    createdAt: string;
    input: {
      from: string;
      to: string[];
      subject: string;
      tags?: Record<string, string>;
      priority?: "normal" | "high";
    };
  }[];
  stats: { total: number; queued: number; delivered: number; failed: number };
}
export interface Key {
  domain?: string;
  lastUsedAt?: string;
  usageTrackingSince?: string;
  permission?: "sending" | "scoped" | "full" | "operations";
  operationAccess?: import("@narada/contracts/delegation").OperationAccess;
  scopes?: import("@narada/contracts/legacy-scopes").ApiScope[];
  revision?: number;
  id: string;
  name: string;
  prefix: string;
  revoked: boolean;
  createdAt: string;
}
export interface Endpoint {
  events: import("@narada/contracts/types").WebhookEventType[];
  id: string;
  url: string;
  createdAt: string;
}
export interface Attempt {
  payload?: { id: string; type: string; created_at: string };
  createdAt?: string;
  completedAt?: string;
  nextAttemptAt?: number;
  expiresAt?: string;
  cycleAttempts?: number;
  endpointId?: string;
  lastStatus?: number;
  id: string;
  state: string;
  attempts: number;
  error?: string;
}
export interface Suppression {
  email: string;
  reason: string;
}
