import { matchHttpOperation } from "@narada/contracts/operations";
import { assertLegacyAccess } from "./authorization.js";
import { z } from "zod";
import { delegationSelection } from "@narada/contracts/delegation";
import { AppError, type ApiKey } from "./model.js";

import { apiScopes, type ApiScope } from "./api-scopes.js";
export { apiScopes, type ApiScope } from "./api-scopes.js";

export const apiKeyAccess = z
  .object({
    permission: z
      .enum(["sending", "scoped", "full", "operations"])
      .default("sending"),
    operationAccess: delegationSelection.optional(),
    scopes: z.array(z.enum(apiScopes)).min(1).max(apiScopes.length).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.permission === "operations") !==
      (value.operationAccess !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "Only operation keys require operationAccess",
      });
    if ((value.permission === "scoped") !== (value.scopes !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Only scoped keys require scopes",
      });
    if (value.scopes && new Set(value.scopes).size !== value.scopes.length)
      ctx.addIssue({ code: "custom", message: "Scopes must be unique" });
  });

// Compatibility adapter: route matching and policy now share the operation catalog.
export function assertApiAccess(key: ApiKey, method: string, path: string) {
  const operation = matchHttpOperation(method, path);
  if (!operation)
    throw new AppError(403, "No scoped access is available for this operation");
  assertLegacyAccess(key, operation.id);
}
