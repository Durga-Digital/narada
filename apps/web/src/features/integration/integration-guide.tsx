import { useState } from "react";
import { Check, Copy, Plug, ShieldCheck } from "lucide-react";
import { PageHeading, Field, Notice } from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Textarea } from "../../components/ui/textarea.js";
import { copyWithFeedback } from "../../lib/feedback.js";
import { integrationPrompt, type IntegrationMode } from "./prompt.js";

export function IntegrationGuide() {
  const [mode, setMode] = useState<IntegrationMode>("resend");
  const [sender, setSender] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState("");
  const [error, setError] = useState("");
  const prompt = integrationPrompt(location.origin, mode, sender);
  const copied = copiedPrompt === prompt;

  return (
    <>
      <PageHeading
        title="Bring your app along."
        description="Give your coding agent everything it needs to connect your app to Narada."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] items-start">
        <div className="space-y-6">
          <section className="rounded-xl border bg-white/60 p-5 space-y-5">
            <div className="flex items-center gap-2 font-medium">
              <Plug size={18} /> Tailor your prompt
            </div>
            <Field label="Integration type">
              <NativeSelect
                value={mode}
                onChange={(e) => setMode(e.target.value as IntegrationMode)}
              >
                <option value="resend">Migrate from Resend</option>
                <option value="new">Connect a new app</option>
              </NativeSelect>
            </Field>
            <Field label="Narada base URL">
              <Input readOnly value={location.origin} />
            </Field>
            <p className="text-xs text-muted-foreground">
              This installation. Open this page in staging or production to copy
              that environment’s URL.
            </p>
            <Field label="Sender address (optional)">
              <Input
                value={sender}
                maxLength={320}
                onChange={(e) => setSender(e.target.value)}
                placeholder="Your App <hello@example.com>"
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Use an address on a domain verified in Narada, or leave blank for
              the agent to check your app’s configuration.
            </p>
          </section>
          <section className="rounded-xl bg-primary/5 p-5 text-sm space-y-3">
            <h2 className="font-medium flex items-center gap-2">
              <ShieldCheck size={18} /> Keep your key separate
            </h2>
            <p className="text-muted-foreground">
              Create a Sending access key in API keys, scoped to your sender
              domain. Add it directly to your app’s server environment as{" "}
              <code>NARADA_API_KEY</code>.
            </p>
            <p className="text-muted-foreground">
              This prompt includes no API key. Copy it into your agent’s
              conversation inside the app you want to integrate.
            </p>
          </section>
        </div>
        <section className="min-w-0 rounded-xl border overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="font-medium">Your integration prompt</h2>
              <p className="text-xs text-muted-foreground mt-1">
                SDK setup, API contract, migration checks, and tests.
              </p>
            </div>
            <Button
              onClick={async () => {
                try {
                  await copyWithFeedback(prompt);
                  setCopiedPrompt(prompt);
                  setError("");
                } catch {
                  setError(
                    "Could not copy. Select the prompt below and copy it manually.",
                  );
                }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy prompt"}
            </Button>
          </div>
          <div className="p-5 space-y-3">
            <Notice>{error}</Notice>
            <Textarea
              aria-label="Integration prompt"
              readOnly
              value={prompt}
              spellCheck={false}
              className="h-[560px] min-h-80 resize-y font-mono text-xs leading-6 bg-muted/30"
            />
            <p className="text-xs text-muted-foreground">
              Review the prompt before sharing. Your agent will inspect the app
              and flag features that need extra migration work.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
