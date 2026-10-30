import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
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
import { Textarea } from "../../components/ui/textarea.js";
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
import type { PropertyDefinition, Topic } from "./types.js";
export function PropertiesPage({ navigation }: { navigation: ReactNode }) {
  const resource = useResource<PropertyDefinition[]>("properties");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<PropertyDefinition | "new">();
  return (
    <>
      <PageHeading
        title="Audience"
        description="Properties make every contact useful—and every message personal."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            Add property
          </Button>
        }
      />
      <div className="border-b pb-3 mb-6">{navigation}</div>
      <Notice>{resource.error}</Notice>
      <p className="text-sm text-muted-foreground mb-4">
        Email, name, first_name, and last_name are built in. Custom properties
        have a type and an optional personalization fallback.
      </p>
      <div className="flex gap-3 mb-4">
        <Input
          aria-label="Search properties"
          placeholder="Search properties…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <NativeSelect
          aria-label="Property type filter"
          className="max-w-48"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All types</option>
          {["string", "number", "boolean", "date"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Fallback value</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resource.data
              ?.filter(
                (p) =>
                  p.key.includes(query.toLowerCase()) &&
                  (!filter || p.type === filter),
              )
              .map((p) => (
                <TableRow key={p.key}>
                  <TableCell>
                    <ResourceIdentifier label="Property key" value={p.key} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.type}</Badge>
                  </TableCell>
                  <TableCell>
                    {p.fallback === undefined ? "—" : String(p.fallback)}
                  </TableCell>
                  <TableCell>
                    {new Date(p.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      onClick={() => setEditing(p)}
                      aria-label={`Edit property ${p.key}`}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        {resource.data?.length === 0 && (
          <p className="p-8 text-center text-muted-foreground">
            Add your first custom property.
          </p>
        )}
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Add property" : "Edit property"}
            </DialogTitle>
            <DialogDescription>
              Keys and types stay fixed after creation. Changing the fallback
              affects future broadcasts.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <PropertyForm
              key={typeof editing === "string" ? editing : editing.key}
              property={typeof editing === "string" ? undefined : editing}
              onSave={async () => {
                setEditing(undefined);
                await resource.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function PropertyForm({
  property,
  onSave,
}: {
  property?: PropertyDefinition;
  onSave: () => Promise<void>;
}) {
  const [type, setType] = useState<PropertyDefinition["type"]>(
      property?.type ?? "string",
    ),
    [fallback, setFallback] = useState(
      property?.fallback === undefined ? "" : String(property.fallback),
    );
  return (
    <ActionForm
      label="Save property"
      successMessage="Property saved"
      onSubmit={async (data) => {
        const input = {
          key: property?.key ?? value(data, "key"),
          type,
          ...(fallback === ""
            ? {}
            : { fallback: propertyInputValue(type, fallback) }),
        };
        await api(
          property ? `properties/${property.key}` : "properties",
          property ? { property: input, revision: property.revision } : input,
          property ? "PUT" : "POST",
        );
        await onSave();
      }}
    >
      {property && (
        <ResourceIdentifier label="Property key" value={property.key} />
      )}
      <Field label="Property key">
        <Input
          name="key"
          defaultValue={property?.key}
          disabled={!!property}
          required
          pattern="[a-z][a-z0-9_]{0,39}"
          placeholder="city"
        />
      </Field>
      <Field label="Property type">
        <NativeSelect
          value={type}
          disabled={!!property}
          onChange={(e) => {
            setType(e.target.value as typeof type);
            setFallback("");
          }}
        >
          {["string", "number", "boolean", "date"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Fallback value">
        <PropertyField type={type} value={fallback} onChange={setFallback} />
      </Field>
    </ActionForm>
  );
}
export function TopicsPage({ navigation }: { navigation: ReactNode }) {
  const resource = useResource<Topic[]>("topics"),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<Topic | "new">();
  return (
    <>
      <PageHeading
        title="Audience"
        description="Let subscribers choose the kinds of email they want."
        action={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            Create topic
          </Button>
        }
      />
      <div className="border-b pb-3 mb-6">{navigation}</div>
      <Notice>{resource.error}</Notice>
      <Input
        className="mb-4"
        aria-label="Search topics"
        placeholder="Search topics…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Default</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resource.data
              ?.filter((t) =>
                `${t.name} ${t.id}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    {t.name}
                    <p className="text-xs text-muted-foreground">
                      {t.description}
                    </p>
                    <ResourceIdentifier label="Topic ID" value={t.id} />
                  </TableCell>
                  <TableCell>Requires opt-in</TableCell>
                  <TableCell>{t.visibility}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t.active ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      disabled={!!t.publicationId}
                      aria-label={`Edit topic ${t.name}`}
                      onClick={() => setEditing(t)}
                    >
                      {t.publicationId ? "Managed by Newsletters" : "Edit"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        {resource.data?.length === 0 && (
          <p className="p-8 text-center text-muted-foreground">
            Create a topic such as Product updates or Market news.
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground mt-4">
        Public topics appear on the subscriber preference page. Private topics
        are shown only to existing subscribers or recipients of that topic.
        Archived topics stop queued sends. Every broadcast includes a signed
        preference link.
      </p>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Create topic" : "Edit topic"}
            </DialogTitle>
            <DialogDescription>
              Subscriptions are explicit. Imports never reverse an unsubscribe.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <TopicForm
              key={typeof editing === "string" ? editing : editing.id}
              topic={typeof editing === "string" ? undefined : editing}
              onSave={async () => {
                setEditing(undefined);
                await resource.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function TopicForm({
  topic,
  onSave,
}: {
  topic?: Topic;
  onSave: () => Promise<void>;
}) {
  return (
    <ActionForm
      label="Save topic"
      successMessage="Topic saved"
      onSubmit={async (data) => {
        const input = {
          name: value(data, "name"),
          description: value(data, "description"),
          visibility: value(data, "visibility"),
          active: data.get("active") === "on",
        };
        await api(
          topic ? `topics/${topic.id}` : "topics",
          topic ? { topic: input, revision: topic.revision } : input,
          topic ? "PUT" : "POST",
        );
        await onSave();
      }}
    >
      {topic && <ResourceIdentifier label="Topic ID" value={topic.id} />}
      <Field label="Topic name">
        <Input
          name="name"
          defaultValue={topic?.name}
          required
          maxLength={100}
        />
      </Field>
      <Field label="Topic description">
        <Textarea
          name="description"
          defaultValue={topic?.description}
          maxLength={300}
        />
      </Field>
      <Field label="Topic visibility">
        <NativeSelect
          name="visibility"
          defaultValue={topic?.visibility ?? "public"}
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
        </NativeSelect>
      </Field>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={topic?.active ?? true}
        />
        Active topic
      </label>
    </ActionForm>
  );
}
