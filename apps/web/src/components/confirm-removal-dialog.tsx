import { useState, type ReactNode } from "react";
import { Field, Notice } from "./shared.js";
import { Input } from "./ui/input.js";
import { Button } from "./ui/button.js";
import { withFeedback } from "../lib/feedback.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog.js";

export function ConfirmRemovalDialog({
  title,
  name,
  description,
  action,
  successMessage,
  close,
  perform,
  completed,
}: {
  title: string;
  name: string;
  description: ReactNode;
  action: string;
  successMessage: string;
  close: () => void;
  perform: (confirmation: string) => Promise<unknown>;
  completed: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[90dvh] overflow-y-auto"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (confirmation !== name || busy) return;
            setBusy(true);
            setError("");
            try {
              await withFeedback(() => perform(confirmation), successMessage);
              completed();
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not complete this action",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm break-all">
            Type <strong>{name}</strong> to confirm.
          </p>
          <Field label="Confirmation name">
            <Input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              autoFocus
            />
          </Field>
          <Notice>{error}</Notice>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              type="submit"
              disabled={busy || confirmation !== name}
            >
              {busy ? "Working…" : action}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
