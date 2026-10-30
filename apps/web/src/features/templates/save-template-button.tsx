import { useState } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { ActionForm, Field, value } from "../../components/shared.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog.js";
import type { TemplateContent } from "@narada/core/template-model";
export function SaveTemplateButton({
  readContent,
  onSaved,
  disabled,
}: {
  readContent: () => Promise<
    Pick<TemplateContent, "name" | "subject" | "html" | "text" | "document">
  >;
  onSaved: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Save as template
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              Save this message as a reusable broadcast template. Recipients,
              sender details, and scheduling stay with the broadcast.
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            label="Create reusable template"
            successMessage="Reusable template created"
            onSubmit={async (data) => {
              const content = await readContent();
              await api("templates", {
                ...content,
                kind: "broadcast",
                alias: value(data, "alias"),
                variables: [],
              });
              setOpen(false);
              onSaved();
            }}
          >
            <Field label="Template alias">
              <Input
                name="alias"
                required
                pattern="[a-z][a-z0-9-]{0,79}"
                placeholder="monthly-news"
              />
            </Field>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
