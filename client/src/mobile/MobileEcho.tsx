// ===== Mobile Echo (Pro-tier live lecture companion) =====
// Mobile-optimized view of Echo: a single-column live transcript with
// concept chips, recording controls, and a history list. The recording
// loop is the same as the desktop EchoApp (MediaRecorder → chunked upload).

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Radio, Mic, Square, Loader2, AlertCircle,
  TrendingDown, TrendingUp, Minus, Sparkles,
  FileText, ChevronRight, History,
} from "lucide-react";
import { echoApi, type EchoSessionStatus, type EchoConceptMatch } from "../services/echo";
import type { MobileTool } from "./MobileLauncher";
import { MobileContainer, MobileHeader, MobileEmpty } from "./MobileUi";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function MobileEcho({ onClose, onOpenTool }: { onClose: () => void; onOpenTool: (tool: MobileTool) => void }) {
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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  // Timestamp (ms) when the current batch of chunks began accumulating.
  const batchStartRef = useRef<number>(0);
  // Guards the upload loop so concurrent uploads can't race.
  const sendingRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.transcript.length]);

  useEffect(() => {
    return () => {
      stopRecordingLoop(false);
      if (pollRef.current) clearInterval(pollRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  const loadActive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { session: active } = await echoApi.getActive();
      setSession(active);
      if (active) {
        sessionIdRef.current = active.id;
        setElapsed(active.durationSec);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadActive(); }, [loadActive]);

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
    batchStartRef.current = now;
    try {
      const updated = await echoApi.uploadChunk(sid, blob, blob.type, offsetSec, durationSec);
      setSession(updated);
    } catch (e) {
      console.warn("[echo] chunk upload failed:", e);
    } finally {
      sendingRef.current = false;
    }
  }, []);

  const startRecording = useCallback(async () => {
    setMicError(null);
    setError(null);
    try {
      if (!sessionIdRef.current) {
        const s = await echoApi.start({ language: "en" });
        sessionIdRef.current = s.id;
        setSession(s);
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(1000);
      startTimeRef.current = Date.now();
      batchStartRef.current = Date.now();
      // Self-scheduling setTimeout: await each upload before scheduling the
      // next, so concurrent uploads can't race and overwrite the transcript.
      const scheduleNextSend = () => {
        chunkTimerRef.current = setTimeout(() => {
          void sendChunks().finally(() => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
              scheduleNextSend();
            }
          });
        }, 8000);
      };
      scheduleNextSend();
      setElapsed(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        if (!sessionIdRef.current) return;
        try { const s = await echoApi.get(sessionIdRef.current); setSession(s); } catch { /* */ }
      }, 3000);
      setRecording(true);
    } catch (e) {
      setMicError(e instanceof Error ? e.message : "Failed to access microphone");
      setRecording(false);
    }
  }, [sendChunks]);

  const stopRecording = useCallback(async () => {
    if (chunksRef.current.length > 0) await sendChunks();
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
      setError(e instanceof Error ? e.message : "Failed to finalize");
    } finally {
      setFinalizing(false);
    }
  }, [sendChunks]);

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

  const wordCount = (session?.transcript.map((s) => s.text).join(" ") ?? "").split(/\s+/).filter(Boolean).length;
  const isCompleted = session?.status === "completed";

  return (
    <MobileContainer>
      <MobileHeader
        title="Echo"
        subtitle="Live lecture companion"
        onClose={onClose}
        right={
          <button
            onClick={() => setView(view === "live" ? "history" : "live")}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink"
          >
            {view === "live" ? <History size={20} /> : <Radio size={20} />}
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {micError && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertCircle size={16} /> Mic: {micError}
        </div>
      )}

      {view === "live" ? (
        loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-ink-muted" />
          </div>
        ) : (
          <>
            {/* Recording controls */}
            <div className="mb-4 flex items-center justify-between rounded-2xl border border-edge bg-surface-2 px-4 py-3">
              <div className="flex items-center gap-2">
                {recording ? (
                  <>
                    <span className="flex h-3 w-3 animate-pulse rounded-full bg-red-500" />
                    <span className="text-sm font-medium text-red-400">{formatTime(elapsed)}</span>
                    <span className="text-xs text-ink-muted">{wordCount}w</span>
                  </>
                ) : isCompleted ? (
                  <>
                    <Sparkles size={16} className="text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">Completed</span>
                  </>
                ) : (
                  <span className="text-sm text-ink-muted">Ready</span>
                )}
              </div>
              {finalizing ? (
                <span className="flex items-center gap-1.5 text-sm text-ink-muted">
                  <Loader2 size={14} className="animate-spin" /> Generating…
                </span>
              ) : recording ? (
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white active:scale-95"
                >
                  <Square size={14} /> Stop
                </button>
              ) : !isCompleted ? (
                <button
                  onClick={startRecording}
                  className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-ink active:scale-95"
                >
                  <Mic size={14} /> {session ? "Resume" : "Start"}
                </button>
              ) : null}
            </div>

            {/* Open note button if completed */}
            {isCompleted && session?.noteId && (
              <button
                onClick={() => onOpenTool("notes")}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent/15 px-4 py-3 text-sm font-medium text-accent active:scale-[.98]"
              >
                <FileText size={16} /> Open generated note
              </button>
            )}

            {/* Transcript */}
            {!session || session.transcript.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-10 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/15">
                  <Mic size={32} className="text-accent" />
                </div>
                <p className="max-w-xs text-sm leading-6 text-ink-muted">
                  {isCompleted
                    ? "No transcript captured."
                    : "Press Start to begin live transcription. Echo transcribes the lecture and surfaces concepts from your Atlas as they're mentioned."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {session.transcript.map((seg, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="shrink-0 pt-0.5 text-[10px] tabular-nums text-ink-muted">
                      {formatTime(seg.start)}
                    </span>
                    <p className="flex-1 text-sm leading-relaxed text-ink">{seg.text}</p>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            )}

            {/* Concepts (inline at the bottom for mobile) */}
            {session && session.concepts.length > 0 && (
              <div className="mt-5 border-t border-edge pt-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Concepts mentioned ({session.concepts.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {session.concepts.map((c) => (
                    <ConceptChipMobile key={c.id} concept={c} />
                  ))}
                </div>
              </div>
            )}

            {/* New terms */}
            {session && session.newTerms.length > 0 && (
              <div className="mt-5 border-t border-edge pt-4">
                <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  <Sparkles size={10} /> New terms ({session.newTerms.length})
                </p>
                <div className="space-y-2">
                  {session.newTerms.map((t, i) => (
                    <div key={i} className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-3">
                      <p className="text-sm font-medium text-blue-300">{t.term}</p>
                      <p className="mt-0.5 text-xs leading-5 text-ink-muted">{t.context}</p>
                      <div className="mt-2 rounded-xl bg-surface-2 p-2">
                        <p className="text-[11px] text-ink"><strong>Q:</strong> {t.suggestedFront}</p>
                        <p className="text-[11px] text-ink"><strong>A:</strong> {t.suggestedBack}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      ) : (
        // History view
        historyLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-ink-muted" />
          </div>
        ) : history.length === 0 ? (
          <MobileEmpty text="No past lecture sessions yet." />
        ) : (
          <div className="space-y-2">
            {history.map((s) => {
              const wc = (s.meta.wordCount as number) ?? 0;
              const date = new Date(s.startedAt).toLocaleDateString(undefined, {
                weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              });
              return (
                <button
                  key={s.id}
                  onClick={() => { setSession(s); setView("live"); }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-3.5 text-left active:bg-surface-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                    <Radio size={18} className="text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{s.title}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-muted">
                      <span>{date}</span>
                      <span>{formatTime(s.durationSec)}</span>
                      <span>{wc}w</span>
                    </div>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-ink-muted" />
                </button>
              );
            })}
          </div>
        )
      )}
    </MobileContainer>
  );
}

function ConceptChipMobile({ concept }: { concept: EchoConceptMatch }) {
  const pct = concept.mastery >= 0 ? Math.round(concept.mastery * 100) : null;
  const Icon = pct === null ? Minus : pct >= 80 ? TrendingUp : pct >= 60 ? Minus : TrendingDown;
  const color = concept.weak
    ? "border-red-500/30 bg-red-500/10 text-red-300"
    : "border-emerald-500/20 bg-emerald-500/5 text-emerald-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border ${color} px-2.5 py-1 text-xs`}>
      <Icon size={10} />
      {concept.label}
      {pct !== null && <span className="text-[10px] opacity-70">{pct}%</span>}
    </span>
  );
}
