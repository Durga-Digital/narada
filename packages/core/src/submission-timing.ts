/** Fixed stage names only: never record payloads, credentials, recipients or URLs. */
export type SubmissionTiming = Partial<
  Record<
    | "authenticate"
    | "rateLimit"
    | "keyUsage"
    | "resolveInput"
    | "idempotencyRead"
    | "eligibilityRead"
    | "persist"
    | "idempotencyRaceRead",
    number
  >
>;
export async function timed<T>(
  timing: SubmissionTiming | undefined,
  stage: keyof SubmissionTiming,
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    if (timing)
      timing[stage] = Math.round((performance.now() - started) * 100) / 100;
  }
}
