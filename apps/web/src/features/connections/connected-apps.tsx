import { useEffect, useState } from "react";
import { Plug, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import { Input } from "../../components/ui/input.js";
import { Notice } from "../../components/shared.js";
import { SettingsSection } from "../settings/settings-section.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import {
  connectionApi,
  permissionLabels,
  type Connection,
  type ConnectionPage,
} from "./api.js";
import { ConnectionAccess } from "./connection-access.js";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Could not load connected apps.";
export function ConnectedApps() {
  const [request, setRequest] = useState({ cursor: "", version: 0 });
  const [previous, setPrevious] = useState<string[]>([]);
  const [page, setPage] = useState<ConnectionPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string>();
  const [disconnecting, setDisconnecting] = useState<Connection>();
  const refresh = () => setRequest((r) => ({ ...r, version: r.version + 1 }));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    connectionApi<ConnectionPage>(
      `connections${request.cursor ? `?cursor=${encodeURIComponent(request.cursor)}` : ""}`,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setPage(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request]);
  return (
    <SettingsSection
      title="Connected apps"
      description="Review what your agents can access, reduce permissions, or disconnect them."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw aria-hidden="true" /> Refresh apps
        </Button>
      }
    >
      <Notice>{error || notice}</Notice>
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <label className="text-sm font-medium block" htmlFor="mcp-endpoint">
          Connect an agent with this MCP address
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            id="mcp-endpoint"
            readOnly
            value={page?.resource ?? `${location.origin}/api/mcp`}
          />
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  page?.resource ?? `${location.origin}/api/mcp`,
                );
                setNotice("MCP address copied.");
              } catch {
                setNotice("Select and copy the MCP address above.");
              }
            }}
          >
            Copy address
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Connect from Claude, Codex, or another MCP client, then choose
          permissions in Narada. Sends and publication still need your separate
          approval.
        </p>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading connected apps…
        </p>
      ) : null}
      {!loading && !error && page?.data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center space-y-2">
          <Plug className="mx-auto text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">No connected apps on this page</p>
          <p className="text-sm text-muted-foreground">
            Use the MCP address above to connect your first agent.
          </p>
        </div>
      ) : null}
      {!loading && !error
        ? page?.data.map((app) => (
            <article
              key={app.reference}
              className="rounded-lg border p-4 space-y-3"
              aria-label={app.name}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium break-words min-w-0">{app.name}</h3>
                <Badge variant={app.active ? "secondary" : "outline"}>
                  {app.active ? "Active" : "Disconnected"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground break-all">
                Client ID: {app.clientId}
              </p>
              <details className="text-sm">
                <summary className="cursor-pointer">
                  {app.scopes.length} permissions
                </summary>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {app.scopes.map((scope) => (
                    <li key={scope}>{permissionLabels.get(scope) ?? scope}</li>
                  ))}
                </ul>
              </details>
              <p className="text-sm text-muted-foreground">
                {app.resources.publicationIds
                  ? `${app.resources.publicationIds.length} selected publications`
                  : "All publications"}{" "}
                ·{" "}
                {app.resources.formIds
                  ? `${app.resources.formIds.length} selected forms`
                  : "All forms"}{" "}
                ·{" "}
                {app.resources.senderDomains
                  ? app.resources.senderDomains.join(", ")
                  : "All sending domains"}
              </p>
              <div className="flex flex-wrap gap-2">
                {app.active ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(app.reference)}
                    >
                      Manage access
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDisconnecting(app)}
                    >
                      Disconnect
                    </Button>
                  </>
                ) : null}
                <Button asChild variant="ghost" size="sm">
                  <a
                    href={`/?page=activity&clientId=${encodeURIComponent(app.clientId)}`}
                  >
                    View activity
                  </a>
                </Button>
              </div>
            </article>
          ))
        : null}
      {previous.length || page?.nextCursor ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            disabled={loading || !previous.length}
            onClick={() => {
              const cursor = previous.at(-1)!;
              setPrevious((p) => p.slice(0, -1));
              setRequest((r) => ({ ...r, cursor }));
            }}
          >
            Previous apps
          </Button>
          <Button
            variant="outline"
            disabled={loading || !!error || !page?.nextCursor}
            onClick={() => {
              setPrevious((p) => [...p, request.cursor]);
              setRequest((r) => ({ ...r, cursor: page!.nextCursor! }));
            }}
          >
            Next apps
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        App names are supplied by the client. Signing out keeps connections
        active; password reset revokes them. Disconnecting stops new calls and
        pending approvals, but does not undo accepted work.
      </p>
      {editing ? (
        <ConnectionAccess
          reference={editing}
          close={() => setEditing(undefined)}
          saved={() => {
            setEditing(undefined);
            setNotice("Connected app access updated.");
            refresh();
          }}
        />
      ) : null}
      {disconnecting ? (
        <Disconnect
          app={disconnecting}
          close={() => setDisconnecting(undefined)}
          completed={() => {
            setDisconnecting(undefined);
            setNotice("App disconnected.");
            refresh();
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
function Disconnect({
  app,
  close,
  completed,
}: {
  app: Connection;
  close: () => void;
  completed: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Disconnect {app.name}?</DialogTitle>
          <DialogDescription>
            New calls and pending approvals will be blocked. Accepted work is
            not undone. The app must reconnect for access again.
          </DialogDescription>
        </DialogHeader>
        <Notice>{error}</Notice>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                await connectionApi(
                  `connections/${encodeURIComponent(app.reference)}/revoke`,
                  {},
                );
                completed();
              } catch (e) {
                setError(message(e));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Disconnecting…" : "Disconnect app"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
