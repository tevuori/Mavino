import { useEffect, useRef, useState } from "react";
import { Mic, Play, Square } from "lucide-react";
import { voiceApi } from "../services/voice";
import type { Note, VFile } from "../types";
import { MobileContainer, MobileEmpty, MobileHeader, MobileTextarea } from "./MobileUi";

export default function MobileVoice({ onClose }: { onClose?: () => void }) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ note: Note; file: VFile; transcript: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSupported(
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function" && typeof MediaRecorder !== "undefined")
    );
  }, []);

  useEffect(() => {
    if (recording) {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording]);

  const start = async () => {
    if (!supported) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
      const mime = mimeTypes.find((t) => !t || MediaRecorder.isTypeSupported(t)) || "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => { void onStop(); };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setSeconds(0);
      setResult(null);
    } catch { /* ignore */ }
  };

  const stop = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };

  const onStop = async () => {
    if (chunksRef.current.length === 0) return;
    const mime = recorderRef.current?.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    setLoading(true);
    setError(null);
    try {
      const res = await voiceApi.save(blob);
      setResult(res);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Transcription failed");
    }
    setLoading(false);
  };

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <MobileContainer>
      <MobileHeader title="Voice Notes" subtitle="Record, transcribe" onClose={onClose} />

      {!supported && (
        <p className="mb-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Microphone recording is not supported in this browser.
        </p>
      )}

      <div className="mb-6 rounded-2xl border border-edge bg-surface-2 p-6 text-center">
        <div className="mb-2 text-4xl font-mono font-bold text-ink">{fmt(seconds)}</div>
        <p className="text-xs text-ink-muted">{recording ? "Recording…" : "Ready to record"}</p>
        <div className="mt-4 flex justify-center gap-4">
          {!recording ? (
            <button
              type="button"
              onClick={() => void start()}
              disabled={!supported}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 text-ink shadow-lg disabled:opacity-50"
            >
              <Mic size={32} />
            </button>
          ) : (
            <button
              type="button"
              onClick={stop}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500 text-ink shadow-lg"
            >
              <Square size={28} fill="currentColor" />
            </button>
          )}
        </div>
      </div>

      {loading && <p className="mb-4 text-center text-sm text-ink-muted">Transcribing…</p>}

      {error && (
        <p className="mb-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>
      )}

      {result && (result.note || result.transcript) && (
        <div className="rounded-2xl border border-edge bg-surface-2 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Play size={16} className="text-accent" />
            <span className="font-medium text-ink">{result.note.title || "Voice note"}</span>
          </div>
          {result.transcript ? (
            <MobileTextarea
              readOnly
              value={result.transcript}
              rows={5}
              className="mb-3 border-0 bg-surface-2"
            />
          ) : (
            <p className="mb-3 text-sm text-ink-muted">No transcript available</p>
          )}
          <p className="text-xs text-ink-muted">Saved as file: {result.file?.name}</p>
        </div>
      )}

      {!result && !loading && <MobileEmpty text="Tap the mic to record a voice note." />}
    </MobileContainer>
  );
}
