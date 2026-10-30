import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import { Notice } from "../../components/shared.js";
import { SettingsSection } from "./settings-section.js";
export function SendingSettings() {
  const resource = useResource<{ mode: "local" | "aws"; paused: boolean }>(
    "settings",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <div className="space-y-6">
      <Notice>{notice || resource.error}</Notice>
      <SettingsSection
        title="Sending control"
        description="Pause new email submissions and hold queued messages until you're ready to resume."
        action={
          resource.data && (
            <Badge variant="outline">
              {resource.data.paused ? "Paused" : "Active"}
            </Badge>
          )
        }
      >
        <div className="rounded-lg bg-muted/40 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="font-medium text-sm">
              {!resource.data
                ? "Loading sending status…"
                : resource.data.paused
                  ? "Your email queue is paused"
                  : "Your email queue is running"}
            </p>
            <p className="text-sm text-muted-foreground">
              {resource.data?.mode === "local"
                ? "Messages are delivered to your local Mailpit inbox."
                : "Accepted email jobs are processed by the delivery workers."}
            </p>
          </div>
          <Button
            variant={resource.data?.paused ? "default" : "outline"}
            disabled={busy || !resource.data}
            onClick={async () => {
              setBusy(true);
              setNotice("");
              try {
                const next = !resource.data!.paused;
                await api(
                  "settings",
                  { paused: next },
                  "POST",
                  next ? "Sending paused" : "Sending resumed",
                );
                await resource.refresh();
                setNotice(
                  next
                    ? "Sending paused. Queued messages will wait."
                    : "Sending resumed.",
                );
              } catch (e) {
                setNotice(
                  e instanceof Error ? e.message : "Unable to update sending",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {resource.data?.paused ? <Play /> : <Pause />}
            {busy
              ? "Updating…"
              : resource.data?.paused
                ? "Resume sending"
                : "Pause sending"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Messages already submitted to the provider cannot be recalled. Queued
          messages still respect their expiry time. Owner password-reset emails
          use a separate authentication delivery path.
        </p>
      </SettingsSection>
      <SettingsSection
        title="Delivery behavior"
        description="How Narada handles email jobs today."
      >
        <dl className="space-y-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2 border-b pb-4">
            <dt>Temporary throttling</dt>
            <dd className="text-muted-foreground">
              Bounded retries with increasing delays
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-b pb-4">
            <dt>Uncertain submission outcomes</dt>
            <dd className="text-muted-foreground">
              Held for review to avoid duplicate sends
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt>Expired messages</dt>
            <dd className="text-muted-foreground">
              Not sent after their expiry time
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground border-t pt-4">
          Automatic SES quota pacing and domain warm-up schedules are not yet
          available.
        </p>
      </SettingsSection>
    </div>
  );
}
