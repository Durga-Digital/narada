import { useState, type FormEvent } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import type { RecoverySender } from "@narada/contracts/owner-security";
import { authClient } from "../../lib/auth.js";
import { api, type Domain } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { ActionForm, Field, Notice, value } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { SettingsSection } from "../settings/settings-section.js";

export function PasswordSettings() {
  const [notice, setNotice] = useState("");
  return (
    <SettingsSection
      title="Password"
      description="Choose a password that’s just for Narada. Other browser sessions will be signed out."
    >
      <ActionForm
        label="Change password"
        successMessage="Password changed"
        onSubmit={async (data) => {
          setNotice("");
          const newPassword = value(data, "newPassword");
          if (newPassword !== value(data, "confirmPassword"))
            throw new Error("Your new passwords don’t match.");
          const result = await authClient.changePassword({
            currentPassword: value(data, "currentPassword"),
            newPassword,
            revokeOtherSessions: true,
          });
          if (result.error) throw new Error(result.error.message);
          setNotice(
            "Password changed. Use your new password the next time you sign in.",
          );
        }}
      >
        <div className="max-w-md">
          <Field label="Current password">
            <Input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password">
            <Input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              aria-describedby="password-hint"
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </Field>
        </div>
        <p id="password-hint" className="text-xs text-muted-foreground">
          At least 12 characters. A few memorable words work well.
        </p>
      </ActionForm>
      <Notice>{notice}</Notice>
    </SettingsSection>
  );
}

export function RecoverySettings({ email }: { email: string }) {
  const settings = useResource<RecoverySender>("profile/recovery-sender");
  const domains = useResource<Domain[]>("domains");
  return (
    <SettingsSection
      title="Recovery email"
      description="Send password-reset links from a domain you’ve verified. The same sender is used when you choose “Forgot your password?”."
    >
      {settings.data && domains.data ? (
        <RecoveryForm
          key={settings.data.revision}
          saved={settings.data}
          domains={domains.data}
          email={email}
          refresh={settings.refresh}
        />
      ) : (
        <Notice>
          {settings.error || domains.error || "Loading recovery settings…"}
        </Notice>
      )}
      {(settings.error || domains.error) && (
        <Button
          variant="outline"
          onClick={() => {
            void settings.refresh();
            void domains.refresh();
          }}
        >
          Refresh settings
        </Button>
      )}
    </SettingsSection>
  );
}

function RecoveryForm({
  saved,
  domains,
  email,
  refresh,
}: {
  saved: RecoverySender;
  domains: Domain[];
  email: string;
  refresh: () => Promise<void>;
}) {
  const verified = domains.filter((d) => d.verified && !d.removedAt);
  const [domain, setDomain] = useState(saved.domain ?? "");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const changed = domain !== saved.domain && domain !== "";
  const selectable = verified.some((d) => d.name === domain);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    try {
      await api(
        "profile/recovery-sender",
        { domain, revision: saved.revision },
        "PUT",
        "Recovery sender saved",
      );
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to save the recovery sender.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="flex items-start gap-3 rounded-lg bg-muted/60 p-4 text-sm">
        <ShieldCheck
          size={18}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-primary"
        />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            {saved.source === "deployment"
              ? "Using your deployment sender"
              : saved.available
                ? "Recovery sender saved"
                : "Recovery sender needs attention"}
          </p>
          <p className="text-muted-foreground break-all">{saved.from}</p>
          {!saved.available && (
            <p className="text-muted-foreground">
              This domain is no longer available for recovery. Choose a verified
              domain below.
            </p>
          )}
          {saved.source === "deployment" && (
            <p className="text-muted-foreground">
              This address must be verified with your email provider. Choose a
              domain below to manage your sender here.
            </p>
          )}
        </div>
      </div>
      {verified.length ? (
        <form onSubmit={save} className="grid gap-4">
          <div className="max-w-md">
            <Field label="Recovery sending domain">
              <NativeSelect
                value={domain}
                onChange={(event) => {
                  setDomain(event.target.value);
                  setNotice("");
                }}
                required
                disabled={saving || sending}
              >
                <option value="" disabled>
                  Choose a verified domain
                </option>
                {saved.domain &&
                  !verified.some((d) => d.name === saved.domain) && (
                    <option value={saved.domain} disabled>
                      {saved.domain} — unavailable
                    </option>
                  )}
                {verified.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {selectable && (
            <p className="text-xs text-muted-foreground break-all">
              Reset emails will come from security@{domain}.
            </p>
          )}
          <Button
            type="submit"
            className="justify-self-start"
            disabled={
              saving || sending || !selectable || (!changed && saved.available)
            }
          >
            {saving ? "Saving…" : "Save recovery sender"}
          </Button>
        </form>
      ) : (
        <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
          Add and verify a domain in{" "}
          <a
            href="/?page=domains"
            className="text-primary underline underline-offset-4"
          >
            Domains
          </a>{" "}
          to choose a recovery sender. You can still change your password above.
        </div>
      )}
      <div className="border-t pt-5 space-y-3">
        <p className="text-sm text-muted-foreground break-words">
          Reset links are sent only to your account email:{" "}
          <span className="text-foreground">{email}</span>.
        </p>
        <Button
          variant="outline"
          disabled={saving || sending || !saved.available || changed}
          onClick={async () => {
            setSending(true);
            setNotice("");
            try {
              const result = await authClient.requestPasswordReset({
                email,
                redirectTo: location.origin,
              });
              if (result.error) throw new Error(result.error.message);
              setNotice(
                "Reset link requested. Check your inbox; in local development, check Mailpit. Resetting your password will sign out all browser sessions and disconnect connected apps.",
              );
            } catch (error) {
              setNotice(
                error instanceof Error
                  ? error.message
                  : "Unable to request a reset link.",
              );
            } finally {
              setSending(false);
            }
          }}
        >
          <Mail size={16} aria-hidden="true" />
          {sending ? "Requesting…" : "Send reset link"}
        </Button>
        {changed && (
          <p className="text-xs text-muted-foreground">
            Save your sender before requesting a reset link.
          </p>
        )}
        <p className="text-xs text-muted-foreground leading-relaxed">
          If Amazon SES is still in sandbox mode, your account email or its
          domain must also be verified. A verified sender alone doesn’t
          guarantee delivery.
        </p>
      </div>
      <Notice>{notice}</Notice>
    </>
  );
}
