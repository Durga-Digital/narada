import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { useState } from "react";
import {
  ArrowUpRight,
  Inbox,
  Send,
  CheckCheck,
  Clock,
  TriangleAlert,
} from "lucide-react";
import {
  api,
  type Domain,
  type MessageMetadata,
  type Overview,
} from "../../lib/api.js";
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
import { ListNoResults } from "../../components/resource-list.js";
import { Textarea } from "../../components/ui/textarea.js";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent } from "../../components/ui/card.js";
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
function sendingDomain(from: string) {
  return (
    from.replace(/.*</, "").replace(/>$/, "").split("@")[1]?.toLowerCase() ?? ""
  );
}
export function Emails() {
  const { data, error, refresh } = useResource<Overview>("overview", 3000);
  const domains = useResource<Domain[]>("domains");
  const [compose, setCompose] = useState(false),
    [selected, setSelected] = useState<string>(),
    [query, setQuery] = useState(""),
    [tagKey, setTagKey] = useState(""),
    [tagValue, setTagValue] = useState(""),
    [domain, setDomain] = useState("");
  const tagKeys = [
    ...new Set(
      (data?.messages ?? []).flatMap((m) => Object.keys(m.input.tags ?? {})),
    ),
  ].sort();
  const tagValues = [
    ...new Set(
      (data?.messages ?? []).flatMap((m) =>
        Object.hasOwn(m.input.tags ?? {}, tagKey)
          ? [m.input.tags![tagKey]!]
          : [],
      ),
    ),
  ].sort();
  const domainOptions = [
    ...new Set([
      ...(domains.data ?? []).map((d) => d.name.toLowerCase()),
      ...(data?.messages ?? []).map((m) => sendingDomain(m.input.from)),
      domain,
    ]),
  ]
    .filter(Boolean)
    .sort();
  const filtered = (data?.messages ?? []).filter(
    (m) =>
      (!domain || sendingDomain(m.input.from) === domain) &&
      (!tagKey ||
        (Object.hasOwn(m.input.tags ?? {}, tagKey) &&
          (!tagValue || m.input.tags![tagKey] === tagValue))) &&
      `${m.input.to} ${m.input.subject} ${m.id}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const message = data?.messages.find((m) => m.id === selected);
  return (
    <>
      <PageHeading
        title="Good things, delivered."
        description="A little less between you and your next message."
        action={
          <Button onClick={() => setCompose(true)}>
            <Send />
            Send an email
          </Button>
        }
      />
      <Notice>{error}</Notice>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total messages", value: data?.stats.total, icon: Send },
          {
            label: "Accepted / delivered",
            value: data?.stats.delivered,
            icon: CheckCheck,
          },
          { label: "In the queue", value: data?.stats.queued, icon: Clock },
          {
            label: "Needs attention",
            value: data?.stats.failed,
            icon: TriangleAlert,
          },
        ].map((s) => (
          <Card key={s.label} className="shadow-none">
            <CardContent className="pt-1">
              <div className="flex justify-between text-muted-foreground text-xs">
                <span>{s.label}</span>
                <s.icon size={16} />
              </div>
              <p className="mt-4 text-3xl tracking-tight">{s.value ?? "—"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {data?.mode === "local" && (
        <div className="mb-8 flex flex-wrap gap-4 justify-between items-center rounded-xl border border-primary/15 bg-accent/50 p-5">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <div>
              <p className="text-sm font-medium">Your local delivery room</p>
              <p className="text-xs text-muted-foreground mt-1">
                Messages are captured in Mailpit. Nothing leaves your machine.
              </p>
            </div>
          </div>
          <Button variant="outline" asChild>
            <a href="http://localhost:8025" target="_blank" rel="noreferrer">
              Open Mailpit
              <ArrowUpRight />
            </a>
          </Button>
        </div>
      )}
      {data?.paused && (
        <Notice>Sending is paused. Resume it in Settings.</Notice>
      )}
      <Card className="shadow-none overflow-hidden">
        <CardContent className="px-0">
          <div className="px-6 flex flex-wrap justify-between items-center gap-4 pb-5">
            <div>
              <h2 className="font-medium">Recent emails</h2>
              <p className="text-xs mt-1 text-muted-foreground">
                {domain || query.trim() || tagKey
                  ? `${filtered.length} matching ${filtered.length === 1 ? "email" : "emails"} within the latest 100 messages`
                  : "Latest 100 messages"}{" "}
                · refreshes automatically
              </p>
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 w-full xl:w-auto">
              <Input
                aria-label="Search emails"
                className="w-full sm:w-64"
                placeholder="Search recipient, subject or ID…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <NativeSelect
                aria-label="Filter emails by sending domain"
                className="w-full sm:w-64"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              >
                <option value="">All sending domains</option>
                {domainOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Filter emails by tag key"
                value={tagKey}
                onChange={(e) => {
                  setTagKey(e.target.value);
                  setTagValue("");
                }}
              >
                <option value="">All tags</option>
                {tagKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Filter emails by tag value"
                value={tagValue}
                disabled={!tagKey}
                onChange={(e) => setTagValue(e.target.value)}
              >
                <option value="">All tag values</option>
                {tagValues.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Recipient / subject</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent at</TableHead>
                <TableHead>
                  <span className="sr-only">Details</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="pl-6 py-4">
                    <div className="font-medium">{m.input.to.join(", ")}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {m.input.subject}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      From {m.input.from}
                    </div>
                    <ResourceIdentifier label="Email ID" value={m.id} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(m.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelected(m.id)}
                    >
                      Details
                      <ArrowUpRight />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data &&
          filtered.length === 0 &&
          (domain || query.trim() || tagKey) ? (
            <ListNoResults
              noun="recent emails"
              onClear={() => {
                setDomain("");
                setQuery("");
                setTagKey("");
                setTagValue("");
              }}
            />
          ) : (
            data?.messages.length === 0 && (
              <div className="text-center py-16">
                <Inbox className="mx-auto text-primary/50 mb-4" size={32} />
                <h3 className="serif text-2xl">
                  Every conversation starts somewhere.
                </h3>
                <p className="text-sm text-muted-foreground mt-2 mb-5">
                  Send your first transactional email to see it here.
                </p>
                <Button variant="outline" onClick={() => setCompose(true)}>
                  Compose your first email
                </Button>
              </div>
            )
          )}
        </CardContent>
      </Card>
      <Dialog open={compose} onOpenChange={setCompose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send an email</DialogTitle>
            <DialogDescription>
              {data?.mode === "local"
                ? "Use any address at narada.test. Open Mailpit to see the result."
                : "Use an address on a verified sending domain."}
            </DialogDescription>
          </DialogHeader>
          <ActionForm
            label="Send email"
            successMessage="Email queued"
            onSubmit={async (d) => {
              await api("send", {
                from: value(d, "from"),
                to: value(d, "to"),
                subject: value(d, "subject"),
                text: value(d, "text"),
              });
              setCompose(false);
              await refresh();
            }}
          >
            <Field label="From">
              <Input
                name="from"
                defaultValue={data?.mode === "local" ? "hello@narada.test" : ""}
                required
              />
            </Field>
            <Field label="To">
              <Input
                name="to"
                type="email"
                placeholder="you@example.com"
                required
              />
            </Field>
            <Field label="Subject">
              <Input name="subject" required />
            </Field>
            <Field label="Message">
              <Textarea name="text" rows={5} required />
            </Field>
          </ActionForm>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(undefined)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {message?.input.subject ?? "Message details"}
            </DialogTitle>
            <DialogDescription className="break-all">
              {selected && (
                <ResourceIdentifier label="Email ID" value={selected} />
              )}
            </DialogDescription>
          </DialogHeader>
          {message && (
            <MessageDetails
              id={message.id}
              local={data?.mode === "local"}
              refresh={refresh}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function StatusBadge({ status }: { status: MessageMetadata["status"] }) {
  return (
    <Badge
      variant={
        ["failed", "bounced", "complained", "unknown"].includes(status)
          ? "destructive"
          : "secondary"
      }
      className="capitalize"
    >
      {status}
    </Badge>
  );
}
function MessageDetails({
  id,
  local,
  refresh,
}: {
  id: string;
  local: boolean;
  refresh: () => Promise<void>;
}) {
  const resource = useResource<MessageMetadata>(`messages/${id}`, 2000);
  if (!resource.data)
    return <Notice>{resource.error || "Loading message…"}</Notice>;
  return (
    <MessageDetail
      message={resource.data}
      local={local}
      refresh={async () => {
        await resource.refresh();
        await refresh();
      }}
    />
  );
}
function MessageDetail({
  message,
  local,
  refresh,
}: {
  message: MessageMetadata;
  local: boolean;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  return (
    <div className="grid gap-4 text-sm">
      <StatusBadge status={message.status} />
      <p>
        From {message.input.from}
        <br />
        To {message.input.to.join(", ")}
      </p>
      <p className="bg-muted p-4 rounded-lg text-xs text-muted-foreground">
        Delivery logs show metadata only. Email bodies are not available here.
      </p>
      <dl className="grid gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Priority</dt>
          <dd className="capitalize">{message.input.priority ?? "normal"}</dd>
        </div>
        {message.input.reply_to && (
          <div>
            <dt className="text-muted-foreground">Reply to</dt>
            <dd>{message.input.reply_to}</dd>
          </div>
        )}
        {message.providerId && (
          <div>
            <dt className="text-muted-foreground">Provider message ID</dt>
            <dd className="font-mono break-all">{message.providerId}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted-foreground">Send attempts</dt>
          <dd>{message.attempts}</dd>
        </div>
      </dl>
      <div>
        <h3 className="font-medium mb-2">Tags</h3>
        {Object.keys(message.input.tags ?? {}).length ? (
          <dl className="grid gap-2 text-xs">
            {Object.entries(message.input.tags ?? {}).map(([key, value]) => (
              <div key={key} className="grid grid-cols-2 gap-3 break-words">
                <dt className="text-muted-foreground">{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">No tags attached.</p>
        )}
      </div>
      <Notice>{message.error ?? error}</Notice>
      <h3 className="font-medium">Delivery timeline</h3>
      <p className="text-muted-foreground text-xs">
        Accepted {new Date(message.createdAt).toLocaleString()}
      </p>
      {message.events.map((e) => (
        <p key={e.id} className="text-xs capitalize">
          {e.type} · {new Date(e.at).toLocaleString()}
        </p>
      ))}
      {local && (
        <div className="border-t pt-4">
          <p className="text-xs text-muted-foreground mb-3">
            Simulate SES feedback through the local event queue.
          </p>
          <div className="flex gap-2 flex-wrap">
            {["delivered", "bounced", "complained"].map((type) => (
              <Button
                key={type}
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await api(
                      "events",
                      { messageId: message.id, type },
                      "POST",
                      "Local email event simulated",
                    );
                    await refresh();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Simulate {type}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
