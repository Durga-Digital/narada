import { useResource } from "../../hooks/use-resource.js";
import type { Topic } from "./types.js";
import { useState } from "react";
import { api } from "../../lib/api.js";
import { ActionForm, Field, Notice, value } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";
export function ContactImport({
  id,
  onImported,
}: {
  id: string;
  onImported: (message: string) => Promise<void>;
}) {
  const topics = useResource<Topic[]>("topics");
  const [csv, setCsv] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <>
      <Notice>{notice}</Notice>
      <ActionForm
        label="Import contacts"
        successMessage="Contact import completed"
        onSubmit={async (data) => {
          const result = await api<{ added: number; duplicates: number }>(
            `audiences/${id}/import`,
            {
              csv,
              consentSource: value(data, "source"),
              consentConfirmed: data.get("consent") === "on",
              topicIds: data.getAll("topic"),
            },
          );
          setNotice(
            `${result.added} contacts added. ${result.duplicates} existing contacts left unchanged.`,
          );
          setCsv("");
          await onImported(
            `${result.added} contacts added. ${result.duplicates} existing contacts left unchanged.`,
          );
        }}
      >
        <Field label="CSV file">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                if (file.size > 180000) {
                  setNotice("Use a CSV smaller than 180 KB.");
                  return;
                }
                setCsv(await file.text());
              }
            }}
          />
        </Field>
        <Field label="Email addresses or CSV">
          <Textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={6}
            required
            placeholder={"email,name\nyou@example.com,Alex"}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          One email per line, or a CSV headed email,name,first_name,last_name
          plus custom property keys. Create custom properties first. Existing
          contact values and opt-outs are preserved.
        </p>
        {topics.data?.some((t) => t.active) && (
          <fieldset className="grid gap-2 rounded-lg border p-3">
            <legend className="text-sm px-1">Topic opt-ins (optional)</legend>
            {topics.data
              .filter((t) => t.active)
              .map((t) => (
                <label key={t.id} className="text-sm flex gap-2">
                  <input name="topic" type="checkbox" value={t.id} />
                  {t.name}
                </label>
              ))}
            <p className="text-xs text-muted-foreground">
              Select only topics covered by the contacts’ explicit consent.
              Existing opt-outs are never reversed.
            </p>
          </fieldset>
        )}
        <Field label="Consent source">
          <Input
            name="source"
            required
            minLength={3}
            maxLength={200}
            placeholder="Newsletter signup form — October 2026"
          />
        </Field>
        <label className="flex items-start gap-2 text-xs leading-5">
          <input name="consent" type="checkbox" required className="mt-1" />
          These contacts opted in to this audience and any selected topics.
        </label>
      </ActionForm>
    </>
  );
}
