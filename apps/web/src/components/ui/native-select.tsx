import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";
export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
