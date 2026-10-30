import { Field } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import type { DnsNameSettings } from "./dns-names.js";

export function DnsNameOptions({
  settings,
  change,
}: {
  settings: DnsNameSettings;
  change: (settings: DnsNameSettings) => void;
}) {
  return (
    <section
      aria-label="DNS copy settings"
      className="rounded-xl border bg-card p-5 space-y-4"
    >
      <div>
        <h3 className="font-medium">Copy the right DNS host</h3>
        <p className="text-sm text-muted-foreground mt-2">
          Squarespace adds your domain to the Host field automatically. Use a
          short host there. Other providers may accept a full record name. These
          settings change the names you copy, not the SES configuration.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="DNS name format">
          <NativeSelect
            value={settings.format}
            onChange={(e) =>
              change({
                ...settings,
                format: e.target.value as DnsNameSettings["format"],
              })
            }
          >
            <option value="relative">
              Short host — Squarespace / auto-appends domain
            </option>
            <option value="full">Full record name</option>
          </NativeSelect>
        </Field>
        <Field label="DNS zone (domain in your DNS provider)">
          <Input
            value={settings.zone}
            disabled={settings.format === "full"}
            onChange={(e) => change({ ...settings, zone: e.target.value })}
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Check the suggested zone against your provider. If your sending domain
        is mail.example.com but you edit DNS under example.com, use example.com
        here. A separately delegated mail.example.com zone needs
        mail.example.com instead. Keep destination values complete. In
        Cloudflare, DKIM CNAMEs must be DNS only.
      </p>
    </section>
  );
}
