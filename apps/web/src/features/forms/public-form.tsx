import { useEffect, useRef, useState } from "react";
import type { Answers, FormContent } from "@narada/contracts/form-content";
import { FormPlayer } from "./form-player.js";
import { Button } from "../../components/ui/button.js";

export function PublicForm({ id }: { id: string }) {
  const [data, setData] = useState<{ version: number; content: FormContent }>(),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [pending, setPending] = useState(false);
  const submissionId = useRef(crypto.randomUUID());
  const token = useRef(new URLSearchParams(location.search).get("token"));
  useEffect(() => {
    // Keep confirmation credentials out of subsequent referrers and browser history entries.
    if (id === "confirm") {
      history.replaceState(null, "", "/forms/confirm");
      return;
    }
    const controller = new AbortController();
    fetch(`/api/forms/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        setData(result);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [id]);
  if (id === "confirm")
    return (
      <main className="min-h-dvh bg-[#fafbf8] flex items-center justify-center p-6">
        <div className="max-w-lg space-y-6">
          <p className="text-primary">narada.</p>
          <h1 className="serif text-4xl">
            {confirmed ? "Email confirmed." : "Confirm your response."}
          </h1>
          <p>
            {confirmed
              ? "Thank you. Your contact details and any selected subscription will now be processed."
              : "Confirm that you submitted this form and want to save your contact details and any subscription you selected."}
          </p>
          {error && <p role="alert">{error}</p>}
          {!confirmed && (
            <Button
              disabled={pending || !token.current}
              onClick={async () => {
                setPending(true);
                setError("");
                try {
                  const r = await fetch("/api/forms/confirm", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ token: token.current }),
                  });
                  const result = await r.json();
                  if (!r.ok) throw new Error(result.error);
                  setConfirmed(true);
                } catch (e) {
                  setError(String(e));
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "Confirming…" : "Confirm email"}
            </Button>
          )}
          {!token.current && !confirmed && (
            <p>Open the confirmation link from your email to continue.</p>
          )}
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="min-h-dvh flex items-center justify-center p-8">
        <div className="space-y-4">
          <p role="status">{error || "Opening your form…"}</p>
          {error && (
            <Button onClick={() => location.reload()}>Try again</Button>
          )}
        </div>
      </main>
    );
  return (
    <FormPlayer
      content={data.content}
      onSubmit={async (answers: Answers) => {
        const r = await fetch(
          `/api/forms/${encodeURIComponent(id)}/responses`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              version: data.version,
              submissionId: submissionId.current,
              answers,
              website: "",
            }),
          },
        );
        const result = await r.json();
        if (!r.ok) {
          const error = new Error(
            result.error || "Unable to submit this response",
          );
          if (r.status >= 400 && r.status < 500) {
            submissionId.current = crypto.randomUUID();
            Object.assign(error, { definitive: true });
          }
          throw error;
        }
      }}
    />
  );
}
