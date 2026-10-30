/** Fail closed for missing coverage, obsolete exceptions and accidental exposure. */
export function assertSurfaceCoverage(
  catalog: readonly string[],
  exposed: readonly string[],
  exclusions: Readonly<Record<string, string>>,
) {
  const errors: string[] = [];
  for (const [id, reason] of Object.entries(exclusions)) {
    if (!catalog.includes(id)) errors.push(`Unknown exclusion: ${id}`);
    if (!reason.trim()) errors.push(`Missing exclusion reason: ${id}`);
    if (exposed.includes(id))
      errors.push(`Exposed operation is still excluded: ${id}`);
  }
  for (const id of catalog)
    if (!exposed.includes(id) && !Object.hasOwn(exclusions, id))
      errors.push(`Missing operation: ${id}`);
  for (const id of exposed)
    if (!catalog.includes(id)) errors.push(`Unknown operation: ${id}`);
  if (new Set(exposed).size !== exposed.length)
    errors.push("Duplicate operation");
  if (errors.length) throw new Error(errors.join("\n"));
}
