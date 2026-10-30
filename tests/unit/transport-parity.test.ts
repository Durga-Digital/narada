import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Narada, type RequestOptions } from "../../packages/sdk/src/index.js";
import { operations } from "@narada/contracts/operations";
import { operationSchemas } from "@narada/contracts/discovery";
import { mcpOperations, mcpToolName } from "@narada/contracts/mcp";
import { mcpInputSchema } from "@narada/mcp/operations";
import { isSharedOperation } from "@narada/core/shared-operations";
import { sdkBindings, type SdkOperationId } from "../contracts/sdk-bindings.js";
import {
  sdkExclusions,
  mcpExclusions,
} from "../contracts/transport-exclusions.js";
import { assertSurfaceCoverage } from "../contracts/coverage.js";
import { schemaFixture } from "../contracts/schema-fixture.js";

const catalog = operations.map((op) => op.id);
it("requires SDK and MCP coverage or a specific, current exclusion for every catalog operation", () => {
  assertSurfaceCoverage(catalog, Object.keys(sdkBindings), sdkExclusions);
  assertSurfaceCoverage(
    catalog,
    mcpOperations.map((op) => op.id),
    mcpExclusions,
  );
  expect(new Set(mcpOperations.map((op) => mcpToolName(op.id))).size).toBe(
    mcpOperations.length,
  );
});

it("detects additions outside existing namespaces, removed coverage and stale exclusions", () => {
  expect(() =>
    assertSurfaceCoverage(
      [...catalog, "new-feature.create"],
      Object.keys(sdkBindings),
      sdkExclusions,
    ),
  ).toThrow("Missing operation: new-feature.create");
  expect(() =>
    assertSurfaceCoverage(
      catalog,
      mcpOperations.filter((op) => op.id !== "forms.create").map((op) => op.id),
      mcpExclusions,
    ),
  ).toThrow("Missing operation: forms.create");
  expect(() =>
    assertSurfaceCoverage(
      catalog,
      [...Object.keys(sdkBindings), "contracts.read"],
      sdkExclusions,
    ),
  ).toThrow("Exposed operation is still excluded: contracts.read");
  expect(() =>
    assertSurfaceCoverage(catalog, Object.keys(sdkBindings), {
      ...sdkExclusions,
      obsolete: "Removed operation",
    }),
  ).toThrow("Unknown exclusion: obsolete");
  expect(() =>
    assertSurfaceCoverage(catalog, Object.keys(sdkBindings), {
      ...sdkExclusions,
      "contracts.read": "",
    }),
  ).toThrow("Missing exclusion reason: contracts.read");
});

// These five operations execute directly in executeMcpOperation; all product
// operations must pass the shared REST/MCP execution boundary.
const directMcpOperations = new Set([
  "identity.read",
  "capabilities.read",
  "operations.list",
  "operations.get",
  "operations.lookup",
]);
it("routes every advertised product tool to a shared executor", () => {
  for (const op of mcpOperations)
    expect(
      directMcpOperations.has(op.id) || isSharedOperation(op.id),
      op.id,
    ).toBe(true);
});

for (const allFields of [false, true]) {
  describe(
    allFields ? "complete contract inputs" : "minimal contract inputs",
    () => {
      for (const op of operations) {
        if (!Object.hasOwn(sdkBindings, op.id)) continue;
        it(`SDK serializes ${op.id} according to the HTTP contract`, async () => {
          if (!("http" in op))
            throw new Error(`Missing HTTP binding: ${op.id}`);
          const schema = operationSchemas[op.id];
          const input = schemaFixture(schema.input, allFields) as {
            params?: Record<string, string>;
            query?: Record<string, unknown>;
            body?: unknown;
          };
          z.fromJSONSchema(schema.input).parse(input);
          const output = schemaFixture(schema.output, allFields);
          z.fromJSONSchema(schema.output).parse(output);
          const transport = vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              Response.json(output, { status: op.http.status }),
            );
          const sdk = new Narada({
            baseUrl: "https://narada.test",
            apiKey: "contract-test-key",
            fetch: transport,
          });
          const abort = new AbortController();
          // Bindings are individually checked against canonical input/output types
          // by tsc. Erase the union only while invoking this data-driven test.
          const call = sdkBindings[op.id as SdkOperationId] as (
            sdk: Narada,
            input: unknown,
            options: RequestOptions,
          ) => Promise<unknown>;
          expect(
            await call(sdk, input, {
              idempotencyKey: "stable-contract-key",
              signal: abort.signal,
            }),
          ).toEqual(output);
          expect(transport).toHaveBeenCalledTimes(1);
          const [url, init] = transport.mock.calls[0]!;
          const request = new Request(url, init);
          const expectedPath = op.http.path.replace(
            /:([a-zA-Z]+)/g,
            (_, name: string) => encodeURIComponent(input.params![name]!),
          );
          expect(request.method).toBe(op.http.method);
          expect(new URL(request.url).pathname).toBe(expectedPath);
          expect(Object.fromEntries(new URL(request.url).searchParams)).toEqual(
            Object.fromEntries(
              Object.entries(input.query ?? {}).map(([key, value]) => [
                key,
                String(value),
              ]),
            ),
          );
          expect(await request.text()).toBe(
            input.body === undefined ? "" : JSON.stringify(input.body),
          );
          expect(request.headers.get("authorization")).toBe(
            "Bearer contract-test-key",
          );
          expect(request.headers.get("idempotency-key")).toBe(
            op.idempotency === "optional-key" ? "stable-contract-key" : null,
          );
          if (op.idempotency === "optional-key") {
            abort.abort();
            expect(init!.signal!.aborted).toBe(true);
          }
        });
      }
      for (const op of mcpOperations) {
        it(`MCP preserves the canonical ${op.id} input and rejects forged context`, () => {
          const input = schemaFixture(
            operationSchemas[op.id].input,
            allFields,
          ) as Record<string, unknown>;
          z.fromJSONSchema(operationSchemas[op.id].input).parse(input);
          const args =
            op.effect === "read"
              ? input
              : { ...input, idempotencyKey: "stable-contract-key" };
          const schema = mcpInputSchema(op.id);
          expect(schema.parse(args)).toEqual(args);
          expect(
            schema.safeParse({ ...args, caller: { scopes: ["*"] } }).success,
          ).toBe(false);
          if (op.effect !== "read")
            expect(schema.safeParse(input).success).toBe(false);
        });
      }
    },
  );
}
