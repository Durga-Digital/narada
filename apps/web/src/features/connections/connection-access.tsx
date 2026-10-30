import { useEffect, useState } from "react";
import type { ResourceRestrictions } from "@narada/contracts/delegation";
import { Button } from "../../components/ui/button.js";
import { Notice } from "../../components/shared.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { connectionApi, permissionLabels, type Connection } from "./api.js";

const dimensions = [
  { key: "publicationIds", kind: "publications", label: "publications" },
  { key: "formIds", kind: "forms", label: "forms" },
  { key: "senderDomains", kind: "domains", label: "sending domains" },
] as const;
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Could not update access.";

export function ConnectionAccess({
  reference,
  close,
  saved,
}: {
  reference: string;
  close: () => void;
  saved: () => void;
}) {
  const [connection, setConnection] = useState<Connection>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setConnection(undefined);
    setError("");
    connectionApi<Connection>(
      `connections/${encodeURIComponent(reference)}`,
      undefined,
      controller.signal,
    )
      .then((c) => {
        if (!controller.signal.aborted) {
          if (!c.active)
            setError(
              "This app is disconnected. Reconnect from your agent to grant access again.",
            );
          else setConnection(c);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [reference, version]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>
            Manage access{connection ? `: ${connection.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            Reduce this app’s permissions and resource access. To add access,
            reconnect from your agent and approve a new consent request.
          </DialogDescription>
        </DialogHeader>
        <Notice>{error}</Notice>
        {!connection && !error ? <p role="status">Loading access…</p> : null}
        {connection ? (
          <AccessForm
            key={`${reference}:${version}`}
            connection={connection}
            pending={pending}
            setPending={setPending}
            close={close}
            saved={saved}
            reload={() => setVersion((v) => v + 1)}
          />
        ) : error ? (
          <Button variant="outline" onClick={() => setVersion((v) => v + 1)}>
            Reload access
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AccessForm({
  connection,
  pending,
  setPending,
  close,
  saved,
  reload,
}: {
  connection: Connection;
  pending: boolean;
  setPending: (v: boolean) => void;
  close: () => void;
  saved: () => void;
  reload: () => void;
}) {
  const [scopes, setScopes] = useState(connection.scopes);
  const [resources, setResources] = useState<ResourceRestrictions>(
    connection.resources,
  );
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (!scopes.length) {
          setError(
            "Keep at least one permission, or disconnect the app to remove all access.",
          );
          return;
        }
        if (
          Object.values(resources).some(
            (ids) => !ids.length || ids.length > 100,
          )
        ) {
          setError(
            "Choose between 1 and 100 resources for each selected category.",
          );
          return;
        }
        setPending(true);
        try {
          await connectionApi(
            `connections/${encodeURIComponent(connection.reference)}`,
            { scopes, resources, revision: connection.revision },
          );
          saved();
        } catch (e) {
          setError(
            `${message(e)} Reload access to review the latest permissions before trying again.`,
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} className="space-y-2">
        <legend className="font-medium mb-2">Permissions</legend>
        {connection.scopes.map((scope) => (
          <label key={scope} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={scopes.includes(scope)}
              onChange={(e) =>
                setScopes((s) =>
                  e.target.checked
                    ? [...s, scope]
                    : s.filter((value) => value !== scope),
                )
              }
            />
            <span>{permissionLabels.get(scope) ?? scope}</span>
          </label>
        ))}
      </fieldset>
      {dimensions.map((d) => (
        <ResourcePicker
          key={d.key}
          kind={d.kind}
          label={d.label}
          initial={connection.resources[d.key]}
          selected={resources[d.key]}
          disabled={pending}
          change={(ids) =>
            setResources((r) => {
              const next = { ...r };
              if (ids === undefined) delete next[d.key];
              else next[d.key] = ids;
              return next;
            })
          }
        />
      ))}
      <Notice>{error}</Notice>
      <DialogFooter className="flex-wrap gap-2">
        {error ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={reload}
          >
            Reload access
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={close}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save access"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ResourcePicker({
  kind,
  label,
  initial,
  selected,
  disabled,
  change,
}: {
  kind: string;
  label: string;
  initial?: string[];
  selected?: string[];
  disabled: boolean;
  change: (ids: string[] | undefined) => void;
}) {
  const [rows, setRows] = useState<{ id: string; label: string }[]>([]);
  const [cursor, setCursor] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const choosing = selected !== undefined;
  useEffect(() => {
    if (!choosing) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    connectionApi<{
      data: { id: string; label: string }[];
      nextCursor: string | null;
    }>(
      `resources?kind=${kind}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      undefined,
      controller.signal,
    )
      .then((page) => {
        if (!controller.signal.aborted) {
          setRows((previous) => [
            ...new Map(
              [...previous, ...page.data].map((row) => [row.id, row]),
            ).values(),
          ]);
          setNextCursor(page.nextCursor);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, cursor, choosing, version]);
  const options = initial
    ? initial.map(
        (id) => rows.find((row) => row.id === id) ?? { id, label: id },
      )
    : rows;
  return (
    <fieldset disabled={disabled} className="rounded-lg border p-3 space-y-2">
      <legend className="px-1 font-medium capitalize">{label}</legend>
      <label className="flex gap-2 text-sm">
        <input
          type="radio"
          name={kind}
          checked={!choosing}
          disabled={!!initial}
          onChange={() => change(undefined)}
        />
        All {label}
      </label>
      <label className="flex gap-2 text-sm">
        <input
          type="radio"
          name={kind}
          checked={choosing}
          onChange={() => change(initial ?? [])}
        />
        Selected {label}
      </label>
      {initial ? (
        <p className="text-xs text-muted-foreground">
          This connection is already restricted. You can only keep or remove its
          existing resources.
        </p>
      ) : null}
      {choosing ? (
        <div className="space-y-2 pl-2">
          {options.map((row) => (
            <label
              key={row.id}
              className="flex items-start gap-2 text-sm break-all"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.includes(row.id)}
                disabled={!selected.includes(row.id) && selected.length >= 100}
                onChange={(e) =>
                  change(
                    e.target.checked
                      ? [...selected, row.id]
                      : selected.filter((id) => id !== row.id),
                  )
                }
              />
              <span>{row.label}</span>
            </label>
          ))}
          {loading ? (
            <p role="status" className="text-sm">
              Loading {label}…
            </p>
          ) : null}
          {!loading && !error && !options.length ? (
            <p className="text-sm text-muted-foreground">
              No {label} available.
            </p>
          ) : null}
          <Notice>{error}</Notice>
          {error ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setVersion((v) => v + 1)}
            >
              Retry loading {label}
            </Button>
          ) : nextCursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => setCursor(nextCursor)}
            >
              Load more {label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
