import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { ImagePlus, Video } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { Field, Notice } from "../../components/shared.js";
import { api } from "../../lib/api.js";
import { youtubeVideo, type MediaAsset } from "@narada/contracts/media-content";
import { uploadImage } from "./media-api.js";

export function MediaTools({
  editor,
  disabled,
  newsletter = false,
}: {
  editor: Editor | null;
  disabled: boolean;
  newsletter?: boolean;
}) {
  const [dialog, setDialog] = useState<"image" | "video" | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [alt, setAlt] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(next?: string) {
    setBusy(true);
    setError("");
    try {
      const page = await api<{ data: MediaAsset[]; nextCursor: string | null }>(
        `media${next ? "?cursor=" + encodeURIComponent(next) : ""}`,
      );
      setAssets((old) =>
        next
          ? [
              ...old,
              ...page.data.filter((a) => !old.some((b) => a.id === b.id)),
            ]
          : page.data,
      );
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load images");
    } finally {
      setBusy(false);
    }
  }
  function insert() {
    if (!editor || disabled) return;
    if (dialog === "image" && selected) {
      const width = newsletter ? selected.width : Math.min(selected.width, 600);
      const attrs = {
        src: selected.url,
        alt,
        width,
        height: Math.max(
          1,
          Math.round((selected.height * width) / selected.width),
        ),
      };
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.selection.to, [
          { type: "image", attrs },
          { type: "paragraph" },
        ])
        .run();
    } else if (dialog === "video") {
      const video = youtubeVideo(url);
      if (!video) {
        setError("Enter a YouTube watch, share, Shorts or live video URL.");
        return;
      }
      const label = title.trim() || "YouTube video";
      editor
        .chain()
        .focus()
        .insertContentAt(
          editor.state.selection.to,
          newsletter
            ? [
                { type: "youtube", attrs: { src: video.url, title: label } },
                { type: "paragraph" },
              ]
            : [
                {
                  type: "image",
                  attrs: {
                    src: video.thumbnail,
                    alt: `Watch ${label} on YouTube`,
                    width: 480,
                    height: 360,
                    href: video.url,
                  },
                },
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: `Watch ${label} on YouTube`,
                      marks: [{ type: "link", attrs: { href: video.url } }],
                    },
                  ],
                },
                { type: "paragraph" },
              ],
        )
        .run();
    }
    setDialog(null);
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || !editor}
        onClick={() => {
          setDialog("image");
          setSelected(null);
          setAlt("");
          void load();
        }}
      >
        <ImagePlus className="size-4" /> Image
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || !editor}
        onClick={() => {
          setDialog("video");
          setUrl("");
          setTitle("");
          setError("");
        }}
      >
        <Video className="size-4" /> YouTube
      </Button>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent
          className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            editor?.commands.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialog === "image" ? "Image library" : "Add a YouTube video"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "image"
                ? "Upload once and reuse in newsletters, templates and broadcasts. Images are public to anyone with the link and remain available in sent emails."
                : "The public newsletter shows a player. Email shows a thumbnail linked to YouTube."}
            </DialogDescription>
          </DialogHeader>
          <Notice>{error}</Notice>
          {dialog === "image" ? (
            <>
              <Field label="Upload image">
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/gif"
                  disabled={busy || disabled}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setBusy(true);
                    setError("");
                    try {
                      const asset = await uploadImage(file);
                      setAssets((old) => [
                        asset,
                        ...old.filter((a) => a.id !== asset.id),
                      ]);
                      setSelected(asset);
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Upload failed",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                PNG, JPEG or GIF · up to 3 MB · up to 16 megapixels
              </p>
              <div
                role="group"
                aria-label="Saved images"
                className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-64 overflow-y-auto"
              >
                {assets.map((asset) => (
                  <button
                    type="button"
                    key={asset.id}
                    aria-pressed={selected?.id === asset.id}
                    disabled={busy || disabled}
                    onClick={() => setSelected(asset)}
                    className={`rounded-lg border p-2 text-left focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === asset.id ? "ring-2 ring-primary" : ""}`}
                  >
                    <img
                      src={asset.url}
                      alt=""
                      loading="lazy"
                      className="h-24 w-full object-contain bg-muted/30"
                    />
                    <span className="block truncate text-sm mt-1">
                      {asset.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {asset.width} × {asset.height}
                    </span>
                  </button>
                ))}
              </div>
              {busy ? (
                <p role="status">Loading images…</p>
              ) : !assets.length && !error ? (
                <p className="text-sm text-muted-foreground">
                  Upload your first image to get started.
                </p>
              ) : null}
              {error && !busy && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void load()}
                >
                  Reload library
                </Button>
              )}
              {cursor && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void load(cursor)}
                >
                  Load more images
                </Button>
              )}
              <Field label="Image description (alt text)">
                <Input
                  value={alt}
                  maxLength={500}
                  disabled={busy || disabled}
                  onChange={(e) => setAlt(e.target.value)}
                  placeholder="Describe the image for readers who cannot see it"
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                Leave empty only for decorative images. This description is
                saved with this use of the image.
              </p>
            </>
          ) : (
            <>
              <Field label="YouTube URL">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                />
              </Field>
              <Field label="Video title">
                <Input
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Describe the video"
                />
              </Field>
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={disabled || busy || (dialog === "image" && !selected)}
              onClick={insert}
            >
              {dialog === "image" ? "Insert image" : "Insert video"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
