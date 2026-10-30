import type { ContactRow } from "./types.js";
export type SubscriptionFilter = "all" | "subscribed" | "unsubscribed";
export function contactView(
  contacts: ContactRow[],
  audienceId: string,
  search: string,
  subscription: SubscriptionFilter,
) {
  const scoped = contacts.flatMap((contact) => {
    const memberships = contact.memberships.filter(
      (m) => !audienceId || m.audienceId === audienceId,
    );
    return !audienceId || memberships.length
      ? [
          {
            ...contact,
            memberships,
            subscribed: memberships.some((m) => m.subscribed),
          },
        ]
      : [];
  });
  const terms = search
    .toLowerCase()
    .split(/[,;\n]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const filtered = scoped.filter(
    (c) =>
      (!terms.length ||
        terms.some((term) =>
          `${c.email} ${c.name}`.toLowerCase().includes(term),
        )) &&
      (subscription === "all" ||
        c.subscribed === (subscription === "subscribed")),
  );
  return {
    filtered,
    total: scoped.length,
    subscribed: scoped.filter((c) => c.subscribed).length,
  };
}
function csvCell(value: string) {
  // Prevent spreadsheet applications interpreting user-supplied fields as formulas.
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function contactsCsv(contacts: ContactRow[]) {
  return [
    "email,name,audience,list_consent,added,consent_source",
    ...contacts.flatMap((c) =>
      (c.memberships.length
        ? c.memberships
        : [
            {
              name: "",
              subscribed: false,
              addedAt: c.addedAt,
              consentSource: "",
            },
          ]
      ).map((m) =>
        [
          c.email,
          c.name,
          m.name,
          m.subscribed ? "recorded" : "none_or_opted_out",
          m.addedAt,
          m.consentSource,
        ]
          .map(csvCell)
          .join(","),
      ),
    ),
  ].join("\r\n");
}
