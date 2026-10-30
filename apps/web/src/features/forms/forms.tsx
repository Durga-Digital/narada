import { useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Notice, PageHeading } from "../../components/shared.js";
import { formStarters, type FormContent } from "@narada/contracts/form-content";
import type { FormRecord } from "@narada/core/form-model";
import { FormEditor } from "./form-editor.js";
import { BroadcastEditor } from "../broadcasts/editor.js";
export type FormPage<T> = { data: T[]; nextCursor: string | null };
export function Forms() {
  const [selected, setSelected] = useState<string>(),
    [broadcast, setBroadcast] = useState<string>(),
    [generation, setGeneration] = useState(0);
  const back = () => {
    setSelected(undefined);
    setBroadcast(undefined);
    setGeneration((g) => g + 1);
  };
  if (broadcast)
    return <BroadcastEditor id={broadcast} back={back} backLabel="All forms" />;
  if (selected)
    return <FormEditor id={selected} back={back} useBroadcast={setBroadcast} />;
  return <Library key={generation} select={setSelected} />;
}
function Library({ select }: { select: (id: string) => void }) {
  const resource = useResource<FormPage<FormRecord>>("forms?limit=20");
  const [query, setQuery] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [extra, setExtra] = useState<FormRecord[]>([]),
    [cursor, setCursor] = useState<string | null>();
  const next = cursor === undefined ? resource.data?.nextCursor : cursor;
  const rows = [...(resource.data?.data ?? []), ...extra].filter(
    (f) =>
      !f.publicationId &&
      f.draft.name.toLowerCase().includes(query.toLowerCase()),
  );
  async function create(kind: FormContent["kind"]) {
    setPending(true);
    setError("");
    try {
      select((await api<FormRecord>("forms", formStarters[kind])).id);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Good conversations start here."
        description="Ask, listen, and turn responses into stronger relationships."
      />
      <div className="grid md:grid-cols-3 gap-4 mb-9">
        {(
          [
            [
              "intake",
              "Client intake",
              "Get to know a client and their next project.",
            ],
            [
              "feedback",
              "Feedback",
              "Learn what worked and what could be better.",
            ],
            [
              "signup",
              "Signup",
              "Welcome subscribers with a confirmed opt-in.",
            ],
          ] as const
        ).map(([kind, title, description]) => (
          <button
            disabled={pending}
            key={kind}
            onClick={() => void create(kind)}
            className="text-left p-6 rounded-xl border bg-[#f3f5ef] hover:border-primary focus-visible:outline-primary disabled:opacity-50"
          >
            <div className="flex justify-between mb-5">
              <ClipboardList className="text-primary" size={22} />
              <Plus size={18} />
            </div>
            <h2 className="serif text-2xl">{title}</h2>
            <p className="text-sm text-muted-foreground mt-2">{description}</p>
            <span className="block mt-5 text-sm font-medium">
              Create {title.toLowerCase()} form →
            </span>
          </button>
        ))}
      </div>
      <Notice>{error || resource.error}</Notice>
      {resource.error && (
        <Button variant="outline" onClick={() => void resource.refresh()}>
          Try again
        </Button>
      )}
      <div className="flex items-center justify-between gap-4 mb-5">
        <h2 className="serif text-2xl">Your forms</h2>
        <Input
          className="max-w-xs"
          aria-label="Search forms"
          placeholder="Search loaded forms…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="space-y-3">
        {rows.map((f) => (
          <button
            key={f.id}
            className="w-full text-left rounded-xl border bg-white p-5 flex flex-wrap justify-between gap-4 hover:border-primary"
            onClick={() => select(f.id)}
          >
            <span>
              <span className="block font-medium">
                {f.draft.name || "Untitled form"}
              </span>
              <span className="text-xs text-muted-foreground">
                {f.draft.questions.length} questions · {f.draft.kind}
              </span>
            </span>
            <span className="text-xs rounded-full bg-muted px-3 py-1 h-fit">
              {f.accepting
                ? `Published · v${f.version}`
                : f.version
                  ? "Closed"
                  : "Draft"}
            </span>
          </button>
        ))}
      </div>
      {!rows.length && (
        <Notice>
          {resource.data
            ? "No forms here yet. Choose a starting point above."
            : "Loading forms…"}
        </Notice>
      )}
      {next && (
        <Button
          className="mt-5"
          variant="outline"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              const p = await api<FormPage<FormRecord>>(
                `forms?limit=20&cursor=${encodeURIComponent(next)}`,
              );
              setExtra((r) => [...r, ...p.data]);
              setCursor(p.nextCursor);
            } catch (e) {
              setError(String(e));
            } finally {
              setPending(false);
            }
          }}
        >
          Load more forms
        </Button>
      )}
    </>
  );
}
