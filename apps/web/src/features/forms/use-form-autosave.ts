import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import {
  formDraftInput,
  type FormContent,
} from "@narada/contracts/form-content";
import type { FormRecord } from "@narada/core/form-model";

// Database maps can return object keys in a different order. Array order still
// matters for questions and choices.
const serialize = (content: FormContent) =>
  JSON.stringify(content, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
const equal = (a: FormContent, b: FormContent) => serialize(a) === serialize(b);

export function useFormAutosave(initial: FormRecord, paused: boolean) {
  const [record, setRecord] = useState(initial);
  const [draft, setDraft] = useState(initial.draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const saved = useRef(initial);
  const latest = useRef(initial.draft);
  const blocked = useRef(false);
  const suspended = useRef(paused);
  suspended.current = paused;
  const mounted = useRef(true);
  const flight = useRef<Promise<FormRecord> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acceptRecord = useCallback((next: FormRecord) => {
    saved.current = next;
    if (mounted.current) setRecord(next);
  }, []);
  const update = useCallback((patch: Partial<FormContent>) => {
    latest.current = { ...latest.current, ...patch };
    setDraft(latest.current);
    if (!blocked.current) setError("");
  }, []);

  const flush = useCallback(
    (force = true): Promise<FormRecord> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (flight.current)
        return flight.current.then(() => (force ? flush(true) : saved.current));
      if (blocked.current)
        return Promise.reject(
          new Error("This form changed elsewhere. Choose which draft to keep."),
        );
      if (equal(latest.current, saved.current.draft))
        return Promise.resolve(saved.current);
      const run = async () => {
        if (mounted.current) {
          setSaving(true);
          setError("");
        }
        try {
          while (
            !equal(latest.current, saved.current.draft) &&
            (force || !suspended.current)
          ) {
            const parsed = formDraftInput.safeParse(latest.current);
            if (!parsed.success)
              throw new Error(
                parsed.error.issues.map((issue) => issue.message).join("; "),
              );
            const snapshot = parsed.data;
            const base = saved.current;
            let next: FormRecord;
            try {
              next = await api<FormRecord>(
                `forms/${base.id}`,
                { draft: snapshot, revision: base.revision },
                "PUT",
              );
              if (!equal(next.draft, snapshot))
                throw new Error("The saved draft changed during saving.");
            } catch (cause) {
              // A lost response can still mean the write succeeded. Read before retrying;
              // never guess a newer revision and overwrite another editor's work.
              const remote = await api<FormRecord>(`forms/${base.id}`).catch(
                () => null,
              );
              if (remote && equal(remote.draft, snapshot)) next = remote;
              else {
                if (remote && remote.revision !== base.revision) {
                  blocked.current = true;
                  if (mounted.current) setConflict(true);
                  throw new Error(
                    "This form changed elsewhere. Your edits are still here. Choose which draft to keep.",
                  );
                }
                throw cause;
              }
            }
            acceptRecord(next);
            // Do not replace the editable draft: newer keystrokes may have arrived.
          }
          return saved.current;
        } catch (cause) {
          if (mounted.current)
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to save your draft. Please retry.",
            );
          throw cause;
        } finally {
          if (mounted.current) setSaving(false);
        }
      };
      const request = run().finally(() => {
        flight.current = null;
      });
      flight.current = request;
      return request;
    },
    [acceptRecord],
  );

  const resolveConflict = useCallback(
    async (keepEdits: boolean) => {
      const remote = await api<FormRecord>(`forms/${saved.current.id}`);
      acceptRecord(remote);
      if (!keepEdits) {
        latest.current = remote.draft;
        setDraft(remote.draft);
      }
      blocked.current = false;
      setConflict(false);
      setError("");
      if (keepEdits) await flush();
    },
    [acceptRecord, flush],
  );

  const dirty = !equal(draft, record.draft);
  useEffect(() => {
    if (paused || !dirty || error || conflict) return;
    timer.current = setTimeout(() => {
      void flush(false).catch(() => {});
    }, 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, record, dirty, paused, error, conflict, flush]);
  useEffect(() => {
    mounted.current = true;
    const leaving = (event: BeforeUnloadEvent) => {
      if (equal(latest.current, saved.current.draft)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const online = () => {
      void flush(false).catch(() => {});
    };
    window.addEventListener("beforeunload", leaving);
    window.addEventListener("online", online);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", leaving);
      window.removeEventListener("online", online);
      if (timer.current) clearTimeout(timer.current);
      // Internal navigation can unmount the editor before the debounce expires.
      void flush().catch(() => {});
    };
  }, [flush]);
  return {
    record,
    draft,
    update,
    acceptRecord,
    flush,
    resolveConflict,
    dirty,
    saving,
    error,
    conflict,
  };
}
