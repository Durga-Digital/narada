import type { IssueStatus } from "./types.js";
export type IssueState = {
  scheduledAt?: number;
  publicVersionId?: string;
  webPublished?: boolean;
  emailReleased?: boolean;
  publishedAt?: string;
  slugLocked?: boolean;
  broadcastId?: string;
  operationId?: string;
  deletedAt?: string;
};
export function issueStatus(issue: IssueState): IssueStatus {
  if (issue.scheduledAt) return "scheduled";
  if (issue.publicVersionId || issue.webPublished) return "published";
  if (issue.emailReleased) return "sent";
  if (issue.publishedAt) return "withdrawn";
  return "draft";
}
export function canDeleteIssue(issue: IssueState) {
  return (
    !issue.deletedAt &&
    !issue.scheduledAt &&
    !issue.publicVersionId &&
    !issue.webPublished &&
    !issue.emailReleased &&
    !issue.publishedAt &&
    !issue.slugLocked &&
    !issue.broadcastId &&
    !issue.operationId
  );
}
export const issueStatusLabels: Record<IssueStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published on web",
  sent: "Email released",
  withdrawn: "Withdrawn from web",
};
