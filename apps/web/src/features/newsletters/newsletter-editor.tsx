import { MediaTools } from "../media/media-tools.js";
import { NewsletterImage, NewsletterVideo } from "./media-nodes.js";
import { youtubeVideo } from "@narada/contracts/media-content";
import { useEffect, useImperativeHandle, type Ref } from "react";
import {
  type JSONContent,
  EditorContent,
  EditorContext,
  useEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  SlashCommand,
  TEXT,
  H1,
  H2,
  H3,
  BULLET_LIST,
  NUMBERED_LIST,
  QUOTE,
  CODE,
  DIVIDER,
} from "@react-email/editor/ui";
import { Undo2, Redo2, Pencil } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import type {
  MessageContent,
  MessageEditorRef,
} from "../email-editor/message-editor.js";
import { EditorialToolbar } from "./editorial-toolbar.js";
import "@react-email/editor/themes/default.css";
import "../email-editor/visual-editor.css";

// Match the article renderer: newsletter content must work on the web and in email.
const extensions = [
  NewsletterImage,
  NewsletterVideo,
  StarterKit.configure({ link: { openOnClick: false } }),
  Placeholder.configure({
    placeholder: "Start your story, or type / to add a block…",
  }),
];
const blocks = [
  TEXT,
  H1,
  H2,
  H3,
  BULLET_LIST,
  NUMBERED_LIST,
  QUOTE,
  CODE,
  DIVIDER,
];

export default function NewsletterEditor({
  value,
  disabled,
  editorRef,
  onChange,
  title = "Write your issue",
}: {
  title?: string;
  value: MessageContent;
  disabled: boolean;
  editorRef: Ref<MessageEditorRef>;
  onChange: () => void;
}) {
  const editor = useEditor({
    extensions,
    content: value.document as JSONContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    editorProps: {
      handlePaste(view, event) {
        const video = youtubeVideo(
          event.clipboardData?.getData("text/plain") ?? "",
        );
        if (
          !view.editable ||
          !video ||
          !view.state.selection.empty ||
          view.state.selection.$from.parent.type.name !== "paragraph" ||
          view.state.selection.$from.parent.content.size
        )
          return false;
        event.preventDefault();
        view.dispatch(
          view.state.tr.replaceSelectionWith(
            view.state.schema.nodes.youtube!.create({
              src: video.url,
              title: "YouTube video",
            }),
          ),
        );
        return true;
      },
      attributes: {
        role: "textbox",
        "aria-label": "Email message",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) => {
      if (editor.isEditable) onChange();
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useImperativeHandle(
    editorRef,
    () => ({
      serialize: async () => {
        if (!editor) throw new Error("The issue editor is still loading");
        return {
          document: editor.getJSON() as NonNullable<MessageContent["document"]>,
          html: "",
          text: "",
        };
      },
    }),
    [editor],
  );
  return (
    <section
      className="narada-message-editor narada-editorial min-w-0 rounded-xl border bg-white"
      aria-label={title === "Write your issue" ? "Issue composition" : title}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Pencil className="size-4" aria-hidden="true" />
          {title}
        </h2>
        <div className="flex flex-wrap gap-1">
          <MediaTools editor={editor} disabled={disabled} newsletter />
          <Button
            variant="ghost"
            size="icon"
            title="Undo"
            aria-label="Undo edit"
            disabled={disabled || !editor}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Redo"
            aria-label="Redo edit"
            disabled={disabled || !editor}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 />
          </Button>
        </div>
      </div>
      {editor ? (
        <EditorContext.Provider value={{ editor }}>
          <EditorialToolbar editor={editor} disabled={disabled} />
          <EditorContent
            editor={editor}
            className="narada-email-canvas min-w-0 p-5 md:p-8"
          />
          <SlashCommand items={blocks} />
        </EditorContext.Provider>
      ) : (
        <p className="p-5">Loading editor…</p>
      )}
      <p className="border-t px-5 py-3 text-xs text-muted-foreground">
        Use the toolbar to format your story, or type / for blocks. Select text
        to add a link.
      </p>
    </section>
  );
}
