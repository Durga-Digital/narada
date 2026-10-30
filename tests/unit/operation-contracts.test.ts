import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { z } from "zod";
import { operations, matchHttpOperation } from "@narada/contracts/operations";
import { operationSchemas, openApiDocument } from "@narada/contracts/discovery";
import { scopes } from "@narada/contracts/scopes";
import { examples } from "../../apps/web/src/features/api-reference/examples.js";
import type { OperationId } from "@narada/contracts/operations";

it("keeps each routed operation, schema and permission discoverable exactly once", () => {
  expect(new Set(operations.map((op) => op.id)).size).toBe(operations.length);
  expect(Object.keys(operationSchemas).sort()).toEqual(
    operations.map((op) => op.id).sort(),
  );
  for (const op of operations) {
    const alternatives = "anyScopes" in op ? op.anyScopes : [];
    expect(op.scopes.length + alternatives.length).toBeGreaterThan(0);
    expect(alternatives.every((scope) => scopes.includes(scope))).toBe(true);
    expect(op.scopes.every((scope) => scopes.includes(scope))).toBe(true);
    if ("http" in op)
      expect(
        matchHttpOperation(
          op.http.method,
          op.http.path.replace(/:[a-z]+/g, "example"),
        )?.id,
      ).toBe(op.id);
  }
  expect(
    matchHttpOperation("GET", "/api/v1/contacts/x/private"),
  ).toBeUndefined();
  expect(matchHttpOperation("PATCH", "/api/v1/contacts/x")).toBeUndefined();
  expect(matchHttpOperation("GET", "/api/v1/openapiXjson")).toBeUndefined();
});

it("generates v1 wire schemas and OpenAPI without database fields or invented OAuth REST support", () => {
  const document = openApiDocument(["contacts.create", "contacts.get"]);
  expect(Object.keys(document.paths)).toEqual([
    "/api/v1/contacts/{email}",
    "/api/v1/contacts",
  ]);
  const create = (document.paths["/api/v1/contacts"] as any).post;
  expect(create.operationId).toBe("contacts.create");
  expect(create.responses[201]).toBeDefined();
  expect(create.security).toEqual([{ apiKey: [] }]);
  const schema = z.fromJSONSchema(operationSchemas["contacts.create"].input);
  expect(schema.safeParse({ body: { email: "a@example.com" } }).success).toBe(
    true,
  );
  expect(
    schema.safeParse({ body: { email: "a@example.com" }, caller: { scopes } })
      .success,
  ).toBe(false);
  expect(schema.safeParse({ body: { name: "Missing email" } }).success).toBe(
    false,
  );
  const output = z.fromJSONSchema(operationSchemas["contacts.create"].output);
  expect(
    output.safeParse({
      email: "a@example.com",
      name: "",
      first_name: "",
      last_name: "",
      properties: {},
      revision: 0,
      addedAt: "now",
    }).success,
  ).toBe(true);
  for (const [id, schema] of Object.entries(operationSchemas)) {
    expect(JSON.stringify(schema.input)).not.toMatch(
      /"(?:pk|sk|hash|token|secret)"/,
    );
    if (id === "webhooks.create") {
      expect(schema.output.properties).toHaveProperty("secret");
      expect(JSON.stringify(schema.output)).not.toMatch(
        /"(?:pk|sk|hash|token)"/,
      );
    } else
      expect(JSON.stringify(schema.output)).not.toMatch(
        /"(?:pk|sk|hash|token|secret)"/,
      );
  }
});

it("keeps the published SDK types identical to the canonical contracts", () => {
  expect(readFileSync("packages/sdk/src/types.ts", "utf8")).toBe(
    "// Generated from packages/contracts/src/types.ts. Run scripts/sync-contract-types.ts.\n" +
      readFileSync("packages/contracts/src/types.ts", "utf8"),
  );
});

it("validates every dashboard API example against its shared request contract", () => {
  for (const example of Object.values(examples).flat()) {
    const url = new URL(`/api/v1${example.path}`, "https://narada.test");
    const op = matchHttpOperation(example.method, url.pathname)!;
    expect(op, example.path).toBeDefined();
    const params: Record<string, string> = {};
    op.http!.path.split("/").forEach((part, index) => {
      if (part.startsWith(":"))
        params[part.slice(1)] = decodeURIComponent(
          url.pathname.split("/")[index]!,
        );
    });
    const query = Object.fromEntries(
      [...url.searchParams].map(([key, value]) => [
        key,
        key === "limit" ? Number(value) : value,
      ]),
    );
    const input = {
      ...(Object.keys(params).length ? { params } : {}),
      ...(Object.keys(query).length ? { query } : {}),
      ...(example.body !== undefined ? { body: example.body } : {}),
    };
    const parsed = z
      .fromJSONSchema(operationSchemas[op.id as OperationId].input)
      .safeParse(input);
    expect(
      parsed.success,
      `${example.method} ${example.path}: ${parsed.error?.message}`,
    ).toBe(true);
  }
});
