import { useState } from "react";
import { api, type Domain } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Field, Notice } from "../../components/shared.js";
import { Panel } from "./setup-ui.js";
export function TestPanel({
  domain,
  busy,
  setBusy,
}: {
  domain: Domain;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const [to, setTo] = useState(""),
    [localPart, setLocalPart] = useState("hello"),
    [message, setMessage] = useState("");
  return (
    <Panel title="Send a domain test">
      <p className="text-sm text-muted-foreground">
        {domain.local
          ? "Send a real local message through the queue to Mailpit. This does not test internet deliverability."
          : "Send to an inbox you control, then inspect the message headers for SPF, DKIM, and DMARC. In the SES sandbox the recipient must also be verified. Normal sending costs and limits apply."}
      </p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const result = await api<{ id: string }>(
              `domains/${encodeURIComponent(domain.name)}/test`,
              { to, localPart },
              "POST",
              "Test email queued",
            );
            setMessage(
              `Test queued. Message ID: ${result.id}. Check Emails for delivery status.`,
            );
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Could not send test");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Sender address prefix">
          <Input
            required
            pattern="[a-zA-Z0-9][a-zA-Z0-9._+\-]{0,63}"
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value)}
            disabled={busy}
          />
        </Field>
        <p className="text-xs text-muted-foreground break-all">
          From: {localPart}@{domain.name}
        </p>
        <Field label="Test inbox">
          <Input
            type="email"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />
        </Field>
        <Button disabled={busy || !domain.verified}>
          {busy ? "Queuing…" : "Send test email"}
        </Button>
        <Notice>{message}</Notice>
      </form>
      {!domain.verified && (
        <p className="text-sm text-muted-foreground">
          Verify the sender domain before sending a test.
        </p>
      )}
      {domain.local && (
        <a
          href="http://localhost:8025"
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-primary underline"
        >
          Open Mailpit
        </a>
      )}
      <p className="text-xs text-muted-foreground">
        A queued or delivered status is not an authentication pass or an
        inbox-placement result. Narada cannot read the destination inbox.
      </p>
    </Panel>
  );
}
