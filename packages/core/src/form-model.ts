import type { Entity } from "./model.js";
import type { Answers, FormContent } from "./form-content.js";
export interface FormRecord extends Entity {
  id: string;
  draft: FormContent;
  revision: number;
  version: number;
  publishedRevision?: number;
  accepting: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface FormVersion extends Entity {
  version: number;
  content: FormContent;
}
export interface FormResponse extends Entity {
  id: string;
  formId: string;
  version: number;
  answers: Answers;
  digest: string;
  createdAt: string;
  email?: string;
  verifiedAt?: string;
  syncedAt?: string;
  status: "pending" | "awaiting_verification" | "complete" | "failed";
  attempts: number;
  revision: number;
  error?: string;
  verificationMessageId?: string;
  acknowledgmentMessageId?: string;
}
