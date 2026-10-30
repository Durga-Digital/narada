import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { withFeedback } from "../../lib/feedback.js";
import { SaveTemplateButton } from "../templates/save-template-button.js";
import { EmailPreview } from "../email-editor/email-preview.js";
import type { PropertyDefinition } from "./types.js";
import { PreviewContactPicker } from "./preview-contact-picker.js";
import { lazy, Suspense, useRef, useState } from "react";
import type { MessageEditorRef } from "../email-editor/message-editor.js";
const MessageEditor = lazy(() => import("../email-editor/message-editor.js"));
import { ArrowLeft, Save, Send, Eye, Clock } from "lucide-react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Field, Notice, PageHeading } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Badge } from "../../components/ui/badge.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog.js";
import { BroadcastProgress } from "./progress.js";
import type {
  AudienceRow,
  Topic,
  BroadcastDetail,
  Broadcast,
  DraftInput,
  Preview,
} from "./types.js";
export function BroadcastEditor({
  id,
  back,
  backLabel = "All broadcasts",
}: {
  backLabel?: string;
  id: string;
  back: () => void;
}) {
  const resource = useResource<BroadcastDetail>(`broadcasts/${id}`, 5000);
  if (!resource.data)
    return <Notice>{resource.error || "Loading broadcast…"}</Notice>;
  return (
    <Editor
      id={id}
      detail={resource.data}
      refresh={resource.refresh}
      back={back}
      backLabel={backLabel}
    />
  );
}
function Editor({
  id,
  detail,
  refresh,
  back,
  backLabel,
}: {
  backLabel: string;
  id: string;
  detail: BroadcastDetail;
  refresh: () => Promise<void>;
  back: () => void;
}) {
  const messageEditor = useRef<MessageEditorRef>(null);
  const audiences = useResource<AudienceRow[]>("audiences");
  const topics = useResource<Topic[]>("topics");
  const properties = useResource<PropertyDefinition[]>("properties");
  const [previewEmail, setPreviewEmail] = useState("");
  const previewPath = `broadcasts/${id}/preview${previewEmail ? `?contact=${encodeURIComponent(previewEmail)}` : ""}`;
  const [draft, setDraft] = useState<DraftInput>(detail.broadcast.draft),
    [revision, setRevision] = useState(detail.broadcast.revision),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<Preview>(),
    [review, setReview] = useState(false),
    [scheduled, setScheduled] = useState(""),
    [testTo, setTestTo] = useState(""),
    [cancel, setCancel] = useState(false);
  const editable = detail.broadcast.status === "draft";
  const active = ["scheduled", "sending"].includes(detail.broadcast.status);
  const field = (key: keyof DraftInput) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  async function save() {
    if (!editable) return detail.broadcast;
    if (!messageEditor.current)
      throw new Error(
        "The email editor is still loading. Try again in a moment.",
      );
    const content = await messageEditor.current.serialize();
    const updated = { ...draft, ...content };
    const saved = await api<Broadcast>(
      `broadcasts/${id}`,
      { draft: updated, revision },
      "PUT",
    );
    setDraft(saved.draft);
    setRevision(saved.revision);
    await refresh();
    return saved;
  }
  async function action(fn: () => Promise<void>, successMessage?: string) {
    setBusy(true);
    setNotice("");
    try {
      await withFeedback(fn, successMessage);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="ghost" className="mb-5 -ml-3" onClick={back}>
        <ArrowLeft />
        {backLabel}
      </Button>
      <PageHeading
        title={detail.broadcast.draft.name}
        description={
          editable
            ? "Craft your message, send yourself a test, then review your audience."
            : "Recipient progress updates automatically. Completed means all submissions have finished."
        }
        action={
          <div className="flex flex-wrap gap-2 items-center">
            <SaveTemplateButton
              disabled={busy}
              readContent={async () => {
                const saved = await save();
                const { name, subject, html, text, document } = saved.draft;
                return { name, subject, html, text, document };
              }}
              onSaved={() => setNotice("Reusable draft created in Templates.")}
            />
            <Badge variant="secondary" className="capitalize">
              {detail.broadcast.status}
            </Badge>
            {editable ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await save();
                      setNotice("Draft saved.");
                    }, "Draft saved")
                  }
                >
                  <Save />
                  Save draft
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await save();
                      setPreview(await api<Preview>(previewPath));
                      setReview(true);
                    })
                  }
                >
                  <Send />
                  Review & send
                </Button>
              </>
            ) : active ? (
              <Button variant="outline" onClick={() => setCancel(true)}>
                Cancel broadcast
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="mb-4 space-y-1">
        <ResourceIdentifier label="Broadcast ID" value={detail.broadcast.id} />
        {draft.audienceId && (
          <ResourceIdentifier
            label="Segment ID (audienceId)"
            value={draft.audienceId}
          />
        )}
        {draft.topicId && (
          <ResourceIdentifier label="Topic ID" value={draft.topicId} />
        )}
      </div>
      <Notice>
        {notice || String(detail.broadcast.error ?? "") || audiences.error}
      </Notice>
      <div className="space-y-6 mt-4">
        <Card className="shadow-none">
          <CardContent>
            <fieldset disabled={!editable || busy} className="grid gap-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Broadcast name">
                  <Input
                    value={draft.name}
                    onChange={(e) => field("name")(e.target.value)}
                    maxLength={120}
                  />
                </Field>
                <Field label="Subject">
                  <Input
                    value={draft.subject}
                    onChange={(e) => field("subject")(e.target.value)}
                    maxLength={200}
                    placeholder="Something worth opening"
                  />
                </Field>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                <Field label="From">
                  <Input
                    value={draft.from}
                    onChange={(e) => field("from")(e.target.value)}
                    placeholder="Your team <hello@narada.test>"
                  />
                </Field>
                <Field label="Audience">
                  <NativeSelect
                    value={draft.audienceId}
                    onChange={(e) => field("audienceId")(e.target.value)}
                  >
                    <option value="">Select an audience</option>
                    {audiences.data
                      ?.filter((a) => !a.publicationId)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.total})
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                <Field label="Reply-To (optional)">
                  <Input
                    type="email"
                    value={draft.replyTo ?? ""}
                    onChange={(e) => field("replyTo")(e.target.value)}
                    placeholder="replies@example.com"
                  />
                </Field>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Subscription topic">
                  <NativeSelect
                    value={draft.topicId ?? ""}
                    onChange={(e) => field("topicId")(e.target.value)}
                  >
                    <option value="">
                      Recorded list consent (manual segments)
                    </option>
                    {topics.data
                      ?.filter((t) => t.active || t.id === draft.topicId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {!t.active ? " (archived)" : ""}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                {draft.audienceId && (
                  <PreviewContactPicker
                    key={draft.audienceId}
                    id={draft.audienceId}
                    value={previewEmail}
                    onChange={setPreviewEmail}
                  />
                )}
              </div>
            </fieldset>
            <Button
              variant="outline"
              className="mt-5"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await save();
                  setPreview(await api<Preview>(previewPath));
                })
              }
            >
              <Eye />
              Preview email
            </Button>
          </CardContent>
        </Card>
        <div className="rounded-xl border overflow-hidden bg-card">
          <Suspense
            fallback={
              <p role="status" className="p-12 text-center">
                Loading email editor…
              </p>
            }
          >
            <MessageEditor
              value={draft}
              tokenLabel="Insert contact property"
              tokens={[
                "email",
                "name",
                "first_name",
                "last_name",
                ...(properties.data ?? []).map((p) => p.key),
              ].map((key) => ({ label: key, value: `{{contact.${key}}}` }))}
              disabled={!editable || busy}
              editorRef={messageEditor}
            />
          </Suspense>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="shadow-none">
            <CardContent>
              <h2 className="font-medium mb-5">Sender details</h2>
              <fieldset disabled={!editable || busy} className="grid gap-4">
                <Field label="Organization">
                  <Input
                    value={draft.organization}
                    onChange={(e) => field("organization")(e.target.value)}
                    placeholder="Your company"
                  />
                </Field>
                <Field label="Postal address">
                  <Textarea
                    value={draft.postalAddress}
                    onChange={(e) => field("postalAddress")(e.target.value)}
                    rows={3}
                    placeholder="Your business mailing address"
                  />
                </Field>
              </fieldset>
              <p className="text-xs text-muted-foreground mt-4">
                These details appear in the footer. Each recipient gets their
                own unsubscribe link.
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-none">
            <CardContent>
              <h2 className="font-medium mb-4">Send yourself a test</h2>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    await save();
                    await api(`broadcasts/${id}/test`, {
                      to: testTo,
                      ...(previewEmail ? { previewEmail } : {}),
                    });
                    setNotice(
                      "Test email queued. In local mode, open Mailpit to read it.",
                    );
                  }, "Test email queued");
                }}
              >
                <Field label="Test recipient">
                  <Input
                    type="email"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    required
                    placeholder="you@example.com"
                  />
                </Field>
                <Button type="submit" variant="outline" disabled={busy}>
                  Send test email
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-3">
                Tests do not send to your audience or change campaign progress.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
      {!editable && <BroadcastProgress detail={detail} />}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(undefined);
            setReview(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {review ? "Ready to share?" : "Email preview"}
            </DialogTitle>
            <DialogDescription>
              {review
                ? `${preview?.eligible} eligible recipients · ${preview?.excluded} unsubscribed or suppressed contacts excluded.`
                : "External images and active content are blocked in this preview."}
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm border-b pb-3">
            <p>
              <strong>From:</strong> {draft.from}
            </p>
            <p>
              <strong>Subject:</strong> {preview?.subject ?? draft.subject}
            </p>
          </div>
          <EmailPreview
            title="Broadcast email preview"
            html={preview?.html ?? ""}
            className="h-72"
          />
          {review && (
            <>
              <Field label="Schedule (optional)">
                <Input
                  type="datetime-local"
                  value={scheduled}
                  onChange={(e) => setScheduled(e.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                Leave blank to send now. Scheduled times use{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}. Audience
                membership is frozen when you confirm; later unsubscribes are
                still honored.
              </p>
              <Notice>{notice}</Notice>
              <Button
                disabled={busy || !preview?.eligible}
                onClick={() =>
                  void action(
                    async () => {
                      await api(`broadcasts/${id}/send`, {
                        revision,
                        confirmed: true,
                        ...(scheduled
                          ? { scheduledAt: new Date(scheduled).getTime() }
                          : {}),
                      });
                      setPreview(undefined);
                      setReview(false);
                      await refresh();
                      setNotice(
                        scheduled
                          ? "Broadcast scheduled."
                          : "Broadcast queued.",
                      );
                    },
                    scheduled ? "Broadcast scheduled" : "Broadcast queued",
                  )
                }
              >
                {scheduled ? <Clock /> : <Send />}
                {scheduled
                  ? "Schedule broadcast"
                  : `Send to ${preview?.eligible} recipients`}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={cancel} onOpenChange={setCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this broadcast?</DialogTitle>
            <DialogDescription>
              Unsent messages will be stopped. Messages already submitted or in
              flight cannot be recalled.
            </DialogDescription>
          </DialogHeader>
          <Notice>{notice}</Notice>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api(`broadcasts/${id}/cancel`, {});
                setCancel(false);
                await refresh();
              }, "Broadcast cancelled — in-flight emails may still be delivered")
            }
          >
            Confirm cancellation
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
