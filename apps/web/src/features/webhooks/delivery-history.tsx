import { useState } from "react";
import { api, type Attempt, type Endpoint } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Notice } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog.js";
interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
interface DeliveryAttempt {
  id: string;
  attempt: number;
  outcome: string;
  startedAt: string;
  finishedAt?: string;
  status?: number;
  error?: string;
}
const time = (value?: string | number) =>
  value ? new Date(value).toLocaleString() : "—";
const states: Record<string, string> = {
  webhook: "Queued",
  "webhook-running": "Delivering",
  complete: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
};
export function DeliveryHistory({ endpoints }: { endpoints: Endpoint[] }) {
  const [cursor, setCursor] = useState<string>(),
    [selected, setSelected] = useState<string>();
  return (
    <section aria-label="Webhook delivery history" className="mt-8">
      <h2 className="font-medium mb-2">Delivery history</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Deliveries and attempts are retained for 30 days. Receivers should
        deduplicate by event ID; a retry can deliver the same event again.
      </p>
      <DeliveryPage
        key={cursor ?? "newest"}
        {...{ cursor, setCursor, endpoints, setSelected }}
      />
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogTitle>Delivery attempts</DialogTitle>
          <DialogDescription>
            Each attempt records its outcome. An unknown outcome means the
            receiver may already have accepted the event.
          </DialogDescription>
          {selected && <History key={selected} id={selected} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function DeliveryPage({
  cursor,
  setCursor,
  endpoints,
  setSelected,
}: {
  cursor?: string;
  setCursor: (value?: string) => void;
  endpoints: Endpoint[];
  setSelected: (value: string) => void;
}) {
  const { data, error, refresh } = useResource<Page<Attempt>>(
    `webhooks/deliveries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    5000,
  );
  const [actionError, setError] = useState(""),
    [busy, setBusy] = useState<string>();
  return (
    <>
      <Notice>{error || actionError}</Notice>
      {!data && !error && <p role="status">Loading deliveries…</p>}
      {data?.data.length === 0 && (
        <Notice>
          No deliveries on this page. Events appear after a subscribed
          transition occurs.
        </Notice>
      )}
      {data?.data.map((row) => (
        <div
          key={row.id}
          data-testid={`webhook-delivery-${row.id}`}
          className="flex flex-wrap justify-between gap-4 border-b py-4 text-sm"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">{row.payload?.type ?? "Event"}</p>
            <p className="text-muted-foreground mt-1">
              {states[row.state] ?? row.state} · {row.attempts} attempts
              {row.lastStatus ? ` · HTTP ${row.lastStatus}` : ""}
            </p>
            <p className="text-xs text-muted-foreground break-all">
              {endpoints.find((e) => e.id === row.endpointId)?.url ??
                "Removed endpoint"}
            </p>
            <p className="text-xs mt-1">
              Created {time(row.createdAt)}
              {row.nextAttemptAt
                ? ` · Next attempt after ${time(row.nextAttemptAt)}`
                : ""}
            </p>
            {row.error && (
              <p className="text-xs text-destructive mt-1">{row.error}</p>
            )}
          </div>
          <div className="flex items-start gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(row.id)}
            >
              View attempts
            </Button>
            {row.state === "failed" && (
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !!busy || !endpoints.some((e) => e.id === row.endpointId)
                }
                onClick={async () => {
                  setBusy(row.id);
                  setError("");
                  try {
                    await api(
                      `webhooks/attempts/${row.id}/retry`,
                      {},
                      "POST",
                      "Webhook retry queued",
                    );
                    await refresh();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not retry delivery",
                    );
                  } finally {
                    setBusy(undefined);
                  }
                }}
              >
                {busy === row.id ? "Queuing…" : "Retry"}
              </Button>
            )}
          </div>
        </div>
      ))}
      <div className="flex gap-2 mt-4">
        <Button
          variant="outline"
          onClick={() => {
            if (cursor) setCursor(undefined);
            else void refresh();
          }}
        >
          Newest deliveries
        </Button>
        <Button
          variant="outline"
          disabled={!data?.nextCursor}
          onClick={() => setCursor(data!.nextCursor!)}
        >
          Older deliveries
        </Button>
      </div>
    </>
  );
}
function History({ id }: { id: string }) {
  const [cursor, setCursor] = useState<string>();
  return (
    <HistoryPage key={cursor ?? "newest"} {...{ id, cursor, setCursor }} />
  );
}
function HistoryPage({
  id,
  cursor,
  setCursor,
}: {
  id: string;
  cursor?: string;
  setCursor: (value?: string) => void;
}) {
  const { data, error } = useResource<
    Page<DeliveryAttempt> & { delivery: Attempt }
  >(
    `webhooks/deliveries/${id}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    5000,
  );
  return (
    <>
      <Notice>{error}</Notice>
      {!data && !error && <p role="status">Loading attempts…</p>}
      {data && (
        <>
          <p className="font-medium">{data.delivery.payload?.type}</p>
          <p className="text-xs break-all">
            Event ID: {data.delivery.payload?.id}
          </p>
          <p className="text-xs">
            History expires {time(data.delivery.expiresAt)}
          </p>
          {data.data.length === 0 && (
            <Notice>
              No recorded attempts on this page. Attempts made before this
              feature was deployed have no detailed history.
            </Notice>
          )}
          <ol className="space-y-3" aria-label="Attempts">
            {data.data.map((attempt) => (
              <li key={attempt.id} className="border rounded-md p-3 text-sm">
                <p className="font-medium">
                  Attempt {attempt.attempt} · {attempt.outcome}
                  {attempt.status ? ` · HTTP ${attempt.status}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Started {time(attempt.startedAt)}
                  {attempt.finishedAt
                    ? ` · Finished ${time(attempt.finishedAt)}`
                    : ""}
                </p>
                {attempt.error && (
                  <p className="text-xs mt-1">{attempt.error}</p>
                )}
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!cursor}
              onClick={() => setCursor(undefined)}
            >
              Newest attempts
            </Button>
            <Button
              variant="outline"
              disabled={!data.nextCursor}
              onClick={() => setCursor(data.nextCursor!)}
            >
              Older attempts
            </Button>
          </div>
        </>
      )}
    </>
  );
}
