import { useState } from "react";
import type { PublicationLogo } from "@narada/contracts/types";
import { LOGO_MAX_BYTES } from "@narada/contracts/branding";
import { api } from "../../lib/api.js";
import { Field, Notice } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";

export function PublicationImageField({
  publicationId,
  label,
  assetId,
  alt,
  disabled,
  onChange,
  onBusy,
}: {
  publicationId: string;
  label: string;
  assetId?: string | null;
  alt?: string;
  disabled?: boolean;
  onChange: (assetId: string | null, alt: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
      <Field
        label={
          assetId
            ? `Replace ${label.toLowerCase()}`
            : `Upload ${label.toLowerCase()}`
        }
      >
        <Input
          type="file"
          accept="image/png,image/jpeg"
          disabled={disabled}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setError("");
            if (file.size > LOGO_MAX_BYTES) {
              setError("Choose a PNG or JPEG at most 512 KiB.");
              return;
            }
            onBusy(true);
            try {
              const contentBase64 = await new Promise<string>(
                (resolve, reject) => {
                  const reader = new FileReader();
                  reader.onerror = () =>
                    reject(new Error("Could not read image"));
                  reader.onload = () =>
                    resolve(String(reader.result).split(",")[1]!);
                  reader.readAsDataURL(file);
                },
              );
              const asset = await api<PublicationLogo>(
                `publications/${publicationId}/assets`,
                { fileName: file.name, contentBase64 },
              );
              onChange(asset.id, alt ?? "");
            } catch (error) {
              setError(
                error instanceof Error ? error.message : "Upload failed",
              );
            } finally {
              onBusy(false);
            }
          }}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        PNG or JPEG, up to 512 KiB and 2,048 pixels per side. Uploaded images
        are public, including before publication.
      </p>
      <Notice>{error}</Notice>
      {assetId && (
        <>
          <Field label={`${label} description`}>
            <Input
              value={alt ?? ""}
              disabled={disabled}
              maxLength={160}
              onChange={(e) => onChange(assetId, e.target.value)}
            />
          </Field>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(null, "")}
          >
            Remove {label.toLowerCase()}
          </Button>
        </>
      )}
    </div>
  );
}
