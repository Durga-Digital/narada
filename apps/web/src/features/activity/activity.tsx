import { useEffect, useState } from "react";
import type { OperationStatus, Page } from "@narada/contracts/types";
import { api } from "../../lib/api.js";
import { Notice, PageHeading } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";

const recovery: Record<OperationStatus["recovery"], string> = {
  retry_same_key:
    "Retry the original request with the same key and unchanged arguments.",
  replay_available:
    "The result is saved. Repeat the original request with the same key and arguments to recover it without repeating the work.",
  reconcile:
    "The outcome is uncertain. Inspect the affected resources and delivery state before taking further action. Do not submit this work with a new key.",
  expired:
    "The replay window has expired. Inspect the current resources before starting another operation.",
  no_retry_key:
    "This request did not supply a retry key. Inspect the affected resources before repeating it.",
};
function actorLabel(actor: OperationStatus["actor"]) {
  return actor.kind === "oauth"
    ? `MCP client ${actor.clientId}`
    : actor.kind === "api-key"
      ? `API key ${actor.keyId}`
      : "Workspace owner";
}
export function Activity() {
  const [request, setRequest] = useState({ cursor: "", version: 0 });
  const [page, setPage] = useState<Page<OperationStatus>>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lookup, setLookup] = useState(
    new URLSearchParams(location.search).get("operationId") ?? "",
  );
  const [selected, setSelected] = useState(lookup);
  const [detail, setDetail] = useState<OperationStatus>();
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const clientId = new URLSearchParams(location.search).get("clientId");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "20" });
    if (request.cursor) params.set("cursor", request.cursor);
    if (clientId) params.set("clientId", clientId);
    api<Page<OperationStatus>>(`operations?${params}`)
      .then((value) => {
        if (active) setPage(value);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load activity");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request, clientId]);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setDetailError("");
    if (!selected) {
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    api<OperationStatus>(`operations/${encodeURIComponent(selected)}`)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((e) => {
        if (active)
          setDetailError(
            e instanceof Error ? e.message : "Could not load operation",
          );
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, request.version]);
  return (
    <>
      <PageHeading
        title="Activity"
        description="See what changed, who requested it, and whether work is still in progress."
      />
      <p className="text-sm text-muted-foreground mb-6">
        History starts when activity tracking is enabled. A successful request
        can still have pending delivery work. Read requests and rejected
        authentication attempts are not included.
      </p>
      {clientId ? (
        <p className="text-sm mb-4 break-all">
          Showing MCP client {clientId}.{" "}
          <a className="underline" href="/?page=activity">
            Show all activity
          </a>
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <Button
          variant="outline"
          disabled={loading}
          onClick={() =>
            setRequest({ cursor: "", version: request.version + 1 })
          }
        >
          Refresh activity
        </Button>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSelected(lookup.trim());
            setRequest((r) => ({ ...r, version: r.version + 1 }));
          }}
        >
          <label className="text-sm">
            Operation ID
            <Input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              placeholder="Paste an operation ID"
              required
            />
          </label>
          <Button type="submit">Find operation</Button>
        </form>
      </div>
      <Notice>{error}</Notice>
      {loading ? (
        <p role="status" className="text-sm mb-4">
          Loading activity…
        </p>
      ) : null}
      {!loading && !error && page?.data.length === 0 ? (
        <p className="text-sm mb-4">No operations on this page.</p>
      ) : null}
      {page ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Recorded operations</caption>
            <thead className="bg-muted">
              <tr>
                <th className="p-3">Operation</th>
                <th className="p-3">Requested by</th>
                <th className="p-3">Outcome</th>
                <th className="p-3">Started</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((operation) => (
                <tr key={operation.id} className="border-t align-top">
                  <td className="p-3">{operation.operation}</td>
                  <td className="p-3 max-w-xs break-all">
                    {actorLabel(operation.actor)}
                  </td>
                  <td className="p-3">
                    {operation.status}
                    {operation.work.length ? (
                      <span className="block text-muted-foreground">
                        Work:{" "}
                        {operation.work
                          .map((w) => `${w.kind}: ${w.status}`)
                          .join(", ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {new Date(operation.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`View operation ${operation.id}`}
                      onClick={() => {
                        setSelected(operation.id);
                        setLookup(operation.id);
                      }}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="flex gap-2 my-4">
        <Button
          variant="outline"
          disabled={loading || !request.cursor}
          onClick={() => setRequest((r) => ({ ...r, cursor: "" }))}
        >
          Newest
        </Button>
        <Button
          variant="outline"
          disabled={loading || !page?.nextCursor}
          onClick={() =>
            setRequest((r) => ({ ...r, cursor: page?.nextCursor ?? "" }))
          }
        >
          Older activity
        </Button>
      </div>
      <Notice>{detailError}</Notice>
      {detailLoading ? <p role="status">Loading operation…</p> : null}
      {detail ? (
        <section
          className="border rounded-lg p-5 mt-6"
          aria-label="Operation details"
        >
          <h2 className="text-lg font-medium">
            {detail.operation} · {detail.status}
          </h2>
          <p className="mt-3 text-sm">{recovery[detail.recovery]}</p>
          <dl className="text-sm mt-4 space-y-2 break-all">
            <div>
              <dt className="font-medium">Operation ID</dt>
              <dd>{detail.id}</dd>
            </div>
            <div>
              <dt className="font-medium">Requested by</dt>
              <dd>{actorLabel(detail.actor)}</dd>
            </div>
            <div>
              <dt className="font-medium">Request ID</dt>
              <dd>{detail.requestId}</dd>
            </div>
            <div>
              <dt className="font-medium">Last recorded change</dt>
              <dd>{new Date(detail.updatedAt).toLocaleString()}</dd>
            </div>
            {detail.revision !== undefined ? (
              <div>
                <dt className="font-medium">Result revision</dt>
                <dd>{detail.revision}</dd>
              </div>
            ) : null}
            {detail.replayExpiresAt ? (
              <div>
                <dt className="font-medium">Replay available until</dt>
                <dd>{new Date(detail.replayExpiresAt).toLocaleString()}</dd>
              </div>
            ) : null}
          </dl>
          {detail.targets.length ? (
            <>
              <h3 className="font-medium mt-4 text-sm">Affected resources</h3>
              <ul className="text-sm mt-2 space-y-1 break-all">
                {detail.targets.map((t) => (
                  <li key={`${t.kind}:${t.id}`}>
                    {t.kind}: {t.id}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {detail.work.length ? (
            <>
              <h3 className="font-medium mt-4 text-sm">Current work status</h3>
              <ul className="text-sm mt-2">
                {detail.work.map((w, i) => (
                  <li key={i}>
                    {w.kind}: {w.status}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground mt-2">
                Publication release and broadcast completion do not confirm
                recipient delivery.
              </p>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
