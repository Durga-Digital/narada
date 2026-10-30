import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  PublicationAbout,
  PublicationAboutInput,
  PublicationSite,
  PublicationSiteInput,
  EditorialCollection,
  PublicationNavigationItem,
  Page,
  Issue as IssueDto,
  IssueCollections,
} from "@narada/contracts/types";
import type { Publication, Issue } from "@narada/core/newsletter-model";
import type { MessageEditorRef } from "../email-editor/message-editor.js";
import type { MessageContent } from "../email-editor/message-editor.js";
import { PublicationBrandingEditor } from "./branding.js";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Field, Notice } from "../../components/shared.js";
import { EmailPreview } from "../email-editor/email-preview.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../components/ui/dialog.js";
const NewsletterEditor = lazy(() => import("./newsletter-editor.js"));

/** Exhaust pagination for bounded picker data, including empty pages. */
export function useEditorialCollections(id: string) {
  const [data, setData] = useState<EditorialCollection[]>([]),
    [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const rows: EditorialCollection[] = [];
      let cursor: string | null = null;
      do {
        const page: Page<EditorialCollection> = await api<
          Page<EditorialCollection>
        >(
          `publications/${id}/collections${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        rows.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);
      if (current === generation.current) {
        setData(rows);
        setError("");
      }
    } catch (e) {
      if (current === generation.current) setError(String(e));
    }
  }, [id]);
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    window.addEventListener("narada:collections-changed", changed);
    return () => {
      generation.current++;
      window.removeEventListener("narada:collections-changed", changed);
    };
  }, [refresh]);
  return { data, error, refresh };
}
function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
export function PublicationWebsite({
  pub,
  refresh,
  settings,
  active,
}: {
  pub: Publication;
  refresh: () => Promise<void>;
  settings: () => void;
  active: boolean;
}) {
  const [panel, setPanel] = useState("appearance");
  const [visited, setVisited] = useState<string[]>([]);
  return (
    <div className="grid gap-6 md:grid-cols-[180px_1fr]">
      <nav
        aria-label="Website settings"
        className="flex gap-2 flex-wrap md:flex-col md:items-stretch"
      >
        {[
          ["appearance", "Appearance"],
          ["about", "About"],
          ["navigation", "Navigation"],
          ["homepage", "Homepage"],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={panel === key ? "default" : "ghost"}
            aria-current={panel === key ? "page" : undefined}
            onClick={() => {
              setPanel(key!);
              setVisited([...visited, key!]);
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      <div className="min-w-0">
        <div hidden={panel !== "appearance"}>
          <PublicationBrandingEditor
            pub={pub}
            active={active && panel === "appearance"}
            refresh={refresh}
            settings={settings}
          />
        </div>
        <div hidden={panel !== "about"}>
          {visited.includes("about") && <AboutLoader id={pub.id} />}
        </div>
        <div hidden={!["navigation", "homepage"].includes(panel)}>
          {visited.some((p) => p === "navigation" || p === "homepage") && (
            <SiteLoader id={pub.id} panel={panel} />
          )}
        </div>
      </div>
    </div>
  );
}
function AboutLoader({ id }: { id: string }) {
  const resource = useResource<PublicationAbout>(`publications/${id}/about`);
  return resource.data ? (
    <AboutEditor id={id} initial={resource.data} />
  ) : (
    <Notice>{resource.error || "Loading About…"}</Notice>
  );
}
function AboutEditor({
  id,
  initial,
}: {
  id: string;
  initial: PublicationAbout;
}) {
  const [saved, setSaved] = useState(initial),
    [title, setTitle] = useState(initial.draft.title),
    [dirty, setDirty] = useState(false),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [html, setHtml] = useState("");
  const editor = useRef<MessageEditorRef>(null);
  useUnsaved(dirty);
  async function act(action: "save" | "preview" | "publish" | "withdraw") {
    setPending(true);
    setMessage("");
    setHtml("");
    try {
      if (action === "save" || action === "preview") {
        const content = await editor.current?.serialize();
        if (!content?.document) throw new Error("The editor is still loading");
        const draft: PublicationAboutInput = {
          title,
          document: content.document,
        };
        if (action === "preview")
          setHtml(
            (
              await api<{ html: string }>(`publications/${id}/about/preview`, {
                revision: saved.revision,
                draft,
              })
            ).html,
          );
        else {
          setSaved(
            await api<PublicationAbout>(
              `publications/${id}/about`,
              { revision: saved.revision, draft },
              "PUT",
            ),
          );
          setDirty(false);
          setMessage("Draft saved. The public About page has not changed.");
        }
      } else {
        setSaved(
          await api<PublicationAbout>(`publications/${id}/about/${action}`, {
            revision: saved.revision,
          }),
        );
        setMessage(
          action === "publish"
            ? "About is live. No email was sent."
            : "About is no longer public.",
        );
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="space-y-5">
      <h2 className="serif text-2xl">About your publication</h2>
      <p className="text-sm text-muted-foreground">
        Introduce yourself, explain what readers can expect, and invite them to
        subscribe.
      </p>
      <p role="status">
        {dirty
          ? "Unsaved changes"
          : saved.published
            ? JSON.stringify(saved.draft) ===
              JSON.stringify(saved.published.content)
              ? "Live · all changes published"
              : "Saved draft · unpublished changes"
            : "Private draft"}
      </p>
      <Field label="About page title">
        <Input
          value={title}
          maxLength={100}
          disabled={pending}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
            setHtml("");
          }}
        />
      </Field>
      <Suspense fallback={<Notice>Loading editor…</Notice>}>
        <NewsletterEditor
          title="About content"
          value={{
            text: "",
            html: "",
            document: initial.draft.document as MessageContent["document"],
          }}
          disabled={pending}
          editorRef={editor}
          onChange={() => {
            setDirty(true);
            setHtml("");
          }}
        />
      </Suspense>
      <Notice>{message}</Notice>
      <div className="flex gap-3 flex-wrap">
        <Button disabled={pending} onClick={() => void act("save")}>
          Save About draft
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void act("preview")}
        >
          Preview About
        </Button>
        <Button
          disabled={pending || dirty || saved.revision === 0}
          onClick={() => void act("publish")}
        >
          Publish About
        </Button>
        {saved.published && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void act("withdraw")}
          >
            Unpublish About
          </Button>
        )}
      </div>
      {html && <EmailPreview title="About preview" html={html} />}
    </section>
  );
}
function SiteLoader({ id, panel }: { id: string; panel: string }) {
  const resource = useResource<PublicationSite>(`publications/${id}/site`);
  return resource.data ? (
    <SiteEditor id={id} initial={resource.data} panel={panel} />
  ) : (
    <Notice>{resource.error || "Loading website…"}</Notice>
  );
}
function SiteEditor({
  id,
  initial,
  panel,
}: {
  id: string;
  initial: PublicationSite;
  panel: string;
}) {
  const [saved, setSaved] = useState(initial),
    [draft, setDraft] = useState(initial.draft),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [html, setHtml] = useState("");
  const collections = useEditorialCollections(id),
    about = useResource<PublicationAbout>(`publications/${id}/about`);
  const issues = useResource<Page<IssueDto>>(
    `publications/${id}/issues?status=published`,
  );
  const [more, setMore] = useState<IssueDto[]>([]),
    [cursor, setCursor] = useState<string | null>();
  const next = cursor === undefined ? issues.data?.nextCursor : cursor;
  const dirty = JSON.stringify(saved.draft) !== JSON.stringify(draft);
  useUnsaved(dirty);
  const change = (value: PublicationSiteInput) => {
    setDraft(value);
    setHtml("");
    setMessage("");
  };
  function nav(index: number, value: PublicationNavigationItem) {
    change({
      ...draft,
      navigation: draft.navigation.map((item, i) =>
        i === index ? value : item,
      ),
    });
  }
  async function act(action: "save" | "preview" | "publish") {
    setPending(true);
    setMessage("");
    setHtml("");
    try {
      if (action === "preview")
        setHtml(
          (
            await api<{ html: string }>(`publications/${id}/site/preview`, {
              revision: saved.revision,
              draft,
            })
          ).html,
        );
      else {
        const result = await api<PublicationSite>(
          `publications/${id}/site${action === "publish" ? "/publish" : ""}`,
          { revision: saved.revision, ...(action === "save" ? { draft } : {}) },
          action === "save" ? "PUT" : "POST",
        );
        setSaved(result);
        setMessage(
          action === "save"
            ? "Website draft saved. Publish to update navigation and homepage together."
            : "Website changes are live. No email was sent.",
        );
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="space-y-5">
      <h2 className="serif text-2xl">
        {panel === "navigation"
          ? "Publication navigation"
          : "Homepage curation"}
      </h2>
      <p className="text-sm text-muted-foreground">
        Navigation and homepage changes publish together. Appearance settings
        save separately.
      </p>
      <p role="status">
        {dirty
          ? "Unsaved changes"
          : saved.published
            ? JSON.stringify(saved.draft) ===
              JSON.stringify(saved.published.content)
              ? "Live · all changes published"
              : "Saved draft · unpublished changes"
            : "Using default website · private draft"}
      </p>
      <fieldset disabled={pending} className="space-y-4">
        {panel === "navigation" ? (
          <>
            <p className="text-sm">
              Up to eight links. Home remains available from your wordmark;
              Subscribe stays visible while signup is enabled.
            </p>
            {draft.navigation.map((item, index) => (
              <div key={index} className="rounded-lg border p-4 grid gap-3">
                <Field label={`Link ${index + 1} label`}>
                  <Input
                    value={item.label}
                    maxLength={100}
                    onChange={(e) =>
                      nav(index, { ...item, label: e.target.value })
                    }
                  />
                </Field>
                <Field label={`Link ${index + 1} destination`}>
                  <NativeSelect
                    value={
                      item.type === "collection"
                        ? `collection:${item.collectionId}`
                        : item.type
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      nav(
                        index,
                        value.startsWith("collection:")
                          ? {
                              type: "collection",
                              label: item.label,
                              collectionId: value.slice(11),
                            }
                          : value === "external"
                            ? {
                                type: "external",
                                label: item.label,
                                url: "https://",
                              }
                            : {
                                type: value as
                                  "home" | "archive" | "about" | "subscribe",
                                label: item.label,
                              },
                      );
                    }}
                  >
                    {["home", "archive", "about", "subscribe", "external"].map(
                      (type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ),
                    )}
                    {collections.data.map((col) => (
                      <option key={col.id} value={`collection:${col.id}`}>
                        {col.name}
                        {col.status === "archived" ? " (archived)" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {item.type === "external" && (
                  <Field label={`Link ${index + 1} URL`}>
                    <Input
                      type="url"
                      value={item.url}
                      onChange={(e) =>
                        nav(index, { ...item, url: e.target.value })
                      }
                    />
                  </Field>
                )}
                {item.type === "about" && !about.data?.published && (
                  <p className="text-sm text-muted-foreground">
                    Hidden until About is published. Publish About before
                    publishing this navigation.
                  </p>
                )}
                {item.type === "collection" &&
                  collections.data.find((c) => c.id === item.collectionId)
                    ?.status === "archived" && (
                    <p className="text-sm text-muted-foreground">
                      This collection is archived and hidden. Remove it before
                      publishing navigation.
                    </p>
                  )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={index === 0}
                    aria-label={`Move link ${index + 1} up`}
                    onClick={() => {
                      const rows = [...draft.navigation];
                      [rows[index - 1], rows[index]] = [
                        rows[index]!,
                        rows[index - 1]!,
                      ];
                      change({ ...draft, navigation: rows });
                    }}
                  >
                    Move up
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={`Remove link ${index + 1}`}
                    onClick={() =>
                      change({
                        ...draft,
                        navigation: draft.navigation.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={draft.navigation.length >= 8}
              onClick={() =>
                change({
                  ...draft,
                  navigation: [
                    ...draft.navigation,
                    { type: "external", label: "My website", url: "https://" },
                  ],
                })
              }
            >
              Add navigation link
            </Button>
          </>
        ) : (
          <>
            <Field label="Featured issue">
              <NativeSelect
                value={draft.featuredIssueId ?? ""}
                onChange={(e) =>
                  change({ ...draft, featuredIssueId: e.target.value || null })
                }
              >
                <option value="">Automatically feature the latest issue</option>
                {draft.featuredIssueId &&
                  ![...(issues.data?.data ?? []), ...more].some(
                    (i) => i.id === draft.featuredIssueId,
                  ) && (
                    <option value={draft.featuredIssueId}>
                      Saved selection (load issues to see its title)
                    </option>
                  )}
                {[...(issues.data?.data ?? []), ...more].map((issue) => (
                  <option key={issue.id} value={issue.id}>
                    {issue.draft.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {next && (
              <Button
                variant="outline"
                onClick={async () => {
                  setPending(true);
                  try {
                    const page = await api<Page<IssueDto>>(
                      `publications/${id}/issues?status=published&cursor=${encodeURIComponent(next)}`,
                    );
                    setMore([...more, ...page.data]);
                    setCursor(page.nextCursor);
                  } catch (e) {
                    setMessage(String(e));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Load more published issues
              </Button>
            )}
            <p className="text-sm">
              The public card uses the published title and cover. A withdrawn
              selection falls back to the latest public issue.
            </p>
            {[0, 1, 2].map((index) => (
              <Field key={index} label={`Homepage collection ${index + 1}`}>
                <NativeSelect
                  value={draft.collectionIds[index] ?? ""}
                  onChange={(e) => {
                    const ids = [...draft.collectionIds];
                    ids[index] = e.target.value;
                    change({ ...draft, collectionIds: ids.filter(Boolean) });
                  }}
                >
                  <option value="">None</option>
                  {collections.data
                    .filter((c) => c.status === "active")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            ))}
          </>
        )}
      </fieldset>
      <Notice>{message || collections.error || issues.error}</Notice>
      <div className="flex gap-3 flex-wrap">
        <Button disabled={pending} onClick={() => void act("save")}>
          Save website draft
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void act("preview")}
        >
          Preview website
        </Button>
        <Button
          disabled={pending || dirty || saved.revision === 0}
          onClick={() => void act("publish")}
        >
          Publish website
        </Button>
      </div>
      {html && <EmailPreview html={html} title="Website preview" />}
    </section>
  );
}
export function PublicationCollections({
  id,
  selectIssue,
}: {
  id: string;
  selectIssue: (id: string) => void;
}) {
  const resource = useEditorialCollections(id),
    [selected, setSelected] = useState<EditorialCollection>(),
    [archive, setArchive] = useState<EditorialCollection>(),
    [name, setName] = useState(""),
    [slug, setSlug] = useState(""),
    [description, setDescription] = useState(""),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  function edit(col?: EditorialCollection) {
    setSelected(col);
    setName(col?.name ?? "");
    setSlug(col?.slug ?? "");
    setDescription(col?.description ?? "");
    setMessage("");
  }
  return (
    <section className="space-y-6">
      <div>
        <h2 className="serif text-2xl">Editorial collections</h2>
        <p className="text-sm text-muted-foreground">
          Organize issues into series. Readers continue receiving the
          publication-wide newsletter.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          {resource.data.length === 0 && (
            <Notice>No collections yet. Create your first series.</Notice>
          )}
          {resource.data.map((col) => (
            <button
              key={col.id}
              className="block w-full rounded-xl border p-4 text-left"
              onClick={() => edit(col)}
            >
              <strong>{col.name}</strong>
              <span className="block text-sm text-muted-foreground">
                {col.status} · /c/{col.slug}
              </span>
            </button>
          ))}
        </div>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setMessage("");
            try {
              const col = await api<EditorialCollection>(
                `publications/${id}/collections${selected ? `/${selected.id}` : ""}`,
                selected
                  ? { name, description, revision: selected.revision }
                  : { name, slug, description },
                selected ? "PUT" : "POST",
              );
              edit(col);
              setMessage("Collection saved to the website. No email was sent.");
              await resource.refresh();
              window.dispatchEvent(new Event("narada:collections-changed"));
            } catch (e) {
              setMessage(String(e));
            } finally {
              setPending(false);
            }
          }}
        >
          <h3 className="font-medium">
            {selected ? "Edit collection" : "Create collection"}
          </h3>
          <fieldset
            disabled={pending || selected?.status === "archived"}
            className="space-y-4"
          >
            <Field label="Collection name">
              <Input
                required
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Collection slug">
              <Input
                required
                disabled={!!selected}
                value={slug}
                maxLength={80}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                onChange={(e) => setSlug(e.target.value)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              The URL cannot be changed after creation.
            </p>
            <Field label="Collection description">
              <Textarea
                value={description}
                maxLength={500}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Button type="submit">
              {selected ? "Save collection" : "Create collection"}
            </Button>
          </fieldset>
          {selected && (
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => edit()}
              >
                New collection
              </Button>
              {selected.status === "active" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setArchive(selected)}
                >
                  Archive collection
                </Button>
              )}
            </div>
          )}
        </form>
      </div>
      <Notice>{message || resource.error}</Notice>
      {selected && (
        <CollectionIssueList
          key={selected.id}
          id={id}
          collectionId={selected.id}
          select={selectIssue}
        />
      )}
      <Dialog
        open={!!archive}
        onOpenChange={(open) => {
          if (!open && !pending) setArchive(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive {archive?.name}?</DialogTitle>
            <DialogDescription>
              Its page, navigation links and homepage rows will disappear.
              Issues remain published and no subscriber preferences change.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setArchive(undefined)}
            >
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                if (!archive) return;
                setPending(true);
                try {
                  const result = await api<EditorialCollection>(
                    `publications/${id}/collections/${archive.id}/archive`,
                    { revision: archive.revision },
                  );
                  edit(result);
                  setArchive(undefined);
                  await resource.refresh();
                  window.dispatchEvent(new Event("narada:collections-changed"));
                } catch (e) {
                  setMessage(String(e));
                } finally {
                  setPending(false);
                }
              }}
            >
              Confirm archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function CollectionIssueList({
  id,
  collectionId,
  select,
}: {
  id: string;
  collectionId: string;
  select: (id: string) => void;
}) {
  const resource = useResource<Page<IssueDto>>(
      `publications/${id}/issues?collectionId=${collectionId}`,
    ),
    [extra, setExtra] = useState<IssueDto[]>([]),
    [cursor, setCursor] = useState<string | null>(),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const next = cursor === undefined ? resource.data?.nextCursor : cursor;
  return (
    <div className="space-y-3">
      <h3 className="serif text-xl">Issues in this collection</h3>
      <p className="text-sm">
        Assign issues from their editor. Only published web versions appear to
        readers.
      </p>
      {[...(resource.data?.data ?? []), ...extra].map((issue) => (
        <button
          key={issue.id}
          className="block w-full rounded-lg border p-4 text-left"
          onClick={() => select(issue.id)}
        >
          {issue.draft.title} · {issue.status}
        </button>
      ))}
      <Notice>{error || resource.error}</Notice>
      {next && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              const page = await api<Page<IssueDto>>(
                `publications/${id}/issues?collectionId=${collectionId}&cursor=${encodeURIComponent(next)}`,
              );
              setExtra([...extra, ...page.data]);
              setCursor(page.nextCursor);
            } catch (e) {
              setError(String(e));
            } finally {
              setPending(false);
            }
          }}
        >
          Load more collection issues
        </Button>
      )}
    </div>
  );
}
export function IssueCollectionPicker({
  pub,
  issue,
  disabled,
  onSaved,
}: {
  pub: Publication;
  issue: Issue;
  disabled: boolean;
  onSaved: (value: IssueCollections) => void;
}) {
  const collections = useEditorialCollections(pub.id),
    [ids, setIds] = useState(issue.collectionIds ?? []),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-medium">
        Editorial collections
      </summary>
      <p className="my-3 text-sm text-muted-foreground">
        Choose up to five series. Saving changes public discovery immediately
        for published issues, without publishing draft content or sending email.
      </p>
      <fieldset disabled={disabled || pending} className="space-y-3">
        {collections.data
          .filter((c) => c.status === "active" || ids.includes(c.id))
          .map((col) => (
            <label key={col.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={ids.includes(col.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, col.id]
                      : ids.filter((id) => id !== col.id),
                  )
                }
              />
              {col.name}
              {col.status === "archived" ? " (archived; remove to save)" : ""}
            </label>
          ))}
        <Button
          variant="outline"
          disabled={ids.length > 5}
          onClick={async () => {
            setPending(true);
            setMessage("");
            try {
              const result = await api<IssueCollections>(
                `publications/${pub.id}/issues/${issue.id}/collections`,
                {
                  revision: issue.collectionRevision ?? 0,
                  issueRevision: issue.revision,
                  collectionIds: ids,
                },
                "PUT",
              );
              onSaved(result);
              setMessage("Collections saved. No email was sent.");
            } catch (e) {
              setMessage(String(e));
            } finally {
              setPending(false);
            }
          }}
        >
          Save issue collections
        </Button>
      </fieldset>
      <Notice>{message || collections.error}</Notice>
    </details>
  );
}
