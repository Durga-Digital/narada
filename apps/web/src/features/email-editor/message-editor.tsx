import { MediaTools } from "../media/media-tools.js";
import { uploadEditorImage } from "../media/media-api.js";
import { StarterKit } from "@react-email/editor/extensions";
const editorialExtensions = [
  StarterKit.configure({
    TwoColumns: false,
    ThreeColumns: false,
    FourColumns: false,
    ColumnsColumn: false,
    PreviewText: false,
    Sup: false,
    Uppercase: false,
    PreservedStyle: false,
    Table: false,
    TableRow: false,
    TableCell: false,
    TableHeader: false,
    Body: false,
    Container: false,
    Div: false,
    Button: false,
    Section: false,
    GlobalContent: false,
  }),
];
import { NativeSelect } from "../../components/ui/native-select.js";

import {
  useEffect,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { EmailEditor, type EmailEditorRef } from "@react-email/editor";
import { Inspector } from "@react-email/editor/ui";
import { EmailPreview } from "./email-preview.js";
import { DocumentStyle } from "./document-style.js";
import { importEmailHtml } from "./import-html.js";
import { Code, Pencil, Undo2, Redo2 } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { Textarea } from "../../components/ui/textarea.js";
import { Field, Notice } from "../../components/shared.js";
import type { MessageContent } from "@narada/core/message-content";
import "@react-email/editor/themes/default.css";
import "./visual-editor.css";

export type { MessageContent } from "@narada/core/message-content";
export interface MessageEditorRef {
  serialize: () => Promise<MessageContent>;
}
function initialContent(content: MessageContent) {
  if (content.document)
    return content.document as ReturnType<EmailEditorRef["getJSON"]>;
  if (content.html) return importEmailHtml(content.html);
  return {
    type: "doc",
    content: content.text.split("\n").map((text) => ({
      type: "paragraph",
      ...(text ? { content: [{ type: "text", text }] } : {}),
    })),
  };
}
export default function MessageEditor({
  value,
  disabled,
  editorRef,
  tokens = [],
  tokenLabel = "Insert variable",
  previewImported = false,
  editorial = false,
  onChange,
}: {
  value: MessageContent;
  disabled: boolean;
  editorRef: Ref<MessageEditorRef>;
  tokens?: { label: string; value: string }[];
  tokenLabel?: string;
  previewImported?: boolean;
  editorial?: boolean;
  onChange?: () => void;
}) {
  const [mode, setMode] = useState(
    value.document || (!value.html && !value.text) ? "visual" : "source",
  );
  const [sourceView, setSourceView] = useState(
    previewImported ? "preview" : "code",
  );
  const [source, setSource] = useState(value);
  const [initial, setInitial] = useState(() => initialContent(value));
  const [error, setError] = useState("");
  const upload = useCallback(async (file: File) => {
    try {
      return await uploadEditorImage(file);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image upload failed");
      throw error;
    }
  }, []);
  const [converting, setConverting] = useState(false);
  const [ready, setReady] = useState(false);
  const ref = useRef<EmailEditorRef>(null);
  const lastDocument = useRef<string | undefined>(undefined);
  useEffect(() => {
    ref.current?.editor?.setEditable(!disabled);
  }, [disabled]);
  async function serialize(): Promise<MessageContent> {
    if (mode === "source") {
      // Callers may pass a whole draft. Never return its stale metadata when
      // they merge serialized content into their current form values.
      const { html, text, document } = source;
      return { html, text, document };
    }
    if (!ref.current?.editor)
      throw new Error(
        "The email editor is still loading. Try again in a moment.",
      );
    const document = ref.current.getJSON() as NonNullable<
      MessageContent["document"]
    >;
    if (JSON.stringify(document).includes('"src":"blob:'))
      throw new Error("Wait for the image upload to finish before saving.");
    if (editorial) return { document, html: "", text: "" };
    const { html, text } = await ref.current.getEmail();
    return { document, html, text };
  }
  useImperativeHandle(editorRef, () => ({ serialize }));
  async function showSource() {
    setConverting(true);
    setError("");
    try {
      setSource(await serialize());
      setMode("source");
      setSourceView("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export email");
    } finally {
      setConverting(false);
    }
  }
  return (
    <section
      className="narada-message-editor min-w-0"
      aria-label="Email composition"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {mode === "visual" ? <Pencil size={16} /> : <Code size={16} />}
          {mode === "visual" ? "Compose your email" : "HTML & plain text"}
        </div>
        <div className="flex flex-wrap gap-1 items-center">
          {mode === "source" && previewImported && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSourceView(sourceView === "preview" ? "code" : "preview")
              }
            >
              {sourceView === "preview" ? "Edit HTML" : "View email"}
            </Button>
          )}
          {!editorial && (
            <NativeSelect
              aria-label={tokenLabel}
              className="max-w-44"
              value=""
              disabled={disabled || (mode === "visual" && !ready)}
              onChange={(e) => {
                const token = e.target.value;
                onChange?.();
                if (mode === "visual")
                  ref.current?.editor
                    ?.chain()
                    .focus()
                    .insertContent({ type: "text", text: token })
                    .run();
                else
                  setSource((current) => ({
                    html: current.html + token,
                    text: current.text + token,
                    document: undefined,
                  }));
              }}
            >
              <option value="" disabled>
                {tokenLabel}…
              </option>
              {tokens.map(({ label, value }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          )}
          {mode === "visual" && (
            <>
              <MediaTools
                editor={ready ? (ref.current?.editor ?? null) : null}
                disabled={disabled}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Undo edit"
                disabled={disabled || !ready}
                onClick={() =>
                  ref.current?.editor
                    ?.chain()
                    .focus()
                    .keyboardShortcut("Mod-z")
                    .run()
                }
              >
                <Undo2 />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Redo edit"
                disabled={disabled || !ready}
                onClick={() =>
                  ref.current?.editor
                    ?.chain()
                    .focus()
                    .keyboardShortcut("Mod-Shift-z")
                    .run()
                }
              >
                <Redo2 />
              </Button>
            </>
          )}
          {!editorial && (
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || converting || (mode === "visual" && !ready)}
              onClick={() => {
                if (mode === "visual") void showSource();
                else {
                  setInitial(initialContent(source));
                  setMode("visual");
                  setReady(false);
                  if (!source.document) onChange?.();
                }
              }}
            >
              {mode === "visual"
                ? "Edit source"
                : source.document
                  ? "Back to design"
                  : "Convert to blocks"}
            </Button>
          )}
        </div>
      </div>
      <Notice>{error}</Notice>
      {mode === "visual" ? (
        <div
          className={
            editorial
              ? "min-w-0"
              : "grid min-w-0 xl:grid-cols-[minmax(0,1fr)_260px]"
          }
        >
          <EmailEditor
            ref={ref}
            onUploadImage={upload}
            extensions={editorial ? editorialExtensions : undefined}
            onUpdate={(instance) => {
              const next = JSON.stringify(instance.getJSON());
              if (
                lastDocument.current !== undefined &&
                next !== lastDocument.current &&
                !disabled
              )
                onChange?.();
              lastDocument.current = next;
            }}
            content={initial}
            editable={!disabled}
            placeholder="Write your message, or type / to add a block…"
            className="narada-email-canvas min-w-0 overflow-x-auto bg-white p-5 md:p-8 min-h-[520px]"
            onReady={(instance) => {
              lastDocument.current = JSON.stringify(instance.getJSON());
              // The wrapper owns editorProps, so label the stable editor DOM rather than overriding its options.
              instance.editor?.view.dom.setAttribute(
                "aria-label",
                "Email message",
              );
              instance.editor?.view.dom.setAttribute("aria-multiline", "true");
              setReady(true);
            }}
          >
            {!editorial && (
              <fieldset
                disabled={disabled}
                className="min-w-0 border-t xl:border-t-0 xl:border-l bg-muted/20 p-4"
              >
                <h2 className="font-medium text-sm mb-4">Page & block style</h2>
                <Inspector.Root>
                  <Inspector.Breadcrumb />
                  <DocumentStyle />
                  <Inspector.Node />
                  <Inspector.Text />
                </Inspector.Root>
              </fieldset>
            )}
          </EmailEditor>
        </div>
      ) : sourceView === "preview" ? (
        <div className="p-4 md:p-8 bg-muted/30 space-y-3">
          <p className="text-sm text-muted-foreground">
            This template uses custom HTML. Edit the code or convert it to
            editable blocks. Conversion may simplify its layout and styles.
          </p>
          <EmailPreview
            html={source.html}
            title="Imported template preview"
            className="h-[520px]"
          />
        </div>
      ) : (
        <fieldset disabled={disabled} className="grid gap-4 p-5">
          <p className="text-xs text-muted-foreground">
            Source mode preserves your HTML. Converting to blocks keeps
            supported inline styles, but responsive rules, dark-mode styles, and
            some layouts may change. Changes are stored when you save.
          </p>
          <Field label="Email HTML">
            <Textarea
              rows={14}
              className="font-mono text-xs"
              value={source.html}
              onChange={(e) => {
                onChange?.();
                setSource({
                  ...source,
                  document: undefined,
                  html: e.target.value,
                });
              }}
            />
          </Field>
          <Field label="Message text">
            <Textarea
              rows={6}
              value={source.text}
              onChange={(e) => {
                onChange?.();
                setSource({
                  ...source,
                  document: undefined,
                  text: e.target.value,
                });
              }}
            />
          </Field>
        </fieldset>
      )}
      <p className="border-t px-5 py-3 text-xs text-muted-foreground">
        Type / for blocks · # then Space for a heading · Select text to format
        it. Preview your saved HTML and plain text before publishing or sending.
      </p>
    </section>
  );
}
