import { expect, it, vi } from "vitest";
import {
  apiKeyCaller,
  oauthCaller,
  ownerCaller,
  assertOperationAccess,
  authorizeOperation,
  executeAuthorized,
  describeCapabilities,
  callerIdentity,
  type Caller,
} from "@narada/core/authorization";
import { operations } from "@narada/contracts/operations";
import { scopes } from "@narada/contracts/scopes";
import {
  selectScopes,
  delegationSelection,
} from "@narada/contracts/delegation";
import type { ApiKey } from "@narada/core/model";

const grant = {
  id: "generation-1",
  userId: "owner",
  clientId: "client",
  resource: "https://narada.test/api/mcp",
  active: true,
  scopes,
};
const consent = { userId: "owner", clientId: "client", scopes };
const delegated = (selected: readonly string[], resources = {}) =>
  oauthCaller({
    subject: "owner",
    clientId: "client",
    resource: grant.resource,
    tokenGrantId: grant.id,
    tokenScopes: selected,
    grant: { ...grant, resources },
    consent,
  });

it("all consent snapshots only requested scopes; selected cannot expand or use wildcards", () => {
  expect(selectScopes(["narada:emails:read"], "all")).toEqual([
    "narada:emails:read",
  ]);
  expect(selectScopes(scopes, [])).toEqual([]);
  expect(() =>
    selectScopes(["narada:emails:read"], ["narada:emails:send"]),
  ).toThrow();
  for (const selection of [
    { scopes: ["*"] },
    { scopes: ["narada:emails:send", "narada:emails:send"] },
    { scopes: [], resources: { publicationIds: [] } },
    { scopes: [], userId: "someone" },
  ])
    expect(delegationSelection.safeParse(selection).success).toBe(false);
});

it("rejects forged or serialized caller objects before invoking any resolver or handler", async () => {
  const resolve = vi.fn(() => ({})),
    handler = vi.fn();
  for (const caller of [
    {},
    { kind: "session", userId: "owner", scopes },
    JSON.parse(JSON.stringify(ownerCaller("owner"))),
  ])
    await expect(
      executeAuthorized(caller as Caller, "emails.send", resolve, handler),
    ).rejects.toMatchObject({ status: 401 });
  expect(resolve).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});

it("separates granular OAuth rights and requires both source and destination permissions", async () => {
  const read = delegated(["narada:emails:read"]);
  authorizeOperation(read, "emails.get");
  expect(() => authorizeOperation(read, "emails.send")).toThrow();
  const send = delegated(["narada:broadcasts:send"]);
  authorizeOperation(send, "broadcasts.send");
  for (const id of [
    "broadcasts.test",
    "broadcasts.cancel",
    "broadcasts.update",
  ])
    expect(() => authorizeOperation(send, id)).toThrow();
  for (const selected of [
    ["narada:templates:read"],
    ["narada:broadcasts:write"],
  ])
    expect(() =>
      authorizeOperation(delegated(selected), "templates.broadcasts.create"),
    ).toThrow();
  authorizeOperation(
    delegated(["narada:templates:read", "narada:broadcasts:write"]),
    "templates.broadcasts.create",
  );
  expect(() =>
    authorizeOperation(
      delegated(["narada:contacts:import"]),
      "segments.import",
    ),
  ).toThrow();
  const resolve = vi.fn(() => ({})),
    handler = vi.fn();
  await expect(
    executeAuthorized(read, "emails.send", resolve, handler),
  ).rejects.toMatchObject({ status: 403 });
  expect(resolve).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});

it("uses the intersection of token, live grant and consent and binds the complete delegation", () => {
  const input = {
    subject: "owner",
    clientId: "client",
    resource: grant.resource,
    tokenGrantId: grant.id,
    tokenScopes: scopes,
    grant: { ...grant, scopes: ["narada:emails:read", "narada:emails:send"] },
    consent: { ...consent, scopes: ["narada:emails:read"] },
  };
  const caller = oauthCaller(input);
  authorizeOperation(caller, "emails.get");
  expect(() => authorizeOperation(caller, "emails.send")).toThrow();
  for (const change of [
    { tokenGrantId: "old-generation" },
    { subject: "other" },
    { clientId: "other" },
    { resource: "https://other/api/mcp" },
    { grant: { ...grant, active: false } },
    { consent: { ...consent, userId: "other" } },
  ])
    expect(() => oauthCaller({ ...input, ...change })).toThrow();
  // Authentication snapshots cannot be expanded by mutating the source object.
  input.consent.scopes.push("narada:emails:send");
  expect(() => authorizeOperation(caller, "emails.send")).toThrow();
  expect(callerIdentity(caller)).toEqual({
    kind: "oauth",
    userId: "owner",
    clientId: "client",
    grantId: "generation-1",
  });
});

it("enforces sender constraints on resolved resources and fails closed for unsupported filters", async () => {
  const caller = delegated(scopes, { senderDomains: ["mail.example.com"] });
  authorizeOperation(caller, "emails.send", {
    senderDomain: "MAIL.EXAMPLE.COM",
  });
  for (const resources of [
    {},
    { senderDomain: "example.com" },
    { senderDomain: "evil.mail.example.com" },
  ])
    expect(() =>
      authorizeOperation(caller, "emails.send", resources),
    ).toThrow();
  const handler = vi.fn();
  await expect(
    executeAuthorized(
      caller,
      "emails.get",
      () => ({ senderDomain: "other.example.com" }),
      handler,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(handler).not.toHaveBeenCalled();
  for (const id of ["broadcasts.list", "broadcasts.get", "templates.test"])
    expect(() => authorizeOperation(caller, id)).toThrow();
  for (const resources of [{ formIds: ["one"] }, { publicationIds: ["one"] }])
    expect(() =>
      authorizeOperation(delegated(scopes, resources), "contacts.list"),
    ).toThrow();
});

it("caps full legacy keys at existing product operations and filters discovery to implemented permissions", () => {
  const full = apiKeyCaller({
    id: "key",
    permission: "full",
    revoked: false,
  } as ApiKey);
  expect(() => authorizeOperation(full, "identity.read")).toThrow();
  expect(() => authorizeOperation(full, "future.delete")).toThrow();
  expect(() =>
    assertOperationAccess(ownerCaller("owner"), "future.delete"),
  ).toThrow();
  const sending = apiKeyCaller({
    id: "key",
    revoked: false,
    domain: "mail.example.com",
  } as ApiKey);
  const discovery = describeCapabilities(
    sending,
    operations.map((op) => op.id),
    "local",
  );
  expect(discovery.operations.map((op) => op.id).sort()).toEqual([
    "approvals.get",
    "approvals.list",
    "approvals.request",
    "capabilities.read",
    "contracts.read",
    "emails.get",
    "emails.send",
  ]);
  expect(discovery.resources).toEqual({ senderDomains: ["mail.example.com"] });
  expect(() =>
    authorizeOperation(sending, "emails.get", { senderDomain: "other.com" }),
  ).toThrow();
  expect(
    describeCapabilities(
      delegated(scopes),
      ["identity.read"],
      "probe",
    ).operations.map((op) => op.id),
  ).toEqual(["identity.read"]);
  expect(() => apiKeyCaller({ id: "key", revoked: true } as ApiKey)).toThrow();
});
