import { z } from "zod";
import { scopes, type Scope } from "./scopes.js";

const selected = z.array(z.string().min(1)).min(1).max(100);
// Omitted dimension means unrestricted; empty lists and unknown dimensions are invalid.
export const resourceRestrictions = z
  .object({
    senderDomains: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)
          .max(253),
      )
      .min(1)
      .max(100)
      .optional(),
    publicationIds: selected.optional(),
    formIds: selected.optional(),
  })
  .strict();
export type ResourceRestrictions = z.infer<typeof resourceRestrictions>;

export const delegationSelection = z
  .object({
    scopes: z.array(z.enum(scopes)).max(scopes.length),
    resources: resourceRestrictions.default({}),
  })
  .strict()
  .refine(
    (value) => new Set(value.scopes).size === value.scopes.length,
    "Scopes must be unique",
  );
export type OperationAccess = z.output<typeof delegationSelection>;

/** Resolve UI choice against this authorization request, never the global catalog. */
export function selectScopes(
  requested: readonly string[],
  selectedScopes: "all" | readonly string[],
): Scope[] {
  const requestedScopes = z.array(z.enum(scopes)).parse(requested);
  const selection = delegationSelection.parse({
    scopes:
      selectedScopes === "all" ? [...new Set(requestedScopes)] : selectedScopes,
  });
  if (selection.scopes.some((scope) => !requestedScopes.includes(scope)))
    throw new Error("Cannot approve a scope the client did not request");
  return selection.scopes;
}
