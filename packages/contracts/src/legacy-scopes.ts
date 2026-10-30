// Shared by the dashboard and server; keep this module free of server dependencies.
export const apiScopeDefinitions = [
  {
    scope: "emails:send",
    group: "Emails",
    label: "Send emails and read delivery status",
  },
  {
    scope: "contacts:create",
    group: "Contacts",
    label: "Create contacts only",
  },
  {
    scope: "contacts:read",
    group: "Contacts",
    label: "List and retrieve contacts and preferences",
  },
  {
    scope: "contacts:write",
    group: "Contacts",
    label: "Create, retrieve, and update individual contacts",
  },
  {
    scope: "contacts:subscriptions",
    group: "Contacts",
    label: "Change topic subscriptions and global opt-outs",
  },
  {
    scope: "properties:read",
    group: "Contact properties",
    label: "List and retrieve property definitions",
  },
  {
    scope: "properties:write",
    group: "Contact properties",
    label: "Create and update property definitions",
  },
  {
    scope: "segments:read",
    group: "Segments",
    label: "List and retrieve segments and their members",
  },
  {
    scope: "segments:write",
    group: "Segments",
    label: "Create and update segment definitions",
  },
  {
    scope: "segments:members",
    group: "Segments",
    label: "Add and remove manual segment members",
  },
  {
    scope: "segments:import",
    group: "Segments",
    label: "Import contacts, memberships, and topic consent from CSV",
  },
  { scope: "topics:read", group: "Topics", label: "List and retrieve topics" },
  {
    scope: "topics:write",
    group: "Topics",
    label: "Create, update, and archive topics",
  },
  {
    scope: "broadcasts:read",
    group: "Broadcasts",
    label: "List, retrieve, and preview broadcasts and recipient results",
  },
  {
    scope: "broadcasts:write",
    group: "Broadcasts",
    label: "Create, update, and duplicate broadcast drafts",
  },
  {
    scope: "broadcasts:send",
    group: "Broadcasts",
    label: "Send, schedule, test, and cancel broadcasts",
  },
  {
    scope: "templates:read",
    group: "Templates",
    label: "List, retrieve, and preview templates",
  },
  {
    scope: "templates:write",
    group: "Templates",
    label: "Create, update, publish, archive, and duplicate templates",
  },
  {
    scope: "templates:test",
    group: "Templates",
    label: "Send template test emails",
  },
] as const;
export type ApiScope = (typeof apiScopeDefinitions)[number]["scope"];
export const apiScopes = apiScopeDefinitions.map(({ scope }) => scope);
