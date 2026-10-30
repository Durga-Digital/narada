import { copyWithFeedback } from "../../lib/feedback.js";
import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { Domain } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Notice } from "../../components/shared.js";
import { RecordName, RecordValue } from "./setup-ui.js";
import { dnsHost, type DnsNameSettings } from "./dns-names.js";
const dnsGuide =
  "https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html#verify-domain-procedure";
export function DkimRecords({
  domain,
  dnsNames,
}: {
  domain: Domain;
  dnsNames: DnsNameSettings;
}) {
  const names = domain.records.map((r) => dnsHost(r.name, dnsNames));
  const recordsText = domain.records
    .map((r, i) => `${names[i]}\t${r.type}\t${r.value}`)
    .join("\n");
  const validNames = names.every((name) => name !== null);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  async function copy(value: string, key: string) {
    try {
      await copyWithFeedback(value);
      setCopied(key);
      setError("");
    } catch {
      setError("Clipboard unavailable. Select and copy the record text.");
    }
  }
  return (
    <>
      <Notice>{error}</Notice>
      <Card className="shadow-none">
        <CardContent>
          <div className="flex flex-wrap justify-between gap-3 mb-5">
            <div>
              <h2 className="font-medium text-lg">DNS records</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Add these records in the DNS settings for your domain.
              </p>
            </div>
            {domain.records.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={!validNames}
                onClick={() => void copy(recordsText, recordsText)}
              >
                {copied === recordsText ? (
                  <Check size={14} />
                ) : (
                  <Copy size={14} />
                )}
                {copied === recordsText ? "Copied records" : "Copy all records"}
              </Button>
            )}
          </div>
          <ol className="text-sm text-muted-foreground grid gap-2 mb-6 list-decimal pl-5">
            <li>Open the DNS provider that manages {domain.name}.</li>
            <li>
              Select the DNS name format above. Copy the host into your
              provider’s Host/Name field and the complete value into its
              Data/Target field. Copy all records uses the selected format too.
            </li>
            <li>Save the records, then return here and check verification.</li>
          </ol>
          <div className="space-y-4">
            {domain.records.map((record, i) => (
              <section
                aria-label={`DNS record ${i + 1}`}
                key={`${record.type}:${record.name}`}
                className="rounded-xl border overflow-hidden"
              >
                <div className="bg-muted/50 border-b px-4 py-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium">
                    {record.type} record {i + 1}
                  </h3>
                  <span className="text-xs text-muted-foreground">DKIM</span>
                </div>
                <div className="p-4 grid gap-4">
                  <RecordName
                    label={`CNAME ${i + 1}`}
                    name={record.name}
                    settings={dnsNames}
                  />
                  <RecordValue
                    label={`Value for record ${i + 1}`}
                    value={record.value}
                  />
                </div>
              </section>
            ))}
          </div>
          {!domain.records.length && (
            <Notice>
              No DNS records were returned for this identity. Check verification
              again or inspect the identity in the SES console.
            </Notice>
          )}
          <p role="status" className="sr-only">
            {copied ? "Copied to clipboard" : ""}
          </p>
          <a
            href={dnsGuide}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary mt-5"
          >
            AWS domain verification guide
            <ExternalLink size={14} />
          </a>
        </CardContent>
      </Card>
    </>
  );
}
