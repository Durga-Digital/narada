import { toast } from "sonner";

/** Wrap a user action, not a background read. Compound actions get one outcome. */
export async function withFeedback<T>(
  operation: () => Promise<T>,
  success?: string,
): Promise<T> {
  try {
    const result = await operation();
    if (success) toast.success(success);
    return result;
  } catch (error) {
    toast.error("Action could not be completed", {
      description: error instanceof Error ? error.message : "Please try again.",
      duration: 8000,
    });
    throw error;
  }
}

/** Never include copied content: it may be an API key or signing secret. */
export function copyWithFeedback(value: string): Promise<void> {
  return withFeedback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      throw new Error(
        "Clipboard unavailable. Select and copy the text instead.",
      );
    }
  }, "Copied to clipboard");
}
