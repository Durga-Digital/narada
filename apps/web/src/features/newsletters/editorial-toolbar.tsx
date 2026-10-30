import { useEffect, useReducer, useRef, useState } from "react";
import type { EmailEditorRef } from "@react-email/editor";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link,
  List,
  ListOrdered,
  Quote,
  Code,
  SquareCode,
  Minus,
} from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import { Field, Notice } from "../../components/shared.js";

type Editor = NonNullable<EmailEditorRef["editor"]>;

export function EditorialToolbar({
  editor,
  disabled,
}: {
  editor: Editor;
  disabled: boolean;
}) {
  // Keep selection updates local to the controls, rather than rerendering the issue form.
  const [, update] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const refresh = () => update();
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
    };
  }, [editor]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const selection = useRef({ from: 0, to: 0 });
  const editingLink = editor.isActive("link");
  const heading = [1, 2, 3, 4, 5, 6].find((level) =>
    editor.isActive("heading", { level }),
  );
  const controls = [
    {
      label: "Bold",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Underline",
      icon: Underline,
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Strikethrough",
      icon: Strikethrough,
      active: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "Inline code",
      icon: Code,
      active: editor.isActive("code"),
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: "Bullet list",
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Block quote",
      icon: Quote,
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Code block",
      icon: SquareCode,
      active: editor.isActive("codeBlock"),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];
  return (
    <div
      role="group"
      aria-label="Issue formatting"
      className="flex flex-wrap items-center gap-1 border-b bg-background px-3 py-2"
    >
      <NativeSelect
        aria-label="Text style"
        className="mr-2 w-36"
        disabled={disabled}
        value={heading ? String(heading) : "paragraph"}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "paragraph")
            editor.chain().focus().setParagraph().run();
          else
            editor
              .chain()
              .focus()
              .setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })
              .run();
        }}
      >
        <option value="paragraph">Paragraph</option>
        {[1, 2, 3, 4, 5, 6].map((level) => (
          <option key={level} value={level}>
            Heading {level}
          </option>
        ))}
      </NativeSelect>
      {controls.map(({ label, icon: Icon, active, run }) => (
        <Button
          key={label}
          type="button"
          size="icon"
          variant={active ? "secondary" : "ghost"}
          title={label}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={run}
        >
          <Icon aria-hidden="true" />
        </Button>
      ))}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={editingLink ? "secondary" : "ghost"}
            title="Add or edit link"
            aria-label="Add or edit link"
            aria-pressed={editingLink}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              selection.current = {
                from: editor.state.selection.from,
                to: editor.state.selection.to,
              };
              setHref(String(editor.getAttributes("link").href ?? ""));
              setLabel(
                editor.state.doc.textBetween(
                  selection.current.from,
                  selection.current.to,
                  " ",
                ),
              );
              setError("");
            }}
          >
            <Link aria-hidden="true" />
          </Button>
        </DialogTrigger>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            editor.commands.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editingLink ? "Edit link" : "Add link"}</DialogTitle>
            <DialogDescription>
              Link to a web page or email address.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled) return;
              let url: URL;
              try {
                url = new URL(href.trim());
              } catch {
                setError("Enter a complete https, http or mailto URL.");
                return;
              }
              if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
                setError("Use an https, http or mailto link.");
                return;
              }
              const chain = editor
                .chain()
                .focus()
                .setTextSelection(selection.current);
              if (
                selection.current.from === selection.current.to &&
                !editingLink
              ) {
                chain
                  .insertContent({
                    type: "text",
                    text: label.trim() || url.href,
                    marks: [{ type: "link", attrs: { href: url.href } }],
                  })
                  .run();
                editor.commands.unsetLink();
              } else
                chain.extendMarkRange("link").setLink({ href: url.href }).run();
              setLinkOpen(false);
            }}
          >
            <Field label="Link URL">
              <Input
                autoFocus
                value={href}
                onChange={(event) => setHref(event.target.value)}
                placeholder="https://example.com"
                required
                disabled={disabled}
              />
            </Field>
            {selection.current.from === selection.current.to &&
              !editingLink && (
                <Field label="Link text">
                  <Input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Text to display"
                    disabled={disabled}
                  />
                </Field>
              )}
            <Notice>{error}</Notice>
            <DialogFooter>
              {editingLink && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .setTextSelection(selection.current)
                      .extendMarkRange("link")
                      .unsetLink()
                      .run();
                    setLinkOpen(false);
                  }}
                >
                  Remove link
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => setLinkOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={disabled}>
                Apply link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        title="Insert divider"
        aria-label="Insert divider"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus aria-hidden="true" />
      </Button>
    </div>
  );
}
