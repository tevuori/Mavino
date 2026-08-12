// ===== Echo app (Pro-tier live lecture companion) =====
// A real-time lecture companion: records audio from the mic (MediaRecorder,
// chunked ~8s), sends each chunk to the server for transcription, and shows
// the live transcript with concept chips from the user's Atlas inline
// (green = known, red = weak, blue = new). On stop, the server generates a
// structured note + extracts new terms for flashcard suggestions.
//
// The recording loop:
//   1. getUserMedia({ audio: true }) → MediaRecorder (audio/webm;codecs=opus)
//   2. ondataavailable → accumulate chunks; every ~8s, send the accumulated
//      blob to POST /api/echo/sessions/:id/chunk with the current offset.
//   3. The client polls GET /api/echo/sessions/:id every 3s for the updated
//      transcript + concepts (the server transcribes + matches on each chunk).
//   4. On stop: POST /api/echo/sessions/:id/stop → LLM generates the note.
//
// Privacy: audio is processed ephemerally — chunks are sent for transcription
// and not stored on disk. Only the transcript text is persisted in the session.

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Radio, Mic, Square, Loader2, AlertCircle,
  TrendingDown, TrendingUp, Minus, Sparkles, Clock,
  FileText, ChevronRight, History,
} from "lucide-react";
import { echoApi, type EchoSessionStatus, type EchoConceptMatch } from "../../services/echo";
import { useWindows } from "../../store/windows";
import type { WindowInstance } from "../../store/windows";

// ----- mastery badge (shared with Atlas) -----
function MasteryBadge({ mastery }: { mastery: number }) {
  if (mastery < 0) return null;
  const pct = Math.round(mastery * 100);
  const Icon = pct >= 80 ? TrendingUp : pct >= 60 ? Minus : TrendingDown;
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] ${color}`}>
      <Icon size={9} />{pct}%
    </span>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function EchoApp({ win: _win }: { win: WindowInstance }) {
  const [session, setSession] = useState<EchoSessionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState<"live" | "history">("live");
  const [history, setHistory] = useState<EchoSessionStatus[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  // Refs for the recording loop.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  // Timestamp (ms) when the current batch of chunks began accumulating.
  // Used to compute each upload's offsetSec + durationSec. Reset after each
  // send so the next batch's offset/duration are independent.
  const batchStartRef = useRef<number>(0);
  // Guards the upload loop so concurrent uploads can't race (and overwrite the
  // server-side transcript). While true, the next send is deferred.
  const sendingRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const { open } = useWindows();

  // ----- recording loop -----

  /** Stop the MediaRecorder + timers (but don't stop the session). */
  const stopRecordingLoop = (releaseMic: boolean = true) => {
    if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; }
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch { /* ignore */ }
    if (releaseMic) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    sendingRef.current = false;
  };

  // Auto-scroll the transcript to the bottom when new segments arrive.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.transcript.length]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopRecordingLoop(false);
      if (pollRef.current) clearInterval(pollRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // Load the active session on mount.
  const loadActive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { session: active } = await echoApi.getActive();
      setSession(active);
      if (active) {
        sessionIdRef.current = active.id;
        // If it's active but we're not recording, the user may have reloaded —
        // show the transcript but don't auto-resume recording.
        setElapsed(active.durationSec);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load active session");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadActive(); }, [loadActive]);

  /** Send accumulated audio chunks to the server. The offset + duration of the
   *  batch are computed from batchStartRef so the server can place the segment
   *  correctly. After sending, batchStartRef is reset for the next batch. */
  const sendChunks = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || chunksRef.current.length === 0) return;
    if (sendingRef.current) return; // a previous send is still in flight
    sendingRef.current = true;
    const batchStart = batchStartRef.current;
    const now = Date.now();
    const offsetSec = (batchStart - startTimeRef.current) / 1000;
    const durationSec = (now - batchStart) / 1000;
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "audio/webm" });
    chunksRef.current = [];
    // The next batch starts accumulating now.
    batchStartRef.current = now;
    try {
      const updated = await echoApi.uploadChunk(sid, blob, blob.type, offsetSec, durationSec);
      setSession(updated);
    } catch (e) {
      // Non-fatal: the chunk is lost but recording continues.
      console.warn("[echo] chunk upload failed:", e);
    } finally {
      sendingRef.current = false;
    }
  }, []);

  /** Start recording: get mic access, set up MediaRecorder, send chunks every 8s. */
  const startRecording = useCallback(async () => {
    setMicError(null);
    setError(null);
    try {
      // Ensure we have an active session.
      if (!sessionIdRef.current) {
        const s = await echoApi.start({ language: "en" });
        sessionIdRef.current = s.id;
        setSession(s);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Pick the best supported codec.
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : "";

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // Collect data every 1s; send every 8s.
      recorder.start(1000);
      startTimeRef.current = Date.now();
      batchStartRef.current = Date.now();

      // Send chunks every 8 seconds. Uses a self-scheduling setTimeout that
      // awaits each upload before scheduling the next, so concurrent uploads
      // can't race and overwrite the server-side transcript. If a send is
      // still in flight when the timer fires, it's skipped (the next tick will
      // pick up the accumulated batch).
      const scheduleNextSend = () => {
        chunkTimerRef.current = setTimeout(() => {
          void sendChunks().finally(() => {
            // Only schedule the next tick while still recording.
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
              scheduleNextSend();
            }
          });
        }, 8000);
      };
      scheduleNextSend();

      // Elapsed timer.
      setElapsed(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);

      // Poll for transcript updates every 3s (in case the server's concept
      // matching updates between chunk uploads).
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        if (!sessionIdRef.current) return;
        try {
          const s = await echoApi.get(sessionIdRef.current);
          setSession(s);
        } catch { /* non-fatal */ }
      }, 3000);

      setRecording(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to access microphone";
      setMicError(msg);
      setRecording(false);
    }
  }, [sendChunks]);

  /** Stop recording: send final chunks, stop the session, generate note. */
  const stopRecording = useCallback(async () => {
    // Send any remaining chunks.
    if (chunksRef.current.length > 0) {
      await sendChunks();
    }
    stopRecordingLoop(true);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setRecording(false);
    setFinalizing(true);
    setError(null);
    try {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error("No active session");
      const completed = await echoApi.stop(sid);
      setSession(completed);
      sessionIdRef.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to finalize session");
    } finally {
      setFinalizing(false);
    }
  }, [sendChunks]);

  // ----- history -----

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { sessions } = await echoApi.list();
      setHistory(sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "history") void loadHistory();
  }, [view, loadHistory]);

  // ----- derived -----

  const transcriptText = session?.transcript.map((s) => s.text).join(" ") ?? "";
  const wordCount = transcriptText.split(/\s+/).filter(Boolean).length;
  const weakConcepts = session?.concepts.filter((c) => c.weak) ?? [];
  const knownConcepts = session?.concepts.filter((c) => !c.weak) ?? [];

  // ----- render -----

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Radio size={18} className="text-accent" />
          <h2 className="text-sm font-semibold text-ink">Echo</h2>
          <span className="text-xs text-ink-muted">Live lecture companion</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView("live")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              view === "live" ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-2"
            }`}
          >
            Live
          </button>
          <button
            onClick={() => setView("history")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              view === "history" ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-2"
            }`}
          >
            <History size={12} /> History
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      {micError && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertCircle size={14} /> Microphone access failed: {micError}
        </div>
      )}

      {view === "live" ? (
        <LiveView
          session={session}
          loading={loading}
          recording={recording}
          finalizing={finalizing}
          elapsed={elapsed}
          wordCount={wordCount}
          weakConcepts={weakConcepts}
          knownConcepts={knownConcepts}
          onStart={startRecording}
          onStop={stopRecording}
          transcriptEndRef={transcriptEndRef}
          onOpenNote={(noteId) => open({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId } })}
        />
      ) : (
        <HistoryView
          sessions={history}
          loading={historyLoading}
          onSelect={(s) => { setSession(s); setView("live"); }}
          onOpenNote={(noteId) => open({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId } })}
        />
      )}
    </div>
  );
}

// ----- live view -----

function LiveView({
  session,
  loading,
  recording,
  finalizing,
  elapsed,
  wordCount,
  weakConcepts,
  knownConcepts,
  onStart,
  onStop,
  transcriptEndRef,
  onOpenNote,
}: {
  session: EchoSessionStatus | null;
  loading: boolean;
  recording: boolean;
  finalizing: boolean;
  elapsed: number;
  wordCount: number;
  weakConcepts: EchoConceptMatch[];
  knownConcepts: EchoConceptMatch[];
  onStart: () => void;
  onStop: () => void;
  transcriptEndRef: React.RefObject<HTMLDivElement>;
  onOpenNote: (noteId: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={24} className="animate-spin text-ink-muted" />
      </div>
    );
  }

  const isCompleted = session?.status === "completed";

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main: transcript + controls */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Recording controls */}
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div className="flex items-center gap-3">
            {recording ? (
              <>
                <span className="flex h-3 w-3 animate-pulse rounded-full bg-red-500" />
                <span className="text-sm font-medium text-red-400">Recording</span>
                <span className="flex items-center gap-1 text-xs text-ink-muted">
                  <Clock size={12} /> {formatTime(elapsed)}
                </span>
                <span className="text-xs text-ink-muted">{wordCount} words</span>
              </>
            ) : isCompleted ? (
              <>
                <Sparkles size={16} className="text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">Session completed</span>
                {session?.noteId && (
                  <button
                    onClick={() => onOpenNote(session.noteId!)}
                    className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-xs text-accent hover:bg-accent/25"
                  >
                    <FileText size={11} /> Open note
                  </button>
                )}
              </>
            ) : (
              <span className="text-sm text-ink-muted">Ready to start</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {finalizing ? (
              <button disabled className="flex items-center gap-2 rounded-lg bg-surface-2 px-4 py-2 text-sm text-ink-muted">
                <Loader2 size={16} className="animate-spin" /> Generating notes…
              </button>
            ) : recording ? (
              <button
                onClick={onStop}
                className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
              >
                <Square size={16} /> Stop & finalize
              </button>
            ) : !isCompleted ? (
              <button
                onClick={onStart}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90"
              >
                <Mic size={16} /> {session ? "Resume" : "Start"} lecture
              </button>
            ) : null}
          </div>
        </div>

        {/* Transcript */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!session || session.transcript.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15">
                <Mic size={28} className="text-accent" />
              </div>
              <p className="max-w-xs text-sm text-ink-muted">
                {isCompleted
                  ? "No transcript was captured. Try again in a quieter environment."
                  : "Press \"Start lecture\" to begin live transcription. Echo will transcribe the lecture in real time and surface concepts from your Atlas as they're mentioned."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {session.transcript.map((seg, i) => (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 pt-0.5 text-[10px] tabular-nums text-ink-muted">
                    {formatTime(seg.start)}
                  </span>
                  <p className="flex-1 text-sm leading-relaxed text-ink">{seg.text}</p>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Sidebar: concepts + new terms */}
      {(session && (session.concepts.length > 0 || session.newTerms.length > 0)) && (
        <div className="w-64 shrink-0 overflow-y-auto border-l border-edge bg-surface-1">
          {/* Concepts */}
          {session.concepts.length > 0 && (
            <div className="p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Concepts mentioned ({session.concepts.length})
              </p>
              <div className="space-y-1.5">
                {weakConcepts.map((c) => (
                  <ConceptChip key={c.id} concept={c} variant="weak" />
                ))}
                {knownConcepts.map((c) => (
                  <ConceptChip key={c.id} concept={c} variant="known" />
                ))}
              </div>
            </div>
          )}
          {/* New terms (only after stop) */}
          {session.newTerms.length > 0 && (
            <div className="border-t border-edge p-3">
              <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                <Sparkles size={10} /> New terms ({session.newTerms.length})
              </p>
              <div className="space-y-2">
                {session.newTerms.map((t, i) => (
                  <div key={i} className="rounded-md border border-blue-500/20 bg-blue-500/5 p-2">
                    <p className="text-xs font-medium text-blue-300">{t.term}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">{t.context}</p>
                    <div className="mt-1.5 rounded bg-surface-2 p-1.5">
                      <p className="text-[10px] text-ink-muted">Suggested flashcard:</p>
                      <p className="text-[11px] text-ink"><strong>Q:</strong> {t.suggestedFront}</p>
                      <p className="text-[11px] text-ink"><strong>A:</strong> {t.suggestedBack}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConceptChip({ concept, variant }: { concept: EchoConceptMatch; variant: "weak" | "known" }) {
  const color = variant === "weak" ? "border-red-500/30 bg-red-500/10" : "border-emerald-500/20 bg-emerald-500/5";
  return (
    <div className={`rounded-md border ${color} p-2`}>
      <div className="flex items-center justify-between gap-1">
        <p className={`text-xs font-medium ${variant === "weak" ? "text-red-300" : "text-emerald-300"}`}>
          {concept.label}
        </p>
        <MasteryBadge mastery={concept.mastery} />
      </div>
      <p className="mt-0.5 text-[10px] text-ink-muted">
        {concept.mentionCount}× mentioned · {formatTime(concept.firstMentionedSec)}
      </p>
    </div>
  );
}

// ----- history view -----

function HistoryView({
  sessions,
  loading,
  onSelect,
  onOpenNote,
}: {
  sessions: EchoSessionStatus[];
  loading: boolean;
  onSelect: (s: EchoSessionStatus) => void;
  onOpenNote: (noteId: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={24} className="animate-spin text-ink-muted" />
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2">
          <History size={28} className="text-ink-muted" />
        </div>
        <p className="max-w-xs text-sm text-ink-muted">
          No past lecture sessions yet. Start a live lecture to capture one.
        </p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-2">
        {sessions.map((s) => {
          const wordCount = (s.meta.wordCount as number) ?? 0;
          const date = new Date(s.startedAt).toLocaleDateString(undefined, {
            weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          });
          return (
            <div
              key={s.id}
              className="group flex items-center gap-3 rounded-lg border border-edge bg-surface-1 p-3 transition hover:border-accent/40"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                <Radio size={18} className="text-accent" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{s.title}</p>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-ink-muted">
                  <span>{date}</span>
                  <span>{formatTime(s.durationSec)}</span>
                  <span>{wordCount} words</span>
                  {s.concepts.length > 0 && <span>{s.concepts.length} concepts</span>}
                  {s.newTerms.length > 0 && <span className="text-blue-400">{s.newTerms.length} new terms</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {s.noteId && (
                  <button
                    onClick={() => onOpenNote(s.noteId!)}
                    className="flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-muted transition hover:text-accent"
                    title="Open note"
                  >
                    <FileText size={12} /> Note
                  </button>
                )}
                <button
                  onClick={() => onSelect(s)}
                  className="flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs text-ink-muted transition hover:text-accent"
                >
                  View <ChevronRight size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
