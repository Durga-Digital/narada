import { useState } from "react";
import { Plus, Webhook } from "lucide-react";
import { api, type Endpoint } from "../../lib/api.js";
import {
  legacyWebhookEvents,
  type WebhookEventType,
} from "@narada/contracts/types";
import { useResource } from "../../hooks/use-resource.js";
import { Field, Notice, PageHeading } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog.js";
import { DeliveryHistory } from "./delivery-history.js";
import { EventPicker } from "./event-picker.js";
const localReceiver = "http://localhost:3001/api/dev/webhook-receiver";
export function Webhooks() {
  const { data, error, refresh } = useResource<{
    mode: "local" | "aws";
    endpoints: Endpoint[];
  }>("webhooks");
  const [secret, setSecret] = useState(""),
    [actionError, setError] = useState("");
  const [editing, setEditing] = useState<Endpoint | null | undefined>();
  const [url, setUrl] = useState(""),
    [events, setEvents] = useState<WebhookEventType[]>(legacyWebhookEvents);
  const [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  function open(endpoint: Endpoint | null) {
    setUrl(endpoint?.url ?? "");
    setEvents(endpoint?.events ?? legacyWebhookEvents);
    setFormError("");
    setEditing(endpoint);
  }
  return (
    <>
      <div className="flex flex-wrap gap-4 items-start justify-between">
        <PageHeading
          title="Keep your app in the loop."
          description="Choose the events your application receives. Signed deliveries, with retries built in."
        />
        <Button onClick={() => open(null)}>
          <Plus size={16} /> Add webhook
        </Button>
      </div>
      <Notice>{error || actionError}</Notice>
      {secret && (
        <Card className="mb-6">
          <CardContent>
            <p className="text-sm mb-3">
              Save this signing secret; it is only shown once.
            </p>
            <Input
              aria-label="Webhook signing secret"
              value={secret}
              readOnly
              onFocus={(e) => e.target.select()}
            />
          </CardContent>
        </Card>
      )}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(undefined);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogTitle>{editing ? "Edit webhook" : "Add webhook"}</DialogTitle>
          <DialogDescription>
            Choose a public HTTPS endpoint and the events it should receive.
          </DialogDescription>
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setFormError("");
              try {
                const result = await api<{ secret?: string }>(
                  editing ? `webhooks/${editing.id}` : "webhooks",
                  { url, events },
                  editing ? "PATCH" : "POST",
                  editing
                    ? "Webhook updated"
                    : "Webhook created — save the signing secret",
                );
                if (result.secret) setSecret(result.secret);
                setEditing(undefined);
                await refresh();
              } catch (e) {
                setFormError(
                  e instanceof Error ? e.message : "Could not save webhook",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Endpoint URL">
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhooks/narada"
                required
              />
            </Field>
            {data?.mode === "local" && (
              <div className="rounded-lg bg-muted p-3 text-xs space-y-2">
                <p>
                  The local receiver captures webhook payloads. Your dashboard
                  URL is not a receiver.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setUrl(localReceiver)}
                >
                  Use local test receiver
                </Button>
              </div>
            )}
            <EventPicker selected={events} onChange={setEvents} />
            <p className="text-xs text-muted-foreground">
              Selection changes apply to new events. Deliveries already queued
              keep their original subscription.
            </p>
            <Notice>{formError}</Notice>
            <Button
              type="submit"
              disabled={busy || !events.length}
              className="w-full"
            >
              {busy ? "Saving…" : editing ? "Save changes" : "Add endpoint"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {!data?.endpoints.length && (
        <Card className="shadow-none">
          <CardContent className="py-12 text-center">
            <Webhook className="mx-auto mb-3 text-primary" />
            <h2 className="font-medium">Connect your first endpoint</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              React to email delivery, form responses, issue publication, and
              broadcast completion.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {data?.endpoints.map((endpoint) => (
          <Card key={endpoint.id} className="shadow-none">
            <CardContent>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-all">
                    {endpoint.url}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {endpoint.events.length} event subscriptions · Signing
                    enabled
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open(endpoint)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await api(
                          `webhooks/${endpoint.id}`,
                          undefined,
                          "DELETE",
                          "Webhook removed",
                        );
                        await refresh();
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {endpoint.events.map((type) => (
                  <Badge variant="outline" key={type}>
                    {type}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <DeliveryHistory endpoints={data?.endpoints ?? []} />
    </>
  );
}
