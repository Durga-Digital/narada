// Retain only random keys and request hashes, never request bodies or credentials.
// An explicit retry of the same failed operation reuses its key; we never retry automatically.
const storagePrefix = "narada:pending-mutation:";
const pending = new Map<string, { key: string; createdAt: number }>();
const running = new Map<string, Promise<unknown>>();
export async function mutationRequest<T>(
  identity: string,
  run: (key: string) => Promise<T>,
): Promise<T> {
  const hash = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const existing = running.get(hash);
  if (existing) return existing as Promise<T>;
  const operation = (async () => {
    let entry = pending.get(hash);
    try {
      const saved = sessionStorage.getItem(storagePrefix + hash);
      if (!entry && saved) {
        const value = JSON.parse(saved);
        if (
          typeof value.key === "string" &&
          typeof value.createdAt === "number"
        )
          entry = value;
      }
    } catch {
      /* Storage can be unavailable; keep the key in memory. */
    }
    entry ??= { key: crypto.randomUUID(), createdAt: Date.now() };
    if (Date.now() - entry.createdAt >= 23 * 3600000)
      throw new Error(
        "This unconfirmed operation is too old to retry safely. Review its outcome before starting a new operation.",
      );
    pending.set(hash, entry);
    try {
      sessionStorage.setItem(storagePrefix + hash, JSON.stringify(entry));
    } catch {
      /* Memory fallback. */
    }
    const clear = () => {
      pending.delete(hash);
      try {
        sessionStorage.removeItem(storagePrefix + hash);
      } catch {
        /* Memory fallback. */
      }
    };
    try {
      const result = await run(entry.key);
      clear();
      return result;
    } catch (error) {
      if (error instanceof DefinitiveMutationError) clear();
      throw error;
    }
  })();
  running.set(hash, operation);
  try {
    return await operation;
  } finally {
    running.delete(hash);
  }
}
export class DefinitiveMutationError extends Error {}
