import {
  aboutInput,
  siteInput,
  siteRevision,
  collectionInput,
  collectionUpdateInput,
  collectionIdsInput,
} from "@narada/contracts/publication-site";
import {
  senderRegistrationInput,
  senderRevisionInput,
  senderMailFromInput,
  resourceSearchInput,
} from "@narada/contracts/integration";
import {
  domainConfigureInput,
  domainRevisionInput,
} from "@narada/contracts/publication-domains";
import { z } from "zod";
import { brandingInput, logoInput } from "@narada/contracts/branding";
import * as ts from "typescript/unstable/sync";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

// The public TypeScript contracts are the source of truth. Generate portable
// structural JSON Schemas without importing server/domain code into clients.
// Domain rules (consent, sender verification, revisions, limits) still run in core.
const file = "packages/contracts/src/operation-types.ts";
const api = new ts.API({ cwd: process.cwd() });
process.on("exit", () => api.close());
const snapshot = api.updateSnapshot({
  openProjects: [resolve("tsconfig.json")],
});
const { checker } = snapshot.getProject(resolve("tsconfig.json"))!;
type Schema = Record<string, unknown>;
function schema(type: ts.Type): Schema {
  if (type.flags & ts.TypeFlags.Unknown) return {};
  if (type.isUnionType()) {
    const members = type
      .getTypes()
      .filter((t) => !(t.flags & ts.TypeFlags.Undefined));
    if (members.length === 1) return schema(members[0]!);
    return { anyOf: members.map(schema) };
  }
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return { const: type.value };
  if (type.flags & ts.TypeFlags.BooleanLiteral)
    return { const: checker.typeToString(type) === "true" };
  if (type.flags & ts.TypeFlags.String) return { type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
  if (type.flags & ts.TypeFlags.Null) return { type: "null" };
  if (checker.isArrayType(type))
    return {
      type: "array",
      items: schema(checker.getTypeArguments(type as ts.TypeReference)[0]!),
    };
  if (type.flags & ts.TypeFlags.Object || type.isIntersectionType()) {
    const properties: Record<string, Schema> = {};
    const required: string[] = [];
    for (const property of checker.getPropertiesOfType(type)) {
      properties[property.name] = schema(checker.getTypeOfSymbol(property)!);
      if (!(property.flags & ts.SymbolFlags.Optional))
        required.push(property.name);
    }
    const index = checker
      .getIndexInfosOfType(type)
      .find((info) => info.keyType.flags & ts.TypeFlags.String)?.valueType;
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties:
        index && !(index.flags & ts.TypeFlags.Never) ? schema(index) : false,
    };
  }
  throw new Error(`Unsupported contract type: ${checker.typeToString(type)}`);
}
const source = await readFile(file, "utf8");
const contractType = checker.getTypeAtPosition(
  resolve(file),
  source.indexOf("interface OperationContracts") + "interface ".length,
)!;
const result: Record<string, { input: Schema; output: Schema }> = {};
for (const property of checker.getPropertiesOfType(contractType)) {
  const contract = checker.getTypeOfSymbol(property)!;
  const part = (name: string) => {
    const p = checker.getPropertyOfType(contract, name)!;
    return schema(checker.getTypeOfSymbol(p)!);
  };
  result[property.name] = { input: part("input"), output: part("output") };
}
// Preserve the bounded canonical branding validators in REST/MCP discovery too.
// TypeScript still supplies the complete envelopes and all output shapes.
const portable = (validator: z.ZodType) => {
  const { $schema, ...shape } = z.toJSONSchema(validator);
  return shape;
};
for (const [kind, validator] of [
  ["about", aboutInput],
  ["site", siteInput],
] as const) {
  for (const action of [
    "update",
    "preview",
    "publish",
    ...(kind === "about" ? ["withdraw"] : []),
  ]) {
    const body =
      action === "update"
        ? z.object({ revision: siteRevision, draft: validator }).strict()
        : action === "preview"
          ? z
              .object({ revision: siteRevision, draft: validator.optional() })
              .strict()
          : z.object({ revision: siteRevision }).strict();
    (
      result[`publications.${kind}.${action}`]!.input.properties as Record<
        string,
        unknown
      >
    ).body = portable(body);
  }
}
for (const [id, validator] of [
  ["publications.collections.create", collectionInput],
  ["publications.collections.update", collectionUpdateInput],
  [
    "publications.collections.archive",
    z.object({ revision: siteRevision }).strict(),
  ],
  [
    "issues.collections.update",
    z
      .object({
        revision: siteRevision,
        issueRevision: siteRevision,
        collectionIds: collectionIdsInput,
      })
      .strict(),
  ],
] as const)
  (result[id]!.input.properties as Record<string, unknown>).body =
    portable(validator);
for (const id of [
  "publications.branding.update",
  "publications.branding.preview",
]) {
  const input = result[id]!.input as {
    properties: { body: { properties: Record<string, unknown> } };
  };
  input.properties.body.properties.branding = portable(brandingInput);
}
(
  result["publications.logo.upload"]!.input.properties as Record<
    string,
    unknown
  >
).body = portable(logoInput);
(
  result["publications.assets.upload"]!.input.properties as Record<
    string,
    unknown
  >
).body = portable(logoInput);
for (const action of ["configure", "check", "activate", "disconnect"]) {
  (
    result[`publications.domain.${action}`]!.input.properties as Record<
      string,
      unknown
    >
  ).body = portable(
    action === "configure" ? domainConfigureInput : domainRevisionInput,
  );
}
for (const [id, part, validator] of [
  ["domains.create", "body", senderRegistrationInput],
  ["domains.mailFrom.update", "body", senderMailFromInput],
  ["domains.dkim.enable", "body", senderRevisionInput],
  ["resources.search", "query", resourceSearchInput],
] as const)
  (result[id]!.input.properties as Record<string, unknown>)[part] =
    portable(validator);
const output = "packages/contracts/src/operation-schemas.json";
const text = JSON.stringify(result, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== text)
    throw new Error(
      "Operation schemas drifted; run scripts/generate-operation-schemas.ts",
    );
} else await writeFile(output, text);

snapshot.dispose();
api.close();
