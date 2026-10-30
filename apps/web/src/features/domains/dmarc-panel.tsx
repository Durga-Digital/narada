import { useState } from "react";
import type { Domain } from "../../lib/api.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Field, Notice } from "../../components/shared.js";
import { Panel, RecordName, RecordValue, dnsLabels } from "./setup-ui.js";
import type { DnsNameSettings } from "./dns-names.js";
export function DmarcPanel({
  domain,
  dnsNames,
}: {
  domain: Domain;
  dnsNames: DnsNameSettings;
}) {
  const [policy, setPolicy] = useState("none"),
    [reports, setReports] = useState("");
  const check = domain.authentication?.dmarc;
  const validReports =
    !reports ||
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(
      reports,
    );
  const record = `v=DMARC1; p=${policy};${reports && validReports ? ` rua=mailto:${reports};` : ""}`;
  return (
    <Panel title="Publish a DMARC policy">
      <p className="text-sm text-muted-foreground">
        DMARC connects your visible From domain to DKIM or SPF. Start with
        monitoring, check all services that send as your domain, then consider
        stricter enforcement. Publish DNS changes with your domain provider.
      </p>
      <div className="rounded-lg bg-muted/60 p-4 text-sm space-y-2">
        <p className="font-medium">
          {check ? dnsLabels[check.status] : "Not checked"}
          {check?.inherited ? " · inherited policy" : ""}
        </p>
        <p>
          {check?.message ??
            "Click Check verification to inspect the published policy."}
        </p>
        {check?.record && (
          <>
            <p className="text-muted-foreground break-all">
              {check.name} · Effective policy: {check.policy ?? "unknown"}
            </p>
            <code className="block break-all select-all">{check.record}</code>
            <p className="text-muted-foreground">
              Keep this policy unless you intend to change it. The generator
              below is a proposal, not a saved change.
            </p>
          </>
        )}
        {check?.alignment && (
          <p className="text-muted-foreground">
            DKIM alignment:{" "}
            {check.alignment.dkim === "s" ? "strict" : "relaxed"} · SPF
            alignment: {check.alignment.spf === "s" ? "strict" : "relaxed"}. A
            MAIL FROM subdomain needs relaxed SPF alignment; aligned DKIM can
            still satisfy DMARC.
          </p>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Proposed DMARC policy">
          <NativeSelect
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
          >
            <option value="none">Monitor (p=none)</option>
            <option value="quarantine">Quarantine failures</option>
            <option value="reject">Reject failures</option>
          </NativeSelect>
        </Field>
        <Field label="Aggregate report email (optional)">
          <Input
            type="email"
            value={reports}
            onChange={(e) => setReports(e.target.value.trim())}
            placeholder={`dmarc@${domain.name}`}
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Use a mailbox you already manage. Narada does not create a report inbox
        or ingest reports. External reporting domains may require additional DNS
        authorization. Without rua, the policy requests no aggregate reports.
      </p>
      {policy !== "none" && (
        <Notice>
          Enforcement can block legitimate mail from other services. Review
          their authentication before publishing this policy.
        </Notice>
      )}
      {!validReports ? (
        <Notice>
          Enter a valid reporting email address before copying a record.
        </Notice>
      ) : (
        <>
          <RecordName
            label="DMARC TXT"
            name={`_dmarc.${domain.name}`}
            settings={dnsNames}
          />
          <RecordValue label="Proposed DMARC TXT value" value={record} />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Publish one DMARC TXT record at this name. An explicit subdomain policy
        overrides inheritance. This check covers policy discovery and common
        syntax, not every DMARC extension or reporting authorization.
      </p>
    </Panel>
  );
}
