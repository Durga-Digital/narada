import { useState } from "react";
import { Send } from "lucide-react";
import { authClient } from "../../lib/auth.js";
import { ActionForm, Field, Notice, value } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
export function Login() {
  const [mfa, setMfa] = useState(false),
    [backup, setBackup] = useState(false),
    [reset, setReset] = useState(false),
    [notice, setNotice] = useState("");
  const token = new URLSearchParams(location.search).get("token");
  return (
    <main className="min-h-screen grid place-items-center p-6 subtle-grid">
      <div className="w-full max-w-md">
        <div className="mb-10 flex items-center justify-center gap-3">
          <Send className="text-primary" />
          <span className="serif text-4xl">narada</span>
        </div>
        <Card>
          <CardContent className="p-8">
            <h1 className="serif text-3xl mb-2">
              {token
                ? "A fresh start."
                : mfa
                  ? "One more step."
                  : reset
                    ? "Welcome back, soon."
                    : "Welcome back."}
            </h1>
            <p className="text-sm text-muted-foreground mb-7">
              Your messages. Your infrastructure.
            </p>
            <ActionForm
              label={
                token
                  ? "Set password"
                  : mfa
                    ? "Verify code"
                    : reset
                      ? "Send reset link"
                      : "Sign in"
              }
              onSubmit={async (data) => {
                if (token) {
                  const r = await authClient.resetPassword({
                    newPassword: value(data, "password"),
                    token,
                  });
                  if (r.error) throw new Error(r.error.message);
                  location.href = "/";
                  return;
                }
                if (mfa) {
                  const r = backup
                    ? await authClient.twoFactor.verifyBackupCode({
                        code: value(data, "code"),
                      })
                    : await authClient.twoFactor.verifyTotp({
                        code: value(data, "code"),
                      });
                  if (r.error) throw new Error(r.error.message);
                  location.href = "/";
                  return;
                }
                if (reset) {
                  const r = await authClient.requestPasswordReset({
                    email: value(data, "email"),
                    redirectTo: location.origin,
                  });
                  if (r.error) throw new Error(r.error.message);
                  setNotice(
                    "If that account exists, a reset link is on its way. In local mode, open Mailpit.",
                  );
                  return;
                }
                const r = await authClient.signIn.email({
                  email: value(data, "email"),
                  password: value(data, "password"),
                });
                if (r.error) throw new Error(r.error.message);
                if ("twoFactorRedirect" in (r.data ?? {})) {
                  setMfa(true);
                } else {
                  location.href = "/";
                }
              }}
            >
              {!mfa && !token && (
                <Field label="Email address">
                  <Input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </Field>
              )}
              {((!reset && !mfa) || token) && (
                <Field label="Password">
                  <Input
                    name="password"
                    type="password"
                    autoComplete={token ? "new-password" : "current-password"}
                    minLength={12}
                    required
                  />
                </Field>
              )}
              {mfa && (
                <Field label={backup ? "Recovery code" : "Authenticator code"}>
                  <Input
                    name="code"
                    autoComplete="one-time-code"
                    inputMode={backup ? "text" : "numeric"}
                    required
                  />
                </Field>
              )}
            </ActionForm>
            {mfa && (
              <Button
                variant="link"
                className="px-0 mt-3"
                onClick={() => setBackup(!backup)}
              >
                {backup ? "Use authenticator code" : "Use a recovery code"}
              </Button>
            )}
            <div className="mt-4">
              <Notice>{notice}</Notice>
            </div>
            {!mfa && !token && (
              <Button
                variant="link"
                className="px-0 mt-3"
                onClick={() => setReset(!reset)}
              >
                {reset ? "Back to sign in" : "Forgot your password?"}
              </Button>
            )}
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Use the owner credentials from your installation.
        </p>
      </div>
    </main>
  );
}
