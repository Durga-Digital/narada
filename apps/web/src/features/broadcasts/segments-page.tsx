import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import {
  ActionForm,
  Field,
  Notice,
  PageHeading,
  value,
} from "../../components/shared.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Badge } from "../../components/ui/badge.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog.js";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "../../components/ui/table.js";
import { PropertyField, propertyInputValue } from "./property-field.js";
import { ContactImport } from "./contact-import.js";
import type {
  AudienceRow,
  AudienceDetail,
  PropertyDefinition,
  SegmentRule,
} from "./types.js";
export function SegmentsPage({ navigation }: { navigation: ReactNode }) {
  const resource = useResource<AudienceRow[]>("segments"),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<AudienceRow | "new">(),
    [selected, setSelected] = useState<AudienceRow>();
  return (
    <>
      <PageHeading
        title="Audience"
        description="Group contacts manually or keep them up to date with property rules."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            Create segment
          </Button>
        }
      />
      <div className="border-b pb-3 mb-6">{navigation}</div>
      <Notice>{resource.error}</Notice>
      <Input
        className="mb-4"
        aria-label="Search segments"
        placeholder="Search segments…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Contacts</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resource.data
              ?.filter((s) =>
                `${s.name} ${s.id}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <button
                      className="font-medium hover:underline"
                      onClick={() => setSelected(s)}
                    >
                      {s.name}
                    </button>
                    <ResourceIdentifier label="Segment ID" value={s.id} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.kind ?? "manual"}</Badge>
                  </TableCell>
                  <TableCell>{s.total}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      disabled={!!s.publicationId}
                      aria-label={`Edit segment ${s.name}`}
                      onClick={() => setEditing(s)}
                    >
                      {s.publicationId ? "Managed by Newsletters" : "Edit"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        {resource.data?.length === 0 && (
          <p className="p-8 text-center text-muted-foreground">
            Create your first segment.
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground mt-4">
        Use a segment ID to add existing contacts to a manual segment. For
        dynamic segments, save contact properties that match its rules.
        Membership does not grant marketing permission. Topic subscriptions and
        recorded list consent are separate. Broadcasts use this ID as
        audienceId. Up to 1,000 recipients per broadcast.
      </p>
      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(undefined);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Create segment" : "Edit segment"}
            </DialogTitle>
            <DialogDescription>
              Dynamic rules evaluate current property values, without
              personalization fallbacks.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <SegmentForm
              key={typeof editing === "string" ? editing : editing.id}
              segment={typeof editing === "string" ? undefined : editing}
              onSave={async () => {
                setEditing(undefined);
                await resource.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(undefined);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              Current matching contacts and separately recorded list consent.
              Topic subscriptions are shown on each contact.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <ResourceIdentifier label="Segment ID" value={selected.id} />
              <SegmentMembers key={selected.id} segment={selected} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function SegmentForm({
  segment,
  onSave,
}: {
  segment?: AudienceRow;
  onSave: () => Promise<void>;
}) {
  const properties = useResource<PropertyDefinition[]>("properties");
  const [kind, setKind] = useState(segment?.kind ?? "manual"),
    [match, setMatch] = useState(segment?.match ?? "all"),
    [rules, setRules] = useState<SegmentRule[]>(
      segment?.rules ?? [
        { property: "email", operator: "contains", value: "" },
      ],
    );
  const definitions = [
    ...["email", "name", "first_name", "last_name"].map((key) => ({
      key,
      type: "string" as const,
    })),
    ...(properties.data ?? []),
  ];
  const update = (i: number, patch: Partial<SegmentRule>) =>
    setRules((rows) =>
      rows.map((r, index) => (index === i ? { ...r, ...patch } : r)),
    );
  return (
    <ActionForm
      label="Save segment"
      successMessage="Segment saved"
      onSubmit={async (form) => {
        const data = {
          name: value(form, "name"),
          kind,
          match,
          rules: kind === "dynamic" ? rules : [],
        };
        await api(
          segment ? `segments/${segment.id}` : "segments",
          segment ? { segment: data, revision: segment.revision } : data,
          segment ? "PUT" : "POST",
        );
        await onSave();
      }}
    >
      {segment && <ResourceIdentifier label="Segment ID" value={segment.id} />}
      <Field label="Segment name">
        <Input
          name="name"
          defaultValue={segment?.name}
          required
          maxLength={100}
        />
      </Field>
      <Field label="Segment type">
        <NativeSelect
          value={kind}
          disabled={!!segment}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="manual">Manual membership</option>
          <option value="dynamic">Dynamic rules</option>
        </NativeSelect>
      </Field>
      {kind === "dynamic" && (
        <>
          <Field label="Match rules">
            <NativeSelect
              value={match}
              onChange={(e) => setMatch(e.target.value as typeof match)}
            >
              <option value="all">All rules (AND)</option>
              <option value="any">Any rule (OR)</option>
            </NativeSelect>
          </Field>
          {rules.map((r, i) => {
            const type =
              definitions.find((d) => d.key === r.property)?.type ?? "string";
            return (
              <div
                key={i}
                className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2"
              >
                <NativeSelect
                  aria-label={`Rule ${i + 1} property`}
                  value={r.property}
                  onChange={(e) =>
                    update(i, { property: e.target.value, value: undefined })
                  }
                >
                  {definitions.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.key}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label={`Rule ${i + 1} operator`}
                  value={r.operator}
                  onChange={(e) =>
                    update(i, {
                      operator: e.target.value as SegmentRule["operator"],
                    })
                  }
                >
                  {[
                    "equals",
                    "not_equals",
                    "contains",
                    "greater_than",
                    "less_than",
                    "is_set",
                    "is_not_set",
                  ].map((op) => (
                    <option key={op} value={op}>
                      {op.replaceAll("_", " ")}
                    </option>
                  ))}
                </NativeSelect>
                {!["is_set", "is_not_set"].includes(r.operator) ? (
                  <Field label={`Rule ${i + 1} value`}>
                    <PropertyField
                      type={type}
                      value={r.value === undefined ? "" : String(r.value)}
                      onChange={(v) =>
                        update(i, { value: propertyInputValue(type, v) })
                      }
                    />
                  </Field>
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove rule ${i + 1}`}
                  onClick={() =>
                    setRules((rows) => rows.filter((_, index) => index !== i))
                  }
                >
                  <X />
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            disabled={rules.length >= 10}
            onClick={() =>
              setRules([
                ...rules,
                { property: "email", operator: "contains", value: "" },
              ])
            }
          >
            Add rule
          </Button>
        </>
      )}
    </ActionForm>
  );
}
function SegmentMembers({ segment }: { segment: AudienceRow }) {
  const [error, setError] = useState("");
  const resource = useResource<AudienceDetail>(`audiences/${segment.id}`),
    [importing, setImporting] = useState(false);
  return (
    <>
      <Notice>{error || resource.error}</Notice>
      {segment.kind !== "dynamic" && (
        <Button variant="outline" onClick={() => setImporting(!importing)}>
          {importing ? "Hide import" : "Add contacts to segment"}
        </Button>
      )}
      {importing && (
        <ContactImport
          id={segment.id}
          onImported={async () => {
            setImporting(false);
            await resource.refresh();
          }}
        />
      )}
      <p className="text-sm">{resource.data?.contacts.length ?? 0} contacts</p>
      <div className="max-h-80 overflow-y-auto">
        {resource.data?.contacts.map((c) => (
          <div
            key={c.email}
            className="flex justify-between gap-2 border-b py-3 text-sm"
          >
            <span className="break-all">{c.email}</span>
            <Badge variant="outline">
              {c.subscribed ? "List consent" : "No list consent"}
            </Badge>
            {segment.kind !== "dynamic" && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${c.email} from segment`}
                onClick={async () => {
                  try {
                    await api(
                      `segments/${segment.id}/contacts/${encodeURIComponent(c.email)}`,
                      undefined,
                      "DELETE",
                      "Segment membership updated",
                    );
                    await resource.refresh();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
