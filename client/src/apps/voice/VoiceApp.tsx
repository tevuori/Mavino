// ===== Voice Notes / Audio Recorder app =====
// Records from the microphone (MediaRecorder), saves the audio to the virtual
// FS, transcribes it via Whisper (OpenAI-compatible), runs an LLM cleanup pass,
// and stores the result as a Note linked to the audio file.

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, Square, Play, Pause, Loader2, FileText, FolderOpen, Eye,
  RefreshCw, AlertCircle, CheckCircle2, Trash2, Headphones,
} from "lucide-react";
import { useWindows } from "../../store/windows";
import { useRecorder, fmtDuration } from "./useRecorder";
import { voiceApi, type VoiceNoteResult } from "../../services/voice";

interface SavedRecording {
  id: string;
  title: string;
  noteId: string;
  fileId: string;
  duration: number;
  transcript: string;
  transcribed: boolean;
  createdAt: number;
  audioUrl: string;
}

export default function VoiceApp() {
  const openWindow = useWindows((s) => s.open);
  const rec = useRecorder();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [last, setLast] = useState<SavedRecording | null>(null);
  const [saved, setSaved] = useState<SavedRecording[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleStop = useCallback(async () => {
    const blob = await rec.stop();
    if (!blob || blob.size === 0) {
      setFeedback({ ok: false, msg: "Recording was empty." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res: VoiceNoteResult = await voiceApi.save(blob, { cleanup: true });
      const item: SavedRecording = {
        id: res.file.id + "-" + Date.now(),
        title: res.note.title,
        noteId: res.note.id,
        fileId: res.file.id,
        duration: rec.elapsed,
        transcript: res.transcript,
        transcribed: res.transcribed,
        createdAt: Date.now(),
        audioUrl: URL.createObjectURL(blob),
      };
      setLast(item);
      setSaved((s) => [item, ...s].slice(0, 20));
      setFeedback({
        ok: true,
        msg: res.transcribed
          ? `Saved — note created: ${res.note.title}`
          : "Audio saved (transcription unavailable).",
      });
    } catch (e) {
      setFeedback({ ok: false, msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [rec]);

  const retranscribe = useCallback(
    async (item: SavedRecording) => {
      setBusy(true);
      setFeedback(null);
      try {
        const res = await voiceApi.transcribe(item.fileId, { cleanup: true });
        const updated: SavedRecording = {
          ...item,
          transcript: res.transcript,
          transcribed: res.transcribed,
          title: res.note.title,
        };
        setLast(updated);
        setSaved((s) => s.map((x) => (x.fileId === item.fileId ? updated : x)));
        setFeedback({ ok: true, msg: "Re-transcribed." });
      } catch (e) {
        setFeedback({ ok: false, msg: (e as Error).message });
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const togglePlay = (item: SavedRecording) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playing === item.id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(item.audioUrl);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    audioRef.current = a;
    setPlaying(item.id);
  };

  const openNote = (noteId: string) =>
    openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId } });
  const openFile = (fileId: string) =>
    openWindow({ appId: "viewer", title: "Viewer", icon: "Eye", payload: { fileId } });
  const openFiles = () =>
    openWindow({ appId: "files", title: "Files", icon: "Folder" });

  // Waveform bars derived from the live level.
  const bars = 28;
  const level = rec.level;

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-surface to-surface-2 text-ink">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3 shrink-0">
        <Headphones size={16} className="text-accent" />
        <span className="text-sm font-semibold">Voice Notes</span>
        <button
          onClick={openFiles}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink"
          title="Open Files"
        >
          <FolderOpen size={13} /> Files
        </button>
      </div>

      {/* Recorder */}
      <div className="flex flex-col items-center px-6 py-8">
        {/* Waveform / level meter */}
        <div className="flex h-20 items-center justify-center gap-[3px] mb-6">
          {Array.from({ length: bars }).map((_, i) => {
            // Center-out amplitude so the meter looks symmetric.
            const dist = Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
            const h = rec.recording
              ? 6 + Math.max(0, level * (1 - dist * 0.7)) * 64 + Math.random() * 6
              : 6;
            return (
              <div
                key={i}
                className="w-[4px] rounded-full transition-[height] duration-75"
                style={{
                  height: `${h}px`,
                  backgroundColor: rec.recording
                    ? rec.paused
                      ? "#f59e0b"
                      : "var(--accent, #6366f1)"
                    : "color-mix(in srgb, currentColor 18%, transparent)",
                }}
              />
            );
          })}
        </div>

        {/* Record / stop button */}
        <div className="relative mb-5">
          <motion.button
            onClick={() => (rec.recording ? handleStop() : rec.start())}
            disabled={busy || !rec.supported}
            whileTap={{ scale: 0.94 }}
            className={`flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg transition disabled:opacity-40 ${
              rec.recording
                ? "bg-danger hover:bg-danger"
                : "bg-accent hover:opacity-90"
            }`}
            title={rec.recording ? "Stop" : "Record"}
          >
            {busy ? (
              <Loader2 size={28} className="animate-spin" />
            ) : rec.recording ? (
              <Square size={26} fill="currentColor" />
            ) : (
              <Mic size={30} />
            )}
          </motion.button>
          {rec.recording && (
            <span className="absolute -right-2 -top-1 flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-danger" />
            </span>
          )}
        </div>

        {/* Elapsed + pause/resume */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-2xl font-bold tabular-nums">
            {fmtDuration(rec.elapsed)}
          </span>
          {rec.recording && (
            <button
              onClick={() => (rec.paused ? rec.resume() : rec.pause())}
              className="flex items-center gap-1 rounded-md bg-surface-2 px-2.5 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink"
            >
              {rec.paused ? <Play size={12} /> : <Pause size={12} />}
              {rec.paused ? "Resume" : "Pause"}
            </button>
          )}
        </div>

        {!rec.supported && (
          <p className="mt-3 text-xs text-danger">
            Audio recording is not supported in this browser.
          </p>
        )}
        {rec.error && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle size={13} /> {rec.error}
          </p>
        )}
        {feedback && (
          <p
            className={`mt-3 flex items-center gap-1.5 text-xs ${
              feedback.ok ? "text-success" : "text-danger"
            }`}
          >
            {feedback.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            {feedback.msg}
          </p>
        )}
      </div>

      {/* Last result */}
      <AnimatePresence>
        {last && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mx-4 mb-3 overflow-hidden rounded-xl border border-edge bg-surface-2"
          >
            <div className="flex items-start gap-3 p-3">
              <button
                onClick={() => togglePlay(last)}
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:opacity-90"
                title={playing === last.id ? "Stop" : "Play"}
              >
                {playing === last.id ? <Square size={14} fill="currentColor" /> : <Play size={14} className="ml-0.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold">{last.title}</p>
                  <span className="shrink-0 text-[10px] text-ink-muted">
                    {fmtDuration(last.duration)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 text-xs text-ink-muted">
                  {last.transcribed
                    ? last.transcript || "(empty transcript)"
                    : "(no transcript — audio saved)"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => openNote(last.noteId)}
                    className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-[11px] font-medium text-accent transition hover:bg-accent/25"
                  >
                    <FileText size={11} /> Open Note
                  </button>
                  <button
                    onClick={() => openFile(last.fileId)}
                    className="flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-[11px] text-ink-muted transition hover:text-ink"
                  >
                    <Eye size={11} /> Audio
                  </button>
                  <button
                    onClick={() => retranscribe(last)}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-[11px] text-ink-muted transition hover:text-ink disabled:opacity-40"
                  >
                    <RefreshCw size={11} /> Re-transcribe
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recent recordings list */}
      {saved.length > 1 && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            This session
          </h3>
          <div className="space-y-1.5">
            {saved.slice(1).map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-edge bg-surface-2 px-3 py-2"
              >
                <button
                  onClick={() => togglePlay(item)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-muted transition hover:text-ink"
                >
                  {playing === item.id ? <Square size={11} fill="currentColor" /> : <Play size={11} className="ml-0.5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{item.title}</p>
                  <p className="text-[10px] text-ink-muted">
                    {fmtDuration(item.duration)}
                    {!item.transcribed && " · no transcript"}
                  </p>
                </div>
                <button
                  onClick={() => openNote(item.noteId)}
                  className="rounded-md p-1.5 text-ink-muted transition hover:bg-surface-3 hover:text-ink"
                  title="Open note"
                >
                  <FileText size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {saved.length === 0 && !last && (
        <div className="mt-auto px-6 pb-8 text-center">
          <p className="text-xs text-ink-muted">
            Tap the mic to record. Your audio is saved to Files and transcribed
            into a linked Note automatically.
          </p>
        </div>
      )}
    </div>
  );
}
