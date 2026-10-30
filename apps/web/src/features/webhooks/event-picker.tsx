import { useState } from "react";
import { webhookEvents, type WebhookEventType } from "@narada/contracts/types";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";
export function EventPicker({
  selected,
  onChange,
}: {
  selected: WebhookEventType[];
  onChange: (events: WebhookEventType[]) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = webhookEvents.filter((e) =>
    `${e.type} ${e.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Events to receive</legend>
      <Input
        aria-label="Search events"
        placeholder="Search events…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{selected.length} selected</span>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(webhookEvents.map((e) => e.type))}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto border rounded-lg p-2">
        {[...new Set(filtered.map((e) => e.group))].map((group) => (
          <div key={group}>
            <p className="px-2 py-2 text-xs font-medium text-muted-foreground">
              {group}
            </p>
            {filtered
              .filter((e) => e.group === group)
              .map((event) => (
                <label
                  key={event.type}
                  className="flex items-start gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-1 accent-primary"
                    checked={selected.includes(event.type)}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...selected, event.type]
                          : selected.filter((t) => t !== event.type),
                      )
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {event.type}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {event.description}
                    </span>
                  </span>
                </label>
              ))}
          </div>
        ))}
        {!filtered.length && (
          <p className="p-3 text-sm text-muted-foreground">
            No matching events.
          </p>
        )}
      </div>
    </fieldset>
  );
}
