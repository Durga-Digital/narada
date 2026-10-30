import { useState } from "react";
import { Cloud, FlaskConical, RefreshCw, ExternalLink } from "lucide-react";
import type { SesStatus } from "@narada/contracts/types";
import { useResource } from "../../hooks/use-resource.js";
import { Notice } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import { SettingsSection } from "./settings-section.js";
const number = (value: number | null | undefined) =>
  value == null ? "Unavailable" : value.toLocaleString();
export function SesSettings() {
  const { data, error, refresh } = useResource<SesStatus>("settings/ses");
  const [refreshing, setRefreshing] = useState(false);
  if (!data)
    return (
      <SettingsSection
        title="Amazon SES"
        description="Read your account status and deployment configuration."
      >
        <Notice>{error || "Loading SES configuration…"}</Notice>
        {error && (
          <Button variant="outline" onClick={() => void refresh()}>
            Try again
          </Button>
        )}
      </SettingsSection>
    );
  const local = data.mode === "local";
  const consoleUrl = `https://${encodeURIComponent(data.region)}.console.aws.amazon.com/ses/home?region=${encodeURIComponent(data.region)}#/account`;
  const account = data.account;
  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-primary/5 p-5 flex items-start gap-4">
        <div className="rounded-lg border bg-background p-2 text-primary">
          {local ? <FlaskConical size={22} /> : <Cloud size={22} />}
        </div>
        <div className="space-y-1 min-w-0">
          <h2 className="font-medium">
            {local ? "You're working locally" : "Connected to Amazon SES"}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {local
              ? "Emails are captured in Mailpit. AWS is not contacted, and no real recipients receive mail."
              : "Account limits and delivery configuration are read from your AWS deployment."}
          </p>
          {local ? (
            <a
              href="http://localhost:8025"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary mt-2"
            >
              Open Mailpit <ExternalLink size={13} />
            </a>
          ) : (
            <a
              href={consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary mt-2"
            >
              Open SES console <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
      <Notice>{error}</Notice>
      <SettingsSection
        title="Connection"
        description="These values come from your deployment configuration."
        action={
          <Badge variant="outline">{local ? "Local capture" : "AWS"}</Badge>
        }
      >
        <dl className="grid sm:grid-cols-3 gap-5 text-sm">
          <div>
            <dt className="text-muted-foreground mb-2">AWS Region</dt>
            <dd className="font-medium break-all">
              {data.region}
              {local && (
                <span className="block text-xs text-muted-foreground font-normal mt-1">
                  Configured; inactive locally
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground mb-2">Configuration set</dt>
            <dd className="font-mono break-all">{data.configurationSet}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground mb-2">Authentication</dt>
            <dd>
              {local ? "No AWS credentials used" : "Deployment AWS credentials"}
            </dd>
          </div>
        </dl>
      </SettingsSection>
      <SettingsSection
        title="Sending capacity"
        description={
          local
            ? "SES quotas and sandbox status become available after deploying to AWS."
            : "AWS account limits apply across senders in this Region. Usage covers the previous 24 hours."
        }
        action={
          !local && (
            <Button
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                try {
                  await refresh();
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
              Refresh status
            </Button>
          )
        }
      >
        {local ? (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            Account status and quotas are not applicable in local mode.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {account?.productionAccess == null
                  ? "Access status unavailable"
                  : account.productionAccess
                    ? "Production access"
                    : "Sandbox"}
              </Badge>
              <Badge variant="outline">
                {account?.sendingEnabled == null
                  ? "Sending status unavailable"
                  : account.sendingEnabled
                    ? "SES sending enabled"
                    : "SES sending disabled"}
              </Badge>
              {account?.enforcementStatus && (
                <Badge variant="outline">{account.enforcementStatus}</Badge>
              )}
            </div>
            <dl className="grid sm:grid-cols-3 gap-4">
              {[
                { label: "Recipients / second", value: account?.maxPerSecond },
                {
                  label: "Recipients / 24 hours",
                  value: account?.maxPer24Hours,
                },
                {
                  label: "Sent in last 24 hours",
                  value: account?.sentLast24Hours,
                },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-muted/50 p-4">
                  <dt className="text-xs text-muted-foreground mb-2">
                    {label}
                  </dt>
                  <dd className="text-2xl font-medium">{number(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              Last checked{" "}
              {data.checkedAt
                ? new Date(data.checkedAt).toLocaleString()
                : "unknown"}
              . Readings are cached for up to 30 seconds. Quota-aware pacing is
              not yet enabled in Narada.
            </p>
          </>
        )}
      </SettingsSection>
      <SettingsSection
        title="Delivery pool"
        description="Choose infrastructure that fits your sending volume."
      >
        <div className="flex flex-wrap gap-3 items-center">
          <Badge variant="outline">
            {local
              ? "Inactive locally"
              : data.delivery?.poolName
                ? "Named IP pool"
                : "SES default routing"}
          </Badge>
          {data.delivery?.poolName && (
            <code className="text-sm break-all">{data.delivery.poolName}</code>
          )}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Narada's default deployment uses shared IPs, suited to low-volume
          sending. Dedicated IP pools require explicit AWS provisioning and add
          cost. Pool changes are managed through your deployment.
        </p>
        {!local && (
          <dl className="grid sm:grid-cols-2 gap-4 text-sm border-t pt-4">
            <div>
              <dt className="text-muted-foreground mb-1">TLS policy</dt>
              <dd>{data.delivery?.tlsPolicy ?? "SES default"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground mb-1">
                Configuration set sending
              </dt>
              <dd>
                {data.delivery?.sendingEnabled == null
                  ? "Unavailable"
                  : data.delivery.sendingEnabled
                    ? "Enabled"
                    : "Disabled"}
              </dd>
            </div>
          </dl>
        )}
      </SettingsSection>
    </div>
  );
}
