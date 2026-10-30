import { ContactEditor } from "./contact-editor.js";
import { useState, type ReactNode } from "react";
import { Download, Plus, Search, Users } from "lucide-react";
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
import { Badge } from "../../components/ui/badge.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog.js";
import { ContactImport } from "./contact-import.js";
import { ContactTable } from "./contact-table.js";
import {
  contactView,
  contactsCsv,
  type SubscriptionFilter,
} from "./contact-view.js";
import type { AudienceRow, ContactDirectory, ContactRow } from "./types.js";

export function ContactDirectoryPage({
  navigation,
}: {
  navigation: ReactNode;
}) {
  const resource = useResource<ContactDirectory>("contacts");
  const [search, setSearch] = useState("");
  const [audience, setAudience] = useState("");
  const [subscription, setSubscription] = useState<SubscriptionFilter>("all");
  const [page, setPage] = useState(0),
    [size, setSize] = useState(40);
  const [dialog, setDialog] = useState<"add" | "create" | undefined>();
  const [importId, setImportId] = useState("");
  const [selected, setSelected] = useState<ContactRow>();
  const [notice, setNotice] = useState("");
  const data = resource.data;
  const view = contactView(
    data?.contacts ?? [],
    audience,
    search,
    subscription,
  );
  function addContacts() {
    setImportId(
      audience || data?.audiences.find((a) => a.kind !== "dynamic")?.id || "",
    );
    setDialog(
      data?.audiences.some((a) => a.kind !== "dynamic") ? "add" : "create",
    );
  }
  function exportContacts() {
    const url = URL.createObjectURL(
      new Blob([contactsCsv(view.filtered)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "narada-contacts.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <PageHeading
        title="Audience"
        description="Your contacts, their lists, and the connections you’re building."
        action={
          <Button onClick={addContacts} disabled={!data}>
            <Plus />
            Add contacts
          </Button>
        }
      />
      <div className="flex items-center justify-between border-b pb-3 mb-6">
        {navigation}
        <Button variant="ghost" onClick={() => setDialog("create")}>
          <Users />
          Create audience
        </Button>
      </div>
      <Notice>{resource.error || notice}</Notice>
      <div
        className="grid grid-cols-3 gap-3 py-5 mb-4"
        aria-label="Contact statistics"
      >
        {[
          ["All contacts", view.total],
          ["With list consent", view.subscribed],
          ["Without list consent", view.total - view.subscribed],
        ].map(([label, count]) => (
          <div key={label} className="border-l pl-4">
            <p className="text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="text-2xl mt-2 tabular-nums">{data ? count : "—"}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(240px,1.5fr)_1fr_1fr_auto] mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search contacts"
            className="pl-9"
            placeholder="Search name, email, or multiple emails…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <NativeSelect
          aria-label="Filter by audience"
          value={audience}
          onChange={(e) => {
            setAudience(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All audiences</option>
          {data?.audiences.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Filter by list consent"
          value={subscription}
          onChange={(e) => {
            setSubscription(e.target.value as SubscriptionFilter);
            setPage(0);
          }}
        >
          <option value="all">All list consent statuses</option>
          <option value="subscribed">With list consent</option>
          <option value="unsubscribed">Without list consent</option>
        </NativeSelect>
        <Button
          variant="outline"
          aria-label="Export filtered contacts"
          title="Export filtered contacts"
          onClick={exportContacts}
          disabled={!view.filtered.length}
        >
          <Download />
          <span className="md:sr-only">Export CSV</span>
        </Button>
      </div>
      {!data ? (
        <p role="status" className="py-12 text-center text-muted-foreground">
          {resource.error
            ? "Contacts could not be loaded."
            : "Loading contacts…"}
        </p>
      ) : (
        <ContactTable
          contacts={view.filtered}
          page={page}
          size={size}
          onPage={setPage}
          onSize={(n) => {
            setSize(n);
            setPage(0);
          }}
          onSelect={setSelected}
        />
      )}
      <p className="text-xs text-muted-foreground mt-5">
        A subscriber belongs to at least one subscribed audience in this view.
        Select an audience to see its subscription status.{" "}
        {data && data.audiences.length >= 100
          ? "Showing the latest 100 audiences."
          : ""}
      </p>
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialog === "create" ? "Create an audience" : "Add contacts"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "create"
                ? "Choose a name for the list your contacts will join."
                : "Import up to 1,000 opted-in contacts per audience. Existing unsubscribe preferences are preserved."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "create" ? (
            <ActionForm
              label="Create audience"
              successMessage="Audience created"
              onSubmit={async (form) => {
                const created = await api<AudienceRow>("audiences", {
                  name: value(form, "name"),
                });
                await resource.refresh();
                setImportId(created.id);
                setAudience(created.id);
                setPage(0);
                setDialog("add");
              }}
            >
              <Field label="Audience name">
                <Input
                  name="name"
                  required
                  maxLength={100}
                  placeholder="Product updates"
                />
              </Field>
            </ActionForm>
          ) : (
            <>
              <Field label="Import into audience">
                <NativeSelect
                  value={importId}
                  onChange={(e) => setImportId(e.target.value)}
                >
                  {data?.audiences
                    .filter((a) => a.kind !== "dynamic")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              {importId && (
                <ContactImport
                  key={importId}
                  id={importId}
                  onImported={async (message) => {
                    await resource.refresh();
                    setNotice(message);
                    setAudience(importId);
                    setSearch("");
                    setSubscription("all");
                    setPage(0);
                    setDialog(undefined);
                  }}
                />
              )}
              <Button variant="ghost" onClick={() => setDialog("create")}>
                Create another audience
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="break-all">
              {selected?.name || selected?.email}
            </DialogTitle>
            <DialogDescription className="break-all">
              {selected?.email} · Subscription and consent by audience
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <ContactEditor
              key={selected.email}
              email={selected.email}
              memberships={selected.memberships}
              onSaved={resource.refresh}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
