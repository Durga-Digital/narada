import { copyWithFeedback } from "../../lib/feedback.js";
import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { Notice } from "../../components/shared.js";
import { dnsHost, type DnsNameSettings } from "./dns-names.js";
export function RecordName({
  label,
  name,
  settings,
}: {
  label: string;
  name: string;
  settings: DnsNameSettings;
}) {
  const host = dnsHost(name, settings);
  return (
    <div className="space-y-2">
      {host === null ? (
        <Notice>
          Choose a DNS zone that contains {name} before copying its host.
        </Notice>
      ) : (
        <RecordValue
          label={`${label} ${settings.format === "relative" ? "host" : "full name"}`}
          value={host}
        />
      )}
      <p className="text-xs text-muted-foreground break-all">
        Full DNS name: <code>{name}</code>
      </p>
      {host !== null && settings.format === "relative" && (
        <p className="text-xs text-muted-foreground">
          Paste only the host above. Your provider adds the zone; adding it
          yourself would duplicate the domain.
        </p>
      )}
    </div>
  );
}
export function RecordValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copiedValue, setCopied] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await copyWithFeedback(value);
              setCopied(value);
              setError("");
            } catch {
              setError("Select and copy the value below.");
            }
          }}
        >
          {copiedValue === value ? <Check size={14} /> : <Copy size={14} />}{" "}
          {copiedValue === value ? "Copied" : "Copy"}
        </Button>
      </div>
      <code className="block break-all text-sm select-all">{value}</code>
      <Notice>{error}</Notice>
    </div>
  );
}
export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-5 sm:p-6 space-y-5">
      <h2 className="font-medium text-lg">{title}</h2>
      {children}
    </section>
  );
}
export const dnsLabels = {
  found: "Record found",
  missing: "Missing",
  invalid: "Review record",
  unknown: "Not confirmed",
  local: "Local preview",
};
