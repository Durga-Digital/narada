import { Copy } from "lucide-react";
import { copyWithFeedback } from "../lib/feedback.js";
import { Button } from "./ui/button.js";

/** Public identifiers stay selectable when clipboard access is unavailable. */
export function ResourceIdentifier({
  label,
  value,
  onSelect,
}: {
  label: string;
  value: string;
  onSelect?: () => void;
}) {
  return (
    <span className="relative z-20 flex min-w-0 items-center gap-1 whitespace-normal text-xs font-normal text-muted-foreground">
      <span className="min-w-0">
        <span>{label}: </span>
        {onSelect ? (
          <button
            type="button"
            className="break-all text-left font-medium hover:underline focus-visible:outline-ring"
            onClick={onSelect}
          >
            {value}
          </button>
        ) : (
          <code className="select-all break-all">{value}</code>
        )}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label.toLowerCase()} ${value}`}
        title={`Copy ${label.toLowerCase()}`}
        onClick={(event) => {
          event.stopPropagation();
          void copyWithFeedback(value).catch(() => {
            // copyWithFeedback displays the error and manual-copy fallback.
          });
        }}
      >
        <Copy aria-hidden="true" />
      </Button>
    </span>
  );
}
