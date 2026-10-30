import { useState } from "react";
import { getDomain } from "tldts";
import { DnsNameOptions } from "./dns-name-settings.js";
import type { DnsNameSettings } from "./dns-names.js";
import { ShieldCheck, FileText, Mail, Send } from "lucide-react";
import { api, type Domain } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Notice } from "../../components/shared.js";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui/tabs.js";
import { DkimRecords } from "./dkim-records.js";
import { DmarcPanel } from "./dmarc-panel.js";
import { MailFromPanel } from "./mail-from-panel.js";
import { TestPanel } from "./domain-test-panel.js";
import { Panel, dnsLabels } from "./setup-ui.js";
export function DomainSetup({
  domain,
  busy,
  setBusy,
  updated,
}: {
  domain: Domain;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  updated: (domain: Domain) => void;
}) {
  const [step, setStep] = useState("dkim"),
    [error, setError] = useState("");
  const auth = domain.authentication;
  const [dnsNames, setDnsNames] = useState<DnsNameSettings>(() => ({
    zone: getDomain(domain.name, { allowPrivateDomains: true }) ?? domain.name,
    format: "relative",
  }));
  const dkimStatus = domain.local
    ? "Local preview"
    : auth?.dkim.signingEnabled === false
      ? "Signing disabled"
      : auth?.dkim.status === "SUCCESS" && auth.dkim.signingEnabled
        ? "Signing enabled"
        : auth?.dkim.status === "SUCCESS"
          ? "Signing status unknown"
          : (auth?.dkim.status?.replaceAll("_", " ").toLowerCase() ??
            "Not checked");
  const dmarcStatus = domain.local
    ? "Local preview"
    : auth
      ? dnsLabels[auth.dmarc.status]
      : "Not checked";
  const mailStatus = domain.local
    ? "Local preview"
    : !auth
      ? "Not checked"
      : auth.mailFrom.domain
        ? auth.mailFrom.status.replaceAll("_", " ").toLowerCase()
        : "SES default";
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-medium text-xl">Domain setup</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Identity verification allows sending. These checks cover
          authentication separately; none guarantees inbox placement. Use Check
          verification to refresh SES and DNS results.
        </p>
      </div>
      <Tabs value={step} onValueChange={setStep}>
        <TabsList
          aria-label="Domain setup steps"
          style={{ height: "auto" }}
          className="grid grid-cols-2 lg:grid-cols-4 h-auto w-full gap-2 bg-transparent p-0 mb-6"
        >
          {[
            ["dkim", "1. DKIM", dkimStatus, <ShieldCheck size={17} />],
            ["dmarc", "2. DMARC", dmarcStatus, <FileText size={17} />],
            ["mail-from", "3. MAIL FROM", mailStatus, <Mail size={17} />],
            ["test", "4. Test email", "Inspect your inbox", <Send size={17} />],
          ].map(([id, title, status, icon]) => (
            <TabsTrigger
              key={String(id)}
              value={String(id)}
              className="border rounded-xl p-4 h-auto flex-col items-start gap-2 whitespace-normal text-left data-[state=active]:border-primary/40 data-[state=active]:bg-primary/5"
            >
              <span className="flex items-center gap-2">
                {icon}
                {title}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {status}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {step !== "test" && (
          <DnsNameOptions settings={dnsNames} change={setDnsNames} />
        )}
        <TabsContent
          forceMount
          value="dkim"
          className="space-y-5 data-[state=inactive]:hidden"
        >
          <Panel title="Sign your emails with DKIM">
            <p className="text-sm text-muted-foreground">
              DKIM lets receiving servers verify that your domain signed the
              message. SES handles signing; publish the CNAME records below with
              your DNS provider.
            </p>
            <p className="text-sm">
              <strong>Status:</strong> {dkimStatus}
            </p>
            {!domain.local && auth?.dkim.signingEnabled === false && (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    updated(
                      await api<Domain>(
                        `domains/${encodeURIComponent(domain.name)}/dkim`,
                        {},
                        "POST",
                        "DKIM signing settings updated",
                      ),
                    );
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Could not enable DKIM",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Enable DKIM signing
              </Button>
            )}
            {domain.local && (
              <p className="text-sm text-muted-foreground">
                AWS generates the real DKIM tokens after deployment. No
                placeholder DNS records need to be published.
              </p>
            )}
            {auth?.dkim.origin === "EXTERNAL" && (
              <p className="text-sm text-muted-foreground">
                This identity uses externally managed DKIM keys. Keep the
                existing signing records; Narada does not replace those keys.
              </p>
            )}
            <Notice>{error}</Notice>
          </Panel>
          {!domain.local && <DkimRecords domain={domain} dnsNames={dnsNames} />}
        </TabsContent>
        <TabsContent
          forceMount
          value="dmarc"
          className="data-[state=inactive]:hidden"
        >
          <DmarcPanel domain={domain} dnsNames={dnsNames} />
        </TabsContent>
        <TabsContent
          forceMount
          value="mail-from"
          className="data-[state=inactive]:hidden"
        >
          <MailFromPanel
            key={`${auth?.mailFrom.domain ?? "default"}/${auth?.mailFrom.behavior ?? "USE_DEFAULT_VALUE"}`}
            domain={domain}
            dnsNames={dnsNames}
            busy={busy}
            setBusy={setBusy}
            updated={updated}
          />
        </TabsContent>
        <TabsContent
          forceMount
          value="test"
          className="data-[state=inactive]:hidden"
        >
          <TestPanel domain={domain} busy={busy} setBusy={setBusy} />
        </TabsContent>
      </Tabs>
      <div className="rounded-xl bg-muted/50 p-5 text-sm">
        <h2 className="font-medium">Protect your sending reputation</h2>
        <p className="text-muted-foreground mt-2">
          Send expected messages, increase new-domain volume gradually, and
          watch bounces and complaints in Metrics. Narada suppresses permanent
          bounces and complaints. Settings shows SES account access and sending
          controls; domain verification does not remove sandbox limits.
          Reputation is earned over time, not enabled by a setting.
        </p>
      </div>
    </div>
  );
}
