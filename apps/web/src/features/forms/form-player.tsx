import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { ArrowRight, Check, ChevronLeft } from "lucide-react";
import {
  answerSchema,
  type Answers,
  type FormContent,
} from "@narada/contracts/form-content";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Textarea } from "../../components/ui/textarea.js";
import "./form-player.css";

type StepMotion = { direction: "forward" | "backward"; reduced: boolean };
const stepVariants: Variants = {
  enter: ({ direction, reduced }: StepMotion) => ({
    opacity: reduced ? 1 : 0,
    y: reduced ? 0 : direction === "forward" ? 20 : -20,
  }),
  visible: ({ reduced }: StepMotion) => ({
    opacity: 1,
    y: 0,
    transition: { duration: reduced ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] },
  }),
  exit: ({ direction, reduced }: StepMotion) => ({
    opacity: reduced ? 1 : 0,
    y: reduced ? 0 : direction === "forward" ? -12 : 12,
    transition: { duration: reduced ? 0 : 0.14, ease: "easeIn" },
  }),
};

function FormStep({
  children,
  config,
}: {
  children: ReactNode;
  config: StepMotion;
}) {
  const present = useIsPresent();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Wait-mode mounts the next panel after exit; focus its heading, not the old one.
    if (present)
      panel.current?.querySelector("h1")?.focus({ preventScroll: true });
  }, [present]);
  return (
    <motion.div
      ref={panel}
      className="narada-form-step w-full max-w-xl"
      data-direction={config.direction}
      inert={!present}
      aria-hidden={!present || undefined}
      custom={config}
      variants={stepVariants}
      initial="enter"
      animate="visible"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

export function FormPlayer({
  content,
  onSubmit,
  preview = false,
}: {
  content: FormContent;
  onSubmit: (answers: Answers) => Promise<void>;
  preview?: boolean;
}) {
  const [step, setStep] = useState(-1),
    [answers, setAnswers] = useState<Answers>({}),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [done, setDone] = useState(false);
  const [locked, setLocked] = useState(false);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const reducedMotion = !!useReducedMotion();
  const stepMotion = { direction, reduced: reducedMotion };
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAdvance = () => {
    if (advanceTimer.current !== null) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  };
  useEffect(
    () => () => {
      if (advanceTimer.current !== null) clearTimeout(advanceTimer.current);
    },
    [],
  );
  const goTo = (target: number) => {
    cancelAdvance();
    setDirection(target < step ? "backward" : "forward");
    setStep(target);
  };
  const q = content.questions[step];
  const selectOption = (option: string | number) => {
    if (!q || (q.type !== "choice" && q.type !== "rating")) return;
    cancelAdvance();
    setAnswers((current) => ({ ...current, [q.id]: option }));
    setError("");
    // Let the selected state register before moving on. Navigation cancels this
    // timer, so Continue, Back, and rapid answer changes cannot skip a question.
    advanceTimer.current = setTimeout(() => goTo(step + 1), 350);
  };
  const next = async () => {
    setError("");
    if (q) {
      const value = answers[q.id];
      if (value === undefined || value === "") {
        if (q.required) {
          setError("Please answer this question to continue.");
          return;
        }
      } else if (!answerSchema(q).safeParse(value).success) {
        setError(
          q.type === "email"
            ? "Please enter a valid email address."
            : "Please check your answer and try again.",
        );
        return;
      }
      goTo(step + 1);
      return;
    }
    setPending(true);
    setLocked(true);
    try {
      await onSubmit(answers);
      setDirection("forward");
      setDone(true);
    } catch (e) {
      if (e instanceof Error && "definitive" in e) setLocked(false);
      setError(
        e instanceof Error ? e.message : "Unable to submit. Please try again.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      className={`narada-form ${preview ? "min-h-[580px] rounded-xl border" : "min-h-dvh"} bg-[#fafbf8] flex flex-col`}
      style={{ borderTop: `5px solid ${content.color}` }}
    >
      <header className="px-6 py-6 sm:px-12 flex items-center justify-between gap-4">
        <span className="font-medium text-sm">
          {content.brand || "narada."}
        </span>
        {preview && (
          <span className="rounded-full bg-white border px-3 py-1 text-xs">
            Preview · no responses saved
          </span>
        )}
        {!done && step >= 0 && (
          <span className="text-xs text-muted-foreground">
            {Math.min(step + 1, content.questions.length)} of{" "}
            {content.questions.length}
          </span>
        )}
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12 sm:py-20">
        <AnimatePresence mode="wait" custom={stepMotion}>
          <FormStep key={done ? "complete" : step} config={stepMotion}>
            {done ? (
              <div className="space-y-6">
                <motion.svg
                  aria-hidden="true"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="narada-form-success text-primary"
                >
                  <motion.path
                    d="M20 6 9 17l-5-5"
                    initial={{ pathLength: reducedMotion ? 1 : 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{
                      duration: reducedMotion ? 0 : 0.35,
                      delay: reducedMotion ? 0 : 0.12,
                    }}
                  />
                </motion.svg>
                <h1 tabIndex={-1} className="serif text-4xl outline-none">
                  You’re all set.
                </h1>
                <p className="text-lg whitespace-pre-wrap">
                  {content.thankYou}
                </p>
                {content.syncContacts && (
                  <p className="text-sm text-muted-foreground">
                    Check your inbox to confirm your email. Contact details and
                    any selected subscription are saved after confirmation.
                  </p>
                )}
              </div>
            ) : step < 0 ? (
              <div className="space-y-6">
                <p className="uppercase tracking-widest text-xs text-muted-foreground">
                  A moment to connect
                </p>
                <h1
                  tabIndex={-1}
                  className="serif text-4xl sm:text-5xl outline-none"
                >
                  {content.name}
                </h1>
                <p className="text-lg text-muted-foreground whitespace-pre-wrap">
                  {content.description}
                </p>
                <Button size="lg" onClick={() => goTo(0)}>
                  Let’s begin <ArrowRight size={18} />
                </Button>
                <p className="text-xs text-muted-foreground">
                  {content.questions.length} questions · Take your time
                </p>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void next();
                }}
                onKeyDown={(event) => {
                  if (
                    !q ||
                    (q.type !== "choice" && q.type !== "rating") ||
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.repeat ||
                    event.nativeEvent.isComposing
                  )
                    return;
                  const target = event.target as HTMLElement;
                  if (
                    target.closest(
                      'button, textarea, select, [contenteditable="true"], input:not([type="radio"])',
                    )
                  )
                    return;
                  const options =
                    q.type === "rating" ? [1, 2, 3, 4, 5] : q.options;
                  const index =
                    q.type === "rating"
                      ? "12345".indexOf(event.key)
                      : "abcdefghijklmnopqrst".indexOf(event.key.toLowerCase());
                  if (
                    event.key.length !== 1 ||
                    index < 0 ||
                    index >= options.length
                  )
                    return;
                  const option = options[index];
                  if (option === undefined) return;
                  event.preventDefault();
                  selectOption(option);
                  event.currentTarget
                    .querySelectorAll<HTMLInputElement>('input[type="radio"]')
                    [index]?.focus();
                }}
                className="space-y-7"
              >
                {q ? (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground mb-3">
                        {q.required ? "Required" : "Optional"}
                      </p>
                      <h1
                        tabIndex={-1}
                        id="question-title"
                        className="serif text-3xl sm:text-4xl outline-none"
                      >
                        {q.type === "consent"
                          ? "Would you like to stay in touch?"
                          : q.label}
                      </h1>
                      {q.description && (
                        <p
                          id="question-description"
                          className="mt-4 text-muted-foreground whitespace-pre-wrap"
                        >
                          {q.description}
                        </p>
                      )}
                    </div>
                    {q.type === "choice" || q.type === "rating" ? (
                      <fieldset
                        aria-labelledby="question-title"
                        aria-describedby={[
                          q.description && "question-description",
                          "choice-instructions",
                          q.type === "rating" && "rating-endpoints",
                          error && "question-error",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        aria-invalid={!!error}
                        className="min-w-0 space-y-4"
                      >
                        <p
                          id="choice-instructions"
                          className="text-sm text-muted-foreground"
                        >
                          {q.type === "rating"
                            ? "Choose a rating"
                            : "Choose one answer"}
                          <span className="narada-form-keyboard-hint">
                            {q.type === "rating"
                              ? " · or press 1–5"
                              : " · or press a letter"}
                          </span>
                          <span className="block mt-1 text-xs">
                            Selecting an answer moves to the next step.
                          </span>
                        </p>
                        <div
                          className={
                            q.type === "rating"
                              ? "narada-form-rating-grid"
                              : "grid gap-3"
                          }
                        >
                          {(q.type === "rating"
                            ? [1, 2, 3, 4, 5]
                            : q.options
                          ).map((option, index) => (
                            <label
                              key={option}
                              className={`narada-form-choice ${q.type === "rating" ? "narada-form-rating" : "narada-form-option"}`}
                            >
                              <input
                                type="radio"
                                className="narada-form-choice-input"
                                name={q.id}
                                value={option}
                                aria-keyshortcuts={
                                  q.type === "rating"
                                    ? String(option)
                                    : String.fromCharCode(65 + index)
                                }
                                checked={answers[q.id] === option}
                                onChange={() => selectOption(option)}
                                onClick={() => {
                                  // Re-selecting a saved answer after going back also advances.
                                  if (answers[q.id] === option)
                                    selectOption(option);
                                }}
                              />
                              {q.type === "choice" && (
                                <span
                                  aria-hidden="true"
                                  className="narada-form-key"
                                >
                                  {String.fromCharCode(65 + index)}
                                </span>
                              )}
                              <span className="narada-form-option-label">
                                {option}
                              </span>
                              <Check
                                aria-hidden="true"
                                size={18}
                                className="narada-form-option-check"
                              />
                            </label>
                          ))}
                        </div>
                        {q.type === "rating" && (
                          <div
                            id="rating-endpoints"
                            className="flex justify-between text-xs text-muted-foreground"
                          >
                            <span>1 · Poor</span>
                            <span>5 · Excellent</span>
                          </div>
                        )}
                      </fieldset>
                    ) : q.type === "consent" ? (
                      <label className="narada-form-choice narada-form-option narada-form-consent">
                        <input
                          type="checkbox"
                          className="narada-form-choice-input"
                          checked={answers[q.id] === true}
                          onChange={(e) => {
                            setAnswers({
                              ...answers,
                              [q.id]: e.target.checked,
                            });
                            setError("");
                          }}
                        />
                        <span
                          aria-hidden="true"
                          className="narada-form-checkbox"
                        >
                          <Check size={16} />
                        </span>
                        <span className="narada-form-option-label">
                          {q.label}
                        </span>
                      </label>
                    ) : q.type === "long_text" ? (
                      <Textarea
                        key={q.id}
                        aria-labelledby="question-title"
                        aria-describedby={
                          q.description ? "question-description" : undefined
                        }
                        aria-invalid={!!error}
                        rows={5}
                        maxLength={
                          q.property
                            ? ["name", "first_name", "last_name"].includes(
                                q.property,
                              )
                              ? 80
                              : 500
                            : 5000
                        }
                        placeholder="Your answer…"
                        value={String(answers[q.id] ?? "")}
                        onChange={(e) =>
                          setAnswers({ ...answers, [q.id]: e.target.value })
                        }
                      />
                    ) : (
                      <Input
                        key={q.id}
                        aria-labelledby="question-title"
                        aria-describedby={
                          q.description ? "question-description" : undefined
                        }
                        aria-invalid={!!error}
                        type={q.type === "email" ? "email" : "text"}
                        autoComplete={q.type === "email" ? "email" : "off"}
                        maxLength={
                          q.type === "email"
                            ? 254
                            : ["name", "first_name", "last_name"].includes(
                                  q.property,
                                )
                              ? 80
                              : 500
                        }
                        className="h-14 text-lg bg-white"
                        placeholder={
                          q.type === "email"
                            ? "you@example.com"
                            : "Your answer…"
                        }
                        value={String(answers[q.id] ?? "")}
                        onChange={(e) =>
                          setAnswers({ ...answers, [q.id]: e.target.value })
                        }
                      />
                    )}
                  </>
                ) : (
                  <>
                    <h1 tabIndex={-1} className="serif text-4xl outline-none">
                      Ready to send?
                    </h1>
                    <p className="text-muted-foreground">
                      Review your answers before submitting.
                    </p>
                    <dl className="space-y-4">
                      {content.questions.map((question) => (
                        <div key={question.id} className="border-b pb-4">
                          <dt className="text-xs text-muted-foreground mb-1">
                            {question.label}
                          </dt>
                          <dd className="whitespace-pre-wrap break-words">
                            {typeof answers[question.id] === "boolean"
                              ? answers[question.id]
                                ? "Yes"
                                : "No"
                              : String(
                                  answers[question.id] ??
                                    (question.type === "consent"
                                      ? "No"
                                      : "Not answered"),
                                )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
                {error && (
                  <p
                    role="alert"
                    id="question-error"
                    className="text-sm rounded-lg border bg-white p-4"
                  >
                    {error}
                    {locked &&
                      " Your answers are kept here. Retry to check or complete the same submission."}
                  </p>
                )}
                <div className="flex gap-3 items-center">
                  <Button
                    type="button"
                    variant="outline"
                    aria-label="Previous question"
                    disabled={pending || locked}
                    onClick={() => {
                      goTo(step - 1);
                      setError("");
                    }}
                  >
                    <ChevronLeft size={18} />
                  </Button>
                  <Button type="submit" disabled={pending}>
                    {pending
                      ? "Sending…"
                      : q
                        ? "Continue"
                        : locked
                          ? "Retry submission"
                          : preview
                            ? "Finish preview"
                            : "Submit response"}
                    <ArrowRight size={18} />
                  </Button>
                  {q && !q.required && (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        setAnswers((current) => {
                          const next = { ...current };
                          delete next[q.id];
                          return next;
                        });
                        goTo(step + 1);
                        setError("");
                      }}
                    >
                      Skip
                    </Button>
                  )}
                </div>
              </form>
            )}
          </FormStep>
        </AnimatePresence>
      </main>
      <footer className="px-6 py-6 sm:px-12 text-xs text-muted-foreground">
        {step >= 0 && !done && (
          <div className="h-1 bg-black/5 mb-6 rounded-full overflow-hidden">
            <motion.div
              className="narada-form-progress h-full"
              initial={false}
              animate={{ scaleX: Math.min(step / content.questions.length, 1) }}
              transition={{
                duration: reducedMotion ? 0 : 0.42,
                ease: [0.22, 1, 0.36, 1],
              }}
              style={{ background: content.color, transformOrigin: "left" }}
            />
          </div>
        )}
        Powered by Narada
      </footer>
    </div>
  );
}
