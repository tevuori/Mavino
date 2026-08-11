// ===== Study Hub: Interactive Teacher ("Teach Me" mode) =====
// A live, voice-ready tutoring session. Athena teaches from the selected
// sources, opening / scrolling / highlighting passages in the existing
// Notes/Editor/Viewer/Browser apps as she speaks, and checks comprehension
// interactively.
//
// Architecture:
//  - All non-visual session logic lives in useTeacherSession (shared with the
//    phone surface, MobileTeach): streaming, tool chips, real comprehension
//    assessment, mastery, lesson plan, exports.
//  - This file owns the DESKTOP presentation: floating source windows,
//    speech-synced highlighting, the session settings popover and the agenda.
//  - Source-history is tracked in local state and sent back to the server on
//    each turn so Athena can resolve "go back to the first file".

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import {
  Sparkles, Send, Square, Plus, Trash2,
  ChevronDown, GraduationCap, MessageSquare, Check,
  FileText, File as FileIcon, Link2, ClipboardPaste,
  Volume2, VolumeX, Mic, MicOff, Pause, Play,
  PanelLeftClose, PanelLeftOpen, Settings2, X, AlertTriangle,
  ArrowUp, ArrowDown, Pencil, RotateCcw,
} from "lucide-react";
import type { StudentLevel, TeachingStyle } from "../../services/teacher";
import { type StudySource } from "../../services/study-sources";
import WorkspaceSourceSelector from "./WorkspaceSourceSelector";
import HighlightableMarkdown from "./HighlightableMarkdown";
import { ActionButton, ErrorBanner, Loading } from "./ui";
import { useWindows } from "../../store/windows";
import { useShowControl, type ShowResult, type ShowCommand } from "../../store/showControl";
import { useFormFactor } from "../../store/formfactor";
import { useTeacherTts } from "./useTeacherTts";
import { useTeacherSession } from "./useTeacherSession";
import { prepareSpeech, segmentAtOffset, type SpeechSegment } from "./teacherSpeech";
import { LessonAgenda, ToolChipRow, ComprehensionCard, PaceFeedbackRow, ExportMenu } from "./teachPanels";
import TeachSourcePane, { type PaneSource, type PaneHighlight } from "./TeachSourcePane";
import TeachErrorBoundary from "./TeachErrorBoundary";
import { isSpeechRecognitionSupported, createTranscriber, type SpeechTranscriber } from "../../services/speech";
import type { AthenaClientAction, AthenaWindowState } from "../../services/athena";

const MobileTeach = lazy(() => import("../../mobile/MobileTeach"));

const KIND_ICON: Record<string, typeof FileText> = {
  note: FileText,
  file: FileIcon,
  paste: ClipboardPaste,
  moodle: GraduationCap,
  url: Link2,
};

const APP_ICONS: Record<string, string> = {
  notes: "StickyNote", editor: "Code", viewer: "Image", browser: "Globe",
};

/** Why a source could not be shown, in words a student understands. */
const SHOW_FAILURE_TEXT: Record<string, string> = {
  "no-match": "the passage wasn't found in the open source",
  "not-loaded": "the source hadn't finished loading",
  "blocked-by-cors": "the site refuses to be embedded",
  "file-not-found": "the file is missing",
  "unsupported-type": "this file type can't be highlighted",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  initialSessionId?: string | null;
  language?: "en" | "cs";
}

export default function TeacherMode(props: Props) {
  // Phones get the single-column, voice-first surface — including for deep
  // links opened by Athena's tools.
  const phone = useFormFactor((s) => s.mode) === "phone";
  if (phone) {
    return (
      <Suspense fallback={<Loading label="Loading Teach Me…" />}>
        <MobileTeach initialSessionId={props.initialSessionId ?? null} language={props.language ?? "en"} />
      </Suspense>
    );
  }
  return (
    <TeachErrorBoundary>
      <DesktopTeacher {...props} />
    </TeachErrorBoundary>
  );
}

function DesktopTeacher({ initialSessionId, language = "en" }: Props) {
  const [input, setInput] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [showSourcePanel, setShowSourcePanel] = useState(true);
  const [studentLevel, setStudentLevel] = useState<StudentLevel>("intermediate");
  const [teachingStyle, setTeachingStyle] = useState<TeachingStyle>("explain");
  const [withPlan, setWithPlan] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [showIssue, setShowIssue] = useState<string>("");

  // Side-by-side source pane (replaces floating source windows). One stable
  // paneId backs the show-control channel; the active source is swapped via
  // paneSource. panePending is the highlight to apply once the source loads.
  const paneId = useRef("teach-source-pane-" + Math.random().toString(36).slice(2)).current;
  const [paneSource, setPaneSource] = useState<PaneSource | null>(null);
  const [panePending, setPanePending] = useState<PaneHighlight | null>(null);
  const paneSourceRef = useRef<PaneSource | null>(null);
  paneSourceRef.current = paneSource;

  // Voice: TTS (Athena speaks) + STT (student speaks)
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const transcriberRef = useRef<SpeechTranscriber | null>(null);
  const sttSupported = isSpeechRecognitionSupported();

  const openWindow = useWindows((s) => s.open);
  const windows = useWindows((s) => s.windows);
  const focusedId = useWindows((s) => s.focusedId);
  const issueShowCommand = useShowControl((s) => s.issueCommand);
  const showResults = useShowControl((s) => s.results);
  const setSpeakingWindow = useShowControl((s) => s.setSpeakingWindow);
  const removeShowWindow = useShowControl((s) => s.removeWindow);

  // Clean up the pane's show-control state on unmount.
  useEffect(() => {
    return () => { removeShowWindow(paneId); };
  }, [paneId, removeShowWindow]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const autoSpeakRef = useRef(autoSpeak);
  autoSpeakRef.current = autoSpeak;

  /** Build an AthenaWindowState[] snapshot for the server (so tools like
   *  list_open_windows work during a teacher turn). */
  const windowSnapshot = useCallback((): AthenaWindowState[] => {
    return windowsRef.current.map((w) => ({
      id: w.id,
      appId: w.appId,
      title: w.title,
      rect: w.rect,
      minimized: w.minimized,
      focused: w.id === focusedId,
    }));
  }, [focusedId]);

  // ----- source pane client actions (desktop-specific) -----
  // Sources are shown in the side-by-side TeachSourcePane (not floating
  // windows). One stable paneId backs the show-control channel; the active
  // source is swapped via paneSource. Per-source windowIds (== refId) let the
  // LLM target focus_source / close_source at a specific source.

  const sessionRef = useRef<ReturnType<typeof useTeacherSession> | null>(null);
  const sourceMetaRef = useRef<Record<string, { appId: string; openPayload: Record<string, unknown> }>>({});

  /** Build a PaneSource from a show_source payload or a history entry + meta. */
  const buildPaneSource = useCallback((args: {
    windowId: string;
    appId: string;
    refId: string;
    name: string;
    kind: string;
    openPayload: Record<string, unknown>;
  }): PaneSource => ({
    windowId: args.windowId,
    appId: args.appId as PaneSource["appId"],
    refId: args.refId,
    name: args.name,
    kind: args.kind,
    openPayload: args.openPayload,
  }), []);

  /** Switch the pane to a source and apply a highlight once it loads. */
  const switchPane = useCallback((src: PaneSource, highlight: PaneHighlight | null) => {
    setPaneSource(src);
    setPanePending(highlight);
  }, []);

  const dispatchSourceAction = useCallback((action: AthenaClientAction) => {
    const p = action.payload as Record<string, any>;
    const act = String(p.action ?? "");
    const setSourceHistory = sessionRef.current?.setSourceHistory;
    switch (act) {
      case "show_source": {
        const appId = String(p.appId ?? "viewer");
        const openPayload = (p.openPayload as Record<string, unknown> | undefined) ?? {};
        const sourceRef = String(p.sourceRef ?? "");
        const name = String(p.title ?? "Source");
        const kind = String(p.sourceKind ?? "");
        const windowId = sourceRef || name;
        const hl = (p.highlight as Record<string, unknown> | undefined);
        const highlight: PaneHighlight | null = hl ? {
          text: typeof hl.text === "string" ? hl.text : undefined,
          posStart: typeof hl.posStart === "number" ? hl.posStart : undefined,
          posEnd: typeof hl.posEnd === "number" ? hl.posEnd : undefined,
          line: typeof hl.line === "number" ? hl.line : undefined,
          lineEnd: typeof hl.lineEnd === "number" ? hl.lineEnd : undefined,
        } : null;
        sourceMetaRef.current[windowId] = { appId, openPayload };
        const src = buildPaneSource({ windowId, appId, refId: sourceRef, name, kind, openPayload });
        switchPane(src, highlight);
        setSourceHistory?.((prev) => {
          const idx = prev.findIndex((h) => h.windowId === windowId);
          const entry = {
            windowId,
            index: idx >= 0 ? prev[idx].index : prev.length + 1,
            name, kind, refId: sourceRef,
            lastHighlight: highlight?.text,
            lastPosStart: highlight?.posStart,
            lastPosEnd: highlight?.posEnd,
          };
          if (idx >= 0) return prev.map((h) => (h.windowId === windowId ? { ...h, ...entry } : h));
          return [...prev, entry];
        });
        break;
      }
      case "show_command": {
        const winId = String(p.windowId ?? "");
        const kind = p.kind as "scroll_to" | "highlight" | "clear_highlight";
        const isActive = paneSourceRef.current?.windowId === winId;
        const payload: Partial<ShowCommand> = {
          text: typeof p.text === "string" ? p.text : undefined,
          posStart: typeof p.posStart === "number" ? p.posStart : undefined,
          posEnd: typeof p.posEnd === "number" ? p.posEnd : undefined,
          lineStart: p.lineStart,
          lineEnd: p.lineEnd,
          line: p.line,
        };
        if (isActive) {
          if (kind === "clear_highlight") issueShowCommand(paneId, "clear_highlight");
          else if (kind === "highlight") issueShowCommand(paneId, "highlight", payload);
          else issueShowCommand(paneId, "scroll_to", payload);
        } else {
          // Target a background source: switch the pane to it and apply after load.
          const entry = sessionRef.current?.sourceHistory.find((h) => h.windowId === winId);
          const meta = sourceMetaRef.current[winId];
          if (entry && meta) {
            const src = buildPaneSource({ windowId: winId, appId: meta.appId, refId: entry.refId, name: entry.name, kind: entry.kind, openPayload: meta.openPayload });
            const pending: PaneHighlight | null = kind === "highlight" ? { text: payload.text, posStart: payload.posStart, posEnd: payload.posEnd, line: payload.lineStart, lineEnd: payload.lineEnd } : null;
            switchPane(src, pending);
          }
        }
        if (kind === "highlight" && p.text) {
          setSourceHistory?.((prev) =>
            prev.map((h) => (h.windowId === winId ? { ...h, lastHighlight: String(p.text) } : h))
          );
        }
        break;
      }
      case "focus_source": {
        const winId = String(p.windowId ?? "");
        const entry = sessionRef.current?.sourceHistory.find((h) => h.windowId === winId);
        const meta = sourceMetaRef.current[winId];
        if (entry && meta) {
          const src = buildPaneSource({ windowId: winId, appId: meta.appId, refId: entry.refId, name: entry.name, kind: entry.kind, openPayload: meta.openPayload });
          switchPane(src, entry.lastHighlight ? {
            text: entry.lastHighlight, posStart: entry.lastPosStart, posEnd: entry.lastPosEnd,
          } : null);
        }
        break;
      }
      case "close_source": {
        const winId = String(p.windowId ?? "");
        setSourceHistory?.((prev) => {
          const next = prev.filter((h) => h.windowId !== winId);
          // If the closed source was active, switch to the most recent remaining.
          if (paneSourceRef.current?.windowId === winId) {
            const last = next[next.length - 1];
            const meta = last ? sourceMetaRef.current[last.windowId] : undefined;
            if (last && meta) {
              const src = buildPaneSource({ windowId: last.windowId, appId: meta.appId, refId: last.refId, name: last.name, kind: last.kind, openPayload: meta.openPayload });
              switchPane(src, null);
            } else {
              setPaneSource(null);
              setPanePending(null);
            }
          }
          return next;
        });
        delete sourceMetaRef.current[winId];
        break;
      }
      default: {
        // Other client_actions (open_app, etc.) — keep non-teacher tools working.
        if (act === "open_app" && p.appId) {
          openWindow({
            appId: p.appId as any,
            title: String(p.title ?? p.appId),
            icon: APP_ICONS[p.appId] ?? "AppWindow",
            payload: p.noteId ? { noteId: p.noteId } : p.fileId ? { fileId: p.fileId } : p.url ? { url: p.url } : undefined,
          });
        }
        break;
      }
    }
  }, [openWindow, buildPaneSource, switchPane, issueShowCommand, paneId]);

  const teach = useTeacherSession({
    language,
    initialSessionId,
    dispatchSourceAction,
    windowSnapshot,
  });
  sessionRef.current = teach;
  const {
    sessions, session, sessionId, messages, streaming, streamText, error, loadingSession,
    teachState, sourceHistory, comprehensionChecks, toolChips, planning,
    exporting, exportResult, setExportResult, exportLesson, generatePlan,
    loadSession, startNewSession, deleteSession, resetSession, renameSession,
    setSessionSources, updateTeachState, setPaceFeedback,
    answerComprehension, send, stop, retry, canRetry, setLibrary, setOnTurnDone,
    attachedSources, setError,
  } = teach;

  // ----- speech-synced source highlighting -----

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
    if (cited) {
      setSpeakingWindow(cited.windowId);
      // Re-anchor to the LAST resolved highlight for this source (exact offsets
      // when available) so the passage stays scrolled into view as the voice
      // plays. We do NOT highlight from seg.quote — quotes extracted from the
      // spoken text are rarely verbatim and caused the "wrong word highlighted"
      // glitch. Only re-issue when switching INTO this source, to avoid
      // re-highlighting on every sentence (which flickers).
      const switchingIn = !prev || prev.citations[0] !== seg.citations[0];
      if (switchingIn) {
        // Switch the pane to the cited source if it's not already active.
        if (paneSourceRef.current?.windowId !== cited.windowId) {
          const meta = sourceMetaRef.current[cited.windowId];
          if (meta) {
            const src = buildPaneSource({
              windowId: cited.windowId, appId: meta.appId, refId: cited.refId,
              name: cited.name, kind: cited.kind, openPayload: meta.openPayload,
            });
            switchPane(src, cited.lastHighlight ? {
              text: cited.lastHighlight, posStart: cited.lastPosStart, posEnd: cited.lastPosEnd,
            } : null);
          }
        } else if (typeof cited.lastPosStart === "number" && typeof cited.lastPosEnd === "number") {
          issueShowCommand(paneId, "highlight", { posStart: cited.lastPosStart, posEnd: cited.lastPosEnd });
        } else if (cited.lastHighlight) {
          issueShowCommand(paneId, "highlight", { text: cited.lastHighlight });
        }
      }
      return;
    }
    setSpeakingWindow(null);
    // Only clear once, when leaving a source-bound sentence.
    if (prev && prev.citations.length > 0) {
      issueShowCommand(paneId, "clear_highlight");
    }
  }, [issueShowCommand, setSpeakingWindow, paneId, buildPaneSource, switchPane]);

  const tts = useTeacherTts({ language, onWordBoundary });
  const ttsRef = useRef(tts);
  ttsRef.current = tts;

  /** Speak an assistant message, pre-mapping its sentences to the sources. */
  const speakMessage = useCallback((text: string, id: string) => {
    segmentsRef.current = prepareSpeech(text).segments;
    spokenSegRef.current = null;
    void ttsRef.current.speak(text, id);
  }, []);

  // Auto-speak finished turns.
  useEffect(() => {
    setOnTurnDone((text) => {
      if (autoSpeakRef.current && text.trim()) speakMessage(text, "latest");
    });
    return () => setOnTurnDone(null);
  }, [setOnTurnDone, speakMessage]);

  // Drop the "currently spoken" glow when playback ends.
  useEffect(() => {
    if (!tts.playing) {
      setSpeakingWindow(null);
      spokenSegRef.current = null;
    }
  }, [tts.playing, setSpeakingWindow]);

  // ----- source-show failures -----

  // A failed highlight is actionable: tell the student, and tell Athena (via
  // state.sourceIssues) so the next turn quotes the passage inline instead.
  const seenResultRef = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const [winId, res] of Object.entries(showResults as Record<string, ShowResult>)) {
      if (seenResultRef.current[winId] === res.seq || res.ok) {
        seenResultRef.current[winId] = res.seq;
        continue;
      }
      seenResultRef.current[winId] = res.seq;
      // All show commands route through paneId; look up the active source.
      const activeWindowId = paneSourceRef.current?.windowId;
      const entry = activeWindowId
        ? sourceHistoryRef.current.find((h) => h.windowId === activeWindowId)
        : sourceHistoryRef.current.find((h) => h.windowId === winId);
      const reason = res.reason ?? "no-match";
      setShowIssue(
        `Couldn't highlight in ${entry?.name ?? "the source"} — ${SHOW_FAILURE_TEXT[reason] ?? reason}. Mavino will quote the passage instead.`
      );
      void updateTeachState({
        sourceIssues: [
          ...(teachState.sourceIssues ?? []).slice(-4),
          { name: entry?.name, refId: entry?.refId, reason, at: new Date().toISOString() },
        ],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResults]);

  // ----- STT (student voice input) -----

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
      transcriber.onError(() => {
        setListening(false);
        setInterimText("");
      });
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

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamText, comprehensionChecks]);

  // Keep the pre-session selection in sync with the loaded session.
  useEffect(() => {
    if (session) setSelectedSourceIds(new Set(session.sourceIds));
  }, [session]);

  // ----- citations -----

  const openCitation = useCallback((index: number) => {
    const entry = sourceHistory.find((h) => h.index === index);
    if (!entry) return;
    const appId = entry.kind === "note" ? "notes"
      : entry.kind === "url" || entry.kind === "moodle" ? "browser"
      : entry.kind === "file" ? "editor"
      : "viewer";
    const openPayload = entry.kind === "note" ? { noteId: entry.refId }
      : entry.kind === "file" ? { fileId: entry.refId }
      : entry.kind === "url" || entry.kind === "moodle" ? { url: entry.refId }
      : {};
    const meta = sourceMetaRef.current[entry.windowId];
    const src = buildPaneSource({
      windowId: entry.windowId,
      appId: meta?.appId ?? appId,
      refId: entry.refId,
      name: entry.name,
      kind: entry.kind,
      openPayload: meta?.openPayload ?? openPayload,
    });
    switchPane(src, entry.lastHighlight ? {
      text: entry.lastHighlight, posStart: entry.lastPosStart, posEnd: entry.lastPosEnd,
    } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceHistory, buildPaneSource, switchPane]);

  const citationMeta = sourceHistory.map((h) => ({ index: h.index, name: h.name, kind: h.kind, refId: h.refId }));

  const startSession = () => {
    void startNewSession({
      sourceIds: [...selectedSourceIds],
      studentLevel,
      teachingStyle,
      withPlan,
    });
  };

  const newSession = () => {
    resetSession();
    setSelectedSourceIds(new Set());
    setShowSourcePanel(true);
    setSettingsOpen(false);
  };

  // ----- render -----

  if (loadingSession && !session) {
    return <div className="flex h-full items-center justify-center"><Loading label="Loading session…" /></div>;
  }

  return (
    <div className="flex h-full gap-3">
      {/* Session list — collapsible sidebar @4xl+ */}
      {sidebarOpen ? (
        <div className="hidden w-56 shrink-0 flex-col @4xl:flex">
          <div className="flex items-center justify-between border-b border-edge px-1 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Sessions</span>
            <div className="flex items-center gap-1">
              <button
                onClick={newSession}
                className="flex items-center gap-1 rounded-md border border-edge px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface-2 hover:text-ink"
                title="New session"
              >
                <Plus size={10} /> New
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-md p-0.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
                title="Collapse sidebar"
              >
                <PanelLeftClose size={14} />
              </button>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-ink-muted">No sessions yet.</p>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition ${
                    sessionId === s.id ? "border-accent/40 bg-accent/10" : "border-transparent hover:bg-surface-2"
                  }`}
                >
                  <button onClick={() => void loadSession(s.id)} className="flex flex-1 flex-col items-start text-left">
                    <span className="truncate text-ink">{s.title}</span>
                    <span className="text-[10px] text-ink-muted">{s.sourceIds.length} src · {timeAgo(s.updatedAt)}</span>
                  </button>
                  <button
                    onClick={() => void deleteSession(s.id)}
                    className="shrink-0 rounded p-0.5 text-ink-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                    title="Delete session"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="hidden shrink-0 flex-col items-center pt-2 @4xl:flex">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
            title="Expand sidebar"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      )}

      {/* Chat panel */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Mobile session list dropdown */}
        <div className="flex items-center gap-2 @4xl:hidden">
          <div className="relative flex-1">
            <button
              onClick={() => setListOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-ink hover:bg-surface-3"
            >
              <span className="flex items-center gap-2 truncate">
                <MessageSquare size={13} className="shrink-0 text-accent" />
                <span className="truncate">{session?.title ?? "Start a Teach Me session"}</span>
              </span>
              <ChevronDown size={13} className="shrink-0 text-ink-muted" />
            </button>
            {listOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-edge bg-surface py-1 shadow-window">
                <button
                  onClick={() => { setListOpen(false); newSession(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-accent hover:bg-surface-2"
                >
                  <Plus size={13} /> New session
                </button>
                {sessions.map((s) => (
                  <div key={s.id} className={`group flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 ${sessionId === s.id ? "bg-surface-2" : ""}`}>
                    <button onClick={() => { setListOpen(false); void loadSession(s.id); }} className="flex flex-1 flex-col items-start text-left">
                      <span className="truncate text-ink">{s.title}</span>
                      <span className="text-[10px] text-ink-muted">{s.sourceIds.length} src · {timeAgo(s.updatedAt)}</span>
                    </button>
                    <button onClick={() => void deleteSession(s.id)} className="shrink-0 rounded p-0.5 text-ink-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Source selection (only when no active session) */}
        {!session && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowSourcePanel((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
              >
                <ChevronDown size={12} className={`transition ${showSourcePanel ? "" : "-rotate-90"}`} />
                Sources {selectedSourceIds.size > 0 && `(${selectedSourceIds.size})`}
              </button>
            </div>
            {showSourcePanel && (
              <WorkspaceSourceSelector
                selectedIds={selectedSourceIds}
                showPreview
                onToggle={(id) => setSelectedSourceIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                onSourceAdded={(s) => setLibrary((prev) => [s, ...prev.filter((x) => x.id !== s.id)])}
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-muted">Level:</span>
              {(["beginner", "intermediate", "advanced"] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setStudentLevel(lvl)}
                  className={`rounded-md px-2 py-1 text-[11px] capitalize transition ${
                    studentLevel === lvl ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {lvl}
                </button>
              ))}
              <span className="ml-2 text-xs text-ink-muted">Style:</span>
              {(["explain", "socratic"] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setTeachingStyle(st)}
                  className={`rounded-md px-2 py-1 text-[11px] capitalize transition ${
                    teachingStyle === st ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                  title={st === "socratic" ? "Mavino only asks guiding questions" : "Mavino explains, then checks"}
                >
                  {st}
                </button>
              ))}
              <label className="flex items-center gap-1 text-[11px] text-ink-muted">
                <input type="checkbox" checked={withPlan} onChange={(e) => setWithPlan(e.target.checked)} />
                Plan the lesson
              </label>
              <ActionButton onClick={startSession} variant="primary">
                <Sparkles size={13} /> Start Teaching
              </ActionButton>
            </div>
          </div>
        )}

        {/* Session header: title, agenda, settings, export */}
        {session && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {titleDraft === null ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{session.title}</span>
                  <button
                    onClick={() => setTitleDraft(session.title)}
                    className="rounded-md p-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
                    title="Rename lesson"
                  >
                    <Pencil size={12} />
                  </button>
                </>
              ) : (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => { void renameSession(titleDraft); setTitleDraft(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { void renameSession(titleDraft); setTitleDraft(null); }
                    if (e.key === "Escape") setTitleDraft(null);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-edge bg-surface-2 px-2 py-1 text-sm text-ink outline-none focus:border-accent/50"
                />
              )}
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                  settingsOpen ? "border-accent/40 bg-accent/10 text-accent" : "border-edge text-ink-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <Settings2 size={11} /> Lesson settings
              </button>
              <ExportMenu
                onExport={(t) => void exportLesson(t)}
                exporting={exporting}
                result={exportResult}
                onDismissResult={() => setExportResult("")}
              />
            </div>

            <LessonAgenda
              plan={teachState.lessonPlan}
              covered={teachState.coveredConcepts ?? []}
              mastery={teachState.mastery ?? {}}
              followPlan={teachState.followPlan !== false}
              onToggleFollow={(v) => void updateTeachState({ followPlan: v })}
              onRegenerate={() => void generatePlan()}
              planning={planning}
            />

            {settingsOpen && (
              <SessionSettings
                attached={attachedSources}
                studentLevel={(teachState.studentLevel as StudentLevel) ?? "intermediate"}
                teachingStyle={(teachState.teachingStyle as TeachingStyle) ?? "explain"}
                inferredLevel={teachState.inferredLevel}
                onReorder={(ids) => void setSessionSources(ids)}
                onLevel={(lvl) => void updateTeachState({ studentLevel: lvl })}
                onStyle={(st) => void updateTeachState({ teachingStyle: st })}
                onSourceAdded={(s) => setLibrary((prev) => [s, ...prev.filter((x) => x.id !== s.id)])}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </div>
        )}

        {error && (
          <div className="flex flex-col gap-1">
            <ErrorBanner message={error} />
            {canRetry && (
              <button
                onClick={retry}
                className="flex items-center gap-1 self-start rounded-md border border-edge px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <RotateCcw size={11} /> Retry that turn
              </button>
            )}
          </div>
        )}

        {showIssue && (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span className="flex-1">{showIssue}</span>
            <button onClick={() => setShowIssue("")} className="shrink-0 opacity-70 hover:opacity-100"><X size={11} /></button>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {messages.length === 0 && !streamText && session && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-ink-muted">
              <GraduationCap size={40} className="opacity-30" />
              <p className="text-sm">Ask Mavino to teach you something from your sources.</p>
              <p className="text-xs">e.g. "Teach me about gradient descent" or "Explain the first chapter"</p>
            </div>
          )}
          {messages.map((m, i) => {
            const msgId = `msg-${i}`;
            const isSpeaking = tts.speakingId === msgId && tts.playing;
            return (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`group max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-accent/15 text-ink" : "bg-surface-2 text-ink"
                }`}>
                  {m.role === "assistant" ? (
                    <>
                      <HighlightableMarkdown
                        content={m.content}
                        scope="teacher"
                        scopeId={sessionId ? `${sessionId}#msg-${i}` : msgId}
                        sourceName={session?.title ? `Teach Me: ${session.title}` : "Teach Me"}
                        citations={citationMeta}
                        onOpenCitation={openCitation}
                      />
                      {tts.supported && (
                        <div className={`mt-1 flex items-center gap-1.5 transition-opacity ${isSpeaking ? "" : "opacity-0 group-hover:opacity-100"}`}>
                          {isSpeaking ? (
                            <>
                              <button
                                onClick={() => (tts.paused ? tts.resume() : tts.pause())}
                                className="flex items-center gap-1 text-[10px] text-accent hover:opacity-80"
                              >
                                {tts.paused ? <Play size={11} /> : <Pause size={11} />} {tts.paused ? "Resume" : "Pause"}
                              </button>
                              <button onClick={tts.stop} className="flex items-center gap-1 text-[10px] text-ink-muted hover:text-ink">
                                <Square size={10} /> Stop
                              </button>
                              <span className="h-1 w-20 overflow-hidden rounded-full bg-surface-3">
                                <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round(tts.progress * 100)}%` }} />
                              </span>
                            </>
                          ) : (
                            <button
                              onClick={() => speakMessage(m.content, msgId)}
                              className="flex items-center gap-1 text-[10px] text-ink-muted hover:text-accent"
                              title="Read aloud"
                            >
                              <Volume2 size={11} /> Read aloud
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              </div>
            );
          })}
          {streamText && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <HighlightableMarkdown
                  content={streamText}
                  scope="teacher"
                  scopeId={sessionId ? `${sessionId}#stream` : "stream"}
                  sourceName={session?.title ? `Teach Me: ${session.title}` : "Teach Me"}
                  citations={citationMeta}
                  onOpenCitation={openCitation}
                  enabled={false}
                />
                <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-accent align-middle" />
              </div>
            </div>
          )}

          <ToolChipRow chips={toolChips} />

          {/* Comprehension checks (graded ones stay visible with their feedback) */}
          {comprehensionChecks.map((c) => (
            <ComprehensionCard key={c.id} check={c} onAnswer={(ans) => void answerComprehension(c.id, ans)} />
          ))}
        </div>

        {/* Input */}
        <div className="flex flex-col gap-2 border-t border-edge pt-2">
          {/* Voice + pace controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setAutoSpeak((v) => {
                  if (v) tts.stop();
                  return !v;
                });
              }}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition ${
                autoSpeak ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink"
              }`}
              title={autoSpeak ? "Auto-speak on (Mavino will read her replies aloud)" : "Auto-speak off"}
            >
              {autoSpeak ? <Volume2 size={12} /> : <VolumeX size={12} />}
              Auto-speak ({tts.provider === "server" ? "Voice" : tts.provider === "webspeech" ? "Web Speech" : "off"})
            </button>
            {tts.playing && (
              <>
                <button
                  onClick={() => (tts.paused ? tts.resume() : tts.pause())}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
                >
                  {tts.paused ? <Play size={11} /> : <Pause size={11} />} {tts.paused ? "Resume" : "Pause"}
                </button>
                <button onClick={tts.stop} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink">
                  <Square size={11} /> Stop voice
                </button>
              </>
            )}
            {session && <PaceFeedbackRow value={teachState.paceFeedback} onChange={setPaceFeedback} />}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={listening ? interimText || "Listening…" : input}
              onChange={(e) => {
                setInput(e.target.value);
                // Typing means the student wants to interject — get out of the way.
                if (ttsRef.current.playing && !ttsRef.current.paused) ttsRef.current.pause();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                  setInput("");
                }
              }}
              placeholder={session ? "Ask Mavino to teach you…" : "Select sources and start a session first"}
              disabled={!session || streaming || listening}
              rows={1}
              className="flex-1 resize-none rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent/50 disabled:opacity-50"
            />
            {sttSupported && session && (
              <button
                onClick={listening ? stopListening : startListening}
                disabled={streaming}
                className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm transition disabled:opacity-40 ${
                  listening ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "border border-edge text-ink-muted hover:bg-surface-2 hover:text-ink"
                }`}
                title={listening ? "Stop listening" : "Speak your question"}
              >
                {listening ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
            )}
            {streaming ? (
              <button onClick={stop} className="flex items-center gap-1 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-400 hover:bg-red-500/30">
                <Square size={14} /> Stop
              </button>
            ) : (
              <button
                onClick={() => { send(input); setInput(""); }}
                disabled={!session || !input.trim()}
                className="flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-40"
              >
                <Send size={14} /> Send
              </button>
            )}
          </div>
        </div>

        {/* Active source-history indicator */}
        {sourceHistory.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-ink-muted">Open sources:</span>
            {sourceHistory.map((h) => {
              const Icon = KIND_ICON[h.kind] ?? FileText;
              return (
                <button
                  key={h.windowId}
                  onClick={() => openCitation(h.index)}
                  className="flex items-center gap-1 rounded-md border border-edge bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface-3 hover:text-ink"
                  title={`Focus ${h.name}`}
                >
                  <Icon size={10} /> [{h.index}] {h.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Side-by-side source pane (wide screens only).
          Replaces floating source windows — the teacher's show_source /
          highlight_source / focus_source / close_source commands drive this
          pane via the shared show-control channel (paneId). */}
      <div className="hidden w-[30rem] shrink-0 @4xl:flex">
        <TeachSourcePane
          paneId={paneId}
          source={paneSource}
          pending={panePending}
          onPendingApplied={() => setPanePending(null)}
          onClose={() => {
            const wid = paneSource?.windowId;
            if (wid) {
              teach.setSourceHistory((prev) => prev.filter((h) => h.windowId !== wid));
              delete sourceMetaRef.current[wid];
            }
            setPaneSource(null);
            setPanePending(null);
          }}
        />
      </div>
    </div>
  );
}

// ----- session settings popover -----

function SessionSettings({
  attached,
  studentLevel,
  teachingStyle,
  inferredLevel,
  onReorder,
  onLevel,
  onStyle,
  onSourceAdded,
  onClose,
}: {
  attached: StudySource[];
  studentLevel: StudentLevel;
  teachingStyle: TeachingStyle;
  inferredLevel?: string;
  onReorder: (ids: string[]) => void;
  onLevel: (lvl: StudentLevel) => void;
  onStyle: (st: TeachingStyle) => void;
  onSourceAdded: (s: StudySource) => void;
  onClose: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const ids = attached.map((s) => s.id);

  const move = (id: string, delta: number) => {
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    onReorder(next);
  };

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = ids.filter((i) => i !== dragId);
    next.splice(ids.indexOf(targetId), 0, dragId);
    setDragId(null);
    onReorder(next);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-edge bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Lesson settings</span>
        <button onClick={onClose} className="rounded p-0.5 text-ink-muted hover:text-ink"><X size={12} /></button>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-muted">
          Attached sources — drag to set the citation order
        </span>
        {attached.length === 0 ? (
          <p className="text-[11px] text-ink-muted">No sources attached.</p>
        ) : attached.map((s, i) => {
          const Icon = KIND_ICON[s.kind] ?? FileText;
          return (
            <div
              key={s.id}
              draggable
              onDragStart={() => setDragId(s.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOn(s.id)}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                dragId === s.id ? "border-accent/50 bg-accent/10" : "border-edge bg-surface"
              }`}
            >
              <span className="w-4 shrink-0 text-center text-ink-muted">[{i + 1}]</span>
              <Icon size={11} className="shrink-0 opacity-60" />
              <span className="flex-1 truncate text-ink">{s.name}</span>
              <button onClick={() => move(s.id, -1)} disabled={i === 0} className="rounded p-0.5 text-ink-muted hover:text-ink disabled:opacity-30" title="Move up">
                <ArrowUp size={11} />
              </button>
              <button onClick={() => move(s.id, 1)} disabled={i === attached.length - 1} className="rounded p-0.5 text-ink-muted hover:text-ink disabled:opacity-30" title="Move down">
                <ArrowDown size={11} />
              </button>
              <button
                onClick={() => onReorder(ids.filter((x) => x !== s.id))}
                className="rounded p-0.5 text-ink-muted hover:text-red-400"
                title="Remove from lesson"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>

      <WorkspaceSourceSelector
        compact
        showPreview
        selectedIds={new Set<string>()}
        attachedIds={new Set(ids)}
        onToggle={(id) => onReorder([...ids, id])}
        onSourceAdded={onSourceAdded}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-ink-muted">Level:</span>
        {(["beginner", "intermediate", "advanced"] as const).map((lvl) => (
          <button
            key={lvl}
            onClick={() => onLevel(lvl)}
            className={`rounded-md px-2 py-1 text-[11px] capitalize transition ${
              studentLevel === lvl ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
            }`}
          >
            {lvl}
          </button>
        ))}
        {inferredLevel && inferredLevel !== studentLevel && (
          <span className="flex items-center gap-1 text-[10px] text-ink-muted" title="Adapted from your comprehension checks">
            <Check size={9} /> teaching at {inferredLevel}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-ink-muted">Style:</span>
        {(["explain", "socratic"] as const).map((st) => (
          <button
            key={st}
            onClick={() => onStyle(st)}
            className={`rounded-md px-2 py-1 text-[11px] capitalize transition ${
              teachingStyle === st ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
            }`}
            title={st === "socratic" ? "Mavino only asks guiding questions" : "Mavino explains, then checks"}
          >
            {st}
          </button>
        ))}
      </div>
    </div>
  );
}
