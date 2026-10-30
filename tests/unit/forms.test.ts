import { it, expect } from "vitest";
import {
  formInput,
  formDraftInput,
  formStarters,
  validateAnswers,
  publicContent,
} from "@narada/core/form-content";
import { csvCell } from "../../apps/api/src/form-routes.js";

it("validates all starters, required answers, choice membership, ratings, and email normalization", () => {
  for (const content of Object.values(formStarters))
    expect(formInput.parse(content)).toEqual(content);
  expect(() => validateAnswers(formStarters.intake, {})).toThrow(
    "Please answer",
  );
  expect(() => validateAnswers(formStarters.feedback, { rating: 6 })).toThrow(
    "Check your answer",
  );
  expect(() => validateAnswers(formStarters.feedback, { rating: "5" })).toThrow(
    "Check your answer",
  );
  expect(() =>
    validateAnswers(formStarters.feedback, { rating: 4, injected: true }),
  ).toThrow("Unknown question");
  expect(() =>
    validateAnswers(formStarters.intake, {
      name: "Ada",
      email: "ada@example.com",
      project: "Hi",
      timeline: "Injected choice",
    }),
  ).toThrow();
  expect(
    validateAnswers(formStarters.signup, { email: "ADA@EXAMPLE.COM" }),
  ).toEqual({ email: "ada@example.com", consent: false });
  expect(
    validateAnswers(formStarters.feedback, {
      rating: 1,
      feedback: "  Keep listening  ",
    }),
  ).toEqual({ rating: 1, feedback: "Keep listening" });
});
it("requires optional unchecked consent, unique mappings and an email for integrations", () => {
  const signup = formStarters.signup;
  expect(() =>
    formInput.parse({
      ...signup,
      questions: signup.questions.map((q) =>
        q.type === "consent" ? { ...q, required: true } : q,
      ),
    }),
  ).toThrow("optional");
  expect(() =>
    formInput.parse({
      ...signup,
      questions: [...signup.questions, signup.questions[0]],
    }),
  ).toThrow("unique");
  expect(() =>
    formInput.parse({ ...formStarters.feedback, syncContacts: true }),
  ).toThrow("required email");
  expect(() =>
    formInput.parse({ ...signup, name: "Header\r\nInjection" }),
  ).toThrow("one line");
  expect(() =>
    validateAnswers(signup, { email: "ada@example.com", consent: "true" }),
  ).toThrow();
});
it("keeps public validation limits aligned without exposing integration settings", () => {
  const content = { ...formStarters.intake, from: "hello@example.com" };
  const publicForm = publicContent(content);
  expect(publicForm.from).toBe("");
  expect(() =>
    validateAnswers(publicForm, {
      name: "x".repeat(81),
      email: "a@example.com",
      project: "hello",
    }),
  ).toThrow();
});
it("escapes CSV quotes and neutralizes formula-like content", () => {
  expect(csvCell('hello,"world"')).toBe('"hello,""world"""');
  for (const value of ["=1+1", "+CMD", "-1", "@formula", " \t=1+1"])
    expect(csvCell(value)).toBe(`"'${value}"`);
  expect(csvCell(false)).toBe('"false"');
});

it("requires contact sync and consent for an audience and hides its identifier publicly", () => {
  const audienceId = "00000000-0000-4000-8000-000000000001";
  const content = { ...formStarters.signup, audienceId, syncContacts: true };
  expect(formInput.parse(content).audienceId).toBe(audienceId);
  expect(publicContent(content).audienceId).toBe("");
  expect(() => formInput.parse({ ...content, syncContacts: false })).toThrow(
    "contact sync",
  );
  expect(() =>
    formInput.parse({
      ...content,
      questions: content.questions.filter((q) => q.type !== "consent"),
    }),
  ).toThrow("consent question");
  expect(() =>
    formInput.parse({ ...content, audienceId: "missing" }),
  ).toThrow();
  // Incomplete private drafts can still autosave; old forms need no migration.
  expect(
    formDraftInput.parse({ ...content, syncContacts: false }).audienceId,
  ).toBe(audienceId);
  expect(formInput.parse(formStarters.signup).audienceId).toBeUndefined();
});

it("rejects question mappings that could fail after a valid response", () => {
  expect(() =>
    formInput.parse({
      ...formStarters.intake,
      questions: formStarters.intake.questions.map((q) =>
        q.type === "email" ? { ...q, property: "name" } : q,
      ),
    }),
  ).toThrow("identify the contact");
  expect(() =>
    formInput.parse({
      ...formStarters.feedback,
      questions: [
        {
          id: "choice",
          label: "Name",
          type: "choice",
          property: "name",
          options: ["Short", "x".repeat(81)],
        },
      ],
    }),
  ).toThrow("80 characters");
});

it("saves incomplete drafts while keeping publish and structural validation strict", () => {
  const draft = {
    ...formStarters.feedback,
    name: "",
    thankYou: "",
    syncContacts: true,
    questions: [
      {
        ...formStarters.feedback.questions[0]!,
        type: "choice",
        label: "",
        options: ["", ""],
      },
    ],
  };
  expect(formDraftInput.parse(draft)).toEqual(draft);
  expect(formInput.safeParse(draft).success).toBe(false);
  expect(
    formDraftInput.safeParse({
      ...draft,
      questions: [draft.questions[0], draft.questions[0]],
    }).success,
  ).toBe(false);
  expect(
    formDraftInput.safeParse({ ...draft, name: "x".repeat(121) }).success,
  ).toBe(false);
  expect(
    formDraftInput.safeParse({
      ...draft,
      questions: [{ ...draft.questions[0], id: "__proto__" }],
    }).success,
  ).toBe(false);
});
