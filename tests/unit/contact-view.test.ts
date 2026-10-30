import { it, expect } from "vitest";
import {
  contactView,
  contactsCsv,
} from "../../apps/web/src/features/broadcasts/contact-view.js";
import type { ContactRow } from "../../apps/web/src/features/broadcasts/types.js";
const contacts: ContactRow[] = [
  {
    email: "alex@example.com",
    name: '=HYPERLINK("example.com")',
    addedAt: "2026-10-01",
    memberships: [
      {
        audienceId: "a",
        name: "News",
        subscribed: false,
        addedAt: "2026-10-01",
        consentSource: "Signup",
      },
      {
        audienceId: "b",
        name: "Updates",
        subscribed: true,
        addedAt: "2026-10-02",
        consentSource: "Signup",
      },
    ],
  },
  {
    email: "sam@example.com",
    name: "Sam",
    addedAt: "2026-10-01",
    memberships: [
      {
        audienceId: "a",
        name: "News",
        subscribed: true,
        addedAt: "2026-10-01",
        consentSource: "Signup",
      },
    ],
  },
];
it("counts unique subscribers and respects the selected audience's unsubscribe", () => {
  expect(contactView(contacts, "", "", "all")).toMatchObject({
    total: 2,
    subscribed: 2,
  });
  const view = contactView(contacts, "a", "", "unsubscribed");
  expect(view).toMatchObject({ total: 2, subscribed: 1 });
  expect(view.filtered.map((c) => c.email)).toEqual(["alex@example.com"]);
  expect(contactView(contacts, "b", "", "unsubscribed").filtered).toEqual([]);
});
it("supports case insensitive names and multiple email search without changing totals", () => {
  expect(contactView(contacts, "", "SAM", "all").filtered).toHaveLength(1);
  const view = contactView(
    contacts,
    "",
    "missing@example.com; ALEX@example.com",
    "all",
  );
  expect(view.total).toBe(2);
  expect(view.filtered.map((c) => c.email)).toEqual(["alex@example.com"]);
});
it("exports each membership with its own status and escapes spreadsheet formulas", () => {
  const csv = contactsCsv(contacts);
  expect(csv.split("\r\n")).toHaveLength(4);
  expect(csv).toContain('"\'=HYPERLINK(""example.com"")"');
  expect(csv).toContain('"News","none_or_opted_out"');
  expect(csv).toContain('"Updates","recorded"');
});
