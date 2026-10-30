import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { withFeedback } from "../../lib/feedback.js";
import { lazy, Suspense, useRef, useState } from "react";
import type { templateDto, TemplateContent } from "@narada/core/template-model";
import type { MessageEditorRef } from "../email-editor/message-editor.js";
import { EmailPreview } from "../email-editor/email-preview.js";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { editableTemplate } from "./starters.js";
import { SampleValuesForm, type SampleValues } from "./sample-values.js";
import {
  Pencil,
  Eye,
  Braces,
  Settings2,
  Monitor,
  Smartphone,
} from "lucide-react";
import { Badge } from "../../components/ui/badge.js";
import { Field, Notice } from "../../components/shared.js";
import { Variables } from "./variables.js";
import { ApiPanel } from "../api-reference/api-reference.js";
const MessageEditor = lazy(() => import("../email-editor/message-editor.js"));
export type TemplateRecord = ReturnType<typeof templateDto>;
export function TemplateEditor({
  id,
  back,
  useBroadcast,
}: {
  id: string;
  back: () => void;
  useBroadcast: (id: string) => void;
}) {
  const resource = useResource<TemplateRecord>(`templates/${id}`);
  if (!resource.data)
    return <Notice>{resource.error || "Loading template…"}</Notice>;
  return (
    <Editor initial={resource.data} back={back} useBroadcast={useBroadcast} />
  );
}
function Editor({
  initial,
  back,
  useBroadcast,
}: {
  initial: TemplateRecord;
  back: () => void;
  useBroadcast: (id: string) => void;
}) {
  const [record, setRecord] = useState(initial),
    [draft, setDraft] = useState<TemplateContent>(() =>
      editableTemplate(initial.draft),
    ),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [samples, setSamples] = useState<SampleValues>({}),
    [section, setSection] = useState("Design"),
    [device, setDevice] = useState("desktop"),
    [dirty, setDirty] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [preview, setPreview] = useState<{
      subject: string;
      html: string;
      text: string;
    }>(),
    [view, setView] = useState("Preview"),
    [copyAlias, setCopyAlias] = useState("");
  const editor = useRef<MessageEditorRef>(null);
  const editable = !record.archived && !busy;
  const variables = () => samples;
  const changeDraft = (next: TemplateContent) => {
    setDraft(next);
    setDirty(true);
  };
  async function showPreview() {
    await action(async () => {
      if (!editor.current) throw new Error("The editor is still loading");
      const content = await editor.current.serialize();
      setPreview({
        subject: draft.subject,
        html: content.html,
        text: content.text,
      });
      setView("Preview");
      setSection("Preview & test");
    });
  }
  async function save() {
    if (!editor.current) throw new Error("The editor is still loading");
    const content = await editor.current.serialize();
    const saved = await api<TemplateRecord>(
      `templates/${record.id}`,
      { draft: { ...draft, ...content }, revision: record.revision },
      "PUT",
    );
    setRecord(saved);
    setDraft(saved.draft);
    setDirty(false);
    return saved;
  }
  async function action(fn: () => Promise<void>, successMessage?: string) {
    setBusy(true);
    setNotice("");
    try {
      await withFeedback(fn, successMessage);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={back}>
          ← Templates
        </Button>
        <div className="ml-auto flex gap-2">
          <ApiPanel resource="Templates" />
          <Button
            variant="outline"
            disabled={!editable}
            onClick={() =>
              action(async () => {
                await save();
                setNotice("Draft saved. Published emails are unchanged.");
              }, "Draft saved")
            }
          >
            Save draft
          </Button>
          <Button
            disabled={!editable}
            onClick={() =>
              action(async () => {
                const saved = await save();
                const published = await api<TemplateRecord>(
                  `templates/${record.id}/publish`,
                  { revision: saved.revision },
                );
                setRecord(published);
                setNotice(`Published version ${published.publishedVersion}.`);
              }, "Template published")
            }
          >
            Publish template
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
            {draft.kind} template
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight">
            {draft.name}
          </h1>
          <ResourceIdentifier label="Template alias" value={record.alias} />
          <ResourceIdentifier label="Template ID" value={record.id} />
        </div>
        <Badge variant="outline">
          {record.archived
            ? "archived"
            : dirty
              ? "Unsaved changes"
              : record.publishedVersion && record.hasUnpublishedChanges
                ? "Unpublished changes"
                : record.status}
        </Badge>
      </div>
      <nav
        aria-label="Template workspace"
        className="flex gap-1 border-b overflow-x-auto pb-3"
      >
        {[
          { label: "Design", icon: Pencil },
          { label: "Preview & test", icon: Eye },
          { label: "Variables", icon: Braces },
          { label: "Settings", icon: Settings2 },
        ].map(({ label, icon: Icon }) => (
          <Button
            key={label}
            variant={section === label ? "secondary" : "ghost"}
            aria-pressed={section === label}
            disabled={busy}
            onClick={() =>
              label === "Preview & test"
                ? void showPreview()
                : setSection(label)
            }
          >
            <Icon size={16} />
            {label}
            {label === "Variables" && draft.variables.length > 0
              ? ` (${draft.variables.length})`
              : ""}
          </Button>
        ))}
        {record.publishedVersion && (
          <span className="ml-auto self-center whitespace-nowrap px-3 text-xs text-muted-foreground">
            Published v{record.publishedVersion}
          </span>
        )}
      </nav>
      <Notice>{notice}</Notice>
      <div hidden={section !== "Design"} className="space-y-5">
        <fieldset disabled={!editable} className="grid sm:grid-cols-2 gap-4">
          <Field label="Template name">
            <Input
              value={draft.name}
              onChange={(e) => changeDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Subject">
            <Input
              value={draft.subject}
              onChange={(e) =>
                changeDraft({ ...draft, subject: e.target.value })
              }
            />
          </Field>
        </fieldset>
        <div className="border rounded-xl overflow-hidden">
          <Suspense
            fallback={
              <p role="status" className="p-10">
                Loading email editor…
              </p>
            }
          >
            <MessageEditor
              value={draft}
              previewImported
              onChange={() => setDirty(true)}
              editorRef={editor}
              disabled={!editable}
              tokens={draft.variables
                .filter((v) => v.key)
                .map((v) => ({ label: v.key, value: `{{vars.${v.key}}}` }))}
            />
          </Suspense>
        </div>
      </div>
      <div
        hidden={section !== "Variables"}
        className="rounded-xl border bg-white p-5 md:p-7"
      >
        <Variables
          value={draft.variables}
          disabled={!editable}
          onChange={(variables) => changeDraft({ ...draft, variables })}
        />
      </div>
      <section
        hidden={section !== "Preview & test"}
        className="border rounded-xl bg-white p-5 md:p-7 space-y-5"
      >
        <h2 className="font-medium">Preview and test</h2>
        <p className="text-sm text-muted-foreground">
          Use sample values to see the email your recipients will receive.
          Preview draft saves your latest changes and applies these values.{" "}
          {draft.kind === "broadcast" &&
            "Contact placeholders resolve later for each broadcast recipient."}
        </p>
        <SampleValuesForm
          definitions={draft.variables}
          value={samples}
          onChange={setSamples}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!editable}
            onClick={() =>
              action(async () => {
                await save();
                setPreview(
                  await api(`templates/${record.id}/preview`, {
                    variables: variables(),
                  }),
                );
              })
            }
          >
            Preview draft
          </Button>
          <Button
            variant="outline"
            disabled={busy || record.archived || !record.publishedVersion}
            onClick={() =>
              action(async () => {
                setPreview(
                  await api(`templates/${record.id}/preview`, {
                    variables: variables(),
                    version: record.publishedVersion,
                  }),
                );
              })
            }
          >
            Preview published
          </Button>
        </div>
        {preview && (
          <div className="space-y-3">
            <p className="text-sm">Subject: {preview.subject}</p>
            <div className="flex flex-wrap gap-1">
              {["Preview", "HTML", "Plain text"].map((v) => (
                <Button
                  key={v}
                  variant={view === v ? "secondary" : "ghost"}
                  onClick={() => setView(v)}
                >
                  {v}
                </Button>
              ))}
              <div className="ml-auto flex gap-1">
                <Button
                  size="icon"
                  variant={device === "desktop" ? "secondary" : "ghost"}
                  aria-label="Desktop preview"
                  aria-pressed={device === "desktop"}
                  onClick={() => setDevice("desktop")}
                >
                  <Monitor />
                </Button>
                <Button
                  size="icon"
                  variant={device === "mobile" ? "secondary" : "ghost"}
                  aria-label="Mobile preview"
                  aria-pressed={device === "mobile"}
                  onClick={() => setDevice("mobile")}
                >
                  <Smartphone />
                </Button>
              </div>
            </div>
            {view === "Preview" ? (
              <div className="rounded-xl bg-muted/50 p-3 sm:p-6">
                <div
                  className={`mx-auto transition-[max-width] ${device === "mobile" ? "max-w-[375px]" : "max-w-full"}`}
                >
                  <EmailPreview
                    title="Template email preview"
                    html={preview.html}
                    className="h-[560px] shadow-sm"
                  />
                </div>
              </div>
            ) : (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">
                {view === "HTML" ? preview.html : preview.text}
              </pre>
            )}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Test sender">
            <Input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="hello@your-verified-domain.com"
            />
          </Field>
          <Field label="Test recipient">
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
        </div>
        <Button
          variant="outline"
          disabled={!editable || !from || !to}
          onClick={() =>
            action(async () => {
              await save();
              await api(`templates/${record.id}/test`, {
                from,
                to,
                variables: variables(),
              });
              setNotice("Test email queued. Check Mailpit in local mode.");
            }, "Test email queued")
          }
        >
          Send template test
        </Button>
      </section>
      <section
        hidden={section !== "Settings"}
        className="border rounded-xl bg-white p-5 md:p-7 space-y-4"
      >
        <h2 className="font-medium">Reuse this template</h2>
        <p className="text-sm text-muted-foreground">
          Published content is copied when you send or create a broadcast.
          Future template edits do not change queued emails or existing
          broadcasts.
        </p>
        {draft.kind === "broadcast" ? (
          <Button
            disabled={busy || record.archived || !record.publishedVersion}
            onClick={() =>
              action(async () => {
                const result = await api<{ id: string }>(
                  `templates/${record.id}/broadcasts`,
                  { variables: variables() },
                );
                useBroadcast(result.id);
              }, "Broadcast created from template")
            }
          >
            Use in broadcast
          </Button>
        ) : (
          <code className="block text-xs p-3 bg-muted rounded break-all">{`template: { id: "${record.alias}", version: ${record.publishedVersion ?? "PUBLISH_FIRST"}, variables: { … } }`}</code>
        )}
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="New copy alias">
            <Input
              value={copyAlias}
              onChange={(e) => setCopyAlias(e.target.value)}
              placeholder="welcome-copy"
            />
          </Field>
          <Button
            variant="outline"
            disabled={busy || !copyAlias}
            onClick={() =>
              action(async () => {
                await api(`templates/${record.id}/duplicate`, {
                  alias: copyAlias,
                });
                setNotice(
                  "Copy created from the saved draft. Find it in Templates.",
                );
              }, "Template duplicated")
            }
          >
            Duplicate template
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              action(
                async () => {
                  const updated = await api<TemplateRecord>(
                    `templates/${record.id}/archive`,
                    { archived: !record.archived, revision: record.revision },
                  );
                  setRecord(updated);
                  setNotice(
                    updated.archived
                      ? "Archived: new template sends are blocked."
                      : "Template restored.",
                  );
                },
                record.archived ? "Template restored" : "Template archived",
              )
            }
          >
            {record.archived ? "Restore template" : "Archive template"}
          </Button>
        </div>
      </section>
    </div>
  );
}
