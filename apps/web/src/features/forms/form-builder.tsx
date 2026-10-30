import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  LayoutGroup,
  Reorder,
  useDragControls,
  type DragControls,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  CheckSquare,
  Copy,
  GripVertical,
  ListChecks,
  Mail,
  Plus,
  Settings2,
  Star,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";
import type { FormContent, FormQuestion } from "@narada/contracts/form-content";
import type { PropertyDefinition } from "@narada/core/audience-model";
import { Button } from "../../components/ui/button.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { Field, Notice } from "../../components/shared.js";
import { FormDragScrollHints } from "./form-drag-scroll-hints.js";
import "./form-builder.css";

const blocks = [
  {
    type: "text",
    name: "Short text",
    hint: "A name or a quick answer",
    icon: TextCursorInput,
    label: "What would you like to know?",
  },
  {
    type: "long_text",
    name: "Long text",
    hint: "Room for a little more detail",
    icon: AlignLeft,
    label: "Tell us a little more.",
  },
  {
    type: "email",
    name: "Email address",
    hint: "An address for follow-up",
    icon: Mail,
    label: "What’s your email address?",
  },
  {
    type: "choice",
    name: "Multiple choice",
    hint: "Choose one from a list",
    icon: ListChecks,
    label: "Which option works for you?",
  },
  {
    type: "rating",
    name: "Rating",
    hint: "A scale from one to five",
    icon: Star,
    label: "How was your experience?",
  },
  {
    type: "consent",
    name: "Marketing consent",
    hint: "An optional, explicit opt-in",
    icon: CheckSquare,
    label: "Yes, email me news and updates. I can unsubscribe at any time.",
  },
] as const;
type BlockType = FormQuestion["type"];
const freshId = () =>
  `q_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;

const BlockDragContext = createContext<DragControls | null>(null);

function BlockDragHandle({
  index,
  disabled,
}: {
  index: number;
  disabled: boolean;
}) {
  const controls = useContext(BlockDragContext);
  return (
    <button
      type="button"
      className="form-drag-handle"
      aria-label={`Drag question ${index + 1} to reorder`}
      title="Drag to reorder; hold near the screen edges to scroll. Escape cancels. Use the arrows to move with a keyboard."
      disabled={disabled}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || !event.isPrimary) return;
        controls?.start(event, { distanceThreshold: 5 });
      }}
    >
      <GripVertical size={16} />
    </button>
  );
}

// Stable keys keep inputs mounted. The forwarded ref lets popLayout remove an
// exiting row from the flow while the remaining items move into its place.
const AnimatedBlock = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    reduced: boolean;
    structure: string;
    id?: string;
    disabled: boolean;
    onStart: () => void;
    onFinish: (cancel: boolean) => void;
  }
>(function AnimatedBlock(
  { children, reduced, structure, id, disabled, onStart, onFinish },
  ref,
) {
  const present = useIsPresent();
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const cancel = () => {
      controls.stop();
      onFinish(true);
      setDragging(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", cancel);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragging, controls, onFinish]);
  useEffect(() => () => controls.cancel(), [controls]);
  return (
    <Reorder.Item
      as="div"
      ref={ref}
      value={id ?? "end"}
      className="form-block-motion"
      data-dragging={dragging || undefined}
      drag={id && !disabled ? "y" : false}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => {
        setDragging(true);
        onStart();
      }}
      onDragEnd={() => {
        setDragging(false);
        onFinish(false);
      }}
      layout="position"
      layoutDependency={structure}
      initial={{ opacity: reduced ? 1 : 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.14 } }}
      transition={{
        opacity: { duration: reduced ? 0 : 0.18 },
        layout: reduced
          ? { duration: 0 }
          : { type: "spring", stiffness: 460, damping: 38, mass: 0.75 },
      }}
      inert={!present}
      aria-hidden={!present || undefined}
    >
      <BlockDragContext.Provider value={controls}>
        {children}
      </BlockDragContext.Provider>
    </Reorder.Item>
  );
});

export function FormBuilder({
  content,
  onChange,
  properties,
  propertyError,
  disabled,
  onDragStateChange,
}: {
  content: FormContent;
  onChange: (patch: Partial<FormContent>) => void;
  properties: PropertyDefinition[];
  propertyError: string;
  disabled: boolean;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  useEffect(() => () => onDragStateChange?.(false), [onDragStateChange]);
  const [active, setActive] = useState(content.questions[0]?.id);
  const [insertion, setInsertion] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragAnnouncement, setDragAnnouncement] = useState("");
  const [removed, setRemoved] = useState<{
    question: FormQuestion;
    index: number;
  } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const dragSession = useRef<{ id: string; questions: FormQuestion[] } | null>(
    null,
  );
  const full = content.questions.length >= 30;
  const reducedMotion = !!useReducedMotion();
  // Remeasure on structural changes and drag start, including fields resized while typing.
  const structure = `${content.questions.map((q) => q.id).join(",")}:${insertion}:${removed?.question.id ?? ""}:${draggingId ?? ""}`;
  function focus(id: string, preventScroll = false) {
    setActive(id);
    requestAnimationFrame(() => {
      const input = canvas.current?.querySelector<HTMLTextAreaElement>(
        `[data-question-id="${CSS.escape(id)}"]`,
      );
      input?.focus({ preventScroll });
    });
  }
  function insert(type: BlockType, index: number) {
    if (
      disabled ||
      full ||
      (["email", "consent"].includes(type) &&
        content.questions.some((q) => q.type === type))
    )
      return;
    const definition = blocks.find((b) => b.type === type)!;
    const question: FormQuestion = {
      id: freshId(),
      label: definition.label,
      description: "",
      type,
      options: type === "choice" ? ["Option one", "Option two"] : [],
      required: type === "email",
      property: "",
    };
    const questions = [...content.questions];
    questions.splice(index, 0, question);
    onChange({ questions });
    setInsertion(null);
    focus(question.id);
  }
  function change(id: string, patch: Partial<FormQuestion>) {
    onChange({
      questions: content.questions.map((q) =>
        q.id === id ? { ...q, ...patch } : q,
      ),
    });
  }
  function move(id: string, destination: number) {
    if (disabled) return;
    const from = content.questions.findIndex((q) => q.id === id);
    if (from < 0) return;
    const questions = [...content.questions],
      [question] = questions.splice(from, 1);
    questions.splice(
      Math.max(0, Math.min(destination, questions.length)),
      0,
      question!,
    );
    onChange({ questions });
    setInsertion(null);
    focus(id);
  }
  function startDrag(id: string) {
    onDragStateChange?.(true);
    dragSession.current = { id, questions: content.questions };
    setDraggingId(id);
    setActive(id);
    setInsertion(null);
    setDragAnnouncement(
      "Block picked up. Drag to reorder, or press Escape to cancel.",
    );
  }
  function reorder(ids: string[]) {
    if (disabled || !dragSession.current) return;
    const byId = new Map(content.questions.map((q) => [q.id, q]));
    const questions = ids.map((id) => byId.get(id)!);
    onChange({ questions });
    setDragAnnouncement(
      `Moving block to position ${ids.indexOf(dragSession.current.id) + 1} of ${ids.length}.`,
    );
  }
  function finishDrag(cancel: boolean) {
    const session = dragSession.current;
    if (!session) return;
    dragSession.current = null;
    if (cancel) onChange({ questions: session.questions });
    setDraggingId(null);
    onDragStateChange?.(false);
    setDragAnnouncement(cancel ? "Reorder cancelled." : "Block placed.");
    focus(session.id, true);
  }
  return (
    <div
      ref={canvas}
      className="form-document rounded-xl border bg-white"
      aria-label="Form document"
      data-dragging={draggingId ? true : undefined}
    >
      {draggingId && <FormDragScrollHints />}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {dragAnnouncement}
      </p>
      <div className="flex flex-wrap justify-between gap-3 border-b px-5 py-3 text-xs text-muted-foreground">
        <span>Build your form, one block at a time.</span>
        <span>{content.questions.length} / 30 questions</span>
      </div>
      <div className="form-document-body mx-auto max-w-3xl px-4 py-8 sm:px-10 sm:py-12">
        <div className="px-3 mb-5 space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Welcome screen
          </p>
          <textarea
            aria-label="Form title"
            rows={1}
            maxLength={120}
            className="form-inline form-document-title serif"
            value={content.name}
            placeholder="Give your form a title"
            onChange={(e) =>
              onChange({ name: e.target.value.replace(/[\r\n]/g, " ") })
            }
          />
          <textarea
            aria-label="Form introduction"
            rows={2}
            maxLength={1000}
            className="form-inline text-muted-foreground"
            value={content.description}
            placeholder="Introduce your form…"
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
        <Notice>{propertyError}</Notice>
        {removed && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 mx-3 mb-3 rounded-lg bg-muted p-3 text-sm"
          >
            <span>Question removed.</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={full}
              onClick={() => {
                const questions = [...content.questions];
                questions.splice(
                  Math.min(removed.index, questions.length),
                  0,
                  removed.question,
                );
                onChange({ questions });
                focus(removed.question.id);
                setRemoved(null);
              }}
            >
              Undo
            </Button>
          </div>
        )}
        <LayoutGroup>
          <Reorder.Group
            as="div"
            axis="y"
            values={content.questions.map((q) => q.id)}
            onReorder={reorder}
            className="relative min-w-0"
          >
            <AnimatePresence initial={false} mode="popLayout">
              {Array.from({ length: content.questions.length + 1 }, (_, i) => {
                const q = content.questions[i],
                  definition = q && blocks.find((b) => b.type === q.type)!;
                return (
                  <AnimatedBlock
                    key={q?.id ?? "end"}
                    reduced={reducedMotion}
                    structure={structure}
                    id={q?.id}
                    disabled={disabled}
                    onStart={() => {
                      if (q) startDrag(q.id);
                    }}
                    onFinish={finishDrag}
                  >
                    <div className="form-insertion">
                      {insertion === i ? (
                        <BlockPicker
                          existing={content.questions}
                          onChoose={(type) => insert(type, i)}
                          onClose={() => {
                            setInsertion(null);
                            requestAnimationFrame(() =>
                              canvas.current
                                ?.querySelector<HTMLButtonElement>(
                                  `[data-insertion-trigger="${i}"]`,
                                )
                                ?.focus(),
                            );
                          }}
                        />
                      ) : i === content.questions.length ? (
                        <button
                          type="button"
                          className="form-add-line"
                          data-insertion-trigger={i}
                          disabled={full}
                          onClick={() => setInsertion(i)}
                          onKeyDown={(e) => {
                            if (e.key === "/") {
                              e.preventDefault();
                              setInsertion(i);
                            }
                          }}
                        >
                          <Plus size={16} />
                          <span>
                            {full
                              ? "30 questions added"
                              : "Type / or click to add a block…"}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="form-insert-button"
                          data-insertion-trigger={i}
                          aria-label={`Insert block before question ${i + 1}`}
                          disabled={full}
                          onClick={() => setInsertion(i)}
                        >
                          <Plus size={14} />
                        </button>
                      )}
                    </div>
                    {q && definition && (
                      <section
                        role="group"
                        aria-label={`Question block ${i + 1}`}
                        className={`form-question-block ${active === q.id ? "form-question-active" : ""}`}
                        onFocusCapture={() => setActive(q.id)}
                      >
                        <div className="form-block-toolbar">
                          <div className="flex items-center gap-2 min-w-0">
                            <BlockDragHandle index={i} disabled={disabled} />
                            <span className="text-xs text-muted-foreground">
                              {i + 1}
                            </span>
                            <definition.icon
                              size={14}
                              className="text-muted-foreground"
                            />
                            <span className="text-xs text-muted-foreground">
                              {definition.name}
                            </span>
                          </div>
                          <div className="form-block-actions flex gap-0.5">
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Move question up"
                              disabled={i === 0}
                              onClick={() => move(q.id, i - 1)}
                            >
                              <ArrowUp />
                            </Button>
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Move question down"
                              disabled={i === content.questions.length - 1}
                              onClick={() => move(q.id, i + 1)}
                            >
                              <ArrowDown />
                            </Button>
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Duplicate question"
                              disabled={
                                full || ["email", "consent"].includes(q.type)
                              }
                              onClick={() => {
                                const copy = {
                                  ...q,
                                  id: freshId(),
                                  property: "",
                                };
                                const questions = [...content.questions];
                                questions.splice(i + 1, 0, copy);
                                onChange({ questions });
                                setInsertion(null);
                                focus(copy.id);
                              }}
                            >
                              <Copy />
                            </Button>
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Remove question"
                              disabled={content.questions.length === 1}
                              onClick={() => {
                                setRemoved({ question: q, index: i });
                                onChange({
                                  questions: content.questions.filter(
                                    (item) => item.id !== q.id,
                                  ),
                                });
                                setInsertion(null);
                                focus(
                                  content.questions[i + 1]?.id ??
                                    content.questions[i - 1]!.id,
                                );
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </div>
                        <div className="px-3 pb-3 space-y-3">
                          <textarea
                            data-question-id={q.id}
                            aria-label={`Question ${i + 1}`}
                            rows={1}
                            maxLength={200}
                            className="form-inline form-question-title"
                            placeholder="Write a question…"
                            value={q.label}
                            onChange={(e) =>
                              change(q.id, { label: e.target.value })
                            }
                          />
                          <textarea
                            aria-label={`Help text for question ${i + 1}`}
                            rows={1}
                            maxLength={500}
                            className="form-inline text-sm text-muted-foreground"
                            placeholder="Add a description (optional)"
                            value={q.description}
                            onChange={(e) =>
                              change(q.id, { description: e.target.value })
                            }
                          />
                          {q.type === "choice" ? (
                            <div className="space-y-2">
                              {q.options.map((option, index) => (
                                <div
                                  key={index}
                                  className="flex items-center gap-2"
                                >
                                  <span
                                    aria-hidden="true"
                                    className="h-4 w-4 rounded-full border shrink-0"
                                  />
                                  <input
                                    aria-label={`Choice ${index + 1} for question ${i + 1}`}
                                    className="form-option min-w-0 flex-1"
                                    value={option}
                                    maxLength={100}
                                    placeholder={`Option ${index + 1}`}
                                    onChange={(e) =>
                                      change(q.id, {
                                        options: q.options.map(
                                          (value, position) =>
                                            position === index
                                              ? e.target.value
                                              : value,
                                        ),
                                      })
                                    }
                                    onKeyDown={(e) => {
                                      if (
                                        e.key === "Enter" &&
                                        q.options.length < 20
                                      ) {
                                        e.preventDefault();
                                        change(q.id, {
                                          options: [
                                            ...q.options.slice(0, index + 1),
                                            "",
                                            ...q.options.slice(index + 1),
                                          ],
                                        });
                                        requestAnimationFrame(() =>
                                          canvas.current
                                            ?.querySelector<HTMLInputElement>(
                                              `[aria-label="Choice ${index + 2} for question ${i + 1}"]`,
                                            )
                                            ?.focus(),
                                        );
                                      }
                                    }}
                                  />
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    aria-label={`Remove choice ${index + 1} from question ${i + 1}`}
                                    disabled={q.options.length <= 2}
                                    onClick={() =>
                                      change(q.id, {
                                        options: q.options.filter(
                                          (_, position) => position !== index,
                                        ),
                                      })
                                    }
                                  >
                                    <X />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={q.options.length >= 20}
                                onClick={() =>
                                  change(q.id, {
                                    options: [
                                      ...q.options,
                                      `Option ${q.options.length + 1}`,
                                    ],
                                  })
                                }
                              >
                                <Plus size={14} />
                                Add option
                              </Button>
                            </div>
                          ) : q.type === "rating" ? (
                            <div aria-hidden="true" className="flex gap-2">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <span
                                  key={n}
                                  className="h-10 w-10 flex items-center justify-center rounded-md border text-sm text-muted-foreground"
                                >
                                  {n}
                                </span>
                              ))}
                            </div>
                          ) : q.type === "consent" ? (
                            <div
                              aria-hidden="true"
                              className="text-sm text-muted-foreground flex items-center gap-3"
                            >
                              <span className="h-4 w-4 rounded border" />
                              Optional opt-in · unchecked by default
                            </div>
                          ) : (
                            <div
                              aria-hidden="true"
                              className={`rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground ${q.type === "long_text" ? "min-h-20" : ""}`}
                            >
                              {q.type === "email"
                                ? "name@example.com"
                                : q.type === "long_text"
                                  ? "A longer answer goes here…"
                                  : "A short answer goes here…"}
                            </div>
                          )}
                          <div className="flex flex-wrap justify-between items-center gap-3 pt-1">
                            <label className="flex gap-2 text-xs items-center text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={q.required}
                                disabled={q.type === "consent"}
                                onChange={(e) =>
                                  change(q.id, { required: e.target.checked })
                                }
                              />
                              Required answer
                            </label>
                            <details className="form-block-settings">
                              <summary className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1.5">
                                <Settings2 size={13} />
                                Block settings
                                {q.property && (
                                  <span className="text-primary">
                                    {" "}
                                    · {q.property}
                                  </span>
                                )}
                              </summary>
                              <div className="mt-4 space-y-4 rounded-lg border bg-[#fafbf8] p-4">
                                <Field label="Answer type">
                                  <NativeSelect
                                    value={q.type}
                                    onChange={(e) => {
                                      const type = e.target.value as BlockType;
                                      change(q.id, {
                                        type,
                                        required:
                                          type === "consent"
                                            ? false
                                            : q.required,
                                        options:
                                          type === "choice"
                                            ? ["Option one", "Option two"]
                                            : [],
                                        property: "",
                                      });
                                    }}
                                  >
                                    {blocks.map((b) => (
                                      <option
                                        key={b.type}
                                        value={b.type}
                                        disabled={
                                          ["email", "consent"].includes(
                                            b.type,
                                          ) &&
                                          content.questions.some(
                                            (item) =>
                                              item.id !== q.id &&
                                              item.type === b.type,
                                          )
                                        }
                                      >
                                        {b.name}
                                      </option>
                                    ))}
                                  </NativeSelect>
                                </Field>
                                {!["consent", "email"].includes(q.type) ? (
                                  <Field label="Save answer to contact property">
                                    <NativeSelect
                                      value={q.property}
                                      onChange={(e) =>
                                        change(q.id, {
                                          property: e.target.value,
                                        })
                                      }
                                    >
                                      <option value="">
                                        Keep in response only
                                      </option>
                                      {q.type !== "rating" &&
                                        ["name", "first_name", "last_name"].map(
                                          (key) => (
                                            <option key={key}>{key}</option>
                                          ),
                                        )}
                                      {properties
                                        .filter(
                                          (p) =>
                                            p.type ===
                                            (q.type === "rating"
                                              ? "number"
                                              : "string"),
                                        )
                                        .map((p) => (
                                          <option key={p.key}>{p.key}</option>
                                        ))}
                                    </NativeSelect>
                                  </Field>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    {q.type === "email"
                                      ? "This address identifies the contact when contact sync is enabled."
                                      : "Consent is always optional. Describe the emails people will receive in the question."}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                  Mapped answers update contacts after email
                                  confirmation when contact sync is enabled in
                                  Settings.
                                </p>
                              </div>
                            </details>
                          </div>
                        </div>
                      </section>
                    )}
                  </AnimatedBlock>
                );
              })}
            </AnimatePresence>
            <motion.div
              layout={reducedMotion ? false : "position"}
              layoutDependency={structure}
              transition={{
                layout: {
                  type: "spring",
                  stiffness: 460,
                  damping: 38,
                  mass: 0.75,
                },
              }}
              className="mx-3 mt-10 pt-6 border-t space-y-3"
            >
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Thank-you screen
              </p>
              <textarea
                aria-label="Completion message"
                rows={2}
                maxLength={1000}
                className="form-inline"
                value={content.thankYou}
                onChange={(e) => onChange({ thankYou: e.target.value })}
              />
            </motion.div>
          </Reorder.Group>
        </LayoutGroup>
      </div>
    </div>
  );
}

function BlockPicker({
  existing,
  onChoose,
  onClose,
}: {
  existing: FormQuestion[];
  onChoose: (type: BlockType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("/"),
    [selected, setSelected] = useState(0);
  const id = useId();
  const available = blocks.filter(
    (b) =>
      !(
        ["email", "consent"].includes(b.type) &&
        existing.some((q) => q.type === b.type)
      ) &&
      `${b.name} ${b.type} ${b.hint}`
        .toLowerCase()
        .includes(query.replace(/^\//, "").toLowerCase()),
  );
  const index = Math.min(selected, Math.max(0, available.length - 1));
  return (
    <div className="form-block-picker rounded-xl border bg-white shadow-lg p-2 my-3">
      <div className="flex items-center gap-2 border-b pb-2 mb-2">
        <Plus size={16} className="ml-2 text-muted-foreground" />
        <input
          autoFocus
          role="combobox"
          aria-label="Search blocks"
          aria-expanded="true"
          aria-controls={`${id}-options`}
          aria-activedescendant={
            available.length ? `${id}-${index}` : undefined
          }
          aria-autocomplete="list"
          className="min-w-0 flex-1 px-2 py-2 outline-none text-sm"
          value={query}
          placeholder="Search blocks…"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSelected(
                Math.max(
                  0,
                  Math.min(
                    available.length - 1,
                    index + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            } else if (e.key === "Enter" && available[index]) {
              e.preventDefault();
              onChoose(available[index].type);
            }
          }}
        />
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Close block menu"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div role="listbox" id={`${id}-options`} aria-label="Block types">
        {available.map((b, i) => (
          <button
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={i === index}
            id={`${id}-${i}`}
            key={b.type}
            className={`flex gap-3 text-left items-center rounded-lg p-3 w-full ${i === index ? "bg-primary/10" : "hover:bg-muted"}`}
            onClick={() => onChoose(b.type)}
          >
            <b.icon size={18} className="text-primary" />
            <span>
              <span className="block text-sm font-medium">{b.name}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {b.hint}
              </span>
            </span>
          </button>
        ))}
      </div>
      {!available.length && (
        <p role="status" className="p-3 text-sm text-muted-foreground">
          No matching blocks. Email and consent can each be added once.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground px-3 pt-2">
        ↑ ↓ to choose · Enter to insert · Esc to close
      </p>
    </div>
  );
}
