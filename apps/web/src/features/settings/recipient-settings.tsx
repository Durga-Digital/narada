import { useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { api, type Suppression } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { ActionForm, Field, Notice, value } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import { SettingsSection } from "./settings-section.js";
export function RecipientSettings() {
  const resource = useResource<Suppression[]>("suppressions");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<string>();
  const rows =
    resource.data?.filter((s) =>
      `${s.email} ${s.reason}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  return (
    <div className="space-y-6">
      <Notice>{notice || resource.error}</Notice>
      <SettingsSection
        title="Recipient protection"
        description="Hard bounces and complaints automatically prevent future sends to affected addresses."
      >
        <div className="flex items-start gap-3 rounded-lg bg-primary/5 p-4 text-sm">
          <ShieldCheck size={20} className="shrink-0 text-primary" />
          <p className="text-muted-foreground leading-relaxed">
            Use suppressions to block an address across transactional emails and
            broadcasts. Audience subscription preferences are managed separately
            in Audience.
          </p>
        </div>
        <ActionForm
          label="Suppress address"
          successMessage="Address suppressed"
          onSubmit={async (d) => {
            await api("suppressions", { email: value(d, "email") });
            await resource.refresh();
            setNotice(
              "Address suppressed. Future sends to this recipient are blocked.",
            );
          }}
        >
          <Field label="Email address">
            <Input
              name="email"
              type="email"
              required
              placeholder="recipient@example.com"
              className="max-w-md"
            />
          </Field>
        </ActionForm>
      </SettingsSection>
      <SettingsSection
        title="Suppressed recipients"
        description="Review recipient consent and resolve delivery issues before removing a suppression."
      >
        <div className="relative max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-3 text-muted-foreground"
          />
          <Input
            aria-label="Search suppressed recipients"
            className="pl-9"
            placeholder="Search by email or reason…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!resource.data ? (
          <Notice>{resource.error || "Loading suppressed recipients…"}</Notice>
        ) : rows.length ? (
          <ul className="divide-y border-y">
            {rows.map((s) => (
              <li
                key={s.email}
                className="flex items-center justify-between gap-3 py-4 text-sm"
              >
                <div className="min-w-0 space-y-2">
                  <p className="break-all font-medium">{s.email}</p>
                  <Badge variant="outline">{s.reason}</Badge>
                </div>
                <Button
                  variant="ghost"
                  className="shrink-0"
                  disabled={!!removing}
                  aria-label={`Remove suppression for ${s.email}`}
                  onClick={async () => {
                    setRemoving(s.email);
                    setNotice("");
                    try {
                      await api(
                        `suppressions/${encodeURIComponent(s.email)}`,
                        undefined,
                        "DELETE",
                        "Suppression removed",
                      );
                      await resource.refresh();
                      setNotice("Suppression removed.");
                    } catch (e) {
                      setNotice(
                        e instanceof Error
                          ? e.message
                          : "Unable to remove suppression",
                      );
                    } finally {
                      setRemoving(undefined);
                    }
                  }}
                >
                  {removing === s.email ? "Removing…" : "Remove"}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed py-10 px-4 text-center text-sm text-muted-foreground">
            {query
              ? "No recipients match your search."
              : "No suppressed recipients. New suppressions will appear here."}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
