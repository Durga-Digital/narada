import { ConnectedApps } from "../connections/connected-apps.js";
import { useState } from "react";
import { authClient } from "../../lib/auth.js";
import { ActionForm, Field, Notice, value } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { SettingsSection } from "./settings-section.js";
export function SecuritySettings() {
  const [enrollment, setEnrollment] = useState<{
    totpURI: string;
    backupCodes: string[];
  }>();
  const [notice, setNotice] = useState("");
  return (
    <div className="space-y-6">
      <Notice>{notice}</Notice>
      <ConnectedApps />
      <SettingsSection
        title="Two-factor authentication"
        description="Add an authenticator app to protect your Narada account. You'll use a one-time code when signing in."
      >
        {enrollment ? (
          <>
            <p className="text-xs mb-3">
              Add this URI to your authenticator. Save the recovery codes
              securely.
            </p>
            <pre className="p-3 bg-muted rounded-lg text-xs whitespace-pre-wrap break-all">
              {enrollment.totpURI}
              {"\n\n"}
              {enrollment.backupCodes.join("\n")}
            </pre>
            <ActionForm
              label="Verify and enable"
              successMessage="Two-factor authentication enabled"
              onSubmit={async (d) => {
                const r = await authClient.twoFactor.verifyTotp({
                  code: value(d, "code"),
                });
                if (r.error) throw new Error(r.error.message);
                setEnrollment(undefined);
                setNotice("Two-factor authentication enabled.");
              }}
            >
              <Field label="Authenticator code">
                <Input name="code" required />
              </Field>
            </ActionForm>
          </>
        ) : (
          <ActionForm
            label="Set up authenticator"
            successMessage="Authenticator setup ready — verify your code to finish"
            onSubmit={async (d) => {
              const r = await authClient.twoFactor.enable({
                password: value(d, "password"),
              });
              if (r.error) throw new Error(r.error.message);
              if (r.data.method !== "totp")
                throw new Error("Authenticator enrollment unavailable");
              setEnrollment(r.data);
            }}
          >
            <Field label="Password to set up authenticator">
              <Input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
          </ActionForm>
        )}
      </SettingsSection>
      <p className="text-sm text-muted-foreground">
        Account security is managed by your self-hosted Better Auth instance.
      </p>
    </div>
  );
}
