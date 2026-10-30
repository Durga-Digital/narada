import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { ListToolbar } from "../../components/resource-list.js";
import { ApiPanel } from "../api-reference/api-reference.js";
import { useState } from "react";
import { Radio, Plus, Copy, ArrowUpRight } from "lucide-react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Notice, PageHeading } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent } from "../../components/ui/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { BroadcastEditor } from "./editor.js";
import {
  blankDraft,
  type BroadcastRow,
  type AudienceRow,
  type Broadcast,
} from "./types.js";
export function Broadcasts() {
  const resource = useResource<BroadcastRow[]>("broadcasts", 5000),
    audiences = useResource<AudienceRow[]>("audiences");
  const [selected, setSelected] = useState<string>(),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [audience, setAudience] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const r = await api<Broadcast>(
        "broadcasts",
        blankDraft,
        "POST",
        "Broadcast draft created",
      );
      setSelected(r.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (selected)
    return (
      <BroadcastEditor
        key={selected}
        id={selected}
        back={() => {
          setSelected(undefined);
          void resource.refresh();
        }}
      />
    );
  const rows = resource.data
    ?.filter(
      (b) =>
        !b.publicationId &&
        (!status || b.status === status) &&
        (!audience || b.audienceId === audience) &&
        `${b.name} ${b.subject} ${b.id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      <PageHeading
        title="One message. Many connections."
        description="Newsletters and announcements, delivered from your own infrastructure."
        action={
          <div className="flex gap-2">
            <ApiPanel resource="Broadcasts" />
            <Button onClick={create} disabled={busy}>
              <Plus />
              Create broadcast
            </Button>
          </div>
        }
      />
      <Notice>{error || resource.error || audiences.error}</Notice>
      <ListToolbar
        searchLabel="Search broadcasts"
        placeholder="Search broadcasts…"
        query={query}
        onQueryChange={setQuery}
      >
        <NativeSelect
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {["draft", "scheduled", "sending", "completed", "cancelled"].map(
            (s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ),
          )}
        </NativeSelect>
        <NativeSelect
          aria-label="Filter by audience"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        >
          <option value="">All audiences</option>
          {audiences.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </ListToolbar>
      <Card className="shadow-none overflow-hidden">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="pl-6 py-5">
                    <button
                      className="flex items-center gap-3 text-left"
                      onClick={() => setSelected(b.id)}
                    >
                      <span className="rounded-lg bg-accent p-2 text-primary">
                        <Radio size={18} />
                      </span>
                      <span className="font-medium">
                        {b.name}
                        <span className="block text-xs font-normal text-muted-foreground mt-1">
                          {b.subject || "No subject yet"}
                        </span>
                      </span>
                    </button>
                    <ResourceIdentifier label="Broadcast ID" value={b.id} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        b.status === "completed" ? "secondary" : "outline"
                      }
                      className="capitalize"
                    >
                      {b.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {audiences.data?.find((a) => a.id === b.audienceId)?.name ??
                      "Not selected"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(b.updatedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Duplicate ${b.name}`}
                        onClick={async () => {
                          try {
                            const r = await api<Broadcast>(
                              `broadcasts/${b.id}/duplicate`,
                              {},
                              "POST",
                              "Broadcast draft created",
                            );
                            setSelected(r.id);
                          } catch (e) {
                            setError(String(e));
                          }
                        }}
                      >
                        <Copy />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Open ${b.name}`}
                        onClick={() => setSelected(b.id)}
                      >
                        <ArrowUpRight />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows?.length === 0 && (
            <div className="text-center py-16 px-6">
              <Radio size={32} className="mx-auto text-primary/50 mb-4" />
              <h2 className="serif text-2xl">Something worth sharing?</h2>
              <p className="text-sm text-muted-foreground mt-2 mb-5">
                {resource.data?.length
                  ? "No broadcasts match these filters."
                  : "Create a draft, choose your audience, and make it yours."}
              </p>
              {!resource.data?.length && (
                <Button variant="outline" onClick={create} disabled={busy}>
                  Create your first broadcast
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground mt-4">
        {rows?.length ?? 0} broadcasts · showing the latest 100
      </p>
    </>
  );
}
