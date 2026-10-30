import { ownerCaller } from "@narada/core/authorization";
import { SendApprovals } from "@narada/core/send-approvals";
import { MutationReceipt } from "@narada/core/idempotency";
import type { Runtime } from "@narada/core/runtime";
import type { Narada, RequestOptions } from "../../packages/sdk/src/index.js";
import type { SendApprovalRequest } from "@narada/contracts/types";
import type { OperationOutput } from "@narada/contracts/operation-types";

/** Explicit test-owner decision for domain regressions. HTTP session checks have separate coverage. */
export async function approvedOperation<
  K extends SendApprovalRequest["operation"],
>(
  runtime: Runtime,
  client: Narada,
  request: Extract<SendApprovalRequest, { operation: K }>,
  options?: RequestOptions,
): Promise<OperationOutput<K>> {
  const approval = await client.approvals.request(request, options);
  const service = new SendApprovals(runtime),
    owner = ownerCaller("fixture-owner");
  const row = await runtime.store.get(`SENDAPPROVAL#${approval.id}`);
  if (!row) throw new Error("Missing review");
  const decision = await service.decide(
    owner,
    approval.id,
    { digest: row.digest },
    true,
  );
  if (decision.status !== "succeeded")
    throw new Error(`Approval ${decision.status}`);
  const receipt = await MutationReceipt.acquire(
    runtime.store,
    `send-approval:${approval.id}`,
    request.operation,
    approval.id,
    { digest: row.digest },
  );
  if (!("replay" in receipt))
    throw new Error("Missing approved operation receipt");
  return JSON.parse(receipt.replay.body);
}
