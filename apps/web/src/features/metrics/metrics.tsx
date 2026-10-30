import { ActivityChart } from "./activity-chart.js";
import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { MetricsSnapshot, MetricKey } from "@narada/core/metrics";
import { api } from "../../lib/api.js";
import { Notice, PageHeading } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { NativeSelect } from "../../components/ui/native-select.js";
const labels: Record<MetricKey, string> = {
  accepted: "Accepted by Narada",
  submitted: "Submitted to SES",
  captured: "Captured locally",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complained",
  delayed: "Delayed",
  failed: "SES failures",
};
const rate = (n: number, total: number) =>
  total ? `${((n / total) * 100).toFixed(1)}%` : "—";
export function Metrics() {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [days, setDays] = useState("15"),
    [domain, setDomain] = useState("");
  const [series, setSeries] = useState<MetricKey>("accepted");
  const [displayedDomain, setDisplayedDomain] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [request, setRequest] = useState({
    days: "15",
    domain: "",
    version: 0,
  });
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    void api<MetricsSnapshot>(
      `metrics?days=${request.days}${request.domain ? `&domain=${encodeURIComponent(request.domain)}` : ""}`,
    )
      .then((data) => {
        if (!active) return;
        setSnapshot(data);
        setDisplayedDomain(request.domain);
        if (!request.domain)
          setDomains(data.domains.map((d) => d.domain).sort());
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load metrics");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [request]);
  return (
    <>
      <div className="flex flex-wrap justify-between gap-4 items-start">
        <PageHeading
          title="Every message, accounted for."
          description="Delivery insights from your Narada sending activity."
        />
        {snapshot?.mode === "aws" && (
          <a
            className="text-sm text-primary inline-flex items-center gap-1 mt-2"
            href={snapshot.cloudWatchUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open CloudWatch <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      <form
        className="flex flex-wrap gap-3 items-end mb-6"
        onSubmit={(e) => {
          e.preventDefault();
          setRequest((r) => ({ days, domain, version: r.version + 1 }));
        }}
      >
        <label className="text-xs space-y-2">
          <span className="block">Sender domain</span>
          <NativeSelect
            aria-label="Sender domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          >
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-xs space-y-2">
          <span className="block">Period</span>
          <NativeSelect
            aria-label="Metrics period"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            {[7, 15, 30, 90].map((n) => (
              <option key={n} value={n}>
                Last {n} days
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" disabled={busy}>
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
          {busy ? "Fetching…" : "Fetch metrics"}
        </Button>
      </form>
      <Notice>{error}</Notice>
      {snapshot?.mode === "local" && (
        <div className="rounded-lg bg-primary/5 border border-primary/15 p-4 mb-6 text-sm">
          <strong>Local development</strong>
          <p className="text-muted-foreground mt-1">
            Messages are captured in Mailpit. Delivery, bounce, and complaint
            results here are simulated feedback, not real inbox delivery.
          </p>
        </div>
      )}
      {snapshot && (
        <div aria-busy={busy} className={busy ? "opacity-60" : ""}>
          <p className="text-xs text-muted-foreground mb-4">
            Showing {snapshot.days[0]?.day} – {snapshot.days.at(-1)?.day} ·{" "}
            {displayedDomain || "All domains"} · UTC acceptance dates
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {(
              [
                "accepted",
                snapshot.mode === "local" ? "captured" : "submitted",
                "delivered",
                "delayed",
              ] as MetricKey[]
            ).map((key) => (
              <Card key={key} className="shadow-none">
                <CardContent>
                  <p className="text-xs text-muted-foreground">{labels[key]}</p>
                  <p className="text-3xl mt-3 tabular-nums">
                    {snapshot.totals[key].toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    recipients
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="shadow-none mb-6">
            <CardContent>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="font-medium">Sending activity</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Outcomes grouped by the date Narada accepted the message
                  </p>
                </div>
                <NativeSelect
                  className="sm:w-52 shrink-0"
                  aria-label="Chart event"
                  value={series}
                  onChange={(e) => setSeries(e.target.value as MetricKey)}
                >
                  {Object.entries(labels).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {snapshot.totals.accepted === 0 && (
                <p className="text-sm text-muted-foreground mb-4">
                  No tracked messages in this period. Metrics begin with new
                  messages after this feature is enabled.
                </p>
              )}
              <ActivityChart
                days={snapshot.days}
                metric={series}
                label={labels[series]}
              />
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  View daily values
                </summary>
                <div className="max-h-72 overflow-auto mt-3">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="py-2">Acceptance date (UTC)</th>
                        <th>{labels[series]}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.days.map((day) => (
                        <tr className="border-t" key={day.day}>
                          <td className="py-2">{day.day}</td>
                          <td>{day.counts[series]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </CardContent>
          </Card>
          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            {(["delivered", "bounced", "complained"] as const).map((key) => (
              <Card className="shadow-none" key={key}>
                <CardContent>
                  <p className="text-sm">{labels[key]} / accepted</p>
                  <p className="text-3xl tabular-nums mt-3">
                    {rate(snapshot.totals[key], snapshot.totals.accepted)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {snapshot.totals[key]} of {snapshot.totals.accepted}{" "}
                    recipients
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="shadow-none">
            <CardContent>
              <h2 className="font-medium mb-4">Sender domains</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm text-left [&_th]:pr-4 [&_td]:pr-4">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="pb-3">Domain</th>
                      <th>Accepted</th>
                      <th>Delivered</th>
                      <th>Bounced</th>
                      <th>Complained</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.domains.map((d) => (
                      <tr key={d.domain} className="border-t">
                        <td className="py-3 pr-4">{d.domain}</td>
                        <td>{d.counts.accepted}</td>
                        <td>{d.counts.delivered}</td>
                        <td>{d.counts.bounced}</td>
                        <td>{d.counts.complained}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!snapshot.domains.length && (
                <p className="text-sm text-muted-foreground py-3">
                  No domain activity yet.
                </p>
              )}
            </CardContent>
          </Card>
          <div className="mt-5 space-y-2 text-xs text-muted-foreground">
            <p>
              Fetched {new Date(snapshot.fetchedAt).toLocaleString()} · Manual
              refresh ·{" "}
              {snapshot.startedAt
                ? `Tracking since ${new Date(snapshot.startedAt).toLocaleString()}`
                : "Tracking starts with the next accepted message"}
            </p>
            <p>
              Counts are unique recipients per message and outcome. Outcomes can
              overlap and arrive later. Delivered means accepted by the
              recipient’s mail server; it does not confirm inbox placement.
            </p>
            <p>
              Rates use Narada-accepted recipients, including queued messages,
              and are not SES account reputation rates. Auth emails and sends
              outside Narada are excluded. Historical messages are not
              backfilled.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
