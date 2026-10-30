import {
  useState,
  useId,
  isValidElement,
  cloneElement,
  type ReactNode,
  type FormEvent,
} from "react";
import { Label } from "./ui/label.js";
import { Button } from "./ui/button.js";
import { withFeedback } from "../lib/feedback.js";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const element = isValidElement<{ id?: string }>(children)
    ? children
    : undefined;
  const id = element?.props.id ?? generatedId;
  return (
    <div className="grid gap-2 text-sm">
      <Label htmlFor={id}>{label}</Label>
      {element ? cloneElement(element, { id }) : children}
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return children ? (
    <p
      role="status"
      className="rounded-lg border border-border bg-muted p-3 text-sm break-words"
    >
      {children}
    </p>
  ) : null;
}
export function ActionForm({
  children,
  onSubmit,
  label = "Save",
  successMessage,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  label?: string;
  successMessage?: string;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setError("");
    try {
      await withFeedback(() => onSubmit(new FormData(form)), successMessage);
      form.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      {children}
      <Notice>{error}</Notice>
      <Button disabled={pending} className="justify-self-start" type="submit">
        {pending ? "Working…" : label}
      </Button>
    </form>
  );
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-8">
      <div>
        <h1 className="serif text-4xl md:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
export const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "");
