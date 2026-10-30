import { useState } from "react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Field, Notice } from "../../components/shared.js";
import { formInput } from "@narada/contracts/form-content";
import type { FormRecord } from "@narada/core/form-model";
import type { PropertyDefinition, Topic } from "@narada/core/audience-model";
import { FormPlayer } from "./form-player.js";
import { FormBuilder } from "./form-builder.js";
import { FormResponses } from "./form-responses.js";
import { useFormAutosave } from "./use-form-autosave.js";
import type { AudienceRow } from "../broadcasts/types.js";
export function FormEditor({
  id,
  back,
  useBroadcast,
}: {
  id: string;
  back: () => void;
  useBroadcast: (id: string) => void;
}) {
  const resource = useResource<FormRecord>(`forms/${id}`);
  if (!resource.data)
    return (
      <>
        <Button variant="ghost" onClick={back}>
          ← Forms
        </Button>
        <Notice>{resource.error || "Loading form…"}</Notice>
        {resource.error && (
          <Button onClick={() => void resource.refresh()}>Try again</Button>
        )}
      </>
    );
  return (
    <Editor
      key={resource.data.id}
      initial={resource.data}
      back={back}
      useBroadcast={useBroadcast}
    />
  );
}
function Editor({
  initial,
  back,
  useBroadcast,
}: {
  initial: FormRecord;
  back: () => void;
  useBroadcast: (id: string) => void;
}) {
  const [tab, setTab] = useState("Build"),
    [pending, setPending] = useState(false),
    [dragging, setDragging] = useState(false),
    [notice, setNotice] = useState("");
  const {
    record,
    draft,
    update,
    acceptRecord,
    flush,
    resolveConflict,
    dirty,
    saving,
    error,
    conflict,
  } = useFormAutosave(initial, pending || dragging);
  const properties = useResource<PropertyDefinition[]>("properties"),
    topics = useResource<Topic[]>("topics"),
    audiences = useResource<AudienceRow[]>("segments");
  const destinations = audiences.data?.filter(
    (audience) => audience.kind !== "dynamic" && !audience.publicationId,
  );
  const url = `${location.origin}/forms/${record.id}`;
  async function action(work: () => Promise<void>) {
    setPending(true);
    setNotice("");
    try {
      await work();
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Unable to complete this action",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() =>
          void action(async () => {
            await flush();
            back();
          })
        }
      >
        ← Forms
      </Button>
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="serif text-4xl">{draft.name || "Untitled form"}</h1>
          <p className="text-xs text-muted-foreground mt-3">
            {record.accepting
              ? `Accepting responses · Version ${record.version}`
              : record.version
                ? "Closed to new responses"
                : "Draft · not public"}
            {record.version &&
            (dirty || record.publishedRevision !== record.revision)
              ? " · Changes not published"
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <span
            data-testid="form-save-status"
            aria-live="polite"
            aria-atomic="true"
            className="self-center text-xs text-muted-foreground"
          >
            {error
              ? "Changes not saved"
              : saving
                ? "Saving…"
                : dirty
                  ? "Waiting to save…"
                  : "All changes saved"}
          </span>
          <Button
            disabled={pending}
            onClick={() =>
              void action(async () => {
                const saved = await flush();
                const valid = formInput.safeParse(saved.draft);
                if (!valid.success)
                  throw new Error(
                    valid.error.issues.map((issue) => issue.message).join("; "),
                  );
                const published = await api<FormRecord>(
                  `forms/${record.id}/publish`,
                  { revision: saved.revision },
                );
                acceptRecord(published);
                setNotice(`Published version ${published.version}.`);
              })
            }
          >
            Publish form
          </Button>
        </div>
      </div>
      <nav
        aria-label="Form workspace"
        className="flex gap-2 border-b pb-3 overflow-x-auto"
      >
        {["Build", "Settings", "Preview", "Responses", "Share"].map((t) => (
          <Button
            key={t}
            variant={tab === t ? "secondary" : "ghost"}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </nav>
      <Notice>{notice}</Notice>
      {error && (
        <div
          role="alert"
          className="rounded-lg border bg-white p-4 text-sm space-y-3"
        >
          <p>{error}</p>
          <div className="flex flex-wrap gap-2">
            {conflict ? (
              <>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => void action(() => resolveConflict(true))}
                >
                  Keep my edits
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void action(() => resolveConflict(false))}
                >
                  Use saved draft
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={pending || saving}
                onClick={() =>
                  void action(async () => {
                    await flush();
                  })
                }
              >
                Retry saving
              </Button>
            )}
          </div>
        </div>
      )}
      <fieldset disabled={pending} className="min-w-0">
        {tab === "Build" && (
          <FormBuilder
            content={draft}
            onChange={update}
            properties={properties.data ?? []}
            propertyError={properties.error}
            disabled={pending}
            onDragStateChange={setDragging}
          />
        )}
        {tab === "Settings" && (
          <div className="max-w-2xl space-y-6">
            <Field label="Form name">
              <Input
                value={draft.name}
                maxLength={120}
                onChange={(e) => update({ name: e.target.value })}
              />
            </Field>
            <Field label="Welcome message">
              <Textarea
                value={draft.description}
                maxLength={1000}
                onChange={(e) => update({ description: e.target.value })}
              />
            </Field>
            <div className="grid sm:grid-cols-[1fr_140px] gap-5">
              <Field label="Brand name">
                <Input
                  value={draft.brand}
                  maxLength={80}
                  onChange={(e) => update({ brand: e.target.value })}
                />
              </Field>
              <Field label="Accent color">
                <Input
                  type="color"
                  value={draft.color}
                  onChange={(e) => update({ color: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Thank-you message">
              <Textarea
                value={draft.thankYou}
                maxLength={1000}
                onChange={(e) => update({ thankYou: e.target.value })}
              />
            </Field>
            <section className="border rounded-xl bg-white p-5 space-y-5">
              <h2 className="serif text-2xl">Contacts & email</h2>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.syncContacts}
                  onChange={(e) =>
                    update({
                      syncContacts: e.target.checked,
                      topicId: e.target.checked ? draft.topicId : "",
                      audienceId: e.target.checked
                        ? (draft.audienceId ?? "")
                        : "",
                    })
                  }
                />
                <span>
                  Save verified respondents to Contacts
                  <br />
                  <span className="text-muted-foreground">
                    Send a confirmation link before creating or updating a
                    profile.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.acknowledgment}
                  onChange={(e) => update({ acknowledgment: e.target.checked })}
                />
                <span>
                  Send a response acknowledgment
                  <br />
                  <span className="text-muted-foreground">
                    A short receipt. With contact sync enabled, it follows email
                    confirmation.
                  </span>
                </span>
              </label>
              {(draft.syncContacts || draft.acknowledgment) && (
                <>
                  <Field label="Sender email">
                    <Input
                      value={draft.from}
                      placeholder="Your team <hello@yourdomain.com>"
                      onChange={(e) => update({ from: e.target.value })}
                    />
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    Use a verified sending domain and make the email question
                    required.
                  </p>
                </>
              )}
              {draft.syncContacts && (
                <div className="space-y-2">
                  <Field label="Audience destination">
                    <NativeSelect
                      value={draft.audienceId ?? ""}
                      disabled={!audiences.data}
                      onChange={(e) => update({ audienceId: e.target.value })}
                    >
                      <option value="">No audience destination</option>
                      {draft.audienceId &&
                        !destinations?.some(
                          (a) => a.id === draft.audienceId,
                        ) && (
                          <option value={draft.audienceId} disabled>
                            {audiences.data
                              ? "Selected audience is unavailable"
                              : "Loading selected audience…"}
                          </option>
                        )}
                      {destinations?.map((audience) => (
                        <option key={audience.id} value={audience.id}>
                          {audience.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <p className="text-xs text-muted-foreground mt-2">
                    Add respondents after email confirmation and a checked
                    consent answer. Create a manual audience in Audience →
                    Segments.
                  </p>
                </div>
              )}
              {draft.syncContacts && audiences.error && (
                <div>
                  <Notice>{audiences.error}</Notice>
                  <Button
                    variant="outline"
                    onClick={() => void audiences.refresh()}
                  >
                    Retry audiences
                  </Button>
                </div>
              )}
              {draft.syncContacts && (
                <Field label="Signup topic">
                  <NativeSelect
                    value={draft.topicId}
                    onChange={(e) => update({ topicId: e.target.value })}
                  >
                    <option value="">No topic subscription</option>
                    {topics.data
                      ?.filter((t) => t.active && t.visibility === "public")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
              )}
              <p className="text-xs text-muted-foreground">
                Signup forms need an audience or an active public topic from
                Audience → Topics. Include an optional consent question
                describing the emails respondents will receive. Existing
                unsubscribe choices are preserved.
              </p>
              <Notice>{topics.error}</Notice>
            </section>
            {record.accepting && (
              <Button
                variant="outline"
                onClick={() =>
                  void action(async () => {
                    const saved = await flush();
                    const closed = await api<FormRecord>(
                      `forms/${record.id}/close`,
                      { revision: saved.revision },
                    );
                    acceptRecord(closed);
                    setNotice(
                      "Form closed. Existing responses are still available.",
                    );
                  })
                }
              >
                Close form
              </Button>
            )}
          </div>
        )}
        {tab === "Preview" && (
          <FormPlayer content={draft} preview onSubmit={async () => {}} />
        )}
        {tab === "Responses" && <FormResponses id={record.id} />}
        {tab === "Share" && (
          <div className="max-w-2xl space-y-5">
            <h2 className="serif text-3xl">Invite a response.</h2>
            <p className="text-sm text-muted-foreground">
              Share the public link anywhere, or create an email invitation in
              Broadcasts.
            </p>
            {record.accepting ? (
              <>
                <Field label="Public form link">
                  <Input readOnly value={url} />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void action(async () => {
                        await navigator.clipboard.writeText(url);
                        setNotice("Form link copied.");
                      })
                    }
                  >
                    Copy link
                  </Button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center text-sm underline"
                  >
                    Open public form ↗
                  </a>
                </div>
                <Button
                  onClick={() =>
                    void action(async () => {
                      await flush();
                      const b = await api<{ id: string }>(
                        `forms/${record.id}/broadcasts`,
                        {},
                      );
                      useBroadcast(b.id);
                    })
                  }
                >
                  Create broadcast invitation
                </Button>
                <p className="text-xs text-muted-foreground">
                  Opens an email draft with your published form link. Choose an
                  audience, review, and send in Broadcasts.
                </p>
              </>
            ) : (
              <Notice>
                Publish the form to open its public link and create an
                invitation.
              </Notice>
            )}
          </div>
        )}
      </fieldset>
    </div>
  );
}
