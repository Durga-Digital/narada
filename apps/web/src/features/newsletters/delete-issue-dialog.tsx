import { useState } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Notice } from "../../components/shared.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "../../components/ui/dialog.js";
export function DeleteIssueDialog({
  publicationId,
  issueId,
  revision,
  title,
  disabled,
  onDeleted,
}: {
  publicationId: string;
  issueId: string;
  revision: number;
  title: string;
  disabled?: boolean;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Delete draft
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this draft?</DialogTitle>
          <DialogDescription>
            “{title}” will be removed from your issues. This cannot be undone.
            No published issues or emails are affected.
          </DialogDescription>
        </DialogHeader>
        <Notice>{error}</Notice>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Keep draft
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                await api(
                  `publications/${publicationId}/issues/${issueId}`,
                  { revision },
                  "DELETE",
                );
                setOpen(false);
                onDeleted();
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "Could not delete draft",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Deleting…" : "Delete draft permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
