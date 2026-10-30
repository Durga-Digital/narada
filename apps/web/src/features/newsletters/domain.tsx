import { useEffect, useState } from "react";
import type {
  PublicationDomainResult,
  SenderDomain,
  Page,
} from "@narada/contracts/types";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Field, Notice } from "../../components/shared.js";

function addressPreview(value: string) {
  if (!value || /[\s/:@*\\?#%]/.test(value)) return "";
  try {
    return new URL(`https://${value.replace(/\.$/, "")}`).hostname;
  } catch {
    return "";
  }
}

export function PublicationDomainEditor({
  id,
  value,
  refresh,
}: {
  id: string;
  value?: PublicationDomainResult;
  refresh: () => Promise<void>;
}) {
  const [hostname, setHostname] = useState("");
  const [suggestions, setSuggestions] = useState<SenderDomain[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [disconnect, setDisconnect] = useState(false);
  const row = value?.domain;
  const normalizedAddress = addressPreview(hostname);
  useEffect(() => {
    let alive = true;
    // This dashboard is owner-only; machine clients use the scoped domains.list operation.
    void api<Page<SenderDomain>>("domains?view=page")
      .then((values) => {
        if (alive) setCursor(values.nextCursor);
        if (alive)
          setSuggestions(
            values.data.filter((d) => d.verified && !d.name.includes("@")),
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!row || ["disconnected", "failed"].includes(row.state)) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 10_000);
    return () => clearInterval(timer);
  }, [row?.id, row?.state, refresh]);
  const moreDomains = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api<Page<SenderDomain>>(
        `domains?view=page&cursor=${encodeURIComponent(cursor)}`,
      );
      setSuggestions((current) => [
        ...current,
        ...page.data.filter((d) => d.verified && !d.name.includes("@")),
      ]);
      setCursor(page.nextCursor);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not load sending domains",
      );
    } finally {
      setLoadingMore(false);
    }
  };
  const action = async (
    action: "configure" | "check" | "activate" | "disconnect",
  ) => {
    setPending(true);
    setError("");
    try {
      await api(
        `publications/${id}/domain${action === "configure" ? "" : `/${action}`}`,
        {
          revision: row?.revision ?? 0,
          ...(action === "configure" ? { hostname } : {}),
        },
        action === "configure" ? "PUT" : "POST",
      );
      setDisconnect(false);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update domain setup",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Publication address</h2>
        <p className="text-muted-foreground mt-2">
          Your default address stays available throughout setup and after
          disconnecting.
        </p>
        {value && (
          <a
            className="underline break-all"
            href={value.defaultUrl}
            target="_blank"
            rel="noreferrer"
          >
            {value.defaultUrl}
          </a>
        )}
      </div>
      <Notice>{error}</Notice>
      {!value ? (
        <p role="status">Loading domain setup…</p>
      ) : !row || row.state === "disconnected" ? (
        <form
          className="rounded-xl border p-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action("configure");
          }}
        >
          <h3 className="text-lg font-semibold">Connect a custom subdomain</h3>
          <p className="text-sm text-muted-foreground">
            Use an unused address such as news.example.com. You’ll add DNS
            records at your provider. Narada creates HTTPS and hosting resources
            in your AWS account, which may incur charges.
          </p>
          {suggestions.length > 0 && (
            <Field label="Start with a verified sending domain">
              <select
                className="border rounded-md w-full p-2"
                aria-label="Verified sending domain"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) setHostname(`news.${e.target.value}`);
                }}
              >
                <option value="">Choose a suggestion (optional)</option>
                {suggestions.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name} · checked{" "}
                    {d.checkedAt
                      ? new Date(d.checkedAt).toLocaleDateString()
                      : "date unavailable"}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {cursor && (
            <Button
              type="button"
              variant="outline"
              disabled={loadingMore}
              onClick={() => void moreDomains()}
            >
              Load more sending domains
            </Button>
          )}
          <Field label="Website subdomain">
            <Input
              required
              maxLength={253}
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="news.example.com"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </Field>
          {normalizedAddress && (
            <p className="text-sm break-all">
              Address to connect: <strong>{normalizedAddress}</strong>
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Sending verification is a saved snapshot. Website ownership requires
            a fresh DNS check, including for suggested domains. Apex domains and
            wildcards aren’t supported.
          </p>
          <Button disabled={pending || !hostname}>
            {pending ? "Starting setup…" : "Connect subdomain"}
          </Button>
        </form>
      ) : (
        <>
          <div className="rounded-xl border p-5 space-y-3" aria-live="polite">
            <h3 className="text-lg font-semibold break-all">{row.hostname}</h3>
            <p className="capitalize">{row.state.replaceAll("_", " ")}</p>
            {row.message && <p>{row.message}</p>}
            <p className="text-sm text-muted-foreground">
              HTTPS: {row.certificate.status} · Routing: {row.routing}
              {row.certificate.expiresAt
                ? ` · Certificate expires ${new Date(row.certificate.expiresAt).toLocaleDateString()}`
                : ""}
            </p>
            {row.lastCheckedAt && (
              <p className="text-sm text-muted-foreground">
                Last checked {new Date(row.lastCheckedAt).toLocaleString()}
              </p>
            )}
            {row.state === "active" && (
              <a
                className="underline"
                href={row.preferredUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open publication ↗
              </a>
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-3">DNS setup</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add these records at your DNS provider. Keep ownership and
              certificate records while connected. Use DNS-only mode for the
              website CNAME. If your zone is delegated, use the full record name
              shown below.
            </p>
            <ol className="space-y-4">
              {row.records.map((record) => (
                <li
                  key={record.purpose}
                  className="border rounded-xl p-4 space-y-2"
                >
                  <div className="flex justify-between gap-3">
                    <h4 className="font-semibold capitalize">
                      {record.purpose} · {record.type}
                    </h4>
                    <span className="text-sm">{record.status}</span>
                  </div>
                  <dl className="text-sm space-y-2">
                    <div>
                      <dt className="text-muted-foreground">Full name</dt>
                      <dd className="font-mono break-all">{record.name}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        Name within the root zone
                      </dt>
                      <dd className="font-mono break-all">
                        {record.shortName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Value</dt>
                      <dd className="font-mono break-all">{record.value}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {["name", "value"].map((field) => (
                      <Button
                        key={field}
                        type="button"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              field === "name" ? record.name : record.value,
                            );
                            setCopied(`${record.purpose} ${field} copied`);
                          } catch {
                            setError(
                              "Copy failed. Select and copy the record text instead.",
                            );
                          }
                        }}
                      >
                        Copy {field}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <p role="status" className="text-sm mt-2">
              {copied}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void action("check")}
            >
              Check DNS and HTTPS
            </Button>
            {row.state === "ready" && (
              <Button
                disabled={pending}
                onClick={() => void action("activate")}
              >
                Activate custom address
              </Button>
            )}
            {row.state !== "disconnecting" && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setDisconnect(true)}
              >
                Disconnect domain
              </Button>
            )}
          </div>
          {disconnect && (
            <div className="rounded-xl border p-5 space-y-3">
              <h3 className="font-semibold">Disconnect {row.hostname}?</h3>
              <p>
                The default address becomes primary immediately. Hosting stays
                disabled and reserved until you remove the website DNS record.
                Sent email links continue to work.
              </p>
              <div className="flex gap-3">
                <Button
                  disabled={pending}
                  onClick={() => void action("disconnect")}
                >
                  Confirm disconnect
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => setDisconnect(false)}
                >
                  Keep connected
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
