import { Notice } from "../../components/shared.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Badge } from "../../components/ui/badge.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.js";
import type { BroadcastDetail } from "./types.js";
export function BroadcastProgress({ detail }: { detail: BroadcastDetail }) {
  return (
    <div className="mt-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Recipients", value: detail.broadcast.total },
          {
            label: "Accepted / delivered",
            value: ["sent", "captured", "delivered"].reduce(
              (n, s) => n + (detail.counts[s] ?? 0),
              0,
            ),
          },
          {
            label: "Pending",
            value: ["pending", "queued", "submitting"].reduce(
              (n, s) => n + (detail.counts[s] ?? 0),
              0,
            ),
          },
          {
            label: "Needs attention",
            value: [
              "failed",
              "expired",
              "unknown",
              "bounced",
              "complained",
            ].reduce((n, s) => n + (detail.counts[s] ?? 0), 0),
          },
        ].map((s) => (
          <Card key={s.label} className="shadow-none">
            <CardContent>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-3xl mt-3">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {detail.broadcast.status === "scheduled" && (
        <Notice>
          Scheduled for{" "}
          {new Date(detail.broadcast.scheduledAt!).toLocaleString()}. Times use
          your browser’s timezone.
        </Notice>
      )}
      <Card className="shadow-none">
        <CardContent>
          <h2 className="font-medium mb-4">Recipient progress</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.recipients.slice(0, 100).map((r) => (
                <TableRow key={r.email}>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-normal">
                    {r.error}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            Showing the first 100 recipients. Summary counts include the entire
            broadcast.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
