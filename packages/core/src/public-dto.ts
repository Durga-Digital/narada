import type * as API from "@narada/contracts/types";
import type {
  SharedContact,
  PropertyDefinition,
  Topic,
} from "./audience-model.js";
import type { Audience, Broadcast } from "./broadcast-model.js";
export function contactDto(c: SharedContact): API.Contact {
  const { email, name, first_name, last_name, properties, revision, addedAt } =
    c;
  return { email, name, first_name, last_name, properties, revision, addedAt };
}
export function propertyDto(p: PropertyDefinition): API.Property {
  const { key, type, fallback, revision, createdAt } = p;
  return { key, type, fallback, revision, createdAt };
}
export function topicDto(t: Topic): API.Topic {
  const { id, name, description, visibility, active, revision, createdAt } = t;
  return { id, name, description, visibility, active, revision, createdAt };
}
export function segmentDto(
  s: Pick<
    Audience,
    | "id"
    | "name"
    | "kind"
    | "match"
    | "rules"
    | "revision"
    | "total"
    | "updatedAt"
  >,
): API.Segment {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind ?? "manual",
    match: s.match ?? "all",
    rules: s.rules ?? [],
    revision: s.revision,
    total: s.total ?? 0,
    updatedAt: s.updatedAt,
  };
}
export function broadcastDto(b: Broadcast): API.Broadcast {
  const { id, status, revision, total, createdAt, updatedAt, scheduledAt } = b;
  const {
    name,
    audienceId,
    topicId,
    from,
    subject,
    text,
    html,
    organization,
    postalAddress,
    replyTo,
  } = b.draft;
  return {
    id,
    status,
    revision,
    total,
    createdAt,
    updatedAt,
    scheduledAt,
    draft: {
      name,
      audienceId,
      topicId,
      from,
      subject,
      text,
      html,
      organization,
      postalAddress,
      replyTo,
    },
  };
}
