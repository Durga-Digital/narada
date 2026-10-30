import { AsyncLocalStorage } from "node:async_hooks";
import { callerIdentity, type Caller } from "./authorization.js";
import { operationById } from "@narada/contracts/operations";
import { canonicalJson } from "./idempotency.js";
import { AppError, hash } from "./model.js";

export class ApprovalRequiredError extends AppError {
  readonly code = "approval_required";
  constructor() {
    super(
      409,
      "Human approval is required. Use approvals.request with this operation and input, then open its reviewUrl. Only the signed-in owner can approve and send.",
    );
  }
}
export function approvalDigest(value: unknown) {
  return hash(canonicalJson(JSON.parse(JSON.stringify(value))));
}
type Execution = {
  caller: Caller;
  operation: string;
  inputDigest: string;
  parts: Record<string, string>;
  checked: Set<string>;
};
const execution = new AsyncLocalStorage<Execution>();

export function assertSendApproval(
  caller: Caller,
  operation: string,
  input: unknown,
) {
  // MCP uses verified OAuth delegation. Application API keys retain unattended
  // sending; neither request flags nor the requested URL can change this policy.
  if (
    callerIdentity(caller).kind !== "oauth" ||
    operationById.get(operation)?.effect !== "send"
  )
    return;
  const current = execution.getStore();
  if (
    !current ||
    current.caller !== caller ||
    current.operation !== operation ||
    current.inputDigest !== approvalDigest(input)
  )
    throw new ApprovalRequiredError();
}
/** Domain services compare the actual message/audience they will persist, not a prior preview. */
export function assertApprovalPart(part: string, value: unknown) {
  const current = execution.getStore();
  if (!current) return;
  if (current.parts[part] !== approvalDigest(value))
    throw new AppError(
      409,
      "The content, recipients or settings changed after review. Request a new approval.",
    );
  current.checked.add(part);
}
export function assertApprovalComplete() {
  const current = execution.getStore();
  if (
    !current ||
    Object.keys(current.parts).some((part) => !current.checked.has(part))
  )
    throw new AppError(
      409,
      "The send did not validate every approved component",
    );
}
/** Internal capability: called only by the authenticated owner approval service. Never accept this context from a transport. */
export function withSendApproval<T>(
  caller: Caller,
  operation: string,
  input: unknown,
  parts: Record<string, string>,
  run: () => Promise<T>,
) {
  return execution.run(
    {
      caller,
      operation,
      inputDigest: approvalDigest(input),
      parts,
      checked: new Set(),
    },
    run,
  );
}
