import { ConfirmRemovalDialog } from "../../components/confirm-removal-dialog.js";
import { useState } from "react";
import { KeyRound, Plus, RefreshCw } from "lucide-react";
import { api, type Key } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Notice, PageHeading } from "../../components/shared.js";
import {
  ListToolbar,
  ListPagination,
  ListEmptyState,
  ListNoResults,
} from "../../components/resource-list.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "../../components/ui/table.js";
import { CreateKeyDialog } from "./create-key-dialog.js";
import { RevokeKeyDialog } from "./revoke-key-dialog.js";
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
function lastUsed(key: Key) {
  if (!key.lastUsedAt)
    return key.usageTrackingSince ? "No activity yet" : "Not recorded";
  const seconds = Math.max(0, (Date.now() - Date.parse(key.lastUsedAt)) / 1000);
  if (seconds < 60) return "Just now";
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (seconds < 3600)
    return formatter.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400)
    return formatter.format(-Math.floor(seconds / 3600), "hour");
  return formatter.format(-Math.floor(seconds / 86400), "day");
}
export function Keys() {
  const resource = useResource<Key[]>("keys");
  const [deleting, setDeleting] = useState<Key>();
  const [editing, setEditing] = useState<Key>();
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const [create, setCreate] = useState(false),
    [revoking, setRevoking] = useState<Key>();
  const [query, setQuery] = useState(""),
    [permission, setPermission] = useState("all"),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(0);
  const [saved, setSaved] = useState<Record<string, Key>>({}),
    [busy, setBusy] = useState(false);
  const byId = Object.fromEntries(
    (resource.data ?? []).map((key) => [key.id, key]),
  );
  for (const key of Object.values(saved)) {
    const fetched = byId[key.id];
    byId[key.id] = {
      ...(fetched && (fetched.revision ?? 0) > (key.revision ?? 0)
        ? fetched
        : key),
      lastUsedAt: fetched?.lastUsedAt ?? key.lastUsedAt,
      revoked: key.revoked || fetched?.revoked || false,
    };
  }
  const rows = Object.values(byId)
    .filter((key) => !deleted.has(key.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const filtered = rows.filter(
    (k) =>
      `${k.name} ${k.prefix} ${k.domain ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (permission === "all" || (k.permission ?? "sending") === permission) &&
      (status === "all" || (status === "revoked" ? k.revoked : !k.revoked)),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 20) - 1),
  );
  function update(key: Key) {
    setSaved((rows) => ({ ...rows, [key.id]: key }));
  }
  function clearFilters() {
    setQuery("");
    setPermission("all");
    setStatus("all");
    setPage(0);
  }
  return (
    <>
      <PageHeading
        title="API keys."
        description="Connect your applications with scoped, server-side credentials."
        action={
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            Create API key
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground mb-4">
        API keys send automatically within their permissions. Keep application
        keys on your server. MCP connections require owner approval for sends
        and issue publication.
      </p>
      <Notice>{resource.error}</Notice>
      <ListToolbar
        searchLabel="Search API keys"
        placeholder="Search by name, token prefix, or domain…"
        query={query}
        onQueryChange={(query) => {
          setQuery(query);
          setPage(0);
        }}
      >
        <NativeSelect
          aria-label="Filter key permission"
          value={permission}
          onChange={(e) => {
            setPermission(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All permissions</option>
          <option value="sending">Sending access</option>
          <option value="scoped">Scoped access</option>
          <option value="full">Full access</option>
          <option value="operations">Operation access</option>
        </NativeSelect>
        <NativeSelect
          aria-label="Filter key status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="revoked">Revoked</option>
        </NativeSelect>
      </ListToolbar>
      {!resource.data && !resource.error ? (
        <p
          role="status"
          className="py-12 text-center text-sm text-muted-foreground"
        >
          Loading API keys…
        </p>
      ) : resource.error && !resource.data ? (
        <Button variant="outline" onClick={() => void resource.refresh()}>
          Try again
        </Button>
      ) : !rows.length ? (
        <ListEmptyState
          icon={<KeyRound size={30} />}
          title="Connect your first application"
          description="Create a separate key for each application so you can manage its access independently."
          action={
            <Button variant="outline" onClick={() => setCreate(true)}>
              Create your first key
            </Button>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="rounded-l-lg pl-4">Name</TableHead>
                <TableHead className="hidden md:table-cell">Token</TableHead>
                <TableHead className="hidden sm:table-cell">
                  Permission
                </TableHead>
                <TableHead
                  className="hidden xl:table-cell"
                  title="Most recent authenticated request; recorded at most once per minute"
                >
                  Last used
                </TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="rounded-r-lg">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered
                .slice(currentPage * 20, currentPage * 20 + 20)
                .map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="pl-4 py-4 whitespace-normal">
                      <div className="flex items-start gap-3">
                        <span
                          className={`rounded-lg border p-2 hidden sm:block ${key.revoked ? "bg-muted text-muted-foreground" : "bg-primary/5 text-primary"}`}
                        >
                          <KeyRound size={18} />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium break-words [overflow-wrap:anywhere]">
                            {key.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 break-all">
                            {key.permission === "operations"
                              ? [
                                  key.operationAccess?.resources.senderDomains?.join(
                                    ", ",
                                  ),
                                  key.operationAccess?.resources.formIds &&
                                    `${key.operationAccess.resources.formIds.length} selected forms`,
                                  key.operationAccess?.resources
                                    .publicationIds &&
                                    `${key.operationAccess.resources.publicationIds.length} selected publications`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "All resources"
                              : (key.domain ?? "All domains")}
                          </p>
                          <div className="flex flex-wrap gap-2 items-center mt-2">
                            <Badge
                              variant="outline"
                              className={
                                key.revoked
                                  ? "text-muted-foreground"
                                  : "text-primary border-primary/20"
                              }
                            >
                              {key.revoked ? "Revoked" : "Active"}
                            </Badge>
                            <span className="text-xs text-muted-foreground sm:hidden">
                              {key.permission === "operations"
                                ? `Operation access: ${key.operationAccess?.scopes.join(", ")}`
                                : key.permission === "full"
                                  ? "Full access"
                                  : key.permission === "scoped"
                                    ? `Scoped: ${key.scopes?.join(", ")}`
                                    : "Sending access"}
                            </span>
                          </div>
                          <code className="block md:hidden text-xs text-muted-foreground mt-2">
                            {key.prefix}…
                          </code>
                          <p className="xl:hidden text-xs text-muted-foreground mt-2">
                            Last used: {lastUsed(key)}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <code className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                        {key.prefix}…
                      </code>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-normal max-w-xs break-words">
                      {key.permission === "operations"
                        ? `Operation access: ${key.operationAccess?.scopes.join(", ")}`
                        : key.permission === "full"
                          ? "Full access"
                          : key.permission === "scoped"
                            ? `Scoped: ${key.scopes?.join(", ")}`
                            : "Sending access"}
                    </TableCell>
                    <TableCell
                      className="hidden xl:table-cell text-muted-foreground"
                      title={
                        key.lastUsedAt
                          ? new Date(key.lastUsedAt).toLocaleString()
                          : key.usageTrackingSince
                            ? "No authenticated requests recorded for this key"
                            : "Usage history was not recorded for this older key"
                      }
                    >
                      {lastUsed(key)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-muted-foreground">
                      {date(key.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!key.revoked && key.permission !== "operations" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Edit ${key.name}`}
                          onClick={() => setEditing(key)}
                        >
                          Edit
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`${key.revoked ? "Delete" : "Revoke"} ${key.name}`}
                        onClick={() =>
                          key.revoked ? setDeleting(key) : setRevoking(key)
                        }
                      >
                        {key.revoked ? "Delete" : "Revoke"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          {!filtered.length && (
            <ListNoResults noun="API keys" onClear={clearFilters} />
          )}
          <ListPagination
            noun="keys"
            total={filtered.length}
            page={currentPage}
            onPageChange={setPage}
          />
        </>
      )}
      <div className="flex flex-wrap justify-between gap-4 items-center mt-6">
        <p className="text-xs text-muted-foreground max-w-lg">
          Full tokens are shown only when created. Last used records
          authenticated API requests, at most once per minute; older usage
          history is unavailable.
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await resource.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          Refresh keys
        </Button>
      </div>
      {create && (
        <CreateKeyDialog
          close={() => setCreate(false)}
          created={(key) => {
            update(key);
            clearFilters();
          }}
        />
      )}
      {editing && (
        <CreateKeyDialog
          apiKey={editing}
          close={() => setEditing(undefined)}
          created={(key) => {
            update(key);
            clearFilters();
          }}
        />
      )}
      {deleting && (
        <ConfirmRemovalDialog
          title="Delete API key?"
          name={deleting.name}
          action="Delete key"
          successMessage="API key deleted"
          close={() => setDeleting(undefined)}
          description="Permanently remove this revoked key and its usage metadata from the list. Email history is retained. This cannot be undone."
          perform={(confirmation) =>
            api(`keys/${deleting.id}`, { confirmation }, "DELETE")
          }
          completed={() => {
            setDeleted((ids) => new Set([...ids, deleting.id]));
            setDeleting(undefined);
            void resource.refresh();
          }}
        />
      )}
      {revoking && (
        <RevokeKeyDialog
          apiKey={revoking}
          close={() => setRevoking(undefined)}
          revoked={update}
        />
      )}
    </>
  );
}
