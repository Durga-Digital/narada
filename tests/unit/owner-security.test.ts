import { expect, it } from "vitest";
import {
  ownerSecurityOperations,
  recoverySenderUpdate,
} from "@narada/contracts/owner-security";
import { ownerSecurityExclusions } from "../contracts/transport-exclusions.js";
import { operations } from "@narada/contracts/operations";
import { mcpOperations } from "@narada/contracts/mcp";
import { scopes } from "@narada/contracts/scopes";
import { assertOperationAccess, oauthCaller } from "@narada/core/authorization";

it("keeps account-security bindings explicitly excluded from delegated discovery and execution", () => {
  const caller = oauthCaller({
    subject: "owner",
    clientId: "client",
    resource: "https://narada.test/api/mcp",
    tokenGrantId: "grant",
    tokenScopes: scopes,
    grant: {
      id: "grant",
      userId: "owner",
      clientId: "client",
      resource: "https://narada.test/api/mcp",
      active: true,
      scopes,
    },
    consent: { userId: "owner", clientId: "client", scopes },
  });
  expect(Object.keys(ownerSecurityExclusions).sort()).toEqual(
    ownerSecurityOperations.map((op) => op.id).sort(),
  );
  for (const op of ownerSecurityOperations) {
    expect(operations.map((entry) => String(entry.id))).not.toContain(op.id);
    expect(mcpOperations.map((entry) => String(entry.id))).not.toContain(op.id);
    expect(() => assertOperationAccess(caller, op.id)).toThrow();
    expect(ownerSecurityExclusions[op.id]).toContain("owner");
  }
});

it("accepts only a domain and revision, never a recipient or arbitrary From header", () => {
  expect(
    recoverySenderUpdate.parse({ domain: " EXAMPLE.COM ", revision: 0 }),
  ).toEqual({ domain: "example.com", revision: 0 });
  for (const input of [
    { domain: "example.com", revision: 0, email: "attacker@example.net" },
    { domain: "example.com", revision: 0, from: "Other <x@example.com>" },
    { domain: "example.com\r\nBcc: attacker@example.net", revision: 0 },
    { domain: "mail-.example.com", revision: 0 },
    { domain: "example.com", revision: -1 },
  ])
    expect(recoverySenderUpdate.safeParse(input).success).toBe(false);
});
