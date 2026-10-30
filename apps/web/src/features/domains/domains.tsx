import {
  ListToolbar,
  ListPagination,
  ListEmptyState,
  ListNoResults,
} from "../../components/resource-list.js";
import { useState } from "react";
import { ChevronRight, Globe2, Plus } from "lucide-react";
import type { Domain } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Notice, PageHeading } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import { AddDomain, type DomainEnvironment } from "./add-domain.js";
import { DomainDetail } from "./domain-detail.js";
import { DomainStatus, domainDate } from "./domain-status.js";
export function Domains() {
  const { data, error, refresh } = useResource<Domain[]>("domains");
  const environment = useResource<DomainEnvironment>("settings");
  const [selection, setSelection] = useState<Domain | "add">();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Record<string, Domain>>({});
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(0);
  function update(domain: Domain) {
    setSaved((rows) => ({ ...rows, [domain.name]: domain }));
    setRemoved((names) => {
      const next = new Set(names);
      next.delete(domain.name);
      return next;
    });
    setSelection(domain);
    void refresh();
  }
  const rows = Object.values({
    ...Object.fromEntries((data ?? []).map((d) => [d.name, d])),
    ...saved,
  })
    .filter((d) => !removed.has(d.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const filtered = rows.filter(
    (d) =>
      d.name.includes(query.trim().toLowerCase()) &&
      (status === "all" ||
        (status === "local"
          ? d.local
          : !d.local && (status === "verified" ? d.verified : !d.verified))),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 20) - 1),
  );
  if (selection === "add")
    return (
      <AddDomain
        environment={environment.data}
        back={() => setSelection(undefined)}
        added={update}
      />
    );
  if (selection)
    return (
      <DomainDetail
        key={selection.name}
        domain={selection}
        environment={environment.data}
        back={() => setSelection(undefined)}
        updated={update}
        removed={() => {
          setRemoved((names) => new Set([...names, selection.name]));
          setSelection(undefined);
          void refresh();
        }}
      />
    );
  return (
    <>
      <PageHeading
        title="Domains."
        description="Manage the domains your emails come from."
        action={
          <Button onClick={() => setSelection("add")}>
            <Plus size={16} />
            Add domain
          </Button>
        }
      />
      <Notice>{error}</Notice>
      {error && data && (
        <Button
          variant="outline"
          className="mb-4"
          onClick={() => void refresh()}
        >
          Try again
        </Button>
      )}
      <ListToolbar
        searchLabel="Search domains"
        placeholder="Search domains…"
        query={query}
        onQueryChange={(query) => {
          setQuery(query);
          setPage(0);
        }}
      >
        <NativeSelect
          aria-label="Filter domain status"
          className="sm:w-56"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All statuses</option>
          <option value="verified">Verified</option>
          <option value="pending">Pending verification</option>
          <option value="local">Local only</option>
        </NativeSelect>
      </ListToolbar>
      {!data && !error ? (
        <p
          role="status"
          className="py-12 text-center text-sm text-muted-foreground"
        >
          Loading domains…
        </p>
      ) : error && !data ? (
        <Button variant="outline" onClick={() => void refresh()}>
          Try again
        </Button>
      ) : rows.length === 0 ? (
        <ListEmptyState
          icon={<Globe2 size={30} />}
          title="A home for your emails"
          description="Add your first sending domain to get started."
          action={
            <Button variant="outline" onClick={() => setSelection("add")}>
              Add your first domain
            </Button>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="rounded-l-lg pl-4">Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Added</TableHead>
                <TableHead className="rounded-r-lg">
                  <span className="sr-only">Open domain</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered
                .slice(currentPage * 20, currentPage * 20 + 20)
                .map((d) => (
                  <TableRow key={d.name}>
                    <TableCell className="pl-4 py-4">
                      <button
                        className="flex items-center gap-3 text-left font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-ring rounded-md"
                        onClick={() => setSelection(d)}
                      >
                        <span className="rounded-lg border bg-primary/5 p-2 text-primary hidden sm:block">
                          <Globe2 size={18} />
                        </span>
                        <span className="break-all whitespace-normal">
                          {d.name}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <DomainStatus domain={d} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {domainDate(d.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`View ${d.name}`}
                        onClick={() => setSelection(d)}
                      >
                        <ChevronRight size={16} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          {!filtered.length && (
            <ListNoResults
              noun="domains"
              onClear={() => {
                setQuery("");
                setStatus("all");
                setPage(0);
              }}
            />
          )}
          <ListPagination
            page={currentPage}
            total={filtered.length}
            noun="domains"
            onPageChange={setPage}
          />
        </>
      )}
      {environment.data?.mode === "local" && (
        <p className="mt-6 text-xs text-muted-foreground">
          Local domains work with Mailpit. They are not verified AWS identities.
        </p>
      )}
    </>
  );
}
