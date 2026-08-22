// ===== Mobile Forge (Pro-tier AI practice problem generator) =====
// Mobile-optimized view of Forge — a problem set list with stats and a
// "Generate" sheet, plus a one-problem-at-a-time practice flow (answer,
// submit, see graded feedback + worked solution, try a variant or move on).
// This fits touch screens naturally since desktop's list-based problem
// browsing collapses into a single focused card per problem.

import { useState, useEffect, useCallback } from "react";
import {
  Flame, Plus, Trash2, Loader2, AlertCircle, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, Lightbulb, FileText,
  Network, Type, Sparkles, RotateCw, Award,
} from "lucide-react";
import {
  forgeApi,
  type ForgeProblemSetSummary, type ForgeProblemSet, type ForgeProblem,
  type ForgeAttempt, type ForgeSource, type ForgeStats,
} from "../services/forge";
import { notesApi } from "../services/notes";
import { filesApi } from "../services/files";
import type { VFile } from "../types";
import type { MobileTool } from "./MobileLauncher";
import {
  MobileContainer, MobileHeader, MobileLoading, MobileCard,
  MobileChip, MobileButton, MobileModal, MobileMarkdown, MobileSelect,
  MobileTextarea,
} from "./MobileUi";

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
  adaptive: "text-accent",
};

const SOURCE_ICONS: Record<string, typeof FileText> = {
  note: FileText,
  file: FileText,
  atlas: Network,
  text: Type,
};

export default function MobileForge({ onClose }: { onClose: () => void; onOpenTool: (tool: MobileTool) => void }) {
  const [sets, setSets] = useState<ForgeProblemSetSummary[]>([]);
  const [stats, setStats] = useState<ForgeStats | null>(null);
  const [activeSet, setActiveSet] = useState<ForgeProblemSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const loadSets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, statsRes] = await Promise.all([forgeApi.listSets(), forgeApi.getStats()]);
      setSets(res.sets);
      setStats(statsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load problem sets");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSet = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await forgeApi.getSet(id);
      setActiveSet(res.set);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load problem set");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSets(); }, [loadSets]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this problem set and all its problems?")) return;
    try {
      await forgeApi.deleteSet(id);
      await loadSets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete set");
    }
  };

  if (activeSet) {
    return <PracticeView set={activeSet} onBack={() => { setActiveSet(null); void loadSets(); }} />;
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Forge"
        subtitle="Practice problems"
        onClose={onClose}
        right={
          <button
            onClick={() => setShowGenerate(true)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-fg active:scale-[.97]"
            aria-label="Generate"
          >
            <Plus size={20} />
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <MobileLoading />
      ) : (
        <>
          {stats && sets.length > 0 && (
            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
                <p className="text-2xl font-bold text-ink">{stats.totalProblems}</p>
                <p className="text-[11px] text-ink-muted">Problems</p>
              </div>
              <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
                <p className="text-2xl font-bold text-ink">{stats.totalAttempts}</p>
                <p className="text-[11px] text-ink-muted">Attempts</p>
              </div>
              <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
                <p className="text-2xl font-bold text-ink">{stats.totalAttempts > 0 ? `${Math.round(stats.avgScore * 100)}%` : "—"}</p>
                <p className="text-[11px] text-ink-muted">Avg score</p>
              </div>
            </div>
          )}

          {sets.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/15">
                <Flame size={32} className="text-accent" />
              </div>
              <p className="max-w-xs text-sm leading-6 text-ink-muted">
                Forge generates graded practice problems from your notes, files, or Atlas — worked solutions included.
              </p>
              <button
                onClick={() => setShowGenerate(true)}
                className="flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-fg active:scale-[.98]"
              >
                <Sparkles size={16} /> Generate a set
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {sets.map((set) => {
                const SourceIcon = SOURCE_ICONS[set.source.kind] ?? FileText;
                return (
                  <MobileCard key={set.id} onClick={() => void loadSet(set.id)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-ink">{set.title}</p>
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
                          <SourceIcon size={11} /> <span className="truncate">{set.source.name}</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleDelete(set.id); }}
                        className="shrink-0 rounded-lg p-1.5 text-ink-muted active:bg-surface-3 active:text-red-300"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-ink-muted">{set.count} problems</span>
                      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-ink-muted">{FORMAT_LABELS[set.format] ?? set.format}</span>
                      <span className={`rounded-full bg-surface-3 px-2 py-0.5 ${DIFFICULTY_COLORS[set.difficulty] ?? "text-ink-muted"}`}>{set.difficulty}</span>
                    </div>
                  </MobileCard>
                );
              })}
            </div>
          )}
        </>
      )}

      <GenerateSheet
        open={showGenerate}
        onCancel={() => setShowGenerate(false)}
        onComplete={(id) => { setShowGenerate(false); void loadSet(id); }}
      />
    </MobileContainer>
  );
}

// ----- practice view -----

function PracticeView({ set, onBack }: { set: ForgeProblemSet; onBack: () => void }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState<Record<string, ForgeAttempt>>({});
  const [grading, setGrading] = useState<string | null>(null);
  const [showHint, setShowHint] = useState<Record<string, boolean>>({});
  const [variantLoading, setVariantLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const setRes = await forgeApi.getSet(set.id);
      const newProblem = setRes.set.problems.find((p) => p.id === res.id);
      if (newProblem) {
        setProblems((prev) => {
          const updated = [...prev];
          updated.splice(currentIdx + 1, 0, newProblem);
          return updated;
        });
        setCurrentIdx((i) => i + 1);
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
      <MobileContainer>
        <MobileHeader title="Forge" subtitle={set.title} onBack={onBack} />
        <div className="flex flex-col items-center gap-4 py-14 text-center">
          <CheckCircle2 size={44} className="text-emerald-400" />
          <p className="text-sm text-ink">All done with this set!</p>
          <MobileButton onClick={onBack}>Back to sets</MobileButton>
        </div>
      </MobileContainer>
    );
  }

  return (
    <MobileContainer>
      <MobileHeader
        title="Forge"
        subtitle={set.title}
        onBack={onBack}
        compact
        right={<span className="text-sm font-medium text-ink-muted">{currentIdx + 1} / {problems.length}</span>}
      />

      {/* Progress bar */}
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full bg-accent transition-all" style={{ width: `${((currentIdx + 1) / problems.length) * 100}%` }} />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Meta */}
      <div className="mb-3 flex items-center gap-1.5 text-[11px]">
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-ink-muted">{FORMAT_LABELS[problem.type] ?? problem.type}</span>
        <span className={`rounded-full bg-surface-3 px-2 py-0.5 ${DIFFICULTY_COLORS[problem.difficulty] ?? "text-ink-muted"}`}>{problem.difficulty}</span>
      </div>

      {/* Prompt */}
      <div className="mb-4 rounded-2xl border border-edge bg-surface-2 p-4">
        <MobileMarkdown content={problem.prompt} />
      </div>

      {/* Hint */}
      {problem.hint && !attempt && (
        showHint[problem.id] ? (
          <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-200">
            <span className="font-semibold">Hint:</span> <MobileMarkdown content={problem.hint} className="inline" />
          </div>
        ) : (
          <button
            onClick={() => setShowHint((prev) => ({ ...prev, [problem.id]: true }))}
            className="mb-4 flex items-center gap-1.5 text-sm text-amber-400 active:opacity-70"
          >
            <Lightbulb size={14} /> Show hint
          </button>
        )
      )}

      {/* Answer input */}
      {!attempt && (
        <div className="mb-4 space-y-3">
          {problem.type === "mcq" && problem.options.length > 0 ? (
            <div className="space-y-2">
              {problem.options.map((opt) => {
                const selected = answers[problem.id] === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setAnswers((prev) => ({ ...prev, [problem.id]: opt.id }))}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left text-sm transition ${
                      selected ? "border-accent bg-accent/10 text-ink" : "border-edge bg-surface-2 text-ink-muted active:bg-surface-3"
                    }`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      selected ? "bg-accent text-accent-fg" : "bg-surface-3 text-ink-muted"
                    }`}>
                      {opt.id}
                    </span>
                    <span>{opt.text}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <MobileTextarea
              value={answers[problem.id] ?? ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [problem.id]: e.target.value }))}
              placeholder={problem.type === "step_by_step" ? "Enter your solution step by step…" : "Enter your answer…"}
              rows={problem.type === "step_by_step" ? 7 : 4}
            />
          )}
          <MobileButton
            onClick={handleSubmit}
            disabled={!answers[problem.id]?.trim() || grading === problem.id}
            className="w-full"
          >
            {grading === problem.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Submit answer
          </MobileButton>
        </div>
      )}

      {/* Feedback */}
      {attempt && (
        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 ${
            attempt.result === "correct" ? "border-emerald-500/30 bg-emerald-500/10"
            : attempt.result === "partial" ? "border-amber-500/30 bg-amber-500/10"
            : "border-red-500/30 bg-red-500/10"
          }`}>
            <div className="mb-2 flex items-center gap-2">
              {attempt.result === "correct" ? <CheckCircle2 size={18} className="text-emerald-400" />
                : attempt.result === "partial" ? <AlertTriangle size={18} className="text-amber-400" />
                : <XCircle size={18} className="text-red-400" />}
              <span className={`text-sm font-semibold ${
                attempt.result === "correct" ? "text-emerald-400" : attempt.result === "partial" ? "text-amber-400" : "text-red-400"
              }`}>
                {attempt.result === "correct" ? "Correct!" : attempt.result === "partial" ? "Partially correct" : "Incorrect"}
              </span>
              <span className="text-xs text-ink-muted">Score: {Math.round(attempt.score * 100)}%</span>
            </div>
            <MobileMarkdown content={attempt.feedback.summary} />

            {attempt.feedback.steps && attempt.feedback.steps.length > 0 && (
              <div className="mt-3 space-y-2">
                {attempt.feedback.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {step.correct ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-400" /> : <XCircle size={13} className="mt-0.5 shrink-0 text-red-400" />}
                    <div className="min-w-0 flex-1">
                      <MobileMarkdown content={step.step} className="text-xs" />
                      {!step.correct && <MobileMarkdown content={step.explanation} className="mt-0.5 text-xs text-ink-muted" />}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {attempt.feedback.misconception && (
              <div className="mt-3 rounded-xl bg-black/10 p-2.5 text-xs text-ink-muted">
                <span className="font-medium text-ink">Misconception:</span> <MobileMarkdown content={attempt.feedback.misconception} className="inline" />
              </div>
            )}
          </div>

          {/* Worked solution */}
          <div className="rounded-2xl border border-edge bg-surface-2 p-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Award size={13} /> Worked solution
            </h4>
            <MobileMarkdown content={problem.solution} />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {attempt.result !== "correct" && (
              <MobileButton variant="ghost" onClick={handleVariant} disabled={variantLoading}>
                {variantLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                Try a variant
              </MobileButton>
            )}
            {isLast ? (
              <MobileButton onClick={onBack}>Finish</MobileButton>
            ) : (
              <MobileButton onClick={() => setCurrentIdx((i) => i + 1)}>
                Next problem <ChevronRight size={14} />
              </MobileButton>
            )}
          </div>
        </div>
      )}
    </MobileContainer>
  );
}

// ----- generate sheet -----

function GenerateSheet({
  open, onComplete, onCancel,
}: {
  open: boolean;
  onComplete: (setId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [sourceKind, setSourceKind] = useState<ForgeSource["kind"]>("text");
  const [sourceText, setSourceText] = useState("");
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
    if (!open) return;
    if (sourceKind === "note") {
      notesApi.list().then((res) => setNotes(res.notes.map((n) => ({ id: n.id, title: n.title })))).catch(() => {});
    } else if (sourceKind === "file") {
      filesApi.all().then((res) => setFiles(res.files)).catch(() => {});
    }
  }, [open, sourceKind]);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const source: ForgeSource = { kind: sourceKind, name: "Practice Set" };
      if (sourceKind === "text") {
        if (!sourceText.trim()) throw new Error("Please enter some text to generate problems from.");
        source.text = sourceText;
      } else if (sourceKind === "note") {
        if (!selectedNoteId) throw new Error("Please select a note.");
        source.refId = selectedNoteId;
        source.name = notes.find((n) => n.id === selectedNoteId)?.title ?? "Note";
      } else if (sourceKind === "file") {
        if (!selectedFileId) throw new Error("Please select a file.");
        source.refId = selectedFileId;
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
      setTitle("");
      setSourceText("");
      onComplete(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <MobileModal open={open} onClose={onCancel} title="Generate practice problems">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full rounded-xl border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-muted"
      />

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase text-ink-muted">Source</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {([
            { key: "text", label: "Text", icon: Type },
            { key: "note", label: "Note", icon: FileText },
            { key: "file", label: "File", icon: FileText },
            { key: "atlas", label: "Atlas", icon: Network },
          ] as const).map(({ key, label, icon: Icon }) => (
            <MobileChip key={key} active={sourceKind === key} onClick={() => setSourceKind(key)}>
              <span className="flex items-center gap-1.5"><Icon size={13} /> {label}</span>
            </MobileChip>
          ))}
        </div>
      </div>

      {sourceKind === "text" && (
        <MobileTextarea
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="Paste the text you want to generate problems from…"
          rows={4}
        />
      )}
      {sourceKind === "note" && (
        <MobileSelect value={selectedNoteId} onChange={(e) => setSelectedNoteId(e.target.value)}>
          <option value="">Select a note…</option>
          {notes.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
        </MobileSelect>
      )}
      {sourceKind === "file" && (
        <MobileSelect value={selectedFileId} onChange={(e) => setSelectedFileId(e.target.value)}>
          <option value="">Select a file…</option>
          {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </MobileSelect>
      )}
      {sourceKind === "atlas" && (
        <p className="rounded-xl bg-accent/10 p-3 text-xs leading-5 text-accent">
          Problems will be generated from your Atlas knowledge graph concepts, targeting weak areas.
        </p>
      )}

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase text-ink-muted">Format</p>
        <MobileSelect value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
          <option value="mixed">Mixed</option>
          <option value="mcq">Multiple choice</option>
          <option value="short_answer">Short answer</option>
          <option value="step_by_step">Step by step</option>
        </MobileSelect>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase text-ink-muted">Difficulty</p>
        <MobileSelect value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
          <option value="adaptive">Adaptive (targets weak concepts)</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </MobileSelect>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase text-ink-muted">Number of problems: {count}</p>
        <input
          type="range"
          min={3}
          max={20}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="w-full accent-accent"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <MobileButton onClick={handleSubmit} disabled={loading} className="w-full">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        Generate
      </MobileButton>
    </MobileModal>
  );
}
