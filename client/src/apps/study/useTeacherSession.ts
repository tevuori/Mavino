// ===== useTeacherSession: shared Teach Me session logic =====
// Everything that is NOT presentation lives here so the desktop surface
// (TeacherMode.tsx, floating source windows) and the phone surface
// (mobile/MobileTeach.tsx, bottom-sheet sources) behave identically:
//   - session CRUD + list, source library resolution
//   - SSE turn streaming, tool-progress chips, streaming errors + retry
//   - real comprehension assessment (POST /:id/assess) and mastery tracking
//   - lesson plan, teaching style, level, pace feedback
//   - lesson exports (note / flashcards / quiz / review tasks)
//
// Source-window handling differs per form factor, so the caller supplies a
// `dispatchSourceAction` handler; every other client_action is handled here.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  teacherApi,
  streamTeacherTurn,
  type StudentLevel,
  type TeacherAssessment,
  type TeacherChatHandle,
  type TeacherComprehensionEntry,
  type TeacherMessage,
  type TeacherSession,
  type TeacherSessionState,
  type TeacherSourceHistoryEntry,
  type TeachingStyle,
  type PaceFeedback,
} from "../../services/teacher";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import type { AthenaClientAction, AthenaToolEvent, AthenaWindowState } from "../../services/athena";

/** A comprehension check rendered as a card, with its graded outcome. */
export interface ComprehensionCheck {
  id: string;
  question: string;
  expectedConcept?: string;
  options?: string[];
  answered: boolean;
  answer?: string;
  grading?: boolean;
  assessment?: TeacherAssessment;
}

/** A transient "Athena is doing X" chip. */
export interface ToolChip {
  id: string;
  label: string;
  done: boolean;
}

/** Human labels for the tools the teacher uses, for the progress chips. */
const TOOL_LABELS: Record<string, string> = {
  show_source: "Opening the source…",
  show_command: "Highlighting the passage…",
  focus_source: "Bringing the source forward…",
  close_source: "Closing a source…",
  check_comprehension: "Asking a comprehension check…",
  mark_concept_covered: "Marking a concept covered…",
  finish_lesson: "Wrapping up the lesson…",
  search_notes: "Searching your notes…",
  read_note: "Reading a note…",
  list_files: "Looking through your files…",
  read_file: "Reading a file…",
  web_search: "Searching the web…",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name.replace(/_/g, " ")}…`;
}

const comprehensionChecksKey = (id: string) => `athena:teach:checks:${id}`;

function logToChecks(log: TeacherComprehensionEntry[]): ComprehensionCheck[] {
  return log.map((e, i) => ({
    id: `comp-log-${i}`,
    question: e.question ?? "",
    expectedConcept: e.concept,
    options: undefined,
    answered: true,
    answer: e.answer,
    grading: false,
    assessment: { passed: e.passed, score: e.passed ? 1 : 0, feedback: e.feedback ?? "", misconception: e.misconception },
  }));
}

export interface UseTeacherSessionOpts {
  language?: "en" | "cs";
  initialSessionId?: string | null;
  /**
   * Handle a source-related client_action (show_source / show_command /
   * focus_source / close_source / open_app). Return the source-history patch
   * for show_source so citations stay in sync, or void.
   */
  dispatchSourceAction?: (action: AthenaClientAction) => void;
  /** Window snapshot for the server (desktop only; phones have no windows). */
  windowSnapshot?: () => AthenaWindowState[];
  /** Called when the teacher declares the lesson finished. */
  onLessonFinished?: (recap: string, needsReview: string[]) => void;
}

export function useTeacherSession(opts: UseTeacherSessionOpts = {}) {
  const { language = "en", initialSessionId, dispatchSourceAction, windowSnapshot, onLessonFinished } = opts;

  const [sessions, setSessions] = useState<TeacherSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [session, setSession] = useState<TeacherSession | null>(null);
  const [messages, setMessages] = useState<TeacherMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  const [loadingSession, setLoadingSession] = useState(false);
  const [library, setLibrary] = useState<StudySource[]>([]);

  // Teacher state (mirrors TeacherSession.state on the server).
  const [teachState, setTeachState] = useState<TeacherSessionState>({
    studentLevel: "intermediate",
    teachingStyle: "explain",
    followPlan: true,
  });
  const [sourceHistory, setSourceHistory] = useState<TeacherSourceHistoryEntry[]>([]);
  const [comprehensionChecks, setComprehensionChecks] = useState<ComprehensionCheck[]>([]);
  const [toolChips, setToolChips] = useState<ToolChip[]>([]);
  const [planning, setPlanning] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<string>("");
  const [lastTurn, setLastTurn] = useState<string>("");

  const handleRef = useRef<TeacherChatHandle | null>(null);
  const streamTextRef = useRef("");
  const autoStartFor = useRef<string | null>(null);
  const teachStateRef = useRef(teachState);
  teachStateRef.current = teachState;
  const sourceHistoryRef = useRef(sourceHistory);
  sourceHistoryRef.current = sourceHistory;
  const dispatchRef = useRef(dispatchSourceAction);
  dispatchRef.current = dispatchSourceAction;
  const finishedRef = useRef(onLessonFinished);
  finishedRef.current = onLessonFinished;

  /** Merge a patch into the teacher state (also used by the source dispatcher). */
  const patchState = useCallback((patch: Partial<TeacherSessionState>) => {
    setTeachState((prev) => ({ ...prev, ...patch }));
  }, []);

  // ----- session + library loading -----

  const refreshLists = useCallback(async () => {
    const [s, lib] = await Promise.all([
      teacherApi.list().then((r) => r.sessions).catch(() => [] as TeacherSession[]),
      studySourcesApi.list().then((r) => r.sources).catch(() => [] as StudySource[]),
    ]);
    setSessions(s);
    setLibrary(lib);
  }, []);

  useEffect(() => { void refreshLists(); }, [refreshLists]);

  const applySession = useCallback((loaded: TeacherSession) => {
    setSession(loaded);
    setSessionId(loaded.id);
    setMessages(loaded.messages ?? []);
    setSourceHistory(loaded.state?.sourceHistory ?? []);
    setTeachState({
      studentLevel: "intermediate",
      teachingStyle: "explain",
      followPlan: true,
      ...(loaded.state ?? {}),
    });
    // Restore comprehension-check cards from localStorage first (keeps pending checks),
    // then fall back to the server's answered comprehension log.
    let checks: ComprehensionCheck[] | null = null;
    try {
      const raw = localStorage.getItem(comprehensionChecksKey(loaded.id));
      if (raw) checks = JSON.parse(raw) as ComprehensionCheck[];
    } catch { /* ignore */ }
    if (checks) {
      setComprehensionChecks(checks);
    } else if (loaded.state?.comprehensionLog?.length) {
      setComprehensionChecks(logToChecks(loaded.state.comprehensionLog));
    } else {
      setComprehensionChecks([]);
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setLoadingSession(true);
    setError("");
    try {
      const { session: loaded } = await teacherApi.get(id);
      applySession(loaded);
      // Make sure every attached source is resolvable for the UI (a session can
      // reference sources that are not in the default library page).
      const missing = loaded.sourceIds.filter((sid) => !library.some((s) => s.id === sid));
      if (missing.length > 0) {
        const fetched = await Promise.all(missing.map((sid) => studySourcesApi.get(sid).catch(() => null)));
        const extra = fetched.filter((x): x is StudySource => x !== null);
        setLibrary((prev) => [...prev, ...extra.filter((e) => !prev.some((p) => p.id === e.id))]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
    } finally {
      setLoadingSession(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, applySession]);

  useEffect(() => {
    if (initialSessionId) void loadSession(initialSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  const startNewSession = useCallback(async (input: {
    sourceIds: string[];
    studentLevel: StudentLevel;
    teachingStyle?: TeachingStyle;
    /** Generate a lesson plan right away (one extra model call). */
    withPlan?: boolean;
    planFocus?: string;
  }) => {
    if (input.sourceIds.length === 0) {
      setError("Select at least one source to start a Teach Me session.");
      return null;
    }
    setError("");
    setLoadingSession(true);
    try {
      const { session: created } = await teacherApi.create({
        sourceIds: input.sourceIds,
        studentLevel: input.studentLevel,
        teachingStyle: input.teachingStyle,
      });
      applySession(created);
      void refreshLists();
      if (input.withPlan) {
        setPlanning(true);
        try {
          const { plan, session: withPlan } = await teacherApi.plan(created.id, {
            focus: input.planFocus,
            language,
          });
          applySession({ ...withPlan, state: { ...withPlan.state, lessonPlan: plan } });
        } catch (e) {
          // A missing plan must never block the lesson.
          setError(e instanceof Error ? `Lesson plan unavailable: ${e.message}` : "Lesson plan unavailable");
        } finally {
          setPlanning(false);
        }
      }
      autoStartFor.current = created.id;
      return created;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
      return null;
    } finally {
      setLoadingSession(false);
    }
  }, [applySession, refreshLists, language]);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await teacherApi.delete(id);
      if (sessionId === id) {
        setSession(null);
        setSessionId(null);
        setMessages([]);
        setSourceHistory([]);
      }
      void refreshLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete session");
    }
  }, [sessionId, refreshLists]);

  const resetSession = useCallback(() => {
    setSession(null);
    setSessionId(null);
    setMessages([]);
    setSourceHistory([]);
    setComprehensionChecks([]);
    setTeachState({ studentLevel: "intermediate", teachingStyle: "explain", followPlan: true });
  }, []);

  /** Rename the session (persisted immediately). */
  const renameSession = useCallback(async (title: string) => {
    if (!sessionId || !title.trim()) return;
    setSession((prev) => (prev ? { ...prev, title } : prev));
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
    try {
      await teacherApi.patch(sessionId, { title: title.trim().slice(0, 200) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename session");
    }
  }, [sessionId]);

  /** Replace the attached sources (also used for drag-reordering). */
  const setSessionSources = useCallback(async (sourceIds: string[]) => {
    if (!sessionId) return;
    setSession((prev) => (prev ? { ...prev, sourceIds } : prev));
    try {
      const { session: updated } = await teacherApi.patch(sessionId, { sourceIds });
      setSession(updated);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, sourceIds: updated.sourceIds } : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update sources");
    }
  }, [sessionId]);

  /** Persist a state patch (level / style / follow-plan / pace). */
  const updateTeachState = useCallback(async (patch: Partial<TeacherSessionState>) => {
    const next = { ...teachStateRef.current, ...patch };
    setTeachState(next);
    if (!sessionId) return;
    try {
      await teacherApi.patch(sessionId, { state: next });
    } catch {
      // Non-fatal: the next turn sends the state along anyway.
    }
  }, [sessionId]);

  const setPaceFeedback = useCallback((pace: PaceFeedback) => {
    void updateTeachState({ paceFeedback: pace });
  }, [updateTeachState]);

  const generatePlan = useCallback(async (focus?: string) => {
    if (!sessionId) return;
    setPlanning(true);
    setError("");
    try {
      const { plan, session: updated } = await teacherApi.plan(sessionId, { focus, language });
      applySession({ ...updated, state: { ...updated.state, lessonPlan: plan } });
      void refreshLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build a lesson plan");
    } finally {
      setPlanning(false);
    }
  }, [sessionId, language, applySession, refreshLists]);

  // ----- client actions -----

  const dispatchAction = useCallback((action: AthenaClientAction) => {
    const p = action.payload as Record<string, unknown>;
    const act = String(p.action ?? "");
    switch (act) {
      case "check_comprehension": {
        setComprehensionChecks((prev) => [...prev, {
          id: `comp-${Date.now()}-${prev.length}`,
          question: String(p.question ?? ""),
          expectedConcept: typeof p.expectedConcept === "string" ? p.expectedConcept : undefined,
          options: Array.isArray(p.options) ? (p.options as unknown[]).map(String) : undefined,
          answered: false,
        }]);
        break;
      }
      case "mark_concept_covered": {
        const concept = String(p.concept ?? "").trim();
        if (concept) {
          setTeachState((prev) => ({
            ...prev,
            coveredConcepts: [...new Set([...(prev.coveredConcepts ?? []), concept])],
          }));
        }
        break;
      }
      case "finish_lesson": {
        const recap = String(p.recap ?? "");
        const needsReview = Array.isArray(p.needsReview) ? (p.needsReview as unknown[]).map(String) : [];
        setTeachState((prev) => ({ ...prev, lessonCompletedAt: new Date().toISOString() }));
        finishedRef.current?.(recap, needsReview);
        break;
      }
      default:
        dispatchRef.current?.(action);
        break;
    }
  }, []);

  // Persist pending/answered comprehension cards so they survive a re-enter.
  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem(comprehensionChecksKey(sessionId), JSON.stringify(comprehensionChecks));
    } catch { /* ignore */ }
  }, [sessionId, comprehensionChecks]);

  // ----- streaming a turn -----

  /** Called with the full assistant text when a turn completes (for auto-speak). */
  const onTurnDoneRef = useRef<((text: string) => void) | null>(null);
  const setOnTurnDone = useCallback((cb: ((text: string) => void) | null) => {
    onTurnDoneRef.current = cb;
  }, []);

  const send = useCallback((text: string) => {
    if (!sessionId || !text.trim() || streaming) return;
    setError("");
    setStreaming(true);
    setStreamText("");
    streamTextRef.current = "";
    setToolChips([]);
    setLastTurn(text);
    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: new Date().toISOString() }]);

    const state: TeacherSessionState = {
      ...teachStateRef.current,
      sourceHistory: sourceHistoryRef.current,
    };

    handleRef.current = streamTeacherTurn(
      sessionId,
      text,
      {
        onContent: (t) => {
          streamTextRef.current += t;
          setStreamText((prev) => prev + t);
        },
        onTool: (ev: AthenaToolEvent) => {
          const done = ev.state === "completed" || ev.state === "error" || ev.state === "canceled";
          setToolChips((prev) => {
            const existing = prev.find((c) => c.id === ev.id);
            if (existing) return prev.map((c) => (c.id === ev.id ? { ...c, done } : c));
            return [...prev, { id: ev.id, label: toolLabel(ev.name), done }];
          });
          if (done) {
            // Let the student see the chip briefly, then fade it out.
            setTimeout(() => setToolChips((prev) => prev.filter((c) => c.id !== ev.id)), 2500);
          }
        },
        onClientAction: dispatchAction,
        onError: (msg) => { setError(msg); setStreaming(false); },
        onDone: () => {
          setStreaming(false);
          const finalText = streamTextRef.current;
          setStreamText("");
          const firstTurn = messages.length === 0;
          void (async () => {
            await loadSession(sessionId);
            // Give the session a real topic title instead of the raw first
            // message once there is something to summarize.
            if (firstTurn && finalText.trim()) {
              try {
                const { session: titled } = await teacherApi.generateTitle(sessionId);
                setSession((prev) => (prev ? { ...prev, title: titled.title } : prev));
                setSessions((prev) => prev.map((s) => (s.id === titled.id ? { ...s, title: titled.title } : s)));
              } catch { /* keep the fallback title */ }
            }
          })();
          onTurnDoneRef.current?.(finalText);
        },
      },
      { windows: windowSnapshot?.() ?? [], sourceHistory: sourceHistoryRef.current, state, language }
    );
  }, [sessionId, streaming, dispatchAction, windowSnapshot, language, loadSession, messages.length]);

  const stop = useCallback(() => {
    handleRef.current?.abort();
    setStreaming(false);
  }, []);

  /** Retry the last turn after a streaming error. */
  const retry = useCallback(() => {
    if (!lastTurn) return;
    // Drop the optimistic user message; send() re-adds it.
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      return last?.role === "user" && last.content === lastTurn ? prev.slice(0, -1) : prev;
    });
    send(lastTurn);
  }, [lastTurn, send]);

  // After creating a new session (and optionally generating a plan) start the
  // first teaching turn automatically so the student doesn't have to type it.
  useEffect(() => {
    if (autoStartFor.current && sessionId === autoStartFor.current && !planning && !streaming && messages.length === 0) {
      autoStartFor.current = null;
      const prompt = language === "cs" ? "Začni výuku." : "Start the lesson.";
      send(prompt);
    }
  }, [sessionId, planning, streaming, messages.length, send, language]);

  // ----- comprehension assessment -----

  const answerComprehension = useCallback(async (id: string, answer: string) => {
    const check = comprehensionChecks.find((c) => c.id === id);
    if (!check || !sessionId) return;
    setComprehensionChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, answered: true, answer, grading: true } : c))
    );
    let assessment: TeacherAssessment | undefined;
    try {
      const res = await teacherApi.assess(sessionId, {
        question: check.question,
        answer,
        expectedConcept: check.expectedConcept,
        language,
      });
      assessment = res.assessment;
      // The server owns mastery + the comprehension log; adopt its version so
      // the next turn does not overwrite the freshly recorded result.
      setTeachState((prev) => ({ ...prev, ...res.state }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not grade that answer");
    }
    setComprehensionChecks((prev) =>
      prev.map((c) => (c.id === id ? { ...c, grading: false, assessment } : c))
    );
    // Feed the answer back as a turn: the prompt now carries the misconception,
    // so a failed check makes Athena re-explain before moving on.
    if (answer.trim()) send(answer.trim());
  }, [comprehensionChecks, sessionId, language, send]);

  // ----- exports -----

  const exportLesson = useCallback(async (target: "note" | "flashcards" | "quiz" | "tasks") => {
    if (!sessionId) return;
    setExporting(target);
    setExportResult("");
    setError("");
    try {
      const res = await teacherApi.export(sessionId, { target, language });
      setExportResult(
        target === "note" ? `Saved as note “${res.title ?? "Lesson"}”`
          : target === "flashcards" ? `Created deck “${res.deckName}” with ${res.count} cards`
          : target === "quiz" ? `Created a quiz with ${res.count} questions`
          : `Added ${res.count} review task${res.count === 1 ? "" : "s"}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }, [sessionId, language]);

  const attachedSources = (session?.sourceIds ?? [])
    .map((id) => library.find((s) => s.id === id))
    .filter((s): s is StudySource => s !== undefined);

  return {
    // data
    sessions, session, sessionId, messages, library, attachedSources,
    streaming, streamText, error, setError, loadingSession,
    // teach state
    teachState, patchState, updateTeachState, setPaceFeedback,
    sourceHistory, setSourceHistory,
    comprehensionChecks, answerComprehension,
    toolChips, planning, generatePlan,
    exporting, exportResult, setExportResult, exportLesson,
    // actions
    refreshLists, loadSession, startNewSession, deleteSession, resetSession,
    renameSession, setSessionSources,
    send, stop, retry, canRetry: Boolean(lastTurn) && !streaming,
    setLibrary, setOnTurnDone,
  };
}
