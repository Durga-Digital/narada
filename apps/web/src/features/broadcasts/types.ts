import type {
  PropertyDefinition,
  SharedContact,
  Topic,
  SegmentRule,
} from "@narada/core/audience-model";
export type { PropertyDefinition, SharedContact, Topic, SegmentRule };
export interface ContactDetails {
  contact: SharedContact;
  topics: (Topic & { subscribed: boolean })[];
  unsubscribedAll: boolean;
}
import type {
  DraftInput,
  BroadcastStatus,
  Broadcast,
} from "@narada/core/broadcast-model";
export type { DraftInput, BroadcastStatus, Broadcast };
export interface BroadcastRow {
  publicationId?: string;
  id: string;
  name: string;
  subject: string;
  audienceId: string;
  status: BroadcastStatus;
  total: number;
  updatedAt: string;
  scheduledAt?: number;
}
export interface AudienceRow {
  publicationId?: string;
  kind?: "manual" | "dynamic";
  match?: "all" | "any";
  rules?: SegmentRule[];
  revision?: number;
  id: string;
  name: string;
  total: number;
  updatedAt: string;
}
export interface AudienceDetail extends AudienceRow {
  contacts: {
    email: string;
    name: string;
    addedAt: string;
    consentedAt?: string;
    consentSource: string;
    subscribed: boolean;
  }[];
}
export interface ContactRow {
  email: string;
  name: string;
  addedAt: string;
  memberships: {
    audienceId: string;
    name: string;
    subscribed: boolean;
    consentSource: string;
    addedAt: string;
  }[];
}
export interface ContactDirectory {
  audiences: AudienceRow[];
  contacts: ContactRow[];
}
export interface BroadcastDetail {
  broadcast: Broadcast;
  counts: Record<string, number>;
  recipients: {
    email: string;
    name: string;
    messageId: string;
    status: string;
    error?: string;
  }[];
}
export interface Preview {
  subject?: string;
  previewEmail?: string;
  html: string;
  text?: string;
  total: number;
  eligible: number;
  excluded: number;
}
export const blankDraft: DraftInput = {
  name: "Untitled broadcast",
  from: "",
  subject: "",
  audienceId: "",
  text: "",
  html: "",
  organization: "",
  postalAddress: "",
};
