import { IssueCollectionPicker } from "./publication-website.js";
import { PublicationImageField } from "./publication-image-field.js";
import { DeleteIssueDialog } from "./delete-issue-dialog.js";
import {
  canDeleteIssue,
  issueStatus,
  issueStatusLabels,
} from "@narada/contracts/issue-state";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type {
  Publication,
  Issue,
  Channels,
} from "@narada/core/newsletter-model";
import type { OwnerIssuePreview as Preview } from "@narada/contracts/dashboard";
import type { BroadcastDetail } from "../broadcasts/types.js";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Field, Notice, PageHeading } from "../../components/shared.js";
import { EmailPreview } from "../email-editor/email-preview.js";
import type { MessageEditorRef } from "../email-editor/message-editor.js";
const NewsletterEditor = lazy(() => import("./newsletter-editor.js"));
type Detail = {
  issue: Issue;
  delivery?: BroadcastDetail;
};
export function IssueEditor({
  publication,
  publicUrl,
  id,
  back,
}: {
  publication: Publication;
  publicUrl?: string;
  id: string;
  back: () => void;
}) {
  const resource = useResource<Detail>(
    `publications/${publication.id}/issues/${id}`,
  );
  if (!resource.data)
    return <Notice>{resource.error || "Loading issue…"}</Notice>;
  return (
    <Composer
      key={id}
      publication={publication}
      publicUrl={publicUrl}
      initial={resource.data}
      back={back}
    />
  );
}
function Composer({
  publication,
  publicUrl,
  initial,
  back,
}: {
  publication: Publication;
  publicUrl?: string;
  initial: Detail;
  back: () => void;
}) {
  const [record, setRecord] = useState(initial.issue),
    [draft, setDraft] = useState(initial.issue.draft),
    [delivery, setDelivery] = useState(initial.delivery);
  const [dirty, setDirty] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<Preview>(),
    [review, setReview] = useState(false),
    [previewTab, setPreviewTab] = useState<"web" | "email">("web");
  const [channels, setChannels] = useState<Channels>(
      initial.issue.emailReleased ? "web" : "both",
    ),
    [schedule, setSchedule] = useState(""),
    [testTo, setTestTo] = useState("");
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (preview) {
      previewRef.current?.focus({ preventScroll: true });
      previewRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    }
  }, [preview]);
  const editorRef = useRef<MessageEditorRef>(null),
    path = `publications/${publication.id}/issues/${record.id}`;
  const disabled =
    pending || !!record.scheduledAt || publication.status !== "active";
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function change() {
    setDirty(true);
    setReview(false);
    setPreview(undefined);
  }
  async function action(fn: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  async function save() {
    if (!dirty) return record;
    const content = await editorRef.current?.serialize();
    if (!content?.document)
      throw new Error("The issue editor is still loading");
    const nextDraft = { ...draft, document: content.document };
    const saved = await api<Issue>(
      path,
      { draft: nextDraft, revision: record.revision },
      "PUT",
    );
    setRecord(saved);
    setDraft(nextDraft);
    setDirty(false);
    return saved;
  }
  async function refresh() {
    const next = await api<Detail>(path);
    setRecord(next.issue);
    setDelivery(next.delivery);
  }
  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        onClick={() => {
          if (!dirty || window.confirm("Leave without saving your changes?"))
            back();
        }}
      >
        ← All issues
      </Button>
      <PageHeading
        title="Issue editor"
        description={
          record.scheduledAt
            ? `Scheduled for ${new Date(record.scheduledAt).toLocaleString()}`
            : record.publicVersionId
              ? "Published on the web. Draft edits stay private until you publish a correction."
              : `${issueStatusLabels[issueStatus(record)]}${record.emailReleased ? " · Email history retained" : " · Private edits"}`
        }
      />
      <Notice>{error}</Notice>
      {canDeleteIssue(record) && (
        <div className="flex justify-end">
          <DeleteIssueDialog
            publicationId={publication.id}
            issueId={record.id}
            revision={record.revision}
            title={draft.title}
            disabled={pending}
            onDeleted={() => {
              setDirty(false);
              back();
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5">
        <p className="text-sm text-muted-foreground" role="status">
          {pending
            ? "Working…"
            : dirty
              ? "Unsaved changes"
              : "All changes saved"}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={disabled || !dirty}
            onClick={() =>
              void action(async () => {
                await save();
              })
            }
          >
            Save issue
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void action(async () => {
                await save();
                setPreview(await api<Preview>(`${path}/preview`));
                setReview(false);
              })
            }
          >
            Preview saved issue
          </Button>
          <Button
            disabled={disabled}
            onClick={() =>
              void action(async () => {
                await save();
                setPreview(await api<Preview>(`${path}/preview`));
                setReview(true);
              })
            }
          >
            {record.emailReleased
              ? "Review web correction"
              : "Review and publish"}
          </Button>
        </div>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-5">
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer font-medium">
              Issue cover image{draft.coverAssetId ? " · Added" : ""}
            </summary>
            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Appears on your website and article previews after publishing.
                To include an image in email, insert it into the issue body.
              </p>
              <PublicationImageField
                publicationId={publication.id}
                label="Issue cover"
                assetId={draft.coverAssetId}
                alt={draft.coverAlt}
                disabled={disabled}
                onBusy={setPending}
                onChange={(coverAssetId, coverAlt) => {
                  setDraft((d) => ({ ...d, coverAssetId, coverAlt }));
                  change();
                }}
              />
            </div>
          </details>
          <fieldset
            disabled={disabled}
            className="grid gap-4 rounded-xl border bg-card p-5"
          >
            <Field label="Issue title">
              <Input
                className="h-12 text-xl md:text-2xl serif"
                value={draft.title}
                onChange={(event) => {
                  change();
                  setDraft((d) => ({ ...d, title: event.target.value }));
                }}
              />
            </Field>
            <Field label="Subtitle">
              <Input
                value={draft.subtitle}
                placeholder="A little context for your readers (optional)"
                onChange={(event) => {
                  change();
                  setDraft((d) => ({ ...d, subtitle: event.target.value }));
                }}
              />
            </Field>
          </fieldset>
          <Suspense fallback={<p>Loading editor…</p>}>
            <NewsletterEditor
              value={{
                document: initial.issue.draft.document,
                html: "",
                text: "",
              }}
              disabled={disabled}
              editorRef={editorRef}
              onChange={change}
            />
          </Suspense>
        </div>
        <aside
          className="min-w-0 rounded-xl border bg-card p-5 space-y-5"
          aria-label="Issue settings"
        >
          <div>
            <h2 className="font-medium">Email & web settings</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              One story for your inbox and public archive.
            </p>
          </div>
          <fieldset disabled={disabled} className="grid gap-5">
            {(
              [
                { key: "subject", label: "Email subject" },
                { key: "preheader", label: "Email preview text" },
                { key: "slug", label: "Issue URL slug" },
              ] as const
            ).map((f) => (
              <Field key={f.key} label={f.label}>
                <Input
                  value={draft[f.key]}
                  disabled={f.key === "slug" && record.slugLocked}
                  placeholder={f.key === "subject" ? draft.title : undefined}
                  onChange={(event) => {
                    change();
                    setDraft((d) => ({ ...d, [f.key]: event.target.value }));
                  }}
                />
              </Field>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Leave the subject blank to use your issue title. The URL is fixed
            after your first publication.
          </p>
        </aside>
      </div>
      {preview && (
        <section
          ref={previewRef}
          tabIndex={-1}
          aria-label="Saved issue preview"
          className="space-y-3 rounded-xl border p-4 scroll-mt-6 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <div className="flex gap-2">
            <Button
              variant="outline"
              aria-pressed={previewTab === "web"}
              onClick={() => setPreviewTab("web")}
            >
              Web preview
            </Button>
            <Button
              variant="outline"
              aria-pressed={previewTab === "email"}
              onClick={() => setPreviewTab("email")}
            >
              Email preview
            </Button>
          </div>
          <EmailPreview
            allowVideos={previewTab === "web"}
            title={
              previewTab === "web" ? "Issue web preview" : "Issue email preview"
            }
            html={previewTab === "web" ? preview.web.html : preview.email.html}
          />
        </section>
      )}
      {review && preview && (
        <section
          className="rounded-xl border p-5 space-y-4"
          aria-label="Publish review"
        >
          <h2 className="serif text-2xl">Ready to publish?</h2>
          <p>
            {publication.settings.name} · {preview.from}
          </p>
          <p>
            {preview.eligible} eligible recipients · {preview.excluded} excluded
          </p>
          <p>
            Web address: {location.origin}
            {preview.url}
          </p>
          <Field label="Publish to">
            <NativeSelect
              value={channels}
              disabled={pending}
              onChange={(event) => setChannels(event.target.value as Channels)}
            >
              <option value="web">Web only</option>
              {!record.emailReleased && (
                <>
                  <option value="both">Web and email</option>
                  <option value="email">Email only</option>
                </>
              )}
            </NativeSelect>
          </Field>
          <Field label="Schedule (optional, your local timezone)">
            <Input
              type="datetime-local"
              value={schedule}
              disabled={pending}
              onChange={(event) => setSchedule(event.target.value)}
            />
          </Field>
          <p className="text-sm text-muted-foreground">
            {Intl.DateTimeFormat().resolvedOptions().timeZone}. Scheduled
            content and recipients are frozen when confirmed. Later signups
            receive future issues; later opt-outs are still honored. Maximum
            1,000 eligible recipients per send.
          </p>
          {record.emailReleased && (
            <p>
              This updates the web article only. Its original email will not be
              sent again.
            </p>
          )}
          <Button
            disabled={
              pending ||
              (channels !== "web" &&
                (preview.eligible === 0 || preview.eligible > 1000))
            }
            onClick={() =>
              void action(async () => {
                const next = await api<Issue>(`${path}/publish`, {
                  revision: record.revision,
                  channels,
                  scheduledAt: schedule
                    ? new Date(schedule).getTime()
                    : undefined,
                  confirmed: true,
                });
                setRecord(next);
                setReview(false);
                setChannels(next.emailReleased ? "web" : channels);
                await refresh();
                setError(
                  next.scheduledAt
                    ? "Issue scheduled."
                    : "Issue published. Email delivery progresses separately.",
                );
              })
            }
          >
            {schedule
              ? "Confirm schedule"
              : record.publicVersionId && channels === "web"
                ? "Publish web correction"
                : "Publish now"}
          </Button>
        </section>
      )}
      <IssueCollectionPicker
        pub={publication}
        issue={record}
        disabled={pending}
        onSaved={(value) =>
          setRecord({
            ...record,
            revision: value.issueRevision,
            collectionIds: value.collectionIds,
            collectionRevision: value.revision,
          })
        }
      />
      <form
        className="flex flex-wrap items-end gap-4 rounded-xl border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void action(async () => {
            const saved = await save();
            await api(`${path}/test`, { revision: saved.revision, to: testTo });
            setError("Test email queued. The issue has not been distributed.");
          });
        }}
      >
        <div className="w-full">
          <h2 className="font-medium">Send yourself a preview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Check the issue in your inbox before sharing it with subscribers.
          </p>
        </div>
        <Field label="Test email address">
          <Input
            type="email"
            value={testTo}
            required
            onChange={(event) => setTestTo(event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Button variant="outline" type="submit" disabled={disabled}>
          Send test email
        </Button>
      </form>
      <div className="flex flex-wrap gap-3">
        {record.scheduledAt && (
          <Button
            disabled={pending}
            onClick={() =>
              void action(async () => {
                setRecord(
                  await api<Issue>(`${path}/cancel`, {
                    revision: record.revision,
                  }),
                );
                setError("Schedule cancelled. You can edit this issue again.");
              })
            }
          >
            Cancel schedule
          </Button>
        )}
        {record.publicVersionId && (
          <>
            <a
              className="underline p-2"
              href={`${publicUrl ?? `/n/${publication.settings.slug}`}/p/${record.draft.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              View public issue
            </a>
            <Button
              variant="outline"
              disabled={pending || !!record.scheduledAt || dirty}
              onClick={() =>
                void action(async () => {
                  setRecord(
                    await api<Issue>(`${path}/withdraw`, {
                      revision: record.revision,
                    }),
                  );
                  setError(
                    "Issue withdrawn from the web. Email history is preserved.",
                  );
                })
              }
            >
              Withdraw from web
            </Button>
          </>
        )}
        <Button
          variant="outline"
          disabled={pending || dirty || publication.status !== "active"}
          onClick={() =>
            void action(async () => {
              await api(`${path}/duplicate`, {});
              back();
            })
          }
        >
          Duplicate issue
        </Button>
        <Button
          variant="outline"
          disabled={pending || dirty}
          onClick={() => void action(refresh)}
        >
          Refresh status
        </Button>
      </div>
      {delivery && (
        <section className="space-y-3">
          <h2 className="serif text-2xl">Email delivery</h2>
          <p>
            {delivery.broadcast.state === "publication-held"
              ? "Held until scheduled publication"
              : delivery.broadcast.status}{" "}
            · {delivery.broadcast.total} recipients
          </p>
          <p className="text-sm">
            Queued and provider-accepted emails are not delivery confirmations.
          </p>
          <div className="flex gap-3 flex-wrap">
            {Object.entries(delivery.counts).map(([status, count]) => (
              <span key={status}>
                {status}: {count}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
