import { DomainSetup } from "./domain-setup.js";
import { ConfirmRemovalDialog } from "../../components/confirm-removal-dialog.js";
import { useState } from "react";
import { ArrowLeft, Globe2, RefreshCw } from "lucide-react";
import { api, type Domain } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Notice } from "../../components/shared.js";
import { DomainStatus, domainDate } from "./domain-status.js";
import type { DomainEnvironment } from "./add-domain.js";
export function DomainDetail({
  domain,
  environment,
  back,
  updated,
  removed,
}: {
  domain: Domain;
  environment?: DomainEnvironment;
  back: () => void;
  updated: (domain: Domain) => void;
  removed: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [removing, setRemoving] = useState(false);
  const region = domain.region ?? environment?.region;
  return (
    <>
      <Button variant="ghost" className="mb-6 -ml-3" onClick={back}>
        <ArrowLeft size={16} />
        All domains
      </Button>
      <div className="flex flex-wrap justify-between items-start gap-5 mb-8">
        <div className="flex gap-4 min-w-0">
          <div className="rounded-xl border bg-primary/5 p-3 text-primary h-fit">
            <Globe2 size={26} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground mb-2">Sending domain</p>
            <h1 className="serif text-3xl md:text-4xl break-all">
              {domain.name}
            </h1>
            <div className="mt-3">
              <DomainStatus domain={domain} />
            </div>
          </div>
        </div>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const fresh = await api<Domain>(
                `domains/${encodeURIComponent(domain.name)}/verify`,
                {},
                "POST",
                "Domain status refreshed",
              );
              updated(fresh);
              setMessage(
                fresh.local
                  ? "Local domain is ready. No AWS verification was performed."
                  : fresh.verified
                    ? "SES confirms this domain is verified for sending."
                    : "SES has not verified this domain yet. Check the records below and try again after DNS changes propagate.",
              );
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not check verification",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
          {busy ? "Checking…" : "Check verification"}
        </Button>
      </div>
      <div className="grid sm:grid-cols-3 gap-5 border-y py-5 mb-7 text-sm">
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            {domain.local ? "Deployment region" : "AWS region"}
          </p>
          <p>{region ?? "Not recorded"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Added</p>
          <p>{domainDate(domain.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Last checked</p>
          <p>
            {domain.checkedAt
              ? new Date(domain.checkedAt).toLocaleString()
              : "Not checked yet"}
          </p>
        </div>
      </div>
      <div className="space-y-4 mb-6">
        <Notice>{error || message}</Notice>
      </div>
      {domain.local && (
        <Card className="border-primary/20 bg-primary/5 shadow-none mb-6">
          <CardContent>
            <h2 className="font-medium">Your local domain is ready</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Local sends go to Mailpit. Authentication settings below are
              previews; Narada does not contact AWS or public DNS locally.
            </p>
          </CardContent>
        </Card>
      )}
      <DomainSetup
        domain={domain}
        busy={busy}
        setBusy={setBusy}
        updated={updated}
      />
      <div className="mt-8 rounded-xl border p-5">
        <h2 className="font-medium">Remove domain</h2>
        <p className="text-sm text-muted-foreground mt-2 mb-4">
          Domain names cannot be renamed. Add the replacement domain first, then
          update your senders and remove this one. Removal keeps email history,
          SES identities, and DNS records.
        </p>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => setRemoving(true)}
        >
          Remove domain
        </Button>
      </div>
      {removing && (
        <ConfirmRemovalDialog
          title="Remove domain?"
          name={domain.name}
          action="Remove domain"
          successMessage="Domain removed from Narada"
          close={() => setRemoving(false)}
          description="Narada will reject new sends from this domain and fail queued emails when they reach the worker. In-flight submissions cannot be recalled. Scoped keys remain, but cannot send until the domain is added again. SES identities and DNS records are retained; other applications and authentication email can still use them."
          perform={(confirmation) =>
            api(
              `domains/${encodeURIComponent(domain.name)}`,
              { confirmation },
              "DELETE",
            )
          }
          completed={removed}
        />
      )}
    </>
  );
}
