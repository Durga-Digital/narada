import { apiScopeDefinitions } from "@narada/contracts/legacy-scopes";
import { copyWithFeedback } from "../../lib/feedback.js";
import { useState } from "react";
import { Check, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { api, type Key, type Domain } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Field, Notice } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog.js";
export function CreateKeyDialog({
  close,
  created,
  apiKey,
}: {
  close: () => void;
  created: (key: Key) => void;
  apiKey?: Key;
}) {
  const domains = useResource<Domain[]>("domains");
  const [name, setName] = useState(apiKey?.name ?? ""),
    [permission, setPermission] = useState<NonNullable<Key["permission"]>>(
      apiKey?.permission ?? "sending",
    ),
    [scopes, setScopes] = useState<NonNullable<Key["scopes"]>>(
      apiKey?.scopes ??
        (apiKey && (apiKey.permission ?? "sending") === "sending"
          ? ["emails:send"]
          : []),
    ),
    [domain, setDomain] = useState(apiKey?.domain ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Key & { token: string }>();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !result) close();
      }}
    >
      <DialogContent
        showCloseButton={!result && !busy}
        onEscapeKeyDown={(e) => {
          if (result || busy) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (result || busy) e.preventDefault();
        }}
        className="max-h-[90dvh] overflow-y-auto"
      >
        <div className="rounded-xl bg-primary/10 text-primary p-3 w-fit">
          {result ? <ShieldCheck size={23} /> : <KeyRound size={23} />}
        </div>
        <DialogTitle>
          {result
            ? "Your API key is ready"
            : apiKey
              ? "Edit API key"
              : "Create API key"}
        </DialogTitle>
        <DialogDescription>
          {result
            ? "Copy this key now. Once you close this window, it cannot be displayed again."
            : apiKey
              ? "Changes apply to the next request using this key. Your existing token stays the same."
              : "Give your application only the access it needs."}
        </DialogDescription>
        {result ? (
          <div className="space-y-5">
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium break-words">{result.name}</p>
              <p className="text-muted-foreground mt-1">
                {result.permission === "full"
                  ? "Full access"
                  : result.permission === "scoped"
                    ? `Scoped access: ${result.scopes?.join(", ")}`
                    : "Sending access"}{" "}
                · {result.domain ?? "Workspace-wide"}
              </p>
            </div>
            <Field label="New API key">
              <Input
                className="font-mono text-xs"
                value={result.token}
                readOnly
                onFocus={(e) => e.target.select()}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                try {
                  await copyWithFeedback(result.token);
                  setCopied(true);
                  setError("");
                } catch {
                  setError(
                    "Clipboard unavailable. Select and copy the key above.",
                  );
                }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy API key"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Store it in your server’s environment or secret manager. Keep it
              out of browser code and source control.
            </p>
            <Notice>{error}</Notice>
            <Button className="w-full" onClick={close}>
              I have saved it
            </Button>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const settings = {
                  name: name.trim(),
                  permission,
                  ...(permission === "scoped" ? { scopes } : {}),
                  ...((permission === "sending" ||
                    (permission === "scoped" &&
                      scopes.includes("emails:send"))) &&
                  domain
                    ? { domain }
                    : {}),
                };
                if (apiKey) {
                  const key = await api<Key>(
                    `keys/${apiKey.id}`,
                    { ...settings, revision: apiKey.revision ?? 0 },
                    "PUT",
                    "API key updated",
                  );
                  created(key);
                  close();
                } else {
                  const key = await api<Key & { token: string }>(
                    "keys",
                    settings,
                    "POST",
                    "API key created — copy it before closing",
                  );
                  setResult(key);
                  const { token: _token, ...metadata } = key;
                  created(metadata);
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save key");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production application"
                required
                maxLength={80}
                autoFocus
                disabled={busy}
              />
            </Field>
            <Field label="Permission">
              <NativeSelect
                value={permission}
                onChange={(e) => {
                  setPermission(
                    e.target.value as NonNullable<Key["permission"]>,
                  );
                  if (e.target.value === "full") setDomain("");
                }}
                disabled={busy}
              >
                <option value="sending">Sending access</option>
                <option value="scoped">Scoped access</option>
                <option value="full">Full access</option>
              </NativeSelect>
            </Field>
            {permission === "scoped" && (
              <div className="space-y-4">
                <p className="text-sm font-medium">Allowed operations</p>
                {[
                  ...new Set(
                    apiScopeDefinitions.map((definition) => definition.group),
                  ),
                ].map((group) => (
                  <fieldset
                    key={group}
                    className="space-y-2 text-sm"
                    disabled={busy}
                  >
                    <legend className="font-medium mb-2">{group}</legend>
                    {apiScopeDefinitions
                      .filter((definition) => definition.group === group)
                      .map(({ scope, label }) => (
                        <label
                          key={scope}
                          className="flex items-start gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={scopes.includes(scope)}
                            onChange={(e) => {
                              setScopes(
                                e.target.checked
                                  ? [...scopes, scope]
                                  : scopes.filter((s) => s !== scope),
                              );
                              if (scope === "emails:send" && !e.target.checked)
                                setDomain("");
                            }}
                          />
                          <span>
                            {label}
                            <code className="block text-xs text-muted-foreground">
                              {scope}
                            </code>
                          </span>
                        </label>
                      ))}
                  </fieldset>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground -mt-2">
              {permission === "sending"
                ? "Send emails and retrieve their delivery status."
                : permission === "scoped"
                  ? "Contact creation does not subscribe anyone. Membership and subscription changes still require explicit consent. Creating a broadcast from a template requires both templates:read and broadcasts:write."
                  : "Access email, audience, broadcast, and template APIs across this workspace. Dashboard administration still requires sign-in."}
            </p>
            <Field label="Domain">
              <NativeSelect
                value={domain}
                disabled={
                  permission === "full" ||
                  (permission === "scoped" &&
                    !scopes.includes("emails:send")) ||
                  busy ||
                  !domains.data
                }
                onChange={(e) => setDomain(e.target.value)}
              >
                <option value="">All domains</option>
                {domains.data?.map((d) => (
                  <option value={d.name} key={d.name}>
                    {d.name}
                    {d.local ? " (local)" : !d.verified ? " (pending)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <p className="text-xs text-muted-foreground -mt-2">
              {permission === "full"
                ? "Full-access keys are workspace-wide. Choose sending or scoped access to restrict email operations to one domain."
                : "A domain restriction applies only to sending email and retrieving its status. All other scopes, including broadcast sending and template tests, apply across the workspace. Subdomains are separate."}
            </p>
            <Notice>{error || domains.error}</Notice>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !name.trim() ||
                  (permission === "scoped" && scopes.length === 0)
                }
              >
                {busy ? "Saving…" : apiKey ? "Save changes" : "Create key"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
