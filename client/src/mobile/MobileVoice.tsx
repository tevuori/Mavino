import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Volume2 } from "lucide-react";
import { voiceApi } from "../services/voice";
import { filesApi, isAudioFile } from "../services/files";
import { useMobileToast } from "../store/mobileToast";
import type { Note, VFile } from "../types";
import { MobileContainer, MobileEmpty, MobileHeader, MobileLoading, MobileTextarea } from "./MobileUi";

export default function MobileVoice({ onClose }: { onClose?: () => void }) {
  const toast = useMobileToast((s) => s.show);
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ note: Note; file: VFile; transcript: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Past recordings
  const [audioFiles, setAudioFiles] = useState<VFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSupported(
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function" && typeof MediaRecorder !== "undefined")
    );
  }, []);

  const loadAudioFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await filesApi.all({ recent: true });
      setAudioFiles(res.files.filter((f) => isAudioFile(f)).slice(0, 30));
    } catch {
      setAudioFiles([]);
    }
    setLoadingFiles(false);
  }, []);

  useEffect(() => { void loadAudioFiles(); }, [loadAudioFiles]);

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
    } catch {
      toast("Could not access microphone", "error");
    }
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
      void loadAudioFiles();
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Transcription failed");
    }
    setLoading(false);
  };

  const playFile = (file: VFile) => {
    if (playingId === file.id) {
      // Toggle pause/play
      if (audioRef.current) {
        if (audioRef.current.paused) audioRef.current.play();
        else audioRef.current.pause();
      }
      return;
    }
    // Stop current
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const audio = new Audio(filesApi.downloadUrl(file.id));
    audio.onended = () => { setPlayingId(null); audioRef.current = null; };
    audio.onerror = () => { setPlayingId(null); toast("Playback failed", "error"); };
    audio.play().catch(() => { toast("Playback failed", "error"); });
    audioRef.current = audio;
    setPlayingId(file.id);
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    };
  }, []);

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <MobileContainer>
      <MobileHeader title="Voice Notes" subtitle="Record, transcribe, listen" onClose={onClose} />

      {!supported && (
        <p className="mb-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Microphone recording is not supported in this browser.
        </p>
      )}

      <div className="mb-6 rounded-2xl border border-edge bg-surface-2 p-6 text-center">
        <div className="mb-2 text-4xl font-mono font-bold text-ink">{fmt(seconds)}</div>
        <p className="text-xs text-ink-muted">{recording ? "Recording..." : "Ready to record"}</p>
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

      {loading && <p className="mb-4 text-center text-sm text-ink-muted">Transcribing...</p>}

      {error && (
        <p className="mb-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>
      )}

      {result && (result.note || result.transcript) && (
        <div className="mb-6 rounded-2xl border border-accent/30 bg-accent/[0.06] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Volume2 size={16} className="text-accent" />
            <span className="font-medium text-ink">{result.note.title || "Voice note"}</span>
          </div>
          {result.transcript ? (
            <MobileTextarea
              readOnly
              value={result.transcript}
              rows={4}
              className="mb-3 border-0 bg-transparent"
            />
          ) : (
            <p className="mb-3 text-sm text-ink-muted">No transcript available</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => playFile(result.file)}
              className="flex items-center gap-1.5 rounded-xl bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent active:bg-accent/25"
            >
              {playingId === result.file?.id ? <Pause size={12} /> : <Play size={12} />}
              {playingId === result.file?.id ? "Pause" : "Play"}
            </button>
            <span className="text-xs text-ink-muted">{result.file?.name}</span>
          </div>
        </div>
      )}

      {/* Past recordings */}
      <div>
        <p className="mb-3 text-sm font-semibold text-ink">Past recordings</p>
        {loadingFiles ? (
          <MobileLoading />
        ) : audioFiles.length === 0 ? (
          <MobileEmpty text="No audio files yet. Record your first voice note above." />
        ) : (
          <div className="space-y-2">
            {audioFiles.map((f) => {
              const isPlaying = playingId === f.id;
              return (
                <article
                  key={f.id}
                  className={`flex items-center gap-3 rounded-2xl border p-3 active:bg-surface-3 ${
                    isPlaying ? "border-accent/30 bg-accent/[0.06]" : "border-edge bg-surface-2"
                  }`}
                  onClick={() => playFile(f)}
                >
                  <button
                    type="button"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                      isPlaying ? "bg-accent text-white" : "bg-surface-3 text-ink-muted"
                    }`}
                  >
                    {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{f.name}</p>
                    <p className="text-xs text-ink-muted">
                      {new Date(f.createdAt).toLocaleDateString()} · {formatSize(f.size)}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </MobileContainer>
  );
}
