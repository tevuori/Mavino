// ===== Quick Capture overlay =====
// Global Ctrl+Shift+N (Cmd+Shift+N on Mac) overlay that takes one line of
// input, sends it to /api/capture (which uses the per-user LLM to classify
// it as task / note / flashcard / athena), then dispatches the returned
// clientAction to open the relevant app. Modeled on CommandPalette.tsx.

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useShortcut } from "../store/shortcuts";
import { useQuickCapture } from "../store/quickCapture";
import { Zap, Loader2, CheckCircle2, AlertCircle, Mic, Square } from "lucide-react";
import { useWindows, type AppId } from "../store/windows";
import { useNotifications } from "../store/notifications";
import { api } from "../services/api";
import { useRecorder, fmtDuration } from "../apps/voice/useRecorder";
import { voiceApi } from "../services/voice";

interface CaptureResponse {
  target: "task" | "note" | "flashcard" | "athena" | "study";
  created: { id: string; title?: string; deckId?: string } | null;
  clientAction: { tool: string; payload: Record<string, unknown> };
}

const TARGET_LABELS: Record<string, string> = {
  task: "Task",
  note: "Note",
  flashcard: "Flashcard",
  athena: "Mavino",
  study: "Study Hub",
};

export default function QuickCapture() {
  const open = useQuickCapture((s) => s.open);
  const setOpen = useQuickCapture((s) => s.setOpen);
  const toggleQuickCapture = useQuickCapture((s) => s.toggle);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { open: openWindow } = useWindows();
  const pushNotification = useNotifications((s) => s.push);
  const rec = useRecorder();

  useShortcut("toggleQuickCapture", () => toggleQuickCapture());

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setText("");
      setFeedback(null);
      setBusy(false);
      setVoiceMode(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Stop any in-progress recording when the overlay closes.
      if (rec.recording) rec.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dispatch = (res: CaptureResponse) => {
    const p = res.clientAction.payload as Record<string, any>;
    const tool = res.clientAction.tool;
    if (tool === "open_app") {
      openWindow({
        appId: p.appId as AppId,
        title: p.title ?? p.appId,
        icon: "AppWindow",
        payload: p.noteId ? { noteId: p.noteId } : p.deckId ? { deckId: p.deckId } : undefined,
      });
    } else if (tool === "open_study_hub") {
      openWindow({
        appId: "study",
        title: "Study Hub",
        icon: "GraduationCap",
        payload: {
          mode: p.mode,
          sourceKind: p.sourceKind,
          text: p.text,
          sourceId: p.sourceId,
        },
      });
    } else if (tool === "open_athena") {
      // Open Athena window; the prompt is dispatched via the Athena app's
      // own client_action handler when the user is already in Athena. For
      // the quick-capture flow we open Athena and rely on the payload.
      openWindow({
        appId: "athena",
        title: "Mavino",
        icon: "Sparkles",
        payload: p.prompt ? { prompt: p.prompt } : undefined,
      });
    }
  };

  const submit = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api.post<CaptureResponse>("/api/capture", { text: content });
      const label = TARGET_LABELS[res.target] ?? "Item";
      const msg = res.created?.title
        ? `${label} created: ${res.created.title}`
        : `Sent to ${label}`;
      setFeedback({ ok: true, msg });
      pushNotification({
        app: "Quick Capture",
        title: label,
        body: msg,
      });
      dispatch(res);
      // Close shortly after success so the user sees the confirmation.
      setTimeout(() => setOpen(false), 700);
    } catch (e) {
      setFeedback({ ok: false, msg: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const submitVoice = async () => {
    if (busy) return;
    if (rec.recording) {
      // Stop the recording first, then process the resulting blob.
      setBusy(true);
      setFeedback(null);
      const blob = await rec.stop();
      if (!blob || blob.size === 0) {
        setFeedback({ ok: false, msg: "Recording was empty." });
        setBusy(false);
        return;
      }
      try {
        const res = await voiceApi.save(blob, { cleanup: true });
        const msg = res.transcribed
          ? `Voice note created: ${res.note.title}`
          : "Voice note saved (transcription unavailable).";
        setFeedback({ ok: true, msg });
        pushNotification({ app: "Quick Capture", title: "Voice Note", body: msg });
        // Open the created note.
        openWindow({
          appId: "notes",
          title: "Notes",
          icon: "StickyNote",
          payload: { noteId: res.note.id },
        });
        setTimeout(() => setOpen(false), 800);
      } catch (e) {
        setFeedback({ ok: false, msg: (e as Error).message });
      } finally {
        setBusy(false);
      }
    } else {
      // Not recording → start recording.
      setFeedback(null);
      await rec.start();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          style={{ paddingTop: "20vh" }}
        >
          <motion.div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl"
            initial={{ scale: 0.96, y: -10, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: -10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-edge px-3 py-2 text-accent">
              <Zap size={16} />
              <span className="text-xs font-semibold uppercase tracking-wide">Quick Capture</span>
              <span className="ml-auto text-[10px] text-ink-muted">Ctrl+Shift+N · Esc to close</span>
            </div>
            <div className="p-3">
              {voiceMode ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={submitVoice}
                    disabled={busy || !rec.supported}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-40 ${
                      rec.recording ? "bg-red-500 hover:bg-red-600" : "bg-accent hover:opacity-90"
                    }`}
                    title={rec.recording ? "Stop & transcribe" : "Start recording"}
                  >
                    {busy ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : rec.recording ? (
                      <Square size={14} fill="currentColor" />
                    ) : (
                      <Mic size={16} />
                    )}
                  </button>
                  <div className="flex flex-1 items-center gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        rec.recording
                          ? rec.paused
                            ? "bg-amber-400"
                            : "animate-pulse bg-red-500"
                          : "bg-surface-3"
                      }`}
                    />
                    <span className="font-mono text-sm tabular-nums text-ink">
                      {fmtDuration(rec.elapsed)}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {rec.recording
                        ? rec.paused
                          ? "paused"
                          : "recording…"
                        : "ready — tap mic to record"}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (rec.recording) rec.stop();
                      setVoiceMode(false);
                    }}
                    disabled={busy}
                    className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-40"
                  >
                    Text
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                    disabled={busy}
                    className="flex-1 rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
                    placeholder="Type anything — a task, idea, question… Mavino will route it."
                  />
                  <button
                    onClick={() => {
                      setVoiceMode(true);
                      setFeedback(null);
                      rec.start();
                    }}
                    disabled={busy || !rec.supported}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-40"
                    title="Record voice note"
                  >
                    <Mic size={16} />
                  </button>
                  <button
                    onClick={submit}
                    disabled={busy || !text.trim()}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    Capture
                  </button>
                </div>
              )}
              {rec.error && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
                  <AlertCircle size={13} /> {rec.error}
                </div>
              )}
              {feedback && (
                <div
                  className={`mt-2 flex items-center gap-1.5 text-xs ${
                    feedback.ok ? "text-emerald-500" : "text-red-500"
                  }`}
                >
                  {feedback.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {feedback.msg}
                </div>
              )}
              <p className="mt-2 text-[11px] text-ink-muted">
                {voiceMode
                  ? "Record a voice note — it's transcribed and saved as a linked Note."
                  : "Type or speak — Mavino routes it to a Task, Note, Flashcard, or chat."}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
