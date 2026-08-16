// ===== Forge app (Pro-tier AI practice problem generator) =====
// Generates graded practice problems from sources (notes, files, Atlas
// concepts, or free text). The student works through problems, submits
// answers, gets LLM-graded feedback with worked solutions, and can request
// variant problems for incorrect answers.
//
// UI: two-state layout —
//   1. Set list: shows all problem sets with stats + "Generate" button
//   2. Practice view: shows problems one at a time with answer input,
//      grading feedback, solution reveal, and variant generation.
//
// Integrates with Atlas (adaptive difficulty targets weak concepts) and
// Pulse (mastery signals). Athena can generate sets via tools and open
// the app focused on a specific set.

import { useState, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  Flame, Plus, Trash2, RefreshCw, Loader2, AlertCircle, X,
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, AlertTriangle,
  Lightbulb, FileText, Brain, Network, Type, Sparkles, RotateCw,
  TrendingUp, Award,
} from "lucide-react";
import {
  forgeApi,
  type ForgeProblemSetSummary, type ForgeProblemSet, type ForgeProblem,
  type ForgeAttempt, type ForgeSource, type ForgeStats,
} from "../../services/forge";
import { filesApi } from "../../services/files";
import { notesApi } from "../../services/notes";
import { useWindows } from "../../store/windows";
import type { WindowInstance } from "../../store/windows";
import type { VFile } from "../../types";

// ----- helpers -----

const FORMAT_LABELS: Record<string, string> = {
  mcq: "Multiple Choice",
  short_answer: "Short Answer",
  step_by_step: "Step by Step",
  mixed: "Mixed",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "text-emerald-400",
  medium: "text-amber-400",
  hard: "text-red-400",
  adaptive: "text-indigo-400",
};

const SOURCE_ICONS: Record<string, typeof FileText> = {
  note: FileText,
  file: FileText,
  atlas: Network,
  text: Type,
};

/** Renders Markdown content (with GFM + math support) inline. */
function MarkdownText({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`selectable markdown-body prose-sm max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-orange-400 underline hover:opacity-80">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ----- main component -----

export default function ForgeApp({ win }: { win: WindowInstance }) {
  const { open } = useWindows();
  const [sets, setSets] = useState<ForgeProblemSetSummary[]>([]);
  const [activeSet, setActiveSet] = useState<ForgeProblemSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [stats, setStats] = useState<ForgeStats | null>(null);

  const loadSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, statsRes] = await Promise.all([
        forgeApi.listSets(),
        forgeApi.getStats(),
      ]);
      setSets(res.sets);
      setStats(statsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load problem sets");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSet = useCallback(async (setId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await forgeApi.getSet(setId);
      setActiveSet(res.set);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load problem set");
    } finally {
      setLoading(false);
    }
  }, []);

  // Focus on a specific set (from Athena open_forge client action).
  useEffect(() => {
    const focusSetId = sessionStorage.getItem(`forge:focus:${win.id}`);
    if (focusSetId) {
      sessionStorage.removeItem(`forge:focus:${win.id}`);
      loadSet(focusSetId);
    } else {
      loadSets();
    }
  }, [win.id, loadSets, loadSet]);

  const handleDeleteSet = async (setId: string) => {
    if (!confirm("Delete this problem set and all its problems?")) return;
    try {
      await forgeApi.deleteSet(setId);
      await loadSets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete set");
    }
  };

  const handleGenerateComplete = async (setId: string) => {
    setShowGenerate(false);
    await loadSet(setId);
  };

  if (loading && !activeSet && sets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (error && !activeSet) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="text-red-400" size={32} />
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => { setError(null); loadSets(); }}
          className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs hover:brightness-110"
        >
          Retry
        </button>
      </div>
    );
  }

  if (activeSet) {
    return (
      <PracticeView
        set={activeSet}
        onBack={() => { setActiveSet(null); loadSets(); }}
      />
    );
  }

  return (
    <SetListView
      sets={sets}
      stats={stats}
      onOpen={loadSet}
      onDelete={handleDeleteSet}
      onGenerate={() => setShowGenerate(true)}
      onRefresh={loadSets}
    >
      {showGenerate && (
        <GenerateDialog
          onComplete={handleGenerateComplete}
          onCancel={() => setShowGenerate(false)}
        />
      )}
    </SetListView>
  );
}

// ----- set list view -----

function SetListView({
  sets, stats, onOpen, onDelete, onGenerate, onRefresh, children,
}: {
  sets: ForgeProblemSetSummary[];
  stats: ForgeStats | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onGenerate: () => void;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-3 px-4 py-2">
        <div className="flex items-center gap-2">
          <Flame className="text-orange-400" size={18} />
          <h2 className="text-sm font-semibold text-ink">Forge</h2>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-ink-muted">
            {sets.length} set{sets.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onGenerate}
            className="flex items-center gap-1 rounded-lg bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-500"
          >
            <Plus size={14} /> Generate
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="flex items-center gap-4 border-b border-surface-3 bg-surface-2 px-4 py-2 text-xs text-ink-muted">
          <span className="flex items-center gap-1">
            <FileText size={12} /> {stats.totalProblems} problems
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 size={12} /> {stats.totalAttempts} attempts
          </span>
          {stats.totalAttempts > 0 && (
            <span className="flex items-center gap-1">
              <TrendingUp size={12} /> avg {(stats.avgScore * 100).toFixed(0)}%
            </span>
          )}
          {stats.conceptsTargeted > 0 && (
            <span className="flex items-center gap-1">
              <Brain size={12} /> {stats.conceptsTargeted} concepts
            </span>
          )}
        </div>
      )}

      {/* Set list */}
      <div className="flex-1 overflow-y-auto p-4">
        {sets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Flame className="text-ink-muted" size={48} />
            <p className="text-sm text-ink-muted">No practice problem sets yet.</p>
            <p className="text-xs text-ink-muted">Generate problems from notes, files, or your Atlas knowledge graph.</p>
            <button
              onClick={onGenerate}
              className="flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-1.5 text-xs text-white hover:bg-orange-500"
            >
              <Plus size={14} /> Generate First Set
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((set) => {
              const SourceIcon = SOURCE_ICONS[set.source.kind] ?? FileText;
              return (
                <div
                  key={set.id}
                  className="group cursor-pointer rounded-xl border border-surface-3 bg-surface-2 p-4 transition hover:border-orange-500/50 hover:bg-surface-3"
                  onClick={() => onOpen(set.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-ink">{set.title}</h3>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-muted">
                        <SourceIcon size={10} />
                        <span>{set.source.name}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(set.id); }}
                      className="rounded p-1 text-ink-muted opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[10px]">
                    <span className="rounded-full bg-surface-4 px-2 py-0.5 text-ink-muted">
                      {set.count} problems
                    </span>
                    <span className="rounded-full bg-surface-4 px-2 py-0.5 text-ink-muted">
                      {FORMAT_LABELS[set.format] ?? set.format}
                    </span>
                    <span className={`rounded-full bg-surface-4 px-2 py-0.5 ${DIFFICULTY_COLORS[set.difficulty] ?? "text-ink-muted"}`}>
                      {set.difficulty}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ----- practice view -----

function PracticeView({ set, onBack }: { set: ForgeProblemSet; onBack: () => void }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState<Record<string, ForgeAttempt>>({});
  const [grading, setGrading] = useState<string | null>(null);
  const [showSolution, setShowSolution] = useState<Record<string, boolean>>({});
  const [showHint, setShowHint] = useState<Record<string, boolean>>({});
  const [variantLoading, setVariantLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local copy of problems so we can append variants without reloading.
  const [problems, setProblems] = useState<ForgeProblem[]>(set.problems);

  const problem = problems[currentIdx];
  const isLast = currentIdx === problems.length - 1;
  const attempt = problem ? attempts[problem.id] : undefined;

  const handleSubmit = async () => {
    if (!problem) return;
    const submitted = answers[problem.id]?.trim();
    if (!submitted) return;
    setGrading(problem.id);
    setError(null);
    try {
      const res = await forgeApi.grade(problem.id, submitted);
      setAttempts((prev) => ({ ...prev, [problem.id]: res.attempt }));
      setShowSolution((prev) => ({ ...prev, [problem.id]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grading failed");
    } finally {
      setGrading(null);
    }
  };

  const handleVariant = async () => {
    if (!problem) return;
    setVariantLoading(true);
    setError(null);
    try {
      const res = await forgeApi.generateVariant(problem.id);
      // Fetch the new variant problem from the set.
      const setRes = await forgeApi.getSet(set.id);
      const newProblem = setRes.set.problems.find((p) => p.id === res.id);
      if (newProblem) {
        // Insert the new problem right after the current one.
        setProblems((prev) => {
          const updated = [...prev];
          updated.splice(currentIdx + 1, 0, newProblem);
          return updated;
        });
        // Navigate to the new variant problem.
        setCurrentIdx((i) => i + 1);
        // Clear the attempt/answer state for the new problem.
        setShowSolution((prev) => ({ ...prev, [newProblem.id]: false }));
        setShowHint((prev) => ({ ...prev, [newProblem.id]: false }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Variant generation failed");
    } finally {
      setVariantLoading(false);
    }
  };

  if (!problem) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <CheckCircle2 className="text-emerald-400" size={48} />
        <p className="text-sm text-ink">All done!</p>
        <button onClick={onBack} className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs hover:brightness-110">
          Back to sets
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-3 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <ChevronLeft size={14} /> Sets
          </button>
          <span className="text-ink-muted">/</span>
          <h2 className="truncate text-sm font-semibold text-ink">{set.title}</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span>{currentIdx + 1} / {set.problems.length}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-surface-3">
        <div
          className="h-full bg-orange-500 transition-all"
          style={{ width: `${((currentIdx + 1) / set.problems.length) * 100}%` }}
        />
      </div>

      {/* Problem content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          {/* Problem meta */}
          <div className="mb-4 flex items-center gap-2 text-[10px]">
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-ink-muted">
              {FORMAT_LABELS[problem.type] ?? problem.type}
            </span>
            <span className={`rounded-full bg-surface-3 px-2 py-0.5 ${DIFFICULTY_COLORS[problem.difficulty] ?? "text-ink-muted"}`}>
              {problem.difficulty}
            </span>
          </div>

          {/* Prompt */}
          <div className="mb-6 rounded-xl border border-surface-3 bg-surface-2 p-4">
            <MarkdownText content={problem.prompt} className="text-sm text-ink" />
          </div>

          {/* Hint */}
          {problem.hint && !showHint[problem.id] && !attempt && (
            <button
              onClick={() => setShowHint((prev) => ({ ...prev, [problem.id]: true }))}
              className="mb-4 flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
            >
              <Lightbulb size={12} /> Show hint
            </button>
          )}
          {showHint[problem.id] && problem.hint && (
            <div className="mb-4 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
              <span className="font-medium">Hint:</span>{" "}
              <MarkdownText content={problem.hint} className="text-xs text-amber-300" />
            </div>
          )}

          {/* Answer input */}
          {!attempt && (
            <div className="mb-4">
              {problem.type === "mcq" && problem.options.length > 0 ? (
                <div className="space-y-2">
                  {problem.options.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setAnswers((prev) => ({ ...prev, [problem.id]: opt.id }))}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition ${
                        answers[problem.id] === opt.id
                          ? "border-orange-500 bg-orange-500/10 text-ink"
                          : "border-surface-3 bg-surface-2 text-ink-muted hover:border-surface-4"
                      }`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                        answers[problem.id] === opt.id ? "bg-orange-500 text-white" : "bg-surface-4 text-ink-muted"
                      }`}>
                        {opt.id}
                      </span>
                      <span>{opt.text}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <textarea
                  value={answers[problem.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [problem.id]: e.target.value }))}
                  placeholder={problem.type === "step_by_step" ? "Enter your solution step by step..." : "Enter your answer..."}
                  rows={problem.type === "step_by_step" ? 8 : 4}
                  className="w-full rounded-lg border border-surface-3 bg-surface-2 p-3 text-sm text-ink placeholder:text-ink-muted focus:border-orange-500 focus:outline-none"
                />
              )}
              <button
                onClick={handleSubmit}
                disabled={!answers[problem.id]?.trim() || grading === problem.id}
                className="mt-3 flex items-center gap-1 rounded-lg bg-orange-600 px-4 py-2 text-sm text-white hover:bg-orange-500 disabled:opacity-50"
              >
                {grading === problem.id ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                Submit Answer
              </button>
            </div>
          )}

          {/* Feedback */}
          {attempt && (
            <div className="space-y-4">
              <div className={`rounded-xl border p-4 ${
                attempt.result === "correct"
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : attempt.result === "partial"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-red-500/30 bg-red-500/10"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {attempt.result === "correct" ? (
                    <CheckCircle2 className="text-emerald-400" size={18} />
                  ) : attempt.result === "partial" ? (
                    <AlertTriangle className="text-amber-400" size={18} />
                  ) : (
                    <XCircle className="text-red-400" size={18} />
                  )}
                  <span className={`text-sm font-medium ${
                    attempt.result === "correct" ? "text-emerald-400"
                    : attempt.result === "partial" ? "text-amber-400"
                    : "text-red-400"
                  }`}>
                    {attempt.result === "correct" ? "Correct!" : attempt.result === "partial" ? "Partially Correct" : "Incorrect"}
                  </span>
                  <span className="text-xs text-ink-muted">
                    Score: {(attempt.score * 100).toFixed(0)}%
                  </span>
                </div>
                <MarkdownText content={attempt.feedback.summary} className="text-sm text-ink" />

                {/* Per-step feedback */}
                {attempt.feedback.steps && attempt.feedback.steps.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {attempt.feedback.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        {step.correct ? (
                          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={12} />
                        ) : (
                          <XCircle className="mt-0.5 shrink-0 text-red-400" size={12} />
                        )}
                        <div className="min-w-0 flex-1">
                          <MarkdownText content={step.step} className="text-xs text-ink" />
                          {!step.correct && (
                            <MarkdownText content={step.explanation} className="mt-0.5 text-xs text-ink-muted" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Misconception */}
                {attempt.feedback.misconception && (
                  <div className="mt-3 rounded-lg bg-surface-2/50 p-2 text-xs text-ink-muted">
                    <span className="font-medium text-ink">Misconception:</span>{" "}
                    <MarkdownText content={attempt.feedback.misconception} className="text-xs text-ink-muted" />
                  </div>
                )}
              </div>

              {/* Solution */}
              {showSolution[problem.id] && (
                <div className="rounded-xl border border-surface-3 bg-surface-2 p-4">
                  <h4 className="mb-2 flex items-center gap-1 text-xs font-medium text-ink">
                    <Award size={12} /> Worked Solution
                  </h4>
                  <MarkdownText content={problem.solution} className="text-sm text-ink-muted" />
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                {attempt.result !== "correct" && (
                  <button
                    onClick={handleVariant}
                    disabled={variantLoading}
                    className="flex items-center gap-1 rounded-lg bg-surface-3 px-3 py-1.5 text-xs text-ink hover:brightness-110"
                  >
                    {variantLoading ? <Loader2 className="animate-spin" size={12} /> : <RotateCw size={12} />}
                    Try a Variant
                  </button>
                )}
                {!isLast && (
                  <button
                    onClick={() => setCurrentIdx((i) => i + 1)}
                    className="flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-1.5 text-xs text-white hover:bg-orange-500"
                  >
                    Next Problem <ChevronRight size={12} />
                  </button>
                )}
                {isLast && (
                  <button
                    onClick={onBack}
                    className="flex items-center gap-1 rounded-lg bg-surface-3 px-3 py-1.5 text-xs text-ink hover:brightness-110"
                  >
                    Finish
                  </button>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----- generate dialog -----

function GenerateDialog({
  onComplete, onCancel,
}: {
  onComplete: (setId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [sourceKind, setSourceKind] = useState<"note" | "file" | "atlas" | "text">("text");
  const [sourceText, setSourceText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [format, setFormat] = useState<"mcq" | "short_answer" | "step_by_step" | "mixed">("mixed");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "adaptive">("adaptive");
  const [count, setCount] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);
  const [files, setFiles] = useState<VFile[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState("");
  const [selectedFileId, setSelectedFileId] = useState("");

  useEffect(() => {
    if (sourceKind === "note") {
      notesApi.list().then((res) => setNotes(res.notes.map((n) => ({ id: n.id, title: n.title })))).catch(() => {});
    } else if (sourceKind === "file") {
      filesApi.all().then((res) => setFiles(res.files)).catch(() => {});
    }
  }, [sourceKind]);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const source: ForgeSource = { kind: sourceKind, name: sourceName || "Practice Set" };
      if (sourceKind === "text") {
        source.text = sourceText;
        if (!sourceText.trim()) throw new Error("Please enter some text to generate problems from.");
      } else if (sourceKind === "note") {
        source.refId = selectedNoteId;
        if (!selectedNoteId) throw new Error("Please select a note.");
        source.name = notes.find((n) => n.id === selectedNoteId)?.title ?? "Note";
      } else if (sourceKind === "file") {
        source.refId = selectedFileId;
        if (!selectedFileId) throw new Error("Please select a file.");
        source.name = files.find((f) => f.id === selectedFileId)?.name ?? "File";
      } else if (sourceKind === "atlas") {
        source.name = "Atlas Knowledge Graph";
      }

      const res = await forgeApi.generateSet({
        title: title.trim() || undefined,
        source,
        format,
        difficulty,
        count,
      });
      onComplete(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-surface-3 bg-surface-1 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkles className="text-orange-400" size={16} /> Generate Practice Problems
          </h3>
          <button onClick={onCancel} className="rounded p-1 text-ink-muted hover:bg-surface-3">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Calculus Practice — Derivatives"
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-orange-500 focus:outline-none"
            />
          </div>

          {/* Source type */}
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Source</label>
            <div className="grid grid-cols-4 gap-2">
              {([
                { key: "text", label: "Text", icon: Type },
                { key: "note", label: "Note", icon: FileText },
                { key: "file", label: "File", icon: FileText },
                { key: "atlas", label: "Atlas", icon: Network },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setSourceKind(key)}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition ${
                    sourceKind === key
                      ? "border-orange-500 bg-orange-500/10 text-ink"
                      : "border-surface-3 bg-surface-2 text-ink-muted hover:border-surface-4"
                  }`}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Source-specific input */}
          {sourceKind === "text" && (
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Paste the text you want to generate problems from..."
              rows={5}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-orange-500 focus:outline-none"
            />
          )}
          {sourceKind === "note" && (
            <select
              value={selectedNoteId}
              onChange={(e) => setSelectedNoteId(e.target.value)}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink focus:border-orange-500 focus:outline-none"
            >
              <option value="">Select a note...</option>
              {notes.map((n) => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
          )}
          {sourceKind === "file" && (
            <select
              value={selectedFileId}
              onChange={(e) => setSelectedFileId(e.target.value)}
              className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink focus:border-orange-500 focus:outline-none"
            >
              <option value="">Select a file...</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          {sourceKind === "atlas" && (
            <p className="rounded-lg bg-indigo-500/10 p-3 text-xs text-indigo-300">
              Problems will be generated from your Atlas knowledge graph concepts, targeting weak areas.
            </p>
          )}

          {/* Format + Difficulty */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-ink-muted">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as any)}
                className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink focus:border-orange-500 focus:outline-none"
              >
                <option value="mixed">Mixed</option>
                <option value="mcq">Multiple Choice</option>
                <option value="short_answer">Short Answer</option>
                <option value="step_by_step">Step by Step</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-muted">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as any)}
                className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink focus:border-orange-500 focus:outline-none"
              >
                <option value="adaptive">Adaptive (targets weak concepts)</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          {/* Count */}
          <div>
            <label className="mb-1 block text-xs text-ink-muted">Number of problems: {count}</label>
            <input
              type="range"
              min={3}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full accent-orange-500"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg bg-surface-3 px-4 py-2 text-xs text-ink-muted hover:brightness-110"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-1 rounded-lg bg-orange-600 px-4 py-2 text-xs text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
              Generate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
