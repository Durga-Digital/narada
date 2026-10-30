import { useState } from "react";
import { ArrowLeft, ArrowRight, Globe2, Mail, MapPin } from "lucide-react";
import { api, type Domain } from "../../lib/api.js";
import {
  normalizeDomainName,
  validDomainName,
} from "@narada/contracts/domain-name";
import { Field, Notice, PageHeading } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Card, CardContent } from "../../components/ui/card.js";
export interface DomainEnvironment {
  mode: "local" | "aws";
  region: string;
}
export function AddDomain({
  environment,
  back,
  added,
}: {
  environment?: DomainEnvironment;
  back: () => void;
  added: (domain: Domain) => void;
}) {
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const normalized = normalizeDomainName(name),
    valid = validDomainName(normalized);
  return (
    <>
      <Button
        variant="ghost"
        className="mb-6 -ml-3"
        onClick={back}
        disabled={busy}
      >
        <ArrowLeft size={16} />
        All domains
      </Button>
      <PageHeading
        title="Add a domain."
        description="Give your messages a recognizable sender address."
      />
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8 lg:gap-12">
        <div className="border-l border-border ml-4 pl-8 relative">
          <span className="absolute -left-4 top-0 rounded-full w-8 h-8 bg-primary text-primary-foreground grid place-items-center text-sm">
            1
          </span>
          <h2 className="font-medium text-lg">Choose your sending domain</h2>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            Use a domain or subdomain you own, such as mail.example.com.
          </p>
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              if (!valid) {
                setError(
                  "Enter a domain such as mail.example.com, without https://, a path, or an email address.",
                );
                return;
              }
              setBusy(true);
              try {
                added(
                  await api<Domain>(
                    "domains",
                    { name: normalized },
                    "POST",
                    "Domain added",
                  ),
                );
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Could not add domain",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Domain name">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
                placeholder="mail.example.com"
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                aria-describedby="domain-help"
                disabled={busy}
              />
            </Field>
            <p id="domain-help" className="text-xs text-muted-foreground">
              Enter just the domain. You’ll add DNS records with your domain
              provider in the next step.
            </p>
            <details className="rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Deployment details
              </summary>
              <div className="mt-3 space-y-2 text-muted-foreground">
                <p className="flex items-center gap-2">
                  <MapPin size={14} />
                  {environment?.region ?? "Loading region…"}
                </p>
                <p>
                  This installation uses one AWS region, set during deployment.
                  Domains are used for sending email.
                </p>
              </div>
            </details>
            {environment?.mode === "local" && (
              <Notice>
                Local development: this creates a local sending domain. No AWS
                requests or DNS changes are needed; messages stay in Mailpit.
              </Notice>
            )}
            <Notice>{error}</Notice>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding domain…" : "Add domain"}
              <ArrowRight size={16} />
            </Button>
          </form>
          <div className="relative mt-10 pt-2">
            <span className="absolute -left-12 top-1 rounded-full w-8 h-8 bg-background border text-muted-foreground grid place-items-center text-sm">
              2
            </span>
            <h2 className="font-medium text-muted-foreground">
              Review DNS records
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              We’ll show the records for your domain and guide you through
              verification.
            </p>
          </div>
        </div>
        <aside className="lg:pt-10">
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-4">
            Your sender, at a glance
          </p>
          <Card className="shadow-none overflow-hidden">
            <CardContent className="p-6">
              <div className="flex gap-3 items-start">
                <div className="rounded-full bg-primary/10 p-3 text-primary">
                  <Mail size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Your team</p>
                  <p className="text-sm text-muted-foreground break-all mt-1">
                    hello@{valid ? normalized : "mail.example.com"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    to your customer
                  </p>
                </div>
              </div>
              <div className="mt-6 border-t pt-6 space-y-3" aria-hidden="true">
                <div className="h-2 rounded-full bg-muted w-3/4" />
                <div className="h-2 rounded-full bg-muted" />
                <div className="h-2 rounded-full bg-muted w-2/3" />
              </div>
              <p className="mt-6 text-xs text-muted-foreground">
                Sender preview
              </p>
            </CardContent>
          </Card>
          <div className="flex gap-3 mt-6 text-sm text-muted-foreground">
            <Globe2 className="shrink-0 text-primary" size={18} />
            <p>
              A dedicated sending subdomain keeps your email setup organized,
              without changing your website’s address.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
