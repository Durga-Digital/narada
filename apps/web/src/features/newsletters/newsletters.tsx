import {
  PublicationWebsite,
  PublicationCollections,
  useEditorialCollections,
} from "./publication-website.js";
import { DeleteIssueDialog } from "./delete-issue-dialog.js";
import { issueStatusLabels } from "@narada/contracts/issue-state";
import type { IssueStatus } from "@narada/contracts/types";
import { PublicationDomainEditor } from "./domain.js";
import type { PublicationDomainResult } from "@narada/contracts/types";
import { PublicationBrandingEditor } from "./branding.js";
import type { IssueListItem as IssueRow } from "@narada/contracts/dashboard";
type IssuePage = { data: IssueRow[]; nextCursor: string | null };
import { ContactEditor } from "../broadcasts/contact-editor.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import { EmailPreview } from "../email-editor/email-preview.js";
import { useState } from "react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Button } from "../../components/ui/button.js";
import {
  Plus,
  ArrowUpRight,
  ChevronRight,
  BookOpen,
  Users,
} from "lucide-react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui/tabs.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Input } from "../../components/ui/input.js";
import { Field, Notice, PageHeading } from "../../components/shared.js";
import type {
  Publication,
  PublicationSettings,
  Issue,
} from "@narada/core/newsletter-model";
import { IssueEditor } from "./issue-editor.js";
export function Newsletters() {
  const [selected, setSelected] = useState<string>();
  return selected ? (
    <PublicationDetail
      key={selected}
      id={selected}
      back={() => setSelected(undefined)}
    />
  ) : (
    <PublicationLibrary select={setSelected} />
  );
}
function PublicationLibrary({ select }: { select: (id: string) => void }) {
  const resource =
    useResource<(Publication & { subscriberCount: number })[]>("publications");
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [filter, setFilter] = useState("current");
  const publications = resource.data?.filter((pub) =>
    filter === "current"
      ? pub.status !== "archived"
      : pub.status === "archived",
  );
  return (
    <>
      <PageHeading
        title="Publications"
        description="A place for your readers, on the web and in the inbox."
        action={
          <Dialog
            open={open}
            onOpenChange={(next) => {
              if (!pending) {
                setOpen(next);
                setError("");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus /> Create publication
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create a publication</DialogTitle>
                <DialogDescription>
                  Give your newsletter a name and a home. You can finish setting
                  it up before it goes live.
                </DialogDescription>
              </DialogHeader>
              <form
                className="grid gap-5"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  setPending(true);
                  setError("");
                  try {
                    const pub = await api<Publication>("publications", {
                      name: data.get("name"),
                      slug: data.get("slug"),
                    });
                    select(pub.id);
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <fieldset disabled={pending} className="grid gap-4">
                  <Field label="Publication name">
                    <Input
                      name="name"
                      required
                      maxLength={100}
                      placeholder="Studio Notes"
                    />
                  </Field>
                  <Field label="Publication URL slug">
                    <Input
                      name="slug"
                      required
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      maxLength={80}
                      placeholder="studio-notes"
                      aria-describedby="publication-slug-hint"
                    />
                  </Field>
                  <p
                    id="publication-slug-hint"
                    className="text-xs text-muted-foreground"
                  >
                    Your publication will live at /n/your-slug. Use lowercase
                    letters, numbers and hyphens.
                  </p>
                </fieldset>
                <Notice>{error}</Notice>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button disabled={pending} type="submit">
                    {pending ? "Creating…" : "Create publication"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Notice>{resource.error}</Notice>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 mb-5">
        <h2 className="font-medium">Your publications</h2>
        <NativeSelect
          className="w-auto"
          aria-label="Show publications"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="current">Active & draft</option>
          <option value="archived">Archived</option>
        </NativeSelect>
      </div>
      {!resource.data && !resource.error && (
        <Notice>Loading publications…</Notice>
      )}
      {publications?.length === 0 && (
        <div className="rounded-xl border border-dashed py-14 px-6 text-center">
          <BookOpen
            className="mx-auto mb-4 size-7 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="serif text-2xl">
            {filter === "archived"
              ? "No archived publications"
              : "Your next chapter starts here"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {filter === "archived"
              ? "Publications you archive will appear here."
              : "Create a publication to start writing and welcome your first readers."}
          </p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {publications?.map((pub) => (
          <button
            key={pub.id}
            className="group min-w-0 rounded-xl border bg-card p-6 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => select(pub.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-xl font-medium break-words min-w-0">
                {pub.settings.name}
              </span>
              <ChevronRight
                className="size-5 shrink-0 text-muted-foreground group-hover:text-primary"
                aria-hidden="true"
              />
            </div>
            <span className="mt-3 inline-flex rounded-full bg-muted px-2.5 py-1 text-xs capitalize">
              {pub.status}
            </span>
            <span className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Users className="size-4" aria-hidden="true" />
                {pub.subscriberCount}{" "}
                {pub.subscriberCount === 1 ? "subscriber" : "subscribers"}
              </span>
              <span className="break-all">/n/{pub.settings.slug}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
function PublicationDetail({ id, back }: { id: string; back: () => void }) {
  const resource = useResource<Publication>(`publications/${id}`);
  const domain = useResource<PublicationDomainResult>(
    `publications/${id}/domain`,
    30_000,
  );
  const [tab, setTab] = useState<
      | "issues"
      | "subscribers"
      | "branding"
      | "collections"
      | "domain"
      | "settings"
    >("issues"),
    [issue, setIssue] = useState<string>(),
    [error, setError] = useState("");
  if (!resource.data)
    return <Notice>{resource.error || "Loading publication…"}</Notice>;
  const pub = resource.data;
  const publicUrl =
    domain.data?.preferredUrl ?? `${location.origin}/n/${pub.settings.slug}`;
  if (issue)
    return (
      <IssueEditor
        publication={pub}
        publicUrl={publicUrl}
        id={issue}
        back={() => setIssue(undefined)}
      />
    );
  return (
    <>
      <Button variant="ghost" onClick={back}>
        ← All publications
      </Button>
      <PageHeading
        title={pub.settings.name}
        description={`${pub.status} publication`}
      />
      <Notice>{error || resource.error}</Notice>
      {pub.status !== "draft" && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-8 text-sm">
          <a
            className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
          >
            View publication{" "}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
          {pub.status === "active" && (
            <>
              <a
                className="underline"
                href={`${publicUrl}/subscribe`}
                target="_blank"
                rel="noreferrer"
              >
                Subscribe page
              </a>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${publicUrl}/subscribe`,
                    );
                    setError("Subscribe link copied.");
                  } catch {
                    setError(
                      "Could not copy the link. Open the subscribe page to copy its address.",
                    );
                  }
                }}
              >
                Copy subscribe link
              </Button>
            </>
          )}
        </div>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className="gap-6"
      >
        <div className="border-b pb-1">
          <TabsList
            variant="line"
            aria-label="Publication views"
            className="flex h-auto w-full flex-wrap justify-start"
          >
            <TabsTrigger
              value="issues"
              className="rounded-none border-0 px-3 after:bg-primary data-[state=active]:text-primary"
            >
              Issues
            </TabsTrigger>
            <TabsTrigger
              value="subscribers"
              className="rounded-none border-0 px-3 after:bg-primary data-[state=active]:text-primary"
            >
              Subscribers
            </TabsTrigger>
            <TabsTrigger
              value="branding"
              className="rounded-none border-0 px-3 after:bg-primary data-[state=active]:text-primary"
            >
              Website
            </TabsTrigger>
            <TabsTrigger
              value="collections"
              className="rounded-none border-0 px-3 after:bg-primary data-[state=active]:text-primary"
            >
              Collections
            </TabsTrigger>
            <TabsTrigger
              value="domain"
              className="rounded-none border-0 px-3 after:bg-primary data-[state=active]:text-primary"
            >
              Domain
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="rounded-none border-0 px-3 after:bg-primary data-[state=active]:text-primary"
            >
              Settings
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="issues">
          <IssueLibrary
            pub={pub}
            select={setIssue}
            setup={() => setTab("settings")}
          />
        </TabsContent>
        <TabsContent value="subscribers">
          <Subscribers id={id} />
        </TabsContent>
        <TabsContent value="branding" forceMount hidden={tab !== "branding"}>
          <PublicationWebsite
            active={tab === "branding"}
            pub={pub}
            refresh={resource.refresh}
            settings={() => setTab("settings")}
          />
        </TabsContent>
        <TabsContent value="collections">
          <PublicationCollections id={id} selectIssue={setIssue} />
        </TabsContent>
        <TabsContent value="domain">
          <Notice>{domain.error}</Notice>
          <PublicationDomainEditor
            id={id}
            value={domain.data}
            refresh={domain.refresh}
          />
        </TabsContent>
        <TabsContent value="settings">
          <Settings key={pub.revision} pub={pub} refresh={resource.refresh} />
        </TabsContent>
      </Tabs>
    </>
  );
}
function Settings({
  pub,
  refresh,
}: {
  pub: Publication;
  refresh: () => Promise<void>;
}) {
  const [branding, setBranding] = useState<string>();
  const [settings, setSettings] = useState(pub.settings),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const fields: {
    key: keyof PublicationSettings;
    label: string;
    type?: string;
  }[] = [
    { key: "name", label: "Publication name" },
    { key: "slug", label: "Publication URL slug" },
    { key: "description", label: "Description" },
    { key: "author", label: "Author display name" },
    { key: "color", label: "Accent color", type: "color" },
    { key: "from", label: "Sender email" },
    { key: "replyTo", label: "Reply-to email", type: "email" },
    { key: "organization", label: "Organization" },
    { key: "postalAddress", label: "Postal address" },
    { key: "privacyUrl", label: "Privacy policy URL", type: "url" },
  ];
  async function save(activate = false) {
    setPending(true);
    setError("");
    try {
      const saved = await api<Publication>(
        `publications/${pub.id}`,
        { settings, revision: pub.revision },
        "PUT",
      );
      if (activate)
        await api(`publications/${pub.id}/activate`, {
          revision: saved.revision,
        });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-5">
      <h2 className="serif text-2xl">Publication settings</h2>
      <p className="text-sm text-muted-foreground">
        A verified sender, organization and postal address are required before
        activation. Existing contacts are never automatically subscribed.
      </p>
      <Notice>{error}</Notice>
      <fieldset
        disabled={pending || pub.status === "archived"}
        className="grid md:grid-cols-2 gap-4"
      >
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input
              type={f.type ?? "text"}
              value={settings[f.key]}
              disabled={f.key === "slug" && pub.status !== "draft"}
              onChange={(event) =>
                setSettings((s) => ({ ...s, [f.key]: event.target.value }))
              }
            />
          </Field>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={pending || pub.status === "archived"}
          onClick={() => void save()}
        >
          Save settings
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={async () => {
            try {
              setBranding(
                (await api<{ html: string }>(`publications/${pub.id}/preview`))
                  .html,
              );
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Preview saved branding
        </Button>
        {pub.status === "draft" && (
          <Button disabled={pending} onClick={() => void save(true)}>
            Save and activate
          </Button>
        )}
        {pub.status === "active" && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={async () => {
              if (
                !window.confirm(
                  "Archive this publication? Signups and future deliveries will stop. Existing public articles stay available.",
                )
              )
                return;
              setPending(true);
              try {
                await api(`publications/${pub.id}/archive`, {
                  revision: pub.revision,
                });
                await refresh();
              } catch (e) {
                setError(String(e));
              } finally {
                setPending(false);
              }
            }}
          >
            Archive publication
          </Button>
        )}
      </div>
      {branding && (
        <EmailPreview html={branding} title="Publication branding preview" />
      )}
    </div>
  );
}
function IssueLibrary(props: {
  pub: Publication;
  select: (id: string) => void;
  setup: () => void;
}) {
  const [filter, setFilter] = useState<IssueStatus | "all">("all");
  const [collectionId, setCollectionId] = useState("");
  const collections = useEditorialCollections(props.pub.id);
  return (
    <>
      <Field label="Filter by collection">
        <NativeSelect
          value={collectionId}
          onChange={(e) => setCollectionId(e.target.value)}
        >
          <option value="">All collections</option>
          {collections.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.status === "archived" ? " (archived)" : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Notice>{collections.error}</Notice>
      <IssueList
        key={`${filter}:${collectionId}`}
        {...props}
        collectionId={collectionId}
        filter={filter}
        setFilter={setFilter}
      />
    </>
  );
}
function IssueList({
  pub,
  select,
  setup,
  filter,
  setFilter,
  collectionId,
}: {
  pub: Publication;
  select: (id: string) => void;
  setup: () => void;
  filter: IssueStatus | "all";
  collectionId: string;
  setFilter: (value: IssueStatus | "all") => void;
}) {
  const query = `?${new URLSearchParams({ ...(filter === "all" ? {} : { status: filter }), ...(collectionId ? { collectionId } : {}) })}`;
  const resource = useResource<IssuePage>(
    `publications/${pub.id}/issues${query}`,
  );
  const [removed, setRemoved] = useState<string[]>([]);
  const [extra, setExtra] = useState<IssueRow[]>([]),
    [cursor, setCursor] = useState<string | null>();
  const nextCursor = cursor === undefined ? resource.data?.nextCursor : cursor;
  const rows = [...(resource.data?.data ?? []), ...extra].filter(
    (row) => !removed.includes(row.id),
  );
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  if (pub.status === "draft")
    return (
      <div className="space-y-4">
        <p>
          Finish your publication settings and activate it to welcome readers
          and write your first issue.
        </p>
        <Button onClick={setup}>Set up publication</Button>
      </div>
    );
  return (
    <div className="space-y-5">
      <Notice>{error || resource.error}</Notice>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="serif text-2xl">Issues</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Write, publish and revisit your letters.
          </p>
        </div>
        <Button
          disabled={pending || pub.status !== "active"}
          onClick={async () => {
            setPending(true);
            try {
              const issue = await api<Issue>(`publications/${pub.id}/issues`, {
                title: "Untitled issue",
                slug: `issue-${crypto.randomUUID().slice(0, 8)}`,
                document: { type: "doc", content: [{ type: "paragraph" }] },
              });
              select(issue.id);
            } catch (e) {
              setError(String(e));
            } finally {
              setPending(false);
            }
          }}
        >
          <Plus /> New issue
        </Button>
      </div>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Filter issues"
      >
        {(
          [
            "all",
            "draft",
            "scheduled",
            "published",
            "sent",
            "withdrawn",
          ] as const
        ).map((status) => (
          <Button
            key={status}
            variant={filter === status ? "default" : "outline"}
            aria-pressed={filter === status}
            onClick={() => setFilter(status)}
          >
            {status === "all"
              ? "All issues"
              : status === "draft"
                ? "Drafts"
                : status === "published"
                  ? "Published"
                  : status === "sent"
                    ? "Sent"
                    : status === "withdrawn"
                      ? "Withdrawn"
                      : "Scheduled"}
          </Button>
        ))}
      </div>
      {!resource.data && !resource.error && <Notice>Loading issues…</Notice>}
      {resource.data && rows.length === 0 && (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <BookOpen
            className="mx-auto mb-4 size-7 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="serif text-2xl">
            {filter === "all"
              ? "No issues yet"
              : "No matching issues on this page"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {nextCursor
              ? "Load more to check the rest of your issues."
              : "Start a new issue or choose another filter."}
          </p>
        </div>
      )}
      {rows.map((i) => (
        <div
          key={i.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-5"
        >
          <button
            className="group flex min-w-0 flex-1 items-center justify-between gap-4 text-left focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => select(i.id)}
          >
            <span className="min-w-0">
              <span className="block text-lg font-medium break-words">
                {i.draft.title}
              </span>
              <span
                className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${i.status === "draft" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}
              >
                {issueStatusLabels[i.status]}
              </span>
              {i.emailReleased && i.status !== "sent" && (
                <span className="ml-2 text-xs text-muted-foreground">
                  Email released
                </span>
              )}
              <span className="mt-2 block text-xs text-muted-foreground">
                {i.scheduledAt
                  ? `Scheduled ${new Date(i.scheduledAt).toLocaleString()}`
                  : `Edited ${new Date(i.updatedAt).toLocaleDateString()}`}
              </span>
            </span>
            <ChevronRight
              className="size-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
          {i.canDelete && (
            <DeleteIssueDialog
              publicationId={pub.id}
              issueId={i.id}
              revision={i.revision}
              title={i.draft.title}
              disabled={pending}
              onDeleted={() => setRemoved((rows) => [...rows, i.id])}
            />
          )}
        </div>
      ))}
      {nextCursor && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              const page = await api<IssuePage>(
                `publications/${pub.id}/issues?cursor=${encodeURIComponent(nextCursor)}${filter === "all" ? "" : `&status=${filter}`}${collectionId ? `&collectionId=${encodeURIComponent(collectionId)}` : ""}`,
              );
              setExtra((rows) => [...rows, ...page.data]);
              setCursor(page.nextCursor);
            } catch (e) {
              setError(String(e));
            } finally {
              setPending(false);
            }
          }}
        >
          Load more issues
        </Button>
      )}
    </div>
  );
}
function Subscribers({ id }: { id: string }) {
  const [selected, setSelected] = useState<string>();
  const resource = useResource<{
    confirmed: number;
    eligible: number;
    subscribers: {
      email: string;
      name: string;
      subscribed: boolean;
      eligible: boolean;
      deliveryStatus: string;
    }[];
  }>(`publications/${id}/subscribers`);
  return (
    <div className="space-y-4">
      <h2 className="serif text-2xl">Subscribers</h2>
      <Notice>{resource.error}</Notice>
      <p>
        {resource.data?.confirmed ?? 0} confirmed subscriptions ·{" "}
        {resource.data?.eligible ?? 0} eligible for delivery
      </p>
      <p className="text-sm text-muted-foreground">
        Global opt-outs and delivery suppressions still apply. Manage contact
        preferences and consent-attested imports in Audience.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr>
              <th className="p-3">Email</th>
              <th>Name</th>
              <th>Subscription</th>
              <th>Delivery</th>
            </tr>
          </thead>
          <tbody>
            {resource.data?.subscribers.length === 0 && (
              <tr className="border-t">
                <td
                  colSpan={4}
                  className="p-6 text-center text-muted-foreground"
                >
                  No subscribers yet. Share your subscribe page to welcome your
                  first readers.
                </td>
              </tr>
            )}
            {resource.data?.subscribers.map((s) => (
              <tr className="border-t" key={s.email}>
                <td className="p-3">
                  <button
                    className="underline"
                    onClick={() => setSelected(s.email)}
                  >
                    {s.email}
                  </button>
                </td>
                <td>{s.name}</td>
                <td>{s.subscribed ? "Subscribed" : "Opted out"}</td>
                <td>{s.deliveryStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Contact preferences</DialogTitle>
          </DialogHeader>
          {selected && (
            <ContactEditor
              email={selected}
              memberships={[]}
              onSaved={resource.refresh}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
