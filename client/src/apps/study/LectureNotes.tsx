// ===== Study Hub: Lecture Video → Notes =====
// Upload or select a lecture video, configure note style/detail, and monitor
// the background processing pipeline. Shows progress stages, job history,
// and links to the generated note on completion.

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video, Upload, Play, Loader2, CheckCircle2, XCircle,
  RefreshCw, Trash2, FileText, FolderOpen, Clock, Settings2,
  Camera, Monitor, ChevronDown, ExternalLink,
} from "lucide-react";
import { lecturesApi, type LectureJob } from "../../services/lectures";
import { filesApi } from "../../services/files";
import { useWindows } from "../../store/windows";
import { Loading, ErrorBanner, SuccessBanner, ActionButton } from "./ui";
import type { StudyLanguage } from "../../services/study";
import type { VFile } from "../../types";

const STAGE_LABELS: Record<string, string> = {
  audio_extract: "Extracting audio track…",
  transcribing: "Transcribing with Whisper…",
  frame_sampling: "Sampling video frames…",
  slide_dedup: "Detecting unique slides…",
  region_detect: "Detecting slide region (camera mode)…",
  ocr: "Extracting slide content…",
  generating_notes: "Generating notes with AI…",
};

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function LectureNotes({ language }: { language: StudyLanguage }) {
  const [jobs, setJobs] = useState<LectureJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Config state
  const [style, setStyle] = useState("outline");
  const [detail, setDetail] = useState("standard");
  const [videoType, setVideoType] = useState<"slides" | "camera">("slides");

  // File picker state
  const [videoFiles, setVideoFiles] = useState<VFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openWindow = useWindows((s) => s.open);

  // Polling ref for active jobs
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const { jobs: j } = await lecturesApi.list();
      setJobs(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVideoFiles = useCallback(async () => {
    try {
      const { files } = await filesApi.list();
      setVideoFiles(files.filter((f: VFile) => f.mimeType.startsWith("video/")));
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    loadJobs();
    loadVideoFiles();
  }, []);

  // Poll active jobs every 3s.
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === "queued" || j.status === "processing");
    if (hasActive) {
      pollRef.current = setInterval(async () => {
        try {
          const { jobs: updated } = await lecturesApi.list();
          setJobs(updated);
          if (!updated.some((j) => j.status === "queued" || j.status === "processing")) {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch { /* ignore polling errors */ }
      }, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobs.some((j) => j.status === "queued" || j.status === "processing")]);

  // Start from existing file.
  const startFromFile = async () => {
    if (!selectedFileId) return;
    setStarting(true);
    setError("");
    try {
      const { job } = await lecturesApi.start({
        videoFileId: selectedFileId,
        style,
        detail,
        language,
        videoType,
      });
      setJobs((prev) => [job, ...prev]);
      setSelectedFileId("");
      setShowConfig(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  };

  // Upload + start.
  const handleUpload = async (file: File) => {
    setStarting(true);
    setError("");
    try {
      const { job } = await lecturesApi.upload(file, { style, detail, language, videoType });
      setJobs((prev) => [job, ...prev]);
      setShowConfig(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setStarting(false);
    }
  };

  const retryJob = async (jobId: string) => {
    try {
      const { job } = await lecturesApi.retry(jobId);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? job : j)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    }
  };

  const deleteJob = async (jobId: string) => {
    try {
      await lecturesApi.remove(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const openNote = (noteId: string) => {
    openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId } });
  };

  const activeJob = jobs.find((j) => j.status === "queued" || j.status === "processing");
  const hasActive = Boolean(activeJob);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Video size={18} className="text-success" />
        <h2 className="text-base font-semibold text-ink">Lecture Video → Notes</h2>
      </div>

      <p className="text-xs text-ink-muted">
        Upload a lecture recording. Mavino will extract slides, transcribe the professor's
        commentary, and generate structured notes combining both. Supports screen captures
        (slides + voice) and camera recordings (professor visible with projected slides).
      </p>

      {error && <ErrorBanner message={error} />}

      {/* Active job progress */}
      {activeJob && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={16} className="animate-spin text-accent" />
            <span className="text-sm font-medium text-ink">Processing lecture…</span>
            <span className="ml-auto text-xs text-ink-muted">{activeJob.progress}%</span>
          </div>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${activeJob.progress}%` }}
            />
          </div>
          <p className="text-[11px] text-ink-muted">
            {STAGE_LABELS[activeJob.stage] ?? "Starting…"}
          </p>
          {activeJob.durationSec > 0 && (
            <p className="text-[10px] text-ink-muted mt-1">
              Video: {formatDuration(activeJob.durationSec)} · {activeJob.slideCount > 0 ? `${activeJob.slideCount} slides detected` : ""}
            </p>
          )}
        </div>
      )}

      {/* New job form */}
      {!hasActive && (
        <div className="rounded-lg border border-edge bg-surface-2 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Upload size={14} className="text-ink-muted" />
            <span className="text-xs font-semibold text-ink">Process a lecture video</span>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="ml-auto flex items-center gap-1 text-[10px] text-ink-muted hover:text-ink"
            >
              <Settings2 size={11} />
              Options
              <ChevronDown size={10} className={`transition ${showConfig ? "rotate-180" : ""}`} />
            </button>
          </div>

          {showConfig && (
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-edge bg-surface p-2.5">
              <div>
                <label className="text-[10px] font-medium text-ink-muted">Note style</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="mt-0.5 w-full rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink"
                >
                  <option value="outline">Outline</option>
                  <option value="cornell">Cornell</option>
                  <option value="summary">Summary</option>
                  <option value="bullets">Bullets</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-ink-muted">Detail level</label>
                <select
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  className="mt-0.5 w-full rounded border border-edge bg-surface-2 px-2 py-1 text-xs text-ink"
                >
                  <option value="brief">Brief</option>
                  <option value="standard">Standard</option>
                  <option value="detailed">Detailed</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-medium text-ink-muted">Video type</label>
                <div className="mt-1 flex gap-2">
                  <button
                    onClick={() => setVideoType("slides")}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition ${
                      videoType === "slides"
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-edge text-ink-muted hover:text-ink"
                    }`}
                  >
                    <Monitor size={12} /> Screen capture
                  </button>
                  <button
                    onClick={() => setVideoType("camera")}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition ${
                      videoType === "camera"
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-edge text-ink-muted hover:text-ink"
                    }`}
                  >
                    <Camera size={12} /> Camera recording
                  </button>
                </div>
                {videoType === "camera" && (
                  <p className="mt-1 text-[10px] text-warning">
                    Camera mode uses vision AI to detect the slide region. Works best with a fixed camera
                    and clearly visible projected slides. Quality may vary.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Upload or pick */}
          <div className="flex flex-col gap-2">
            {/* Upload button */}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={starting}
              className="flex items-center justify-center gap-2 rounded-md border border-dashed border-edge bg-surface px-4 py-3 text-xs text-ink-muted transition hover:border-accent/50 hover:text-ink"
            >
              {starting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {starting ? "Uploading…" : "Upload a video file"}
            </button>

            {/* Or pick from existing files */}
            {videoFiles.length > 0 && (
              <div className="rounded-md border border-edge bg-surface p-2">
                <p className="mb-1.5 text-[10px] font-medium text-ink-muted">Or pick an existing video:</p>
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {videoFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSelectedFileId(f.id === selectedFileId ? "" : f.id)}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-left text-[11px] transition ${
                        selectedFileId === f.id
                          ? "bg-accent/10 text-accent"
                          : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      <Video size={11} className="shrink-0" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="shrink-0 text-[10px] opacity-60">
                        {(f.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    </button>
                  ))}
                </div>
                {selectedFileId && (
                  <button
                    onClick={startFromFile}
                    disabled={starting}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40"
                  >
                    {starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    Start processing
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Job history */}
      {jobs.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Processing history
          </span>
          <div className="flex flex-col gap-1.5">
            {jobs
              .filter((j) => j.status !== "queued" && j.status !== "processing")
              .map((j) => (
                <div
                  key={j.id}
                  className="group flex items-center gap-2.5 rounded-md border border-edge bg-surface-2 px-3 py-2"
                >
                  {j.status === "completed" ? (
                    <CheckCircle2 size={14} className="shrink-0 text-success" />
                  ) : (
                    <XCircle size={14} className="shrink-0 text-danger" />
                  )}
                  <div className="flex flex-1 flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-ink">
                        {j.status === "completed" ? `${j.slideCount} slides` : "Failed"}
                      </span>
                      {j.durationSec > 0 && (
                        <span className="text-[10px] text-ink-muted">· {formatDuration(j.durationSec)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                      <Clock size={9} />
                      {timeAgo(j.createdAt)}
                      {j.error && <span className="text-danger truncate">— {j.error}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    {j.status === "completed" && j.noteId && (
                      <button
                        onClick={() => openNote(j.noteId!)}
                        className="rounded p-1 text-ink-muted hover:text-accent"
                        title="Open generated notes"
                      >
                        <ExternalLink size={12} />
                      </button>
                    )}
                    {j.status === "failed" && (
                      <button
                        onClick={() => retryJob(j.id)}
                        className="rounded p-1 text-ink-muted hover:text-accent"
                        title="Retry"
                      >
                        <RefreshCw size={12} />
                      </button>
                    )}
                    <button
                      onClick={() => deleteJob(j.id)}
                      className="rounded p-1 text-ink-muted hover:text-danger"
                      title="Remove from history"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {loading && <Loading label="Loading…" />}
    </div>
  );
}
