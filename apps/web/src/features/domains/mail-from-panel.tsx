import { useState } from "react";
import { api, type Domain } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Field, Notice } from "../../components/shared.js";
import { Panel, RecordName, RecordValue, dnsLabels } from "./setup-ui.js";
import type { DnsNameSettings } from "./dns-names.js";
export function MailFromPanel({
  domain,
  dnsNames,
  busy,
  setBusy,
  updated,
}: {
  domain: Domain;
  dnsNames: DnsNameSettings;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  updated: (domain: Domain) => void;
}) {
  const current = domain.authentication?.mailFrom;
  const [custom, setCustom] = useState(Boolean(current?.domain));
  const [name, setName] = useState(current?.domain ?? `bounce.${domain.name}`);
  const [behavior, setBehavior] = useState(
    current?.behavior ?? "USE_DEFAULT_VALUE",
  );
  const [error, setError] = useState("");
  return (
    <Panel title="Custom MAIL FROM (optional)">
      <p className="text-sm text-muted-foreground">
        SES uses its own return-path domain by default. A dedicated bounce
        subdomain can add SPF alignment. It is optional when DKIM already aligns
        with your From domain.
      </p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            updated(
              await api<Domain>(
                `domains/${encodeURIComponent(domain.name)}/mail-from`,
                { domain: custom ? name.trim().toLowerCase() : null, behavior },
                "PUT",
                domain.local
                  ? "MAIL FROM preview saved"
                  : "MAIL FROM settings saved",
              ),
            );
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not save MAIL FROM",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="MAIL FROM mode">
          <NativeSelect
            disabled={busy}
            value={custom ? "custom" : "default"}
            onChange={(e) => setCustom(e.target.value === "custom")}
          >
            <option value="default">SES default</option>
            <option value="custom">Custom bounce subdomain</option>
          </NativeSelect>
        </Field>
        {custom && (
          <>
            <Field label="Bounce subdomain">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={busy}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Choose an unused subdomain of {domain.name}. Do not use a domain
              that sends or receives ordinary email. Do not replace your normal
              inbox MX records.
            </p>
            <Field label="If the MX record fails">
              <NativeSelect
                disabled={busy}
                value={behavior}
                onChange={(e) => setBehavior(e.target.value as typeof behavior)}
              >
                <option value="USE_DEFAULT_VALUE">
                  Fall back to SES default
                </option>
                <option value="REJECT_MESSAGE">
                  Reject sending until fixed
                </option>
              </NativeSelect>
            </Field>
            <p className="text-xs text-muted-foreground">
              {behavior === "REJECT_MESSAGE"
                ? "Sending will fail while SES cannot verify the MX record, including initial DNS setup."
                : "Sending can continue using SES's return path. SPF alignment is lost during fallback; aligned DKIM can still satisfy DMARC."}
            </p>
          </>
        )}
        <Notice>{error}</Notice>
        <Button disabled={busy || (custom && !name.trim())}>
          {busy
            ? "Saving…"
            : domain.local
              ? "Save local preview"
              : "Save MAIL FROM settings"}
        </Button>
      </form>
      <div className="border-t pt-4 text-sm space-y-2">
        <p>Saved mode: {current?.domain ?? "SES default"}</p>
        <p>
          SES status:{" "}
          {domain.local
            ? "Local preview — no AWS changes"
            : (current?.status ?? "Not checked")}
        </p>
        {current?.domain && (
          <>
            <p>
              MX: {dnsLabels[current.mx]} · SPF: {dnsLabels[current.spf]}
            </p>
            <p className="text-xs text-muted-foreground">
              Checks compare DNS to the records below. MX must contain exactly
              one entry. SPF checks this dedicated SES record, not arbitrary SPF
              policies. Refresh with Check verification after publishing.
            </p>
          </>
        )}
      </div>
      {current?.records.map((record) => (
        <div key={record.type} className="space-y-3">
          <RecordName
            label={record.type}
            name={record.name}
            settings={dnsNames}
          />
          <RecordValue label={`${record.type} value`} value={record.value} />
        </div>
      ))}
      {current?.domain && (
        <p className="text-xs text-muted-foreground">
          For MX, enter 10 in your provider’s priority field and the remaining
          value as the mail server.
        </p>
      )}
    </Panel>
  );
}
