import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, Download, ZoomIn, ZoomOut, Maximize, Minimize, Expand,
  AlertCircle, File as FileIcon,
} from "lucide-react";
import {
  filesApi, isImageFile, isPdfFile, isPptxFile, isAudioFile, isVideoFile, formatBytes,
} from "../../services/files";
import { useWindows } from "../../store/windows";
import { useShowControl, type ShowCommand } from "../../store/showControl";
import type { WindowInstance } from "../../store/windows";
import type { VFile } from "../../types";
import { PptxViewer } from "../shared/PptxViewer";

export default function ViewerApp({ win }: { win: WindowInstance }) {
  const fileId = win.payload?.fileId as string | undefined;
  const setTitle = useWindows((s) => s.setTitle);
  const [file, setFile] = useState<VFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Interactive Teacher: consume show-control commands for this window.
  const showCommands = useShowControl((s) => s.commands);
  const removeShowWindow = useShowControl((s) => s.removeWindow);
  const reportShowResult = useShowControl((s) => s.reportResult);
  const lastShowSeq = useRef(0);
  const activeShowCmd = showCommands[win.id];
  const [pdfSearch, setPdfSearch] = useState<string | null>(null);
  const [pdfPage, setPdfPage] = useState<number | null>(null);
  useEffect(() => {
    if (!activeShowCmd || activeShowCmd.seq === lastShowSeq.current) return;
    lastShowSeq.current = activeShowCmd.seq;
    // Report back to the Teacher whether the passage could actually be shown,
    // so it can quote the text inline instead of relying on the visual.
    if (!file) {
      reportShowResult(win.id, activeShowCmd.seq, activeShowCmd.kind, false, "file-not-found");
    } else if (activeShowCmd.kind === "highlight" || activeShowCmd.kind === "scroll_to") {
      const showable = isPdfFile(file)
        ? Boolean(activeShowCmd.text ?? activeShowCmd.selector ?? activeShowCmd.page)
        : isImageFile(file);
      reportShowResult(
        win.id,
        activeShowCmd.seq,
        activeShowCmd.kind,
        showable,
        showable ? undefined : isPdfFile(file) ? "no-match" : "unsupported-type"
      );
    }
    // For PDFs: use PDF Open Parameters (#page= or #search=) to jump to a page
    // or highlight text in the native viewer. Page takes priority. For
    // audio/video: seek via the media element. For images: handled by the
    // ImageViewer via the command prop below.
    if (file && isPdfFile(file) && (activeShowCmd.kind === "scroll_to" || activeShowCmd.kind === "highlight")) {
      if (typeof activeShowCmd.page === "number" && activeShowCmd.page >= 1) {
        setPdfPage(activeShowCmd.page);
        setPdfSearch(null);
      } else {
        const raw = activeShowCmd.text ?? activeShowCmd.selector ?? "";
        if (raw) {
          // Truncate to first ~60 chars to avoid highlighting huge portions
          // of the document. PDF #search= highlights ALL occurrences, so a
          // long text would highlight too much. A shorter, specific snippet
          // jumps to the right passage without over-highlighting.
          const q = raw.length > 60 ? raw.slice(0, 60).trim() : raw;
          if (q) {
            setPdfSearch(q);
            setPdfPage(null);
          }
        }
      }
    }
    if (file && (isAudioFile(file) || isVideoFile(file)) && activeShowCmd.kind === "scroll_to") {
      // "scroll_to" on media = seek to a timestamp (pos in seconds, if numeric).
      const t = activeShowCmd.pos;
      if (typeof t === "number") {
        const el = document.querySelector(`[data-viewer-win="${win.id}"] audio, [data-viewer-win="${win.id}"] video`) as HTMLMediaElement | null;
        if (el) { try { el.currentTime = t; void el.play(); } catch { /* noop */ } }
      }
    }
  }, [activeShowCmd, file, win.id, reportShowResult]);
  useEffect(() => {
    return () => { if (win.id) removeShowWindow(win.id); };
  }, [win.id, removeShowWindow]);

  useEffect(() => {
    if (!fileId) {
      setError("No file specified");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { files } = await filesApi.all();
        const found = files.find((f) => f.id === fileId);
        if (cancelled) return;
        if (!found) {
          setError("File not found");
        } else {
          setFile(found);
          setTitle(win.id, found.name);
          filesApi.markOpened(found.id).catch(() => {});
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId, setTitle, win.id]);

  const download = useCallback(async () => {
    if (!file) return;
    try {
      const res = await filesApi.download(file.id);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }, [file]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-ink-muted" />
      </div>
    );
  }
  if (error || !file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-muted">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-sm">{error ?? "No file"}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge bg-surface-2 px-3 py-1.5">
        <span className="line-clamp-1 text-xs font-medium text-ink">{file.name}</span>
        <span className="text-[11px] text-ink-muted">{formatBytes(file.size)}</span>
        <button
          onClick={download}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-edge px-2 py-1 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
        >
          <Download size={13} /> Download
        </button>
      </div>

      <div className="flex-1 overflow-hidden" data-viewer-win={win.id}>
        {isImageFile(file) && <ImageViewer file={file} command={activeShowCmd} />}
        {isPptxFile(file) && (
          <div className="h-full w-full" data-viewer-win={win.id}>
            <PptxViewer fileId={file.id} paneId={win.id} />
          </div>
        )}
        {isPdfFile(file) && (
          <iframe
            key={pdfPage ? `page-${pdfPage}` : pdfSearch ?? "default"}
            src={
              pdfPage
                ? `${filesApi.downloadUrl(file.id)}#page=${pdfPage}`
                : pdfSearch
                  ? `${filesApi.downloadUrl(file.id)}#search=${encodeURIComponent(pdfSearch)}`
                  : filesApi.downloadUrl(file.id)
            }
            className="h-full w-full border-0"
            title={file.name}
          />
        )}
        {isAudioFile(file) && <AudioViewer file={file} />}
        {isVideoFile(file) && <VideoViewer file={file} />}
        {!isImageFile(file) && !isPdfFile(file) && !isAudioFile(file) && !isVideoFile(file) && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-muted">
            <FileIcon size={48} className="opacity-30" />
            <p className="text-sm">No preview available for this file type</p>
            <p className="text-xs">{file.mimeType}</p>
            <button
              onClick={download}
              className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-accent-fg"
            >
              <Download size={13} /> Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageViewer({ file, command }: { file: VFile; command?: ShowCommand }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fit, setFit] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Pointer pinch-to-zoom state
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);
  const lastCmdSeq = useRef(0);

  // Interactive Teacher: react to show-control commands. For images we can't
  // highlight text, so a scroll_to/highlight triggers a brief focus pulse
  // (zoom-in then back) to draw the student's eye to the image.
  useEffect(() => {
    if (!command || command.seq === lastCmdSeq.current) return;
    lastCmdSeq.current = command.seq;
    if (command.kind === "scroll_to" || command.kind === "highlight") {
      setFit(false);
      setZoom((z) => Math.min(8, Math.max(z, 2)));
      setPan({ x: 0, y: 0 });
      // Ease back to fit after 1.5s so the student sees the whole image again.
      const t = setTimeout(() => { setFit(true); setZoom(1); }, 1500);
      return () => clearTimeout(t);
    }
  }, [command]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setFit(false);
    setZoom((z) => Math.max(0.1, Math.min(8, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Track all active pointers for pinch detection.
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      // Start pinch — record initial distance + zoom.
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStart.current = { dist, zoom: fit ? 1 : zoom };
      setFit(false);
      dragRef.current = null; // cancel single-finger pan during pinch
      return;
    }

    if (zoom <= 1 && fit) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }, [pan, zoom, fit]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Pinch zoom
    if (pointers.current.size === 2 && pinchStart.current) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const newZoom = Math.max(0.1, Math.min(8, (pinchStart.current.zoom * dist) / pinchStart.current.dist));
      setZoom(newZoom);
      return;
    }

    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      dragRef.current = null;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
  }, []);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFit(true);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => {});
    } else {
      void document.exitFullscreen?.().then(() => setFullscreen(false));
    }
  };

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="relative flex h-full w-full touch-none items-center justify-center overflow-hidden bg-surface-3"
      style={{ cursor: zoom > 1 && !fit ? "grab" : "default" }}
    >
      <img
        src={filesApi.downloadUrl(file.id)}
        alt={file.name}
        draggable={false}
        className="select-none max-h-full max-w-full transition-transform"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${fit ? 1 : zoom})`,
          transformOrigin: "center",
          touchAction: "none",
        }}
        onError={(e) => {
          (e.currentTarget.style.display = "none");
        }}
      />
      {/* Zoom controls */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-edge bg-surface-2 p-1 shadow-window">
          <ViewerBtn onClick={() => { setFit(false); setZoom((z) => Math.max(0.1, z / 1.2)); }} title="Zoom out">
            <ZoomOut size={15} />
          </ViewerBtn>
          <span className="w-14 text-center text-xs text-ink-muted">
            {fit ? "Fit" : `${Math.round(zoom * 100)}%`}
          </span>
          <ViewerBtn onClick={() => { setFit(false); setZoom((z) => Math.min(8, z * 1.2)); }} title="Zoom in">
            <ZoomIn size={15} />
          </ViewerBtn>
          <ViewerBtn onClick={resetView} title="Fit to screen">
            <Expand size={15} />
          </ViewerBtn>
          <ViewerBtn onClick={() => { setFit(false); setZoom(1); setPan({ x: 0, y: 0 }); }} title="Actual size">
            1:1
          </ViewerBtn>
          <ViewerBtn onClick={toggleFullscreen} title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
          </ViewerBtn>
        </div>
    </div>
  );
}

function AudioViewer({ file }: { file: VFile }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface-2 p-6">
      <div className="flex h-32 w-32 items-center justify-center rounded-full bg-accent/10">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" className="text-accent">
          <path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
          <circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <p className="text-sm font-medium text-ink">{file.name}</p>
      <audio controls src={filesApi.downloadUrl(file.id)} className="w-full max-w-md" />
    </div>
  );
}

function VideoViewer({ file }: { file: VFile }) {
  return (
    <div className="flex h-full items-center justify-center bg-black">
      <video controls src={filesApi.downloadUrl(file.id)} className="max-h-full max-w-full" />
    </div>
  );
}

function ViewerBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink"
    >
      {children}
    </button>
  );
}
