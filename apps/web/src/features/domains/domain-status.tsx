import { CheckCircle2, Clock3, FlaskConical } from "lucide-react";
import type { Domain } from "../../lib/api.js";
import { Badge } from "../../components/ui/badge.js";
export function DomainStatus({ domain }: { domain: Domain }) {
  return domain.local ? (
    <Badge variant="outline">
      <FlaskConical size={12} />
      Local only
    </Badge>
  ) : domain.verified ? (
    <Badge
      title="SES identity verified; check the domain setup checklist for DKIM, DMARC and MAIL FROM status."
      className="bg-primary/10 text-primary border-primary/15"
    >
      <CheckCircle2 size={12} />
      Verified
    </Badge>
  ) : (
    <Badge className="bg-amber-50 text-amber-800 border-amber-200">
      <Clock3 size={12} />
      Pending verification
    </Badge>
  );
}
export function domainDate(date?: string) {
  if (!date) return "Not recorded";
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? "Not recorded"
    : value.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}
