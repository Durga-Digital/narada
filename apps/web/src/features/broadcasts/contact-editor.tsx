import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { useState } from "react";
import { api } from "../../lib/api.js";
import { useResource } from "../../hooks/use-resource.js";
import { ActionForm, Field, Notice, value } from "../../components/shared.js";
import { Input } from "../../components/ui/input.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import { PropertyField, propertyInputValue } from "./property-field.js";
import type {
  ContactDetails,
  ContactRow,
  PropertyDefinition,
} from "./types.js";
export function ContactEditor({
  email,
  memberships,
  onSaved,
}: {
  email: string;
  memberships: ContactRow["memberships"];
  onSaved: () => Promise<void>;
}) {
  const resource = useResource<ContactDetails>(
      `contacts/${encodeURIComponent(email)}`,
    ),
    properties = useResource<PropertyDefinition[]>("properties");
  if (!resource.data || !properties.data)
    return (
      <Notice>
        {resource.error || properties.error || "Loading contact…"}
      </Notice>
    );
  return (
    <>
      <ResourceIdentifier label="Contact email" value={email} />
      <ContactForm
        key={resource.data.contact.revision}
        detail={resource.data}
        definitions={properties.data}
        onSaved={async () => {
          await resource.refresh();
          await onSaved();
        }}
      />
      <div className="space-y-2 border-t pt-4 mt-4">
        <h3 className="font-medium">Segment membership</h3>
        {memberships.map((m) => (
          <div key={m.audienceId} className="text-sm">
            <p>
              {m.name}{" "}
              <Badge variant="outline">
                {m.subscribed ? "List consent" : "No list consent"}
              </Badge>
            </p>
            <ResourceIdentifier label="Segment ID" value={m.audienceId} />
            <p className="text-xs text-muted-foreground">
              {m.consentSource} · {new Date(m.addedAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
function ContactForm({
  detail,
  definitions,
  onSaved,
}: {
  detail: ContactDetails;
  definitions: PropertyDefinition[];
  onSaved: () => Promise<void>;
}) {
  const [properties, setProperties] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(detail.contact.properties).map(([k, v]) => [k, String(v)]),
    ),
  );
  const [subscribed, setSubscribed] = useState(
      new Set(detail.topics.filter((t) => t.subscribed).map((t) => t.id)),
    ),
    [notice, setNotice] = useState("");
  return (
    <>
      <Notice>
        {notice ||
          (detail.unsubscribedAll
            ? "This contact has unsubscribed from all broadcasts. Topic changes do not resume delivery."
            : "")}
      </Notice>
      <ActionForm
        label="Save contact"
        successMessage="Contact saved"
        onSubmit={async (form) => {
          const profile = {
            name: value(form, "name"),
            first_name: value(form, "first_name"),
            last_name: value(form, "last_name"),
            properties: Object.fromEntries(
              definitions
                .filter(
                  (d) =>
                    properties[d.key] !== undefined && properties[d.key] !== "",
                )
                .map((d) => [
                  d.key,
                  propertyInputValue(d.type, properties[d.key]!),
                ]),
            ),
          };
          const changes = detail.topics.filter(
            (t) => subscribed.has(t.id) !== t.subscribed,
          );
          if (
            changes.some((t) => subscribed.has(t.id)) &&
            form.get("consent") !== "on"
          )
            throw new Error("Confirm consent before subscribing to topics");
          if (changes.length && value(form, "source").trim().length < 3)
            throw new Error("Record a source for subscription changes");
          await api(
            `contacts/${encodeURIComponent(detail.contact.email)}`,
            { contact: profile, revision: detail.contact.revision },
            "PUT",
          );
          for (const t of changes)
            await api(
              `contacts/${encodeURIComponent(detail.contact.email)}/topics/${t.id}`,
              {
                subscribed: subscribed.has(t.id),
                source: value(form, "source"),
                confirmed: true,
              },
            );
          setNotice("Contact saved.");
          await onSaved();
        }}
      >
        <Field label="Display name">
          <Input
            name="name"
            defaultValue={detail.contact.name}
            maxLength={80}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <Input
              name="first_name"
              defaultValue={detail.contact.first_name}
              maxLength={80}
            />
          </Field>
          <Field label="Last name">
            <Input
              name="last_name"
              defaultValue={detail.contact.last_name}
              maxLength={80}
            />
          </Field>
        </div>
        {definitions.map((d) => (
          <Field key={d.key} label={d.key}>
            <PropertyField
              type={d.type}
              value={properties[d.key] ?? ""}
              onChange={(v) => setProperties({ ...properties, [d.key]: v })}
            />
          </Field>
        ))}
        <h3 className="font-medium border-t pt-3">Topic subscriptions</h3>
        {detail.topics
          .filter((t) => t.active || t.subscribed)
          .map((t) => (
            <label key={t.id} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!t.active}
                checked={subscribed.has(t.id)}
                onChange={(e) =>
                  setSubscribed((current) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(t.id);
                    else next.delete(t.id);
                    return next;
                  })
                }
              />
              {t.name}
              {!t.active && " (archived)"}
            </label>
          ))}
        <Field label="Subscription change source">
          <Input
            name="source"
            placeholder="Customer request or signup form"
            maxLength={200}
          />
        </Field>
        <label className="flex gap-2 text-xs">
          <input name="consent" type="checkbox" />
          The contact explicitly opted in to the selected new topics.
        </label>
      </ActionForm>
      <Button
        className="mt-4"
        variant="outline"
        disabled={detail.unsubscribedAll}
        onClick={async () => {
          try {
            await api(
              `contacts/${encodeURIComponent(detail.contact.email)}/unsubscribe`,
              {},
              "POST",
              "Contact unsubscribed from all broadcasts",
            );
            await onSaved();
          } catch (e) {
            setNotice(String(e));
          }
        }}
      >
        Unsubscribe from all broadcasts
      </Button>
    </>
  );
}
