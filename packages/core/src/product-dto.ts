import { issueStatus, canDeleteIssue } from "@narada/contracts/issue-state";
import type * as API from "@narada/contracts/types";
import type { FormContent } from "./form-content.js";
import type { FormRecord, FormResponse } from "./form-model.js";
import type { Publication, Issue } from "./newsletter-model.js";
export function formContentDto(c: FormContent): API.FormInput {
  const {
    name,
    kind,
    description,
    brand,
    color,
    thankYou,
    syncContacts,
    audienceId,
    topicId,
    from,
    acknowledgment,
  } = c;
  return {
    name,
    kind,
    description,
    brand,
    color,
    thankYou,
    syncContacts,
    audienceId,
    topicId,
    from,
    acknowledgment,
    questions: c.questions.map(
      ({ id, label, type, description, required, options, property }) => ({
        id,
        label,
        type,
        description,
        required,
        options,
        property,
      }),
    ),
  };
}
export function formDto(f: FormRecord): API.Form {
  const {
    id,
    revision,
    version,
    publishedRevision,
    accepting,
    createdAt,
    updatedAt,
  } = f;
  return {
    id,
    draft: formContentDto(f.draft),
    publicationId:
      typeof f.publicationId === "string" ? f.publicationId : undefined,
    revision,
    version,
    publishedRevision,
    accepting,
    createdAt,
    updatedAt,
  };
}
export function responseDto(r: FormResponse): API.FormResponseSummary {
  const {
    id,
    formId,
    version,
    createdAt,
    email,
    verifiedAt,
    syncedAt,
    status,
    attempts,
    revision,
    error,
  } = r;
  return {
    id,
    formId,
    version,
    createdAt,
    email,
    verifiedAt,
    syncedAt,
    status,
    attempts,
    revision,
    error,
  };
}
export function publicationDto(p: Publication): API.Publication {
  const { id, status, formId, revision, createdAt, updatedAt } = p;
  const {
    name,
    slug,
    description,
    author,
    color,
    from,
    replyTo,
    organization,
    postalAddress,
    privacyUrl,
  } = p.settings;
  return {
    id,
    status,
    formId,
    revision,
    createdAt,
    updatedAt,
    ...(p.branding ? { branding: p.branding } : {}),
    settings: {
      name,
      slug,
      description,
      author,
      color,
      from,
      replyTo,
      organization,
      postalAddress,
      privacyUrl,
    },
  };
}
export function issueDto(i: Issue): API.Issue {
  const {
    id,
    publicationId,
    revision,
    createdAt,
    updatedAt,
    publishedAt,
    webUpdatedAt,
    scheduledAt,
    emailReleased,
  } = i;
  const {
    title,
    slug,
    subtitle,
    subject,
    preheader,
    document,
    coverAssetId,
    coverAlt,
  } = i.draft;
  return {
    id,
    publicationId,
    revision,
    createdAt,
    updatedAt,
    publishedAt,
    webUpdatedAt,
    scheduledAt,
    emailReleased,
    webPublished: !!i.publicVersionId,
    status: issueStatus(i),
    canDelete: canDeleteIssue(i),
    draft: {
      title,
      slug,
      subtitle,
      subject,
      preheader,
      document,
      coverAssetId,
      coverAlt,
    },
  };
}
