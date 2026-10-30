import { z } from "zod";

const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .refine((v) => !["constructor", "prototype", "__proto__"].includes(v));
const questionFields = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(200),
    description: z.string().max(500).default(""),
    type: z.enum(["text", "long_text", "email", "choice", "rating", "consent"]),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    property: z.union([z.literal(""), identifier]).default(""),
  })
  .strict();
const questionDraftInput = questionFields.extend({
  label: z.string().max(200),
  options: z.array(z.string().max(100)).max(20).default([]),
});
export const questionInput = questionFields.superRefine((q, ctx) => {
  if (
    q.type === "choice" &&
    (q.options.length < 2 || new Set(q.options).size !== q.options.length)
  )
    ctx.addIssue({
      code: "custom",
      message: "Choice questions need 2–20 different options",
    });
  if (q.type === "email" && q.property)
    ctx.addIssue({
      code: "custom",
      message:
        "Email questions identify the contact automatically and cannot map to another property",
    });
  if (
    q.type === "choice" &&
    ["name", "first_name", "last_name"].includes(q.property) &&
    q.options.some((option) => option.length > 80)
  )
    ctx.addIssue({
      code: "custom",
      message: "Choices mapped to a contact name must be at most 80 characters",
    });
  if (q.type === "consent" && (q.required || q.property))
    ctx.addIssue({
      code: "custom",
      message:
        "Marketing consent must be optional and cannot map to a property",
    });
});
const formFields = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((v) => !/[\r\n]/.test(v), "Form name must be one line"),
    description: z.string().max(1000).default(""),
    kind: z.enum(["intake", "feedback", "signup"]),
    brand: z.string().max(80).default(""),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#345d37"),
    thankYou: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .default("Thank you. Your response has been received."),
    questions: z.array(questionInput).min(1).max(30),
    syncContacts: z.boolean().default(false),
    audienceId: z.string().uuid().or(z.literal("")).optional(),
    topicId: z.string().uuid().or(z.literal("")).default(""),
    from: z.string().max(320).default(""),
    acknowledgment: z.boolean().default(false),
  })
  .strict();
// Private drafts may be incomplete, but retain structural and size limits.
export const formDraftInput = formFields
  .extend({
    name: z
      .string()
      .max(120)
      .refine((v) => !/[\r\n]/.test(v), "Form name must be one line"),
    thankYou: z
      .string()
      .max(1000)
      .default("Thank you. Your response has been received."),
    questions: z.array(questionDraftInput).min(1).max(30),
  })
  .superRefine((f, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(f)).length > 150000)
      ctx.addIssue({ code: "custom", message: "Form content exceeds 150 KB" });
    if (new Set(f.questions.map((q) => q.id)).size !== f.questions.length)
      ctx.addIssue({
        code: "custom",
        message: "Question identifiers must be unique",
      });
  });
export const formInput = formFields.superRefine((f, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new TextEncoder().encode(JSON.stringify(f)).length > 150000)
    issue("Form content exceeds 150 KB");
  if (new Set(f.questions.map((q) => q.id)).size !== f.questions.length)
    issue("Question identifiers must be unique");
  const mappings = f.questions.map((q) => q.property).filter(Boolean);
  if (new Set(mappings).size !== mappings.length)
    issue("Map each contact property only once");
  if (f.questions.filter((q) => q.type === "email").length > 1)
    issue("Use one email question per form");
  if (
    (f.syncContacts || f.acknowledgment) &&
    !f.questions.some((q) => q.type === "email" && q.required)
  )
    issue("Contact and email integrations need a required email question");
  if (
    f.audienceId &&
    (!f.syncContacts || !f.questions.some((q) => q.type === "consent"))
  )
    issue(
      "An audience destination needs contact sync and an optional consent question",
    );
  if (
    f.topicId &&
    (!f.syncContacts || !f.questions.some((q) => q.type === "consent"))
  )
    issue("A signup topic needs contact sync and an optional consent question");
  if (f.questions.filter((q) => q.type === "consent").length > 1)
    issue("Use one marketing consent question per form");
});
export type FormContent = z.output<typeof formInput>;
export type FormQuestion = FormContent["questions"][number];
export type Answers = Record<string, string | number | boolean>;
export function answerSchema(q: FormQuestion) {
  if (q.type === "consent") return z.boolean();
  if (q.type === "rating") return z.number().int().min(1).max(5);
  if (q.type === "email")
    return z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase());
  if (q.type === "choice")
    return z
      .string()
      .refine((v) => q.options.includes(v), "Choose an available option");
  return z
    .string()
    .trim()
    .min(q.required ? 1 : 0)
    .max(
      q.property
        ? ["name", "first_name", "last_name"].includes(q.property)
          ? 80
          : 500
        : q.type === "long_text"
          ? 5000
          : 500,
    );
}
export function validateAnswers(content: FormContent, input: unknown): Answers {
  const raw = z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .parse(input);
  if (
    Object.keys(raw).some((key) => !content.questions.some((q) => q.id === key))
  )
    throw new Error("Unknown question in response");
  const result: Answers = {};
  for (const q of content.questions) {
    const value = raw[q.id];
    if (value === undefined || value === "") {
      if (q.required) throw new Error(`Please answer: ${q.label}`);
      if (q.type === "consent") result[q.id] = false;
      continue;
    }
    const parsed = answerSchema(q).safeParse(value);
    if (!parsed.success) throw new Error(`Check your answer: ${q.label}`);
    result[q.id] = parsed.data;
  }
  return result;
}
export function publicContent(content: FormContent) {
  return {
    ...content,
    from: "",
    audienceId: "",
    topicId: "",
    questions: content.questions.map((q) => ({
      ...q,
      property: ["name", "first_name", "last_name"].includes(q.property)
        ? "name"
        : q.property
          ? "value"
          : "",
    })),
  };
}
export const formStarters: Record<FormContent["kind"], FormContent> = {
  intake: formInput.parse({
    name: "Client intake",
    kind: "intake",
    description: "Tell us a little about you and what you have in mind.",
    questions: [
      {
        id: "name",
        label: "What’s your name?",
        type: "text",
        required: true,
        property: "name",
      },
      {
        id: "email",
        label: "Where can we reach you?",
        type: "email",
        required: true,
      },
      {
        id: "project",
        label: "What would you like help with?",
        type: "long_text",
        required: true,
      },
      {
        id: "timeline",
        label: "When would you like to get started?",
        type: "choice",
        options: ["As soon as possible", "Within a month", "Just exploring"],
      },
    ],
  }),
  feedback: formInput.parse({
    name: "Feedback",
    kind: "feedback",
    description: "A few small questions to help us do better.",
    questions: [
      {
        id: "rating",
        label: "How was your experience?",
        type: "rating",
        required: true,
      },
      { id: "feedback", label: "What could we do better?", type: "long_text" },
      {
        id: "email",
        label: "Want us to follow up? Leave your email.",
        type: "email",
      },
    ],
  }),
  signup: formInput.parse({
    name: "Stay in the loop",
    kind: "signup",
    description: "Sign up for news and updates from our team.",
    questions: [
      {
        id: "name",
        label: "What’s your name?",
        type: "text",
        property: "name",
      },
      {
        id: "email",
        label: "What’s your email address?",
        type: "email",
        required: true,
      },
      {
        id: "consent",
        label: "Yes, email me news and updates. I can unsubscribe at any time.",
        type: "consent",
      },
    ],
  }),
};
