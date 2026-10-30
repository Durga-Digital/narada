import { useState } from "react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { Button } from "../../components/ui/button.js";
import { Notice } from "../../components/shared.js";
import type { FormContent } from "@narada/contracts/form-content";
import type { FormResponse } from "@narada/core/form-model";
import type { FormPage } from "./forms.js";
export function FormResponses({ id }: { id: string }) {
  const resource = useResource<FormPage<FormResponse>>(
    `forms/${id}/responses?limit=20`,
  );
  const [extra, setExtra] = useState<FormResponse[]>([]),
    [cursor, setCursor] = useState<string | null>(),
    [selected, setSelected] = useState<string>(),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const next = cursor === undefined ? resource.data?.nextCursor : cursor;
  if (selected)
    return (
      <ResponseDetail
        formId={id}
        id={selected}
        back={() => {
          setSelected(undefined);
          setExtra([]);
          setCursor(undefined);
          void resource.refresh();
        }}
      />
    );
  const rows = [...(resource.data?.data ?? []), ...extra];
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="serif text-3xl">Every answer matters.</h2>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => {
              setExtra([]);
              setCursor(undefined);
              void resource.refresh();
            }}
          >
            Refresh responses
          </Button>
          <Button
            variant="outline"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              setError("");
              try {
                const parts: string[] = [];
                let position = "";
                do {
                  const result = await fetch(
                    `/api/admin/forms/${id}/export${position ? `?cursor=${encodeURIComponent(position)}` : ""}`,
                  );
                  if (!result.ok)
                    throw new Error(
                      "Unable to export responses. Please try again.",
                    );
                  parts.push(await result.text());
                  position = result.headers.get("x-next-cursor") ?? "";
                } while (position);
                const url = URL.createObjectURL(
                  new Blob(parts, { type: "text/csv;charset=utf-8" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `form-${id}-responses.csv`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Export failed");
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? "Exporting…" : "Export all CSV"}
          </Button>
        </div>
      </div>
      <Notice>{error || resource.error}</Notice>
      <p className="text-xs text-muted-foreground">
        Processing shows contact and email queue status. Check Emails for
        delivery outcomes.
      </p>
      <div className="overflow-x-auto border rounded-xl">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted">
            <tr>
              {["Respondent", "Submitted", "Version", "Processing"].map((h) => (
                <th key={h} className="p-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="p-4">
                  <button
                    className="text-primary underline text-left break-all"
                    onClick={() => setSelected(row.id)}
                  >
                    {row.email || "Anonymous response"}
                  </button>
                </td>
                <td className="p-4 whitespace-nowrap">
                  {new Date(row.createdAt).toLocaleString()}
                </td>
                <td className="p-4">v{row.version}</td>
                <td className="p-4">{row.status.replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <Notice>
          {resource.data
            ? "No responses yet. Share your published form to start a conversation."
            : "Loading responses…"}
        </Notice>
      )}
      {next && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              const page = await api<FormPage<FormResponse>>(
                `forms/${id}/responses?limit=20&cursor=${encodeURIComponent(next)}`,
              );
              setExtra((r) => [...r, ...page.data]);
              setCursor(page.nextCursor);
            } catch (e) {
              setError(String(e));
            } finally {
              setPending(false);
            }
          }}
        >
          Load more responses
        </Button>
      )}
    </section>
  );
}
function ResponseDetail({
  formId,
  id,
  back,
}: {
  formId: string;
  id: string;
  back: () => void;
}) {
  const resource = useResource<{
    response: FormResponse;
    content: FormContent;
  }>(`forms/${formId}/responses/${id}`);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const r = resource.data?.response;
  return (
    <div className="space-y-5 max-w-2xl">
      <Button variant="ghost" onClick={back}>
        ← Responses
      </Button>
      <Notice>{error || resource.error}</Notice>
      {r && (
        <>
          <h2 className="serif text-3xl">{r.email || "Anonymous response"}</h2>
          <p className="text-sm text-muted-foreground">
            {new Date(r.createdAt).toLocaleString()} · Version {r.version} ·{" "}
            {r.status.replaceAll("_", " ")}
          </p>
          <dl className="space-y-5">
            {resource.data?.content.questions.map((q) => (
              <div key={q.id} className="border-b pb-4">
                <dt className="font-medium mb-2">{q.label}</dt>
                <dd className="text-sm whitespace-pre-wrap break-words">
                  {typeof r.answers[q.id] === "boolean"
                    ? r.answers[q.id]
                      ? "Yes"
                      : "No"
                    : String(r.answers[q.id] ?? "Not answered")}
                </dd>
              </div>
            ))}
          </dl>
          {r.verifiedAt && (
            <p className="text-sm">
              Email confirmed: {new Date(r.verifiedAt).toLocaleString()}
            </p>
          )}
          {r.syncedAt && (
            <p className="text-sm">
              Contact saved: {new Date(r.syncedAt).toLocaleString()}
            </p>
          )}
          <Notice>{r.error}</Notice>
          {r.verificationMessageId && (
            <p className="text-xs break-all">
              Verification email ID: {r.verificationMessageId}
            </p>
          )}
          {r.acknowledgmentMessageId && (
            <p className="text-xs break-all">
              Acknowledgment email ID: {r.acknowledgmentMessageId}
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => void resource.refresh()}>
              Refresh status
            </Button>
            {r.status === "failed" && (
              <Button
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    await api(`forms/${formId}/responses/${id}/retry`, {});
                    await resource.refresh();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Retry processing
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
