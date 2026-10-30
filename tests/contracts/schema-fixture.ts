import type { JsonSchema } from "@narada/contracts/discovery";

// Structural fixtures only: domain-valid consent, revisions and saved resources
// are exercised by integration tests. Include optional fields and distinct path
// values so dropped parameters or swapped IDs cannot hide behind empty objects.
export function schemaFixture(
  schema: JsonSchema,
  allFields: boolean,
  location = "fixture",
): unknown {
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (Array.isArray(schema.enum))
    return schema.enum[allFields ? schema.enum.length - 1 : 0];
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const choices = (schema.anyOf ?? schema.oneOf) as JsonSchema[];
    const nonNull = choices.filter((choice) => choice.type !== "null");
    const variants = nonNull.length ? nonNull : choices;
    return schemaFixture(
      variants[allFields ? variants.length - 1 : 0]!,
      allFields,
      location,
    );
  }
  switch (schema.type) {
    case "object": {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.properties ?? {}))
        if (allFields || schema.required?.includes(key))
          result[key] = schemaFixture(child, allFields, `${location}.${key}`);
      if (
        typeof schema.additionalProperties === "object" &&
        schema.additionalProperties
      )
        result.custom = schemaFixture(
          schema.additionalProperties as JsonSchema,
          allFields,
          `${location}.custom`,
        );
      return result;
    }
    case "array":
      return [
        schemaFixture(
          schema.items as JsonSchema,
          allFields,
          `${location}.item`,
        ),
      ];
    case "string":
      if (Array.isArray(schema.examples) && schema.examples.length)
        return schema.examples[0];
      return `${location} /+?&é`;
    case "number":
    case "integer":
      return 2;
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      if (Object.keys(schema).length === 0)
        return { example: "arbitrary JSON" };
      throw new Error(
        `Add a fixture for schema at ${location}: ${JSON.stringify(schema)}`,
      );
  }
}
