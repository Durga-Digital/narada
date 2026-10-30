import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { ListToolbar } from "../../components/resource-list.js";
import { useState } from "react";
import { LayoutGrid, List, Plus, FilePlus2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Badge } from "../../components/ui/badge.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog.js";
import {
  ActionForm,
  Field,
  Notice,
  PageHeading,
} from "../../components/shared.js";
import { ApiPanel } from "../api-reference/api-reference.js";
import { EmailPreview } from "../email-editor/email-preview.js";
import { TemplateEditor, type TemplateRecord } from "./template-editor.js";
import { BroadcastEditor } from "../broadcasts/editor.js";
import { starters } from "./starters.js";
type TemplatePage = { data: TemplateRecord[]; nextCursor: string | null };
export function Templates() {
  const [selected, setSelected] = useState<string>(),
    [broadcast, setBroadcast] = useState<string>(),
    [generation, setGeneration] = useState(0);
  const back = () => {
    setSelected(undefined);
    setBroadcast(undefined);
    setGeneration((g) => g + 1);
  };
  if (broadcast)
    return (
      <BroadcastEditor id={broadcast} back={back} backLabel="All templates" />
    );
  if (selected)
    return (
      <TemplateEditor
        key={selected}
        id={selected}
        back={back}
        useBroadcast={setBroadcast}
      />
    );
  return <Library key={generation} select={setSelected} />;
}
function Library({ select }: { select: (id: string) => void }) {
  const resource = useResource<TemplatePage>("templates?limit=20");
  const [extra, setExtra] = useState<TemplateRecord[]>([]),
    [cursor, setCursor] = useState<string | null | undefined>(),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [layout, setLayout] = useState("grid"),
    [create, setCreate] = useState(false),
    [starter, setStarter] = useState("blank"),
    [name, setName] = useState("Untitled template"),
    [alias, setAlias] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false);
  const next = cursor === undefined ? resource.data?.nextCursor : cursor;
  const rows = [...(resource.data?.data ?? []), ...extra].filter(
    (t) =>
      (!status || t.status === status) &&
      `${t.draft.name} ${t.alias} ${t.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        title="A place for every message."
        description="Design once, publish with confidence, and reuse across your application."
        action={
          <div className="flex gap-2">
            <ApiPanel resource="Templates" />
            <Button onClick={() => setCreate(true)}>
              <Plus />
              New template
            </Button>
          </div>
        }
      />
      <Notice>{notice || resource.error}</Notice>
      <ListToolbar
        searchLabel="Search templates"
        placeholder="Search loaded templates…"
        query={query}
        onQueryChange={setQuery}
      >
        <NativeSelect
          aria-label="Template status"
          className="w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {["draft", "published", "archived"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </NativeSelect>
        <Button
          variant={layout === "grid" ? "secondary" : "ghost"}
          size="icon"
          aria-label="Grid view"
          aria-pressed={layout === "grid"}
          onClick={() => setLayout("grid")}
        >
          <LayoutGrid />
        </Button>
        <Button
          variant={layout === "list" ? "secondary" : "ghost"}
          size="icon"
          aria-label="List view"
          aria-pressed={layout === "list"}
          onClick={() => setLayout("list")}
        >
          <List />
        </Button>
      </ListToolbar>
      <div
        className={
          layout === "grid"
            ? "grid sm:grid-cols-2 xl:grid-cols-3 gap-5"
            : "space-y-3"
        }
      >
        {rows.map((t) => (
          <article
            key={t.id}
            className="relative border rounded-xl overflow-hidden bg-white"
          >
            <button
              className="absolute inset-0 z-10 w-full rounded-xl hover:bg-muted/10 focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => select(t.id)}
              aria-label={`Open template ${t.draft.name}`}
            />
            {layout === "grid" && (
              <div
                className="h-48 bg-muted overflow-hidden p-4 pointer-events-none"
                aria-hidden="true"
              >
                <EmailPreview
                  title={`${t.draft.name} thumbnail`}
                  html={t.draft.html}
                  className="h-72"
                />
              </div>
            )}
            <div className="p-4 flex justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-medium">{t.draft.name}</h2>
                <ResourceIdentifier label="Template alias" value={t.alias} />
                <ResourceIdentifier label="Template ID" value={t.id} />
                <p className="text-xs text-muted-foreground mt-2">
                  {t.draft.kind} · {t.draft.variables.length} variables{" "}
                  {t.publishedVersion ? `· v${t.publishedVersion}` : ""}
                </p>
              </div>
              <Badge variant="outline" className="h-fit">
                {t.status}
              </Badge>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <Notice>
          {resource.data
            ? "No templates match yet. Start from a reusable design or a blank email."
            : "Loading templates…"}
        </Notice>
      )}
      {next && (
        <Button
          className="mt-5"
          variant="outline"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              const p = await api<TemplatePage>(
                `templates?limit=20&cursor=${encodeURIComponent(next)}`,
              );
              setExtra((current) => [...current, ...p.data]);
              setCursor(p.nextCursor);
            } catch (e) {
              setNotice(String(e));
            } finally {
              setLoading(false);
            }
          }}
        >
          Load more templates
        </Button>
      )}
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create template</DialogTitle>
            <DialogDescription>
              Choose a starting point. The alias is permanent and can be used in
              your API calls.
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            label="Create template"
            successMessage="Template created"
            onSubmit={async () => {
              const created = await api<TemplateRecord>("templates", {
                ...starters[starter]!,
                name,
                alias,
              });
              select(created.id);
            }}
          >
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium mb-3">
                Choose a starting point
              </legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(starters).map(([key, design]) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={`Start with ${design.name}`}
                    aria-pressed={starter === key}
                    className={`rounded-xl border text-left overflow-hidden transition-colors focus-visible:outline-2 focus-visible:outline-primary ${starter === key ? "border-primary ring-1 ring-primary bg-primary/5" : "hover:border-primary/50 bg-white"}`}
                    onClick={() => {
                      setStarter(key);
                      setName(design.name);
                    }}
                  >
                    <div
                      className="relative h-28 bg-muted/60 overflow-hidden pointer-events-none"
                      aria-hidden="true"
                    >
                      {design.html ? (
                        <div className="absolute left-1/2 top-3 w-[600px] -translate-x-1/2">
                          <EmailPreview
                            title={`${design.name} starter`}
                            html={design.html}
                            className="h-[420px] scale-[0.3] origin-top border-0"
                          />
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <FilePlus2
                            className="text-muted-foreground"
                            size={28}
                          />
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <span className="block text-sm font-medium">
                        {key === "blank"
                          ? "Blank email"
                          : key === "blank_broadcast"
                            ? "Blank broadcast"
                            : design.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {design.kind}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </fieldset>
            <Field label="Template name">
              <Input
                value={name}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Template alias">
              <Input
                value={alias}
                required
                pattern="[a-z][a-z0-9-]{0,79}"
                placeholder="welcome-email"
                onChange={(e) => setAlias(e.target.value)}
              />
            </Field>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
