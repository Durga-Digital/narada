import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { useId } from "react";
import { Popover } from "radix-ui";
import { ChevronLeft, ChevronRight, Users, X } from "lucide-react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import type { ContactRow } from "./types.js";

function ContactAudiences({ contact }: { contact: ContactRow }) {
  const titleId = useId();
  const first = contact.memberships[0];

  if (!first) {
    return <span className="text-xs text-muted-foreground">No audiences</span>;
  }

  const remaining = contact.memberships.length - 1;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`View ${contact.memberships.length} ${remaining ? "audiences" : "audience"} for ${contact.email}`}
          className="flex max-w-64 items-center gap-1.5 rounded-md py-1 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Badge variant="outline" className="min-w-0 shrink">
            <span className="truncate">{first.name}</span>
          </Badge>
          {remaining > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
              +{remaining} more
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          aria-labelledby={titleId}
          className="z-50 flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md outline-none"
        >
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <h3 id={titleId} className="text-sm font-medium">
              Audiences ({contact.memberships.length})
            </h3>
            <Popover.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Close audiences"
              >
                <X />
              </Button>
            </Popover.Close>
          </div>
          <ul
            aria-label="Audience memberships"
            tabIndex={0}
            className="min-h-0 overflow-y-auto overscroll-contain p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {contact.memberships.map((membership) => (
              <li
                key={membership.audienceId}
                className="break-words rounded-md px-2 py-2"
              >
                {membership.name}
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ContactTable({
  contacts,
  page,
  size,
  onPage,
  onSize,
  onSelect,
}: {
  contacts: (ContactRow & { subscribed: boolean })[];
  page: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
  onSelect: (contact: ContactRow) => void;
}) {
  const pages = Math.max(1, Math.ceil(contacts.length / size));
  const current = Math.min(page, pages - 1);
  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="pl-5">Email</TableHead>
              <TableHead>Audiences</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts
              .slice(current * size, (current + 1) * size)
              .map((contact) => (
                <TableRow key={contact.email}>
                  <TableCell className="pl-5 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="rounded-full bg-muted text-muted-foreground size-8 flex items-center justify-center shrink-0"
                      >
                        {(contact.name || contact.email)
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>
                      <div>
                        <ResourceIdentifier
                          label="Contact email"
                          value={contact.email}
                          onSelect={() => onSelect(contact)}
                        />
                        {contact.name && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {contact.name}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ContactAudiences contact={contact} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={contact.subscribed ? "secondary" : "outline"}
                    >
                      {contact.subscribed ? "List consent" : "No list consent"}
                      {contact.subscribed && (
                        <span className="ml-1 rounded-full bg-primary/10 px-1.5">
                          {
                            contact.memberships.filter((m) => m.subscribed)
                              .length
                          }
                        </span>
                      )}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                    {new Date(contact.addedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        {!contacts.length && (
          <div className="text-center py-14 px-5">
            <Users className="mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">No contacts to show</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add your first contacts or adjust your filters.
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground mt-4">
        <p aria-live="polite">
          {contacts.length ? current * size + 1 : 0}–
          {Math.min((current + 1) * size, contacts.length)} of {contacts.length}{" "}
          contacts
        </p>
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label="Contacts per page"
            value={size}
            onChange={(e) => onSize(Number(e.target.value))}
          >
            {[20, 40, 100].map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => onPage(current - 1)}
          >
            <ChevronLeft />
          </Button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={current + 1 === pages}
            onClick={() => onPage(current + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </>
  );
}
