import { ResourceIdentifier } from "../../components/resource-identifier.js";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
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
                    <div className="flex flex-wrap gap-1 max-w-64">
                      {contact.memberships.map((m) => (
                        <Badge key={m.audienceId} variant="outline">
                          {m.name}
                        </Badge>
                      ))}
                    </div>
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
