import { Hono } from "hono";
import { operations } from "@narada/contracts/operations";
import {
  isSharedOperation,
  type SharedOperations,
} from "@narada/core/shared-operations";
import { mutationJson } from "./idempotency.js";
export type PreparedProductOperation = Awaited<
  ReturnType<SharedOperations["prepare"]>
>;
export function productRoutes() {
  const app = new Hono<{
    Variables: { productOperation: PreparedProductOperation };
  }>();
  for (const op of operations) {
    if (!isSharedOperation(op.id) || !("http" in op)) continue;
    app.on(op.http.method, op.http.path.replace(/^\/api\/v1/, ""), (c) => {
      c.header("Cache-Control", "no-store");
      const operation = c.get("productOperation");
      return mutationJson(
        c,
        (commit) => operation.run(commit),
        undefined,
        op.http.status,
      );
    });
  }
  return app;
}
