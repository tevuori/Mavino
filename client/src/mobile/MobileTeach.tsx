// ===== Mobile Teach Me =====
// A single-column, voice-first phone surface for the Interactive Teacher.
// All non-visual logic is shared with the desktop TeacherMode through
// useTeacherSession; this file owns the phone presentation:
//   - full-width chat bubbles with inline citation chips
//   - a large push-to-talk mic button (voice-first input)
//   - a bottom-sheet source viewer (instead of floating windows) that shows the
//     referenced source as plain text with the spoken passage highlighted
//   - collapsible lesson agenda + mastery, full-width comprehension cards
//   - per-message TTS controls with speech-synced source highlighting
//   - lesson exports (note / flashcards / quiz / review tasks)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, ChevronDown, GraduationCap, Loader2, Mic, Pause, Play,
  Plus, Send, Sparkles, Square, Trash2, Volume2, VolumeX, X,
} from "lucide-react";
import type { StudentLevel, TeachingStyle } from "../services/teacher";
import { studySourcesApi, type StudySource } from "../services/study-sources";
import type { AthenaClientAction } from "../services/athena";
import { useTeacherSession } from "../apps/study/useTeacherSession";
import { useTeacherTts } from "../apps/study/useTeacherTts";
import { prepareSpeech, segmentAtOffset, type SpeechSegment } from "../apps/study/teacherSpeech";
import { LessonAgenda, ToolChipRow, ComprehensionCard, PaceFeedbackRow, ExportMenu } from "../apps/study/teachPanels";
import HighlightableMarkdown from "../apps/study/HighlightableMarkdown";
import type { CitationMeta } from "../apps/study/CitationMarkdown";
import { isSpeechRecognitionSupported, createTranscriber, type SpeechTranscriber } from "../services/speech";
import { findHighlightRange } from "../apps/study/highlightRange";
import {
  MobileContainer, MobileEmpty, MobileFab, MobileHeader, MobileLoading, MobileTextarea,
} from "./MobileUi";

const LEVELS: StudentLevel[] = ["beginner", "intermediate", "advanced"];
const STYLES: TeachingStyle[] = ["explain", "socratic"];

const KIND_ICON: Record<string, typeof BookOpen> = {
  note: BookOpen, file: BookOpen, paste: BookOpen, moodle: GraduationCap, url: BookOpen,
};

/** The source currently shown in the bottom sheet. */
interface SourceSheet {
  /** Stable id used as the sourceHistory windowId on phones (no real windows). */
  windowId: string;
  refId: string;
  name: string;
  kind: string;
  loading: boolean;
  text?: string;
  highlight?: string;
  /** Character offsets of the resolved anchor (exact, preferred over text search). */
  posStart?: number;
  posEnd?: number;
  error?: string;
}

interface Props {
  initialSessionId?: string | null;
  language?: "en" | "cs";
  onClose?: () => void;
}

export default function MobileTeach({ initialSessionId = null, language = "en", onClose }: Props) {
  // ----- pre-session setup -----
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [studentLevel, setStudentLevel] = useState<StudentLevel>("intermediate");
  const [teachingStyle, setTeachingStyle] = useState<TeachingStyle>("explain");
  const [withPlan, setWithPlan] = useState(true);
  const [view, setView] = useState<"list" | "new">("list");

  const [input, setInput] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [sheet, setSheet] = useState<SourceSheet | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ReturnType<typeof useTeacherSession> | null>(null);

  // ----- source bottom-sheet: resolve text + apply highlight -----

  /** Resolve the cached text for a source (matched by refId in the library). */
  const resolveSourceText = useCallback(async (refId: string): Promise<string | undefined> => {
    const lib = sessionRef.current?.library ?? [];
    const match = lib.find((s) => s.refId === refId || s.id === refId);
    if (!match) return undefined;
    if (match.textCache) return match.textCache;
    try {
      const full = await studySourcesApi.get(match.id);
      return full.textCache;
    } catch {
      return undefined;
    }
  }, []);

  const openSourceSheet = useCallback((
    entry: { windowId: string; refId: string; name: string; kind: string; highlight?: string; posStart?: number; posEnd?: number }
  ) => {
    setSheet({ ...entry, loading: true });
    void (async () => {
      const text = await resolveSourceText(entry.refId);
      setSheet((prev) =>
        prev && prev.windowId === entry.windowId
          ? { ...prev, loading: false, text, error: text ? undefined : "Source text is unavailable." }
          : prev
      );
    })();
  }, [resolveSourceText]);

  // ----- source client actions (phone: bottom sheet, no windows) -----

  const dispatchSourceAction = useCallback((action: AthenaClientAction) => {
    const p = action.payload as Record<string, unknown>;
    const act = String(p.action ?? "");
    const setSourceHistory = sessionRef.current?.setSourceHistory;
    switch (act) {
      case "show_source": {
        const refId = String(p.sourceRef ?? "");
        const name = String(p.title ?? "Source");
        const kind = String(p.sourceKind ?? "");
        const highlight = (p.highlight as Record<string, unknown> | undefined);
        const highlightText = typeof highlight?.text === "string" ? highlight.text : undefined;
        const posStart = typeof highlight?.posStart === "number" ? highlight.posStart : undefined;
        const posEnd = typeof highlight?.posEnd === "number" ? highlight.posEnd : undefined;
        // Phones have no window ids — key source history by the source ref.
        const windowId = refId || name;
        setSourceHistory?.((prev) => {
          if (prev.some((h) => h.windowId === windowId)) {
            return prev.map((h) => (h.windowId === windowId ? {
              ...h, lastHighlight: highlightText, lastPosStart: posStart, lastPosEnd: posEnd,
            } : h));
          }
          return [...prev, {
            windowId, index: prev.length + 1, name, kind, refId,
            lastHighlight: highlightText, lastPosStart: posStart, lastPosEnd: posEnd,
          }];
        });
        openSourceSheet({ windowId, refId, name, kind, highlight: highlightText, posStart, posEnd });
        break;
      }
      case "show_command": {
        const windowId = String(p.windowId ?? "");
        const kind = String(p.kind ?? "");
        const text = typeof p.text === "string" ? p.text : undefined;
        const posStart = typeof p.posStart === "number" ? p.posStart : undefined;
        const posEnd = typeof p.posEnd === "number" ? p.posEnd : undefined;
        if (kind === "clear_highlight") {
          setSheet((prev) => (prev && prev.windowId === windowId ? { ...prev, highlight: undefined, posStart: undefined, posEnd: undefined } : prev));
        } else if (kind === "highlight" && (text || (typeof posStart === "number" && typeof posEnd === "number"))) {
          setSheet((prev) => (prev && prev.windowId === windowId ? { ...prev, highlight: text, posStart, posEnd } : prev));
          setSourceHistory?.((prev) =>
            prev.map((h) => (h.windowId === windowId ? { ...h, lastHighlight: text, lastPosStart: posStart, lastPosEnd: posEnd } : h))
          );
        }
        break;
      }
      case "focus_source": {
        const windowId = String(p.windowId ?? "");
        const entry = sessionRef.current?.sourceHistory.find((h) => h.windowId === windowId);
        if (entry) {
          openSourceSheet({
            windowId: entry.windowId, refId: entry.refId, name: entry.name,
            kind: entry.kind, highlight: entry.lastHighlight,
            posStart: entry.lastPosStart, posEnd: entry.lastPosEnd,
          });
        }
        break;
      }
      case "close_source": {
        const windowId = String(p.windowId ?? "");
        setSheet((prev) => (prev && prev.windowId === windowId ? null : prev));
        setSourceHistory?.((prev) => prev.filter((h) => h.windowId !== windowId));
        break;
      }
      default:
        break;
    }
  }, [openSourceSheet]);

  const teach = useTeacherSession({ language, initialSessionId, dispatchSourceAction });
  sessionRef.current = teach;
  const {
    sessions, session, sessionId, messages, streaming, streamText, error,
    loadingSession, library, attachedSources,
    teachState, sourceHistory, comprehensionChecks, toolChips, planning,
    exporting, exportResult, setExportResult, exportLesson, generatePlan,
    loadSession, startNewSession, deleteSession, resetSession,
    updateTeachState, setPaceFeedback, answerComprehension,
    send, stop, retry, canRetry, setOnTurnDone,
  } = teach;

  // ----- speech (TTS) with speech-synced sheet highlighting -----

  const segmentsRef = useRef<SpeechSegment[]>([]);
  const spokenSegRef = useRef<SpeechSegment | null>(null);
  const sourceHistoryRef = useRef(sourceHistory);
  sourceHistoryRef.current = sourceHistory;

  const onWordBoundary = useCallback((charStart: number) => {
    const seg = segmentAtOffset(segmentsRef.current, charStart);
    if (!seg || seg === spokenSegRef.current) return;
    const prev = spokenSegRef.current;
    spokenSegRef.current = seg;
    const cited = seg.citations
      .map((n) => sourceHistoryRef.current.find((h) => h.index === n))
      .find((h) => h !== undefined);
    if (!cited) return;
    // Re-anchor to the last resolved highlight for this source (exact offsets
    // when available). Do NOT use seg.quote — quotes from the spoken text are
    // rarely verbatim and highlighted the wrong passage. Only re-open the sheet
    // when switching sources, to avoid re-rendering on every sentence.
    const switchingIn = !prev || prev.citations[0] !== seg.citations[0];
    if (switchingIn) {
      openSourceSheet({
        windowId: cited.windowId, refId: cited.refId, name: cited.name,
        kind: cited.kind, highlight: cited.lastHighlight,
        posStart: cited.lastPosStart, posEnd: cited.lastPosEnd,
      });
    }
  }, [openSourceSheet]);

  const tts = useTeacherTts({ language, onWordBoundary });
  const ttsRef = useRef(tts);
  ttsRef.current = tts;
  const autoSpeakRef = useRef(autoSpeak);
  autoSpeakRef.current = autoSpeak;

  const speakMessage = useCallback((text: string, id: string) => {
    segmentsRef.current = prepareSpeech(text).segments;
    spokenSegRef.current = null;
    void ttsRef.current.speak(text, id);
  }, []);

  useEffect(() => {
    setOnTurnDone((text) => {
      if (autoSpeakRef.current && text.trim()) speakMessage(text, "latest");
    });
    return () => setOnTurnDone(null);
  }, [setOnTurnDone, speakMessage]);

  // ----- STT (push-to-talk) -----

  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const transcriberRef = useRef<SpeechTranscriber | null>(null);
  const sttSupported = isSpeechRecognitionSupported();

  const startListening = useCallback(() => {
    if (!sttSupported || listening) return;
    try {
      const transcriber = createTranscriber();
      transcriberRef.current = transcriber;
      let finalText = "";
      transcriber.onUpdate(({ interim, final: fin }) => {
        if (fin) finalText += fin;
        setInterimText(interim);
      });
      transcriber.onEnd(() => {
        setListening(false);
        setInterimText("");
        if (finalText.trim()) send(finalText.trim());
      });
      transcriber.onError(() => { setListening(false); setInterimText(""); });
      transcriber.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [sttSupported, listening, send]);

  const stopListening = useCallback(() => {
    transcriberRef.current?.stop();
    setListening(false);
  }, []);

  // ----- misc -----

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamText, comprehensionChecks]);

  const citationMeta: CitationMeta[] = useMemo(
    () => sourceHistory.map((h) => ({ index: h.index, name: h.name, kind: h.kind, refId: h.refId })),
    [sourceHistory]
  );

  const openCitation = useCallback((index: number) => {
    const entry = sourceHistory.find((h) => h.index === index);
    if (entry) {
      openSourceSheet({
        windowId: entry.windowId, refId: entry.refId, name: entry.name,
        kind: entry.kind, highlight: entry.lastHighlight,
      });
    }
  }, [sourceHistory, openSourceSheet]);

  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startSession = () => {
    void startNewSession({ sourceIds: [...selectedSourceIds], studentLevel, teachingStyle, withPlan });
  };

  const submit = () => {
    const t = input.trim();
    if (!t || streaming) return;
    setInput("");
    if (tts.playing) tts.stop();
    send(t);
  };

  // ----- session picker (no active session) -----

  if (!sessionId) {
    if (view === "new") {
      return (
        <MobileContainer>
          <MobileHeader title="New lesson" subtitle="Teach Me" onBack={() => setView("list")} />

          <p className="mb-2 text-sm font-semibold text-ink">Sources</p>
          <div className="mb-4 space-y-2">
            {library.length === 0 ? (
              <MobileEmpty text="No study sources yet. Add materials in Study Hub first." />
            ) : (
              library.map((s: StudySource) => {
                const Icon = KIND_ICON[s.kind] ?? BookOpen;
                const on = selectedSourceIds.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSource(s.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left ${
                      on ? "border-indigo-400/60 bg-accent/15" : "border-edge bg-surface-2"
                    }`}
                  >
                    <Icon size={18} className={on ? "text-accent" : "text-ink-muted"} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.name}</span>
                    {on && <span className="text-xs text-accent">Selected</span>}
                  </button>
                );
              })
            )}
          </div>

          <p className="mb-2 text-sm font-semibold text-ink">Level</p>
          <div className="mb-4 flex gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setStudentLevel(l)}
                className={`flex-1 rounded-2xl py-2.5 text-sm font-medium capitalize ${
                  studentLevel === l ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          <p className="mb-2 text-sm font-semibold text-ink">Teaching style</p>
          <div className="mb-4 flex gap-2">
            {STYLES.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setTeachingStyle(st)}
                className={`flex-1 rounded-2xl py-2.5 text-sm font-medium capitalize ${
                  teachingStyle === st ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setWithPlan((v) => !v)}
            className={`mb-4 flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm ${
              withPlan ? "border-indigo-400/60 bg-accent/15 text-ink" : "border-edge bg-surface-2 text-ink-muted"
            }`}
          >
            <span className="flex items-center gap-2"><Sparkles size={16} /> Generate a lesson plan</span>
            <span className={`h-5 w-9 rounded-full p-0.5 transition ${withPlan ? "bg-accent" : "bg-surface-3"}`}>
              <span className={`block h-4 w-4 rounded-full bg-surface-2 transition ${withPlan ? "translate-x-4" : ""}`} />
            </span>
          </button>

          {error && <p className="mb-3 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

          <button
            type="button"
            onClick={startSession}
            disabled={selectedSourceIds.size === 0 || loadingSession}
            className="w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {loadingSession ? "Starting…" : "Start lesson"}
          </button>
        </MobileContainer>
      );
    }

    return (
      <MobileContainer>
        <MobileHeader
          title="Teach Me"
          subtitle="Interactive tutor"
          onClose={onClose}
          right={<MobileFab onClick={() => { resetSession(); setSelectedSourceIds(new Set()); setView("new"); }} icon={<Plus size={22} />} />}
        />
        <p className="mb-3 text-sm font-semibold text-ink">Recent lessons</p>
        <div className="space-y-2">
          {loadingSession ? (
            <MobileLoading />
          ) : sessions.length ? (
            sessions.map((s) => (
              <article
                key={s.id}
                className="flex items-center gap-2 rounded-2xl border border-edge bg-surface-2 p-4"
              >
                <button onClick={() => void loadSession(s.id)} className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="flex items-center gap-2 truncate font-medium text-ink">
                    <GraduationCap size={16} className="shrink-0 text-accent" /> {s.title}
                  </span>
                  <span className="mt-1 text-xs text-ink-muted">
                    {s.sourceIds.length} source{s.sourceIds.length === 1 ? "" : "s"}
                  </span>
                </button>
                <button
                  onClick={() => void deleteSession(s.id)}
                  className="shrink-0 rounded-xl p-2 text-ink-muted active:bg-surface-3 active:text-red-400"
                >
                  <Trash2 size={16} />
                </button>
              </article>
            ))
          ) : (
            <MobileEmpty text="No lessons yet. Tap + to start learning." />
          )}
        </div>
      </MobileContainer>
    );
  }

  // ----- active lesson -----

  const latestSpeaking = tts.speakingId === "latest" && (tts.playing || tts.paused);

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      {/* header */}
      <header className="mb-2 flex items-center gap-2">
        <button
          onClick={() => { stop(); resetSession(); setView("list"); }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-ink active:bg-surface-3"
        >
          <ChevronDown size={20} className="rotate-90" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-ink">{session?.title ?? "Lesson"}</p>
        </div>
        <button
          onClick={() => setAutoSpeak((v) => !v)}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
            autoSpeak ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
          }`}
          title={autoSpeak ? "Auto-speak on" : "Auto-speak off"}
        >
          {autoSpeak ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <ExportMenu onExport={exportLesson} exporting={exporting} result={exportResult} onDismissResult={() => setExportResult("")} />
      </header>

      {/* agenda + mastery + pace */}
      <div className="mb-2 space-y-2">
        <LessonAgenda
          plan={teachState.lessonPlan}
          covered={teachState.coveredConcepts ?? []}
          mastery={teachState.mastery ?? {}}
          followPlan={teachState.followPlan ?? true}
          onToggleFollow={(v) => void updateTeachState({ followPlan: v })}
          onRegenerate={() => void generatePlan()}
          planning={planning}
        />
        <PaceFeedbackRow value={teachState.paceFeedback} onChange={setPaceFeedback} />
      </div>

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pb-3">
        {messages.length === 0 && !streaming && (
          <MobileEmpty text="Ask a question, or tap the mic to speak. Mavino will teach from your sources." />
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-ink">
                {m.content}
              </div>
            ) : (
              <div className="rounded-2xl rounded-bl-sm border border-edge bg-surface-2 px-3.5 py-2.5">
                <HighlightableMarkdown
                  content={m.content}
                  scope="teacher"
                  scopeId={`${sessionId}:${i}`}
                  citations={citationMeta}
                  onOpenCitation={openCitation}
                  enabled={false}
                />
                <div className="mt-1.5 flex items-center gap-2">
                  {latestSpeaking && i === messages.length - 1 ? (
                    <>
                      <button
                        onClick={() => (tts.paused ? tts.resume() : tts.pause())}
                        className="flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-xs text-ink"
                      >
                        {tts.paused ? <Play size={12} /> : <Pause size={12} />}
                        {tts.paused ? "Resume" : "Pause"}
                      </button>
                      <button onClick={() => tts.stop()} className="rounded-lg bg-surface-3 p-1 text-ink">
                        <Square size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => speakMessage(m.content, `msg-${i}`)}
                      className="flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-xs text-ink"
                    >
                      <Volume2 size={12} /> Play
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {streaming && (
          <div className="rounded-2xl rounded-bl-sm border border-edge bg-surface-2 px-3.5 py-2.5">
            {toolChips.length > 0 && <div className="mb-2"><ToolChipRow chips={toolChips} /></div>}
            {streamText ? (
              <HighlightableMarkdown
                content={streamText}
                scope="teacher"
                scopeId={`${sessionId}:stream`}
                citations={citationMeta}
                onOpenCitation={openCitation}
                enabled={false}
              />
            ) : (
              <Loader2 size={16} className="animate-spin text-accent" />
            )}
          </div>
        )}

        {comprehensionChecks.map((c) => (
          <ComprehensionCard key={c.id} check={c} onAnswer={(a) => void answerComprehension(c.id, a)} fullWidth />
        ))}

        {error && (
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
            <span className="min-w-0 flex-1">{error}</span>
            {canRetry && (
              <button onClick={retry} className="shrink-0 rounded-lg bg-red-500/20 px-2 py-1 text-xs">Retry</button>
            )}
          </div>
        )}
      </div>

      {/* interim STT transcript */}
      {listening && (
        <p className="mb-1 text-center text-xs text-accent">{interimText || "Listening…"}</p>
      )}

      {/* composer */}
      <div className="flex items-end gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <MobileTextarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          placeholder="Ask Mavino…"
          rows={1}
          className="flex-1"
        />
        {sttSupported && (
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
              listening ? "animate-pulse bg-red-500 text-ink" : "bg-surface-3 text-ink"
            }`}
          >
            <Mic size={20} />
          </button>
        )}
        <button
          type="button"
          onClick={streaming ? stop : submit}
          disabled={!streaming && !input.trim()}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-ink disabled:opacity-50"
        >
          {streaming ? <Square size={18} /> : <Send size={18} />}
        </button>
      </div>

      {/* source bottom sheet */}
      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setSheet(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative flex max-h-[75vh] w-full flex-col rounded-t-3xl border-t border-edge bg-[#0f1117] pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
              <BookOpen size={16} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{sheet.name}</span>
              <button onClick={() => setSheet(null)} className="rounded-xl p-1.5 text-ink-muted active:bg-surface-3">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3">
              {sheet.loading ? (
                <div className="flex items-center gap-2 text-sm text-ink-muted">
                  <Loader2 size={14} className="animate-spin" /> Loading source…
                </div>
              ) : sheet.error ? (
                <p className="text-sm text-ink-muted">{sheet.error}</p>
              ) : (
                <SourceText text={sheet.text ?? ""} highlight={sheet.highlight} posStart={sheet.posStart} posEnd={sheet.posEnd} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Plain-text source view with the spoken passage highlighted + scrolled into view.
 *  Resolves the highlight by character offset (exact) first, then exact text,
 *  then fuzzy token-overlap so a paraphrased phrase still lands on the right
 *  passage instead of the first occurrence of a common word. */
function SourceText({ text, highlight, posStart, posEnd }: { text: string; highlight?: string; posStart?: number; posEnd?: number }) {
  const markRef = useRef<HTMLElement>(null);
  const range = highlight || (typeof posStart === "number" && typeof posEnd === "number")
    ? findHighlightRange(text, { posStart, posEnd, text: highlight })
    : null;

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [range?.from, range?.to]);

  if (!range) {
    return <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink-muted">{text}</pre>;
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink-muted">
      {text.slice(0, range.from)}
      <mark ref={markRef} className="rounded bg-amber-400/30 text-amber-100">{text.slice(range.from, range.to)}</mark>
      {text.slice(range.to)}
    </pre>
  );
}
