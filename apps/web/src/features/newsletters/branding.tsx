import { PublicationImageField } from "./publication-image-field.js";
import { useEffect, useRef, useState } from "react";
import type {
  PublicationBranding,
  PublicationLogo,
} from "@narada/contracts/types";
import {
  defaultBranding,
  publicationThemes,
  LOGO_MAX_BYTES,
} from "@narada/contracts/branding";
import type { Publication } from "@narada/core/newsletter-model";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";
import { Field, Notice } from "../../components/shared.js";
import { EmailPreview } from "../email-editor/email-preview.js";

export function PublicationBrandingEditor({
  pub,
  active,
  refresh,
  settings,
}: {
  pub: Publication;
  active: boolean;
  refresh: () => Promise<void>;
  settings: () => void;
}) {
  const [saved, setSaved] = useState(pub);
  const [draft, setDraft] = useState<PublicationBranding>(
    pub.branding ?? defaultBranding,
  );
  const [html, setHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [mobile, setMobile] = useState(false);
  const previewRequest = useRef(0);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved.branding ?? defaultBranding);
  const base = `publications/${pub.id}`;
  useEffect(() => {
    if (!active) return;
    const version = ++previewRequest.current;
    setPreviewError("");
    // Clear the old preview so an unsaved edit is never represented as current.
    setHtml("");
    const timer = setTimeout(() => {
      void api<{ html: string }>(`${base}/branding/preview`, {
        branding: draft,
        revision: saved.revision,
      })
        .then((result) => {
          if (previewRequest.current === version) setHtml(result.html);
        })
        .catch((err) => {
          if (previewRequest.current === version)
            setPreviewError(
              err instanceof Error ? err.message : "Preview failed",
            );
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      previewRequest.current++;
    };
  }, [active, base, draft, saved.revision]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const change = (patch: Partial<PublicationBranding>) => {
    setDraft((value) => ({ ...value, ...patch }));
    setStatus("");
  };
  const reload = async () => {
    setPending(true);
    setError("");
    try {
      const latest = await api<Publication>(base);
      setSaved(latest);
      setDraft(latest.branding ?? defaultBranding);
      setStatus("Saved branding restored.");
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not reload branding",
      );
    } finally {
      setPending(false);
    }
  };
  const upload = async (file: File) => {
    setError("");
    setStatus("");
    if (file.size > LOGO_MAX_BYTES) {
      setError("Choose a logo at most 512 KiB.");
      return;
    }
    setPending(true);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read the logo"));
        reader.onload = () => resolve(String(reader.result).split(",")[1]!);
        reader.readAsDataURL(file);
      });
      const asset = await api<PublicationLogo>(`${base}/logo`, {
        fileName: file.name,
        contentBase64,
      });
      change({ logoAssetId: asset.id });
      setStatus("Logo uploaded. Save branding to show it on your publication.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <h2 className="serif text-2xl">Make it your publication</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a look for your homepage, archive, and signup pages. Email
          designs stay unchanged.
        </p>
        <Button variant="link" className="px-0" onClick={settings}>
          Edit name, description, and accent color in Settings
        </Button>
      </div>
      <Notice>
        {error ||
          (pub.revision !== saved.revision
            ? "Publication settings changed. Reload saved branding before continuing; your edits are still here."
            : "")}
      </Notice>
      <div className="grid gap-8 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Field label="Homepage layout">
            <select
              aria-label="Homepage layout"
              className="w-full rounded-md border bg-background p-2"
              disabled={pending}
              value={draft.layout ?? "letter"}
              onChange={(e) =>
                change({
                  layout: e.target.value as PublicationBranding["layout"],
                })
              }
            >
              <option value="letter">
                Letter — introduction and signup first
              </option>
              <option value="feature">
                Feature — lead with the latest story
              </option>
              <option value="grid">
                Grid — featured story and recent issue cards
              </option>
            </select>
          </Field>
          <PublicationImageField
            publicationId={pub.id}
            label="Wordmark"
            assetId={draft.wordmarkAssetId}
            alt={draft.wordmarkAlt}
            disabled={pending}
            onBusy={setPending}
            onChange={(wordmarkAssetId, wordmarkAlt) =>
              change({ wordmarkAssetId, wordmarkAlt })
            }
          />
          <PublicationImageField
            publicationId={pub.id}
            label="Homepage cover"
            assetId={draft.coverAssetId}
            alt={draft.coverAlt}
            disabled={pending}
            onBusy={setPending}
            onChange={(coverAssetId, coverAlt) =>
              change({ coverAssetId, coverAlt })
            }
          />
          <fieldset disabled={pending} className="space-y-3">
            <legend className="font-medium">Signup section</legend>
            <Field label="Signup heading">
              <Input
                value={draft.signupHeading ?? ""}
                maxLength={100}
                placeholder="Stay in the loop"
                onChange={(e) => change({ signupHeading: e.target.value })}
              />
            </Field>
            <Field label="Signup description">
              <Textarea
                value={draft.signupDescription ?? ""}
                maxLength={300}
                placeholder="What readers receive and how often."
                onChange={(e) => change({ signupDescription: e.target.value })}
              />
            </Field>
            <Field label="Signup button text">
              <Input
                value={draft.signupButton ?? ""}
                maxLength={40}
                placeholder="Subscribe"
                onChange={(e) => change({ signupButton: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.signupName !== false}
                onChange={(e) => change({ signupName: e.target.checked })}
              />
              Ask for an optional name
            </label>
            <p className="text-xs text-muted-foreground">
              Email confirmation and unsubscribe information always remain
              visible.
            </p>
          </fieldset>
          <fieldset disabled={pending} className="space-y-3">
            <legend className="mb-3 text-sm font-medium">Theme</legend>
            {publicationThemes.map((theme) => (
              <label
                key={theme.id}
                className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${draft.theme === theme.id ? "border-primary bg-primary/5" : "bg-card"}`}
              >
                <input
                  type="radio"
                  name={`theme-${pub.id}`}
                  value={theme.id}
                  checked={draft.theme === theme.id}
                  onChange={() => change({ theme: theme.id })}
                  className="mt-1 accent-primary"
                />
                <span>
                  <span
                    className={`block text-lg ${theme.id === "minimal" ? "font-medium" : "serif"}`}
                  >
                    {theme.name}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {theme.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset disabled={pending} className="space-y-4">
            <legend className="mb-2 text-sm font-medium">
              Publication logo
            </legend>
            <p className="text-sm text-muted-foreground">
              PNG or JPEG, up to 512 KiB and 2,048 pixels per side. A square
              transparent PNG works well. Uploaded logos have public URLs.
            </p>
            <Field label={draft.logoAssetId ? "Replace logo" : "Upload logo"}>
              <Input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </Field>
            {draft.logoAssetId && (
              <>
                <Field label="Logo description">
                  <Input
                    value={draft.logoAlt}
                    maxLength={160}
                    placeholder={saved.settings.name}
                    onChange={(event) =>
                      change({ logoAlt: event.target.value })
                    }
                  />
                </Field>
                <Button
                  variant="outline"
                  onClick={() => change({ logoAssetId: null, logoAlt: "" })}
                >
                  Remove logo
                </Button>
              </>
            )}
            <Field label="Welcome message (optional)">
              <Textarea
                rows={5}
                value={draft.welcomeText}
                maxLength={1000}
                onChange={(event) =>
                  change({ welcomeText: event.target.value })
                }
                placeholder="Tell readers what to expect from your publication."
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              {draft.welcomeText.length}/1,000 characters · Plain text
            </p>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={pending || !dirty}
              onClick={async () => {
                setPending(true);
                setError("");
                setStatus("");
                try {
                  const result = await api<Publication>(
                    `${base}/branding`,
                    { branding: draft, revision: saved.revision },
                    "PUT",
                  );
                  setSaved({ ...saved, ...result });
                  setDraft(result.branding ?? defaultBranding);
                  setStatus(
                    "Branding saved. Your public pages are up to date.",
                  );
                  await refresh();
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Save failed. Your edits are preserved.",
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "Working…" : "Save branding"}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void reload()}
            >
              Discard changes and reload
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Saving updates public pages immediately. Uploading or previewing
            alone does not.
          </p>
          <p role="status" className="text-sm">
            {status ||
              (dirty
                ? "Unsaved branding changes"
                : "All branding changes saved")}
          </p>
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">Homepage preview</h3>
            <div className="flex gap-2" role="group" aria-label="Preview width">
              <Button
                variant="outline"
                aria-pressed={!mobile}
                onClick={() => setMobile(false)}
              >
                Desktop
              </Button>
              <Button
                variant="outline"
                aria-pressed={mobile}
                onClick={() => setMobile(true)}
              >
                Mobile
              </Button>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Links and signup are disabled in this private preview.
          </p>
          <Notice>{previewError}</Notice>
          <div className={`mx-auto ${mobile ? "max-w-[390px]" : "w-full"}`}>
            {html ? (
              <EmailPreview
                html={html}
                title="Publication homepage preview"
                className="h-[740px]"
              />
            ) : (
              !previewError && (
                <p
                  role="status"
                  className="rounded-lg border p-8 text-sm text-muted-foreground"
                >
                  Updating preview…
                </p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
