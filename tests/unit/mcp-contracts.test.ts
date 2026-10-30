import { expect, it } from "vitest";
import {
  assignSlots,
  deriveIndexMap,
} from "@datar-platform/better-auth-dynamodb";
import { getAuthTables } from "better-auth/db";
import { baseAuthOptions } from "@narada/core/auth-base";
import { oauthAuthOptions } from "@narada/core/oauth-auth";
import { loadConfig } from "@narada/core/config";
import { Store } from "@narada/core/store";
import { mcpOperations, mcpToolName } from "@narada/contracts/mcp";
import { operationSchemas, type JsonSchema } from "@narada/contracts/discovery";
import type { OperationId } from "@narada/contracts/operations";
import { mcpInputSchema } from "@narada/mcp/operations";

it("requires an exact approval contract for every MCP send operation", () => {
  const variants = operationSchemas["approvals.request"].input.properties!.body!
    .anyOf as JsonSchema[];
  expect(variants.map((v) => v.properties!.operation!.const).sort()).toEqual(
    mcpOperations
      .filter((op) => op.effect === "send")
      .map((op) => op.id)
      .sort(),
  );
  for (const variant of variants) {
    const operation = variant.properties!.operation!.const as OperationId;
    const { $schema, ...input } = operationSchemas[operation].input;
    expect(variant.properties!.input, operation).toEqual(input);
  }
});

it("keeps existing owner lookup slots stable when adding the OAuth schema", () => {
  const config = loadConfig({
    NARADA_MODE: "local",
    BETTER_AUTH_URL: "http://localhost:3001",
    BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-characters",
  });
  const store = new Store(config);
  try {
    const previous = assignSlots(
      deriveIndexMap(getAuthTables(baseAuthOptions(config, store))),
    );
    const next = assignSlots(
      deriveIndexMap(getAuthTables(oauthAuthOptions(config, store))),
    );
    expect(next.maxSlots).toBe(6);
    for (const [model, slots] of Object.entries(previous.slots))
      expect(next.slots[model]).toEqual(slots);
  } finally {
    store.client.destroy();
  }
});
it("exposes only canonical product tools with explicit mutation retry keys", () => {
  expect(new Set(mcpOperations.map((op) => mcpToolName(op.id))).size).toBe(
    mcpOperations.length,
  );
  for (const op of mcpOperations) {
    expect(operationSchemas[op.id].output).toBeDefined();
    const schema = mcpInputSchema(op.id).toJSONSchema();
    if (op.effect !== "read")
      expect(schema.required).toContain("idempotencyKey");
    else expect(schema.properties).not.toHaveProperty("idempotencyKey");
  }
  expect(
    mcpInputSchema("forms.list").safeParse({ caller: { scopes: ["*"] } })
      .success,
  ).toBe(false);
  const form = {
    body: {
      name: "Feedback",
      kind: "feedback",
      from: "hello@narada.test",
      questions: [{ id: "note", label: "Feedback", type: "text" }],
    },
  };
  expect(
    mcpInputSchema("forms.create").safeParse({
      ...form,
      idempotencyKey: "stable-key",
    }).success,
  ).toBe(true);
  expect(mcpInputSchema("forms.create").safeParse(form).success).toBe(false);
  expect(
    mcpInputSchema("forms.create").safeParse({
      ...form,
      idempotencyKey: "bad\nkey",
    }).success,
  ).toBe(false);
});
