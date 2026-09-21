// ===== Shared Teach Me panels (desktop + mobile) =====
// Presentational pieces used by both TeacherMode (desktop) and MobileTeach:
// the lesson agenda, mastery summary, tool-progress chips, comprehension
// cards, pace feedback and the export menu.

import { useState } from "react";
import {
  BookOpen, Check, ChevronDown, Loader2, ListChecks, Sparkles,
  FileText, Layers, HelpCircle, ListTodo, Gauge, X,
} from "lucide-react";
import type {
  TeacherLessonPlan,
  TeacherMasteryEntry,
  PaceFeedback,
} from "../../services/teacher";
import type { ComprehensionCheck, ToolChip } from "./useTeacherSession";
import CitationMarkdown from "./CitationMarkdown";
import type { CitationMeta } from "./CitationMarkdown";
import type { CitationTarget } from "./studyMarkdown";

/** Pass rate of a concept, 0..1 (0 when never checked). */
export function passRate(entry: TeacherMasteryEntry | undefined): number {
  if (!entry || entry.checksTotal === 0) return 0;
  return entry.checksPassed / entry.checksTotal;
}

// ----- lesson agenda -----

export function LessonAgenda({
  plan,
  covered,
  mastery,
  followPlan,
  onToggleFollow,
  onRegenerate,
  planning,
}: {
  plan?: TeacherLessonPlan;
  covered: string[];
  mastery: Record<string, TeacherMasteryEntry>;
  followPlan: boolean;
  onToggleFollow: (v: boolean) => void;
  onRegenerate: () => void;
  planning: boolean;
}) {
  const [open, setOpen] = useState(true);
  const coveredSet = new Set(covered.map((c) => c.toLowerCase()));

  if (!plan) {
    return (
      <button
        onClick={onRegenerate}
        disabled={planning}
        className="flex items-center gap-1.5 self-start rounded-md border border-edge px-2 py-1 text-[11px] text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        {planning ? <Loader2 size={11} className="animate-spin" /> : <ListChecks size={11} />}
        {planning ? "Building a lesson plan…" : "Build a lesson plan"}
      </button>
    );
  }

  const done = plan.keyConcepts.filter((c) => coveredSet.has(c.toLowerCase())).length;

  return (
    <div className="rounded-lg border border-edge bg-surface-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-ink"
      >
        <ChevronDown size={12} className={`shrink-0 text-ink-muted transition ${open ? "" : "-rotate-90"}`} />
        <ListChecks size={12} className="shrink-0 text-accent" />
        <span className="flex-1 truncate font-medium">{plan.title}</span>
        <span className="shrink-0 text-[10px] text-ink-muted">
          {done}/{plan.keyConcepts.length} concepts
        </span>
      </button>
      {open && (
        <div className="flex max-h-[min(16rem,40vh)] flex-col gap-2 overflow-y-auto border-t border-edge px-2.5 py-2">
          {plan.objectives.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {plan.objectives.map((o, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-ink-muted">• {o}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1">
            {plan.keyConcepts.map((concept) => {
              const isCovered = coveredSet.has(concept.toLowerCase());
              const rate = passRate(mastery[concept]);
              const strong = rate >= 0.8;
              const weak = mastery[concept] && rate < 0.6;
              return (
                <span
                  key={concept}
                  title={
                    mastery[concept]
                      ? `${mastery[concept].checksPassed}/${mastery[concept].checksTotal} checks passed`
                      : "Not checked yet"
                  }
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                    strong
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : weak
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                        : isCovered
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-edge text-ink-muted"
                  }`}
                >
                  {isCovered && <Check size={9} />} {concept}
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-edge p-0.5">
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  onClick={() => onToggleFollow(v)}
                  className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                    followPlan === v ? "bg-accent/15 text-accent" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {v ? "Follow plan" : "Explore freely"}
                </button>
              ))}
            </div>
            <button
              onClick={onRegenerate}
              disabled={planning}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink disabled:opacity-50"
            >
              {planning ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Rebuild
            </button>
            {plan.estimatedTurns ? (
              <span className="text-[10px] text-ink-muted">~{plan.estimatedTurns} turns</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ----- tool progress chips -----

export function ToolChipRow({ chips }: { chips: ToolChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.id}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-opacity duration-500 ${
            c.done
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400 opacity-60"
              : "border-accent/40 bg-accent/10 text-accent"
          }`}
        >
          {c.done ? <Check size={9} /> : <Loader2 size={9} className="animate-spin" />}
          {c.label}
        </span>
      ))}
    </div>
  );
}

// ----- comprehension check -----

export function ComprehensionCard({
  check,
  onAnswer,
  citations,
  onOpenCitation,
  fullWidth = false,
}: {
  check: ComprehensionCheck;
  onAnswer: (answer: string) => void;
  citations?: CitationMeta[];
  onOpenCitation?: (target: CitationTarget) => void;
  fullWidth?: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const assessment = check.assessment;
  const graded = check.answered && !check.grading && assessment;
  const tone = !graded
    ? "border-accent/40 bg-accent/10"
    : assessment.passed
      ? "border-emerald-500/40 bg-emerald-500/10"
      : "border-amber-500/50 bg-amber-500/10";

  return (
    <div className={fullWidth ? "w-full" : "flex justify-start"}>
      <div className={`rounded-lg border px-3 py-2.5 text-sm ${tone} ${fullWidth ? "w-full" : "max-w-[85%]"}`}>
        <div
          className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold ${
            graded ? (assessment.passed ? "text-emerald-400" : "text-amber-400") : "text-accent"
          }`}
        >
          <BookOpen size={13} />
          {graded ? (assessment.passed ? "Correct" : "Not quite") : "Comprehension check"}
          {check.grading && <Loader2 size={11} className="animate-spin" />}
        </div>
        <div className="mb-2 text-ink">
          <CitationMarkdown
            content={check.question}
            citations={citations}
            onOpenCitation={onOpenCitation}
            className="text-sm"
          />
        </div>

        {check.answered ? (
          <div className="flex flex-col gap-1">
            <div className="text-xs text-ink-muted">
              Your answer: <CitationMarkdown content={check.answer ?? ""} className="text-xs" />
            </div>
            {check.grading && <p className="text-xs text-ink-muted">Checking your answer…</p>}
            {assessment && (
              <div className="text-xs text-ink">
                <CitationMarkdown content={assessment.feedback} citations={citations} onOpenCitation={onOpenCitation} className="text-xs" />
              </div>
            )}
            {assessment?.misconception && (
              <div className="text-[11px] text-amber-400">
                Watch out: <CitationMarkdown content={assessment.misconception} className="text-[11px]" />
              </div>
            )}
          </div>
        ) : check.options && check.options.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {check.options.map((opt) => (
              <button
                key={opt}
                onClick={() => onAnswer(opt)}
                className="rounded-md border border-edge bg-surface px-2.5 py-2 text-left text-xs text-ink transition hover:border-accent/50 hover:bg-surface-2"
              >
                <CitationMarkdown content={opt} citations={citations} onOpenCitation={onOpenCitation} className="text-xs" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (answer.trim()) onAnswer(answer.trim());
                }
              }}
              placeholder="Your answer…"
              rows={1}
              className="flex-1 resize-none rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink outline-none placeholder:text-ink-muted focus:border-accent/50"
            />
            <button
              onClick={() => answer.trim() && onAnswer(answer.trim())}
              className="flex items-center gap-1 rounded-md bg-accent px-2 py-1.5 text-xs text-white hover:bg-accent/90"
            >
              <Check size={12} /> Answer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- pace feedback -----

const PACE_LABELS: Record<PaceFeedback, string> = {
  too_easy: "Too easy",
  just_right: "Just right",
  too_hard: "Too hard",
};

export function PaceFeedbackRow({
  value,
  onChange,
}: {
  value?: string;
  onChange: (v: PaceFeedback) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Gauge size={11} className="text-ink-muted" />
      {(Object.keys(PACE_LABELS) as PaceFeedback[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`rounded-md px-1.5 py-0.5 text-[10px] transition ${
            value === p ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {PACE_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

// ----- export menu -----

const EXPORT_TARGETS: { target: "note" | "flashcards" | "quiz" | "tasks"; label: string; icon: typeof FileText }[] = [
  { target: "note", label: "Save as note", icon: FileText },
  { target: "flashcards", label: "Create flashcards", icon: Layers },
  { target: "quiz", label: "Create a quiz", icon: HelpCircle },
  { target: "tasks", label: "Add review tasks", icon: ListTodo },
];

export function ExportMenu({
  onExport,
  exporting,
  result,
  onDismissResult,
}: {
  onExport: (target: "note" | "flashcards" | "quiz" | "tasks") => void;
  exporting: string | null;
  result: string;
  onDismissResult: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-muted transition hover:bg-surface-2 hover:text-ink"
      >
        <Sparkles size={11} /> Export
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-lg border border-edge bg-surface py-1 shadow-window">
          {EXPORT_TARGETS.map(({ target, label, icon: Icon }) => (
            <button
              key={target}
              onClick={() => { onExport(target); setOpen(false); }}
              disabled={exporting !== null}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              {exporting === target ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
              {label}
            </button>
          ))}
        </div>
      )}
      {result && (
        <div className="absolute right-0 top-full z-30 mt-1 flex w-56 items-start gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-300 shadow-window">
          <Check size={11} className="mt-0.5 shrink-0" />
          <span className="flex-1">{result}</span>
          <button onClick={onDismissResult} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
