// ===== Study Hub: Quiz Me =====
// Generate quiz questions from a source, answer one-by-one with instant AI
// grading + explanation, then see a final score.

import { useState, useEffect } from "react";
import { Sparkles, CheckCircle2, XCircle, RotateCcw, Award, Brain, Save, Filter } from "lucide-react";
import WorkspaceSourceSelector, { studySourceToDescriptor } from "./WorkspaceSourceSelector";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import { ActionButton, ErrorBanner, Loading, MarkdownView, PinnedGraph, PreselectedSource, SuccessBanner, TruncationNote } from "./ui";
import {
  studyApi,
  type SourceDescriptor,
  type QuizQuestion,
  type QuizGradeResult,
} from "../../services/study";
import { flashcardsApi } from "../../services/flashcards";
import { useWindows } from "../../store/windows";

type Phase = "setup" | "answering" | "feedback" | "done";

interface AnsweredQuestion extends QuizQuestion {
  userAnswer: string;
  result?: QuizGradeResult;
}

export default function QuizMe({
  initialSource,
  initialGraphId,
  preloadedQuizId,
  language,
}: {
  initialSource?: SourceDescriptor | null;
  initialGraphId?: string | null;
  preloadedQuizId?: string | null;
  language?: "en" | "cs";
}) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [pinnedSource, setPinnedSource] = useState<SourceDescriptor | null>(initialSource ?? null);
  const [graphId, setGraphId] = useState<string | null>(initialGraphId ?? null);
  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const getSources = async (): Promise<SourceDescriptor[]> => {
    if (pinnedSource) return [pinnedSource];
    const { sources: lib } = await studySourcesApi.list();
    return [...selectedSourceIds].map((id) => {
      const s = lib.find((x) => x.id === id);
      return s ? studySourceToDescriptor(s) : null;
    }).filter((x): x is SourceDescriptor => x !== null);
  };
  const [count, setCount] = useState(5);
  const [types, setTypes] = useState<Set<"mcq" | "short">>(new Set(["mcq", "short"]));
  const [phase, setPhase] = useState<Phase>("setup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [quizId, setQuizId] = useState("");
  const [questions, setQuestions] = useState<AnsweredQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<QuizGradeResult | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [reviewFilter, setReviewFilter] = useState<"all" | "correct" | "wrong">("all");
  const [flashcardsLoading, setFlashcardsLoading] = useState(false);
  const [flashcardsSuccess, setFlashcardsSuccess] = useState("");
  const [saveNoteLoading, setSaveNoteLoading] = useState(false);
  const [saveNoteSuccess, setSaveNoteSuccess] = useState("");
  const openWindow = useWindows((s) => s.open);

  // If opened with a preloaded quizId (from Athena's start_quiz tool), fetch
  // the pre-generated questions and jump straight into the answering phase.
  useEffect(() => {
    if (!preloadedQuizId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    studyApi
      .quizGet(preloadedQuizId)
      .then((res) => {
        if (cancelled) return;
        setQuizId(res.quizId);
        setSourceName(res.sourceName);
        setTruncated(res.truncated ?? false);
        setQuestions(res.questions.map((q) => ({ ...q, userAnswer: "" })));
        setPhase("answering");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load pre-generated quiz");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preloadedQuizId]);

  const toggleType = (t: "mcq" | "short") => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        if (next.size > 1) next.delete(t); // keep at least one
      } else next.add(t);
      return next;
    });
  };

  const hasSource = graphId !== null || pinnedSource !== null || selectedSourceIds.size > 0;

  const start = async () => {
    if (!hasSource) return;
    setLoading(true);
    setError("");
    setQuestions([]);
    setCurrent(0);
    setAnswer("");
    setFeedback(null);
    try {
      const res = await studyApi.quizStart({
        ...(graphId ? { graphId } : { sources: await getSources() }),
        questionCount: count,
        types: [...types],
        language,
      });
      setQuizId(res.quizId);
      setSourceName(res.sourceName);
      setTruncated(res.truncated);
      setQuestions(res.questions.map((q) => ({ ...q, userAnswer: "" })));
      setPhase("answering");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start quiz");
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    const q = questions[current];
    if (!q || !answer.trim() || !quizId) return;
    setLoading(true);
    setError("");
    try {
      const result = await studyApi.quizAnswer(quizId, { questionId: q.id, answer: answer.trim(), language });
      setFeedback(result);
      setQuestions((prev) =>
        prev.map((qq, i) => (i === current ? { ...qq, userAnswer: answer.trim(), result } : qq))
      );
      setPhase("feedback");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to grade answer");
    } finally {
      setLoading(false);
    }
  };

  const next = () => {
    if (current + 1 >= questions.length) {
      finish();
    } else {
      setCurrent((c) => c + 1);
      setAnswer("");
      setFeedback(null);
      setPhase("answering");
    }
  };

  const finish = async () => {
    const correctCount = questions.filter((q) => q.result?.correct).length;
    const total = questions.length;
    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    if (quizId) {
      try {
        await studyApi.quizFinish(quizId, { score, correct: correctCount, total, saveAsNote: false });
      } catch { /* non-fatal */ }
    }
    setPhase("done");
  };

  const restart = () => {
    setPhase("setup");
    setQuestions([]);
    setCurrent(0);
    setAnswer("");
    setFeedback(null);
    setQuizId("");
    setReviewFilter("all");
    setFlashcardsSuccess("");
    setSaveNoteSuccess("");
  };

  // Retry only the questions the user got wrong.
  const retryWrong = () => {
    const wrong = questions.filter((q) => !q.result?.correct);
    if (wrong.length === 0) return;
    // Reset the answered questions to only the wrong ones, clearing their results.
    setQuestions(wrong.map((q) => ({ ...q, userAnswer: "", result: undefined })));
    setCurrent(0);
    setAnswer("");
    setFeedback(null);
    setPhase("answering");
    setReviewFilter("all");
  };

  // Create a flashcard deck from the wrong answers (prompt → front, model answer → back).
  const makeFlashcardsFromMistakes = async () => {
    const wrong = questions.filter((q) => !q.result?.correct && q.result?.modelAnswer);
    if (wrong.length === 0) return;
    setFlashcardsLoading(true);
    setFlashcardsSuccess("");
    setError("");
    try {
      const deckName = `Quiz mistakes: ${sourceName}`;
      const deck = await flashcardsApi.createDeck({ name: deckName });
      for (const q of wrong) {
        await flashcardsApi.createCard(deck.deck.id, {
          front: q.prompt,
          back: q.result?.modelAnswer ?? "",
        });
      }
      setFlashcardsSuccess(`Created ${wrong.length} flashcards from your mistakes.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create flashcards");
    } finally {
      setFlashcardsLoading(false);
    }
  };

  // Save quiz results as a note.
  const saveResultsAsNote = async () => {
    if (!quizId) return;
    const correctCount = questions.filter((q) => q.result?.correct).length;
    const total = questions.length;
    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    setSaveNoteLoading(true);
    setSaveNoteSuccess("");
    setError("");
    try {
      const res = await studyApi.quizFinish(quizId, {
        score,
        correct: correctCount,
        total,
        saveAsNote: true,
      });
      if (res.noteId) {
        setSaveNoteSuccess("Results saved as a note.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save results");
    } finally {
      setSaveNoteLoading(false);
    }
  };

  const q = questions[current];

  // ===== Setup =====
  if (phase === "setup") {
    return (
      <div className="flex flex-col gap-3">
        {graphId ? (
          <PinnedGraph graphId={graphId} onDismiss={() => setGraphId(null)} />
        ) : pinnedSource ? (
          <PreselectedSource source={pinnedSource} onDismiss={() => setPinnedSource(null)} />
        ) : (
          <WorkspaceSourceSelector selectedIds={selectedSourceIds} onToggle={toggleSource} disabled={loading} />
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Questions
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
              className="w-20 rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-ink outline-none focus:border-accent"
            />
          </label>
          <div className="flex flex-col gap-1 text-xs text-ink-muted">
            Types
            <div className="flex gap-1">
              {(["mcq", "short"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs ${
                    types.has(t)
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-edge text-ink-muted hover:bg-surface-2"
                  }`}
                >
                  {t === "mcq" ? "Multiple choice" : "Short answer"}
                </button>
              ))}
            </div>
          </div>
          <ActionButton onClick={start} disabled={!hasSource} loading={loading}>
            <Sparkles size={13} /> Start quiz
          </ActionButton>
        </div>
        {loading && <Loading label="Generating quiz questions…" />}
        {error && <ErrorBanner message={error} />}
        <TruncationNote show={truncated} />
      </div>
    );
  }

  // ===== Done =====
  if (phase === "done") {
    const correctCount = questions.filter((q) => q.result?.correct).length;
    const wrongCount = questions.length - correctCount;
    const total = questions.length;
    const score = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const filteredQuestions = questions.filter((qq) => {
      if (reviewFilter === "correct") return qq.result?.correct;
      if (reviewFilter === "wrong") return !qq.result?.correct;
      return true;
    });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-edge bg-surface-2 p-6 text-center">
          <Award size={36} className={score >= 70 ? "text-emerald-500" : "text-amber-500"} />
          <div className="text-2xl font-bold text-ink">{score}%</div>
          <div className="text-xs text-ink-muted">
            {correctCount} / {total} correct — {sourceName}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <ActionButton onClick={restart} variant="ghost">
              <RotateCcw size={13} /> New quiz
            </ActionButton>
            {wrongCount > 0 && (
              <ActionButton onClick={retryWrong} variant="ghost">
                <RotateCcw size={13} /> Retry wrong ({wrongCount})
              </ActionButton>
            )}
            {wrongCount > 0 && (
              <ActionButton onClick={makeFlashcardsFromMistakes} loading={flashcardsLoading} variant="ghost">
                <Brain size={13} /> Flashcards from mistakes
              </ActionButton>
            )}
            <ActionButton onClick={saveResultsAsNote} loading={saveNoteLoading} variant="ghost">
              <Save size={13} /> Save as note
            </ActionButton>
          </div>
        </div>
        {flashcardsSuccess && <SuccessBanner message={flashcardsSuccess} />}
        {saveNoteSuccess && <SuccessBanner message={saveNoteSuccess} />}
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-ink-muted">Review</span>
            <div className="flex gap-1">
              {(["all", "correct", "wrong"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setReviewFilter(f)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition ${
                    reviewFilter === f
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-edge text-ink-muted hover:bg-surface-2"
                  }`}
                >
                  {f === "all" && <Filter size={10} />}
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  {f === "correct" && ` (${correctCount})`}
                  {f === "wrong" && ` (${wrongCount})`}
                </button>
              ))}
            </div>
          </div>
          {filteredQuestions.map((qq, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 text-xs ${
                qq.result?.correct
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-red-500/30 bg-red-500/5"
              }`}
            >
              <div className="flex items-start gap-2">
                {qq.result?.correct ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
                )}
                <div className="flex flex-col gap-1">
                  <div className="font-medium text-ink">{qq.prompt}</div>
                  <div className="text-ink-muted">
                    Your answer: <span className="text-ink">{qq.userAnswer || "(blank)"}</span>
                  </div>
                  {!qq.result?.correct && qq.result?.modelAnswer && (
                    <div className="text-ink-muted">
                      Correct: <span className="text-ink">{qq.result.modelAnswer}</span>
                    </div>
                  )}
                  {qq.result?.explanation && (
                    <div className="text-ink-muted italic">{qq.result.explanation}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ===== Answering / Feedback =====
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span>
          Question {current + 1} of {questions.length} — {sourceName}
        </span>
        <span>{Math.round((current / questions.length) * 100)}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${(current / questions.length) * 100}%` }}
        />
      </div>

      {q && (
        <div className="rounded-lg border border-edge bg-surface-2 p-4">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-muted">
            {q.type === "mcq" ? "Multiple choice" : "Short answer"}
          </div>
          <div className="text-sm font-medium text-ink">{q.prompt}</div>
        </div>
      )}

      {q?.type === "mcq" && q.options ? (
        <div className="flex flex-col gap-1.5">
          {q.options.map((opt, i) => {
            const selected = answer === opt;
            const isCorrect = feedback?.modelAnswer === opt;
            const showResult = phase === "feedback";
            let cls = "border-edge bg-surface-2 hover:bg-surface-3";
            if (showResult && isCorrect) cls = "border-emerald-500/40 bg-emerald-500/10";
            else if (showResult && selected && !isCorrect) cls = "border-red-500/40 bg-red-500/10";
            else if (selected) cls = "border-accent bg-accent/10";
            return (
              <button
                key={i}
                disabled={phase === "feedback"}
                onClick={() => setAnswer(opt)}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs text-ink transition ${cls}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-edge text-[10px]">
                  {String.fromCharCode(65 + i)}
                </span>
                {opt}
                {showResult && isCorrect && <CheckCircle2 size={13} className="ml-auto text-emerald-500" />}
                {showResult && selected && !isCorrect && <XCircle size={13} className="ml-auto text-red-400" />}
              </button>
            );
          })}
        </div>
      ) : (
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={phase === "feedback"}
          placeholder="Type your answer…"
          rows={3}
          className="resize-y rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-70"
        />
      )}

      {error && <ErrorBanner message={error} />}

      {phase === "feedback" && feedback && (
        <div
          className={`rounded-lg border p-3 text-xs ${
            feedback.correct
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            {feedback.correct ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            {feedback.correct ? "Correct!" : "Not quite."}
          </div>
          {!feedback.correct && feedback.modelAnswer && (
            <div className="mb-1 text-ink">
              Correct answer: <span className="font-medium">{feedback.modelAnswer}</span>
            </div>
          )}
          {feedback.explanation && <div className="text-ink-muted">{feedback.explanation}</div>}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {phase === "answering" && (
          <ActionButton onClick={submit} disabled={!answer.trim()} loading={loading}>
            Submit
          </ActionButton>
        )}
        {phase === "feedback" && (
          <ActionButton onClick={next}>
            {current + 1 >= questions.length ? "Finish" : "Next question"}
          </ActionButton>
        )}
      </div>
    </div>
  );
}
