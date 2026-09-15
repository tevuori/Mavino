// ===== Music Widget — compact desktop overlay =====
// Fixed to the top-right corner of the wallpaper. Shows now-playing info
// from the user's active Spotify device (phone, desktop, etc.) with
// play/pause/skip controls and expandable synced lyrics.

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Play, Pause, SkipBack, SkipForward, Loader2, Music as MusicIcon,
  AlertCircle, ChevronDown, ChevronUp, RefreshCw, Maximize,
} from "lucide-react";
import { useMusic } from "../store/music";
import { findActiveLine } from "../services/lyrics";
import { useAutoChillOnIdle } from "./useAutoChillOnIdle";
import ChillView from "./ChillView";

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function MusicWidget() {
  const {
    connection, error, state, lyrics, lyricsLoading, lyricsError,
    expanded, chilling, init, togglePlay, next, previous, seek, setExpanded, setChilling,
  } = useMusic();

  const [currentLine, setCurrentLine] = useState<string | null>(null);
  const [activeLineIdx, setActiveLineIdx] = useState(-1);
  const lyricListRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressTimeRef = useRef<HTMLSpanElement>(null);
  const lastActiveLine = useRef(-1);

  const track = state?.item;
  const isPlaying = state?.is_playing ?? false;
  const duration = track?.duration_ms ?? 0;

  // Auto-enter fullscreen chill mode after 10 min of inactivity while music plays.
  useAutoChillOnIdle();

  // Auto-init on mount
  useEffect(() => {
    if (connection === "idle") init();
  }, [connection, init]);

  // Position interpolation — updates DOM via refs to avoid re-rendering
  // the whole widget every 500ms. Only triggers a state update when the
  // active lyric line changes.
  useEffect(() => {
    if (connection !== "ready") return;
    const tick = () => {
      const store = useMusic.getState();
      let pos: number;
      if (store.state?.is_playing && store.positionUpdatedAt > 0) {
        pos = store.positionMs + (Date.now() - store.positionUpdatedAt);
      } else {
        pos = store.positionMs;
      }

      // Update progress bar via refs (no re-render)
      const pct = duration ? (pos / duration) * 100 : 0;
      if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
      if (progressTimeRef.current) progressTimeRef.current.textContent = fmt(pos);

      // Update active lyric line only when it changes
      const newIdx = findActiveLine(lyrics, pos / 1000);
      if (newIdx !== lastActiveLine.current) {
        lastActiveLine.current = newIdx;
        setActiveLineIdx(newIdx);
        setCurrentLine(newIdx >= 0 ? lyrics[newIdx]?.text ?? null : null);
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => clearInterval(id);
  }, [connection, lyrics, duration]);

  // Auto-scroll to active line in expanded lyrics
  useEffect(() => {
    if (!expanded || activeLineIdx < 0 || !lyricListRef.current) return;
    const container = lyricListRef.current;
    const el = container.querySelector(`[data-line="${activeLineIdx}"]`) as HTMLElement | null;
    if (!el) return;
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: target, behavior: "smooth" });
  }, [activeLineIdx, expanded]);

  // Don't render if not configured or no playback
  if (connection === "not-configured") return null;
  if (connection === "idle" || connection === "connecting") {
    return (
      <div className="flex w-72 items-center gap-2 rounded-xl border border-edge bg-surface/80 p-3 shadow-window backdrop-blur-xl">
        <Loader2 size={16} className="animate-spin text-accent" />
        <span className="text-xs text-ink-muted">Connecting to Spotify...</span>
      </div>
    );
  }
  if (connection === "error") {
    return (
      <div className="flex w-72 items-center gap-2 rounded-xl border border-edge bg-surface/80 p-3 shadow-window backdrop-blur-xl">
        <AlertCircle size={16} className="shrink-0 text-red-400" />
        <span className="flex-1 truncate text-xs text-ink-muted">{error}</span>
        <button onClick={() => init()} className="rounded p-1 text-ink-muted hover:bg-surface-3 hover:text-ink">
          <RefreshCw size={12} />
        </button>
      </div>
    );
  }

  // No active playback
  if (!track) {
    return (
      <div className="flex w-72 items-center gap-2 rounded-xl border border-edge bg-surface/80 p-3 shadow-window backdrop-blur-xl">
        <MusicIcon size={16} className="shrink-0 text-ink-muted" />
        <span className="text-xs text-ink-muted">No active Spotify session</span>
      </div>
    );
  }

  return (
    <>
    <motion.div
      layout
      className="w-72 overflow-hidden rounded-xl border border-edge bg-surface/80 shadow-window backdrop-blur-xl"
    >
      {/* Collapsed: now-playing bar */}
      <div className="flex items-center gap-3 p-2.5">
        {/* Album art */}
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-3">
          {track.album.images?.[0]?.url ? (
            <img src={track.album.images[0].url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <MusicIcon size={18} className="text-ink-muted" />
            </div>
          )}
          {isPlaying && (
            <div className="absolute bottom-0.5 right-0.5 flex items-end gap-px rounded bg-black/50 px-0.5">
              <span className="h-1.5 w-0.5 animate-pulse bg-green-400" style={{ animationDelay: "0ms" }} />
              <span className="h-2 w-0.5 animate-pulse bg-green-400" style={{ animationDelay: "150ms" }} />
              <span className="h-1 w-0.5 animate-pulse bg-green-400" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>

        {/* Track info + current lyric */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-ink">{track.name}</p>
          <p className="truncate text-[10px] text-ink-muted">
            {track.artists.map((a) => a.name).join(", ")}
          </p>
          {currentLine && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-accent">{currentLine}</p>
          )}
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => togglePlay()}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-surface-3"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
          </button>
          <button
            onClick={() => next()}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink hover:bg-surface-3"
            title="Next"
          >
            <SkipForward size={12} fill="currentColor" />
          </button>
          <button
            onClick={() => setChilling(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-3 hover:text-ink"
            title="Chill mode (fullscreen)"
          >
            <Maximize size={12} />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-3 hover:text-ink"
            title={expanded ? "Collapse" : "Expand lyrics"}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Progress bar (thin, always visible) — updated via refs */}
      <div className="px-2.5 pb-1">
        <div className="flex items-center gap-2">
          <span ref={progressTimeRef} className="text-[9px] tabular-nums text-ink-muted">0:00</span>
          <div
            className="group relative h-1 flex-1 cursor-pointer rounded-full bg-surface-3"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              seek(Math.round(pct * duration));
            }}
          >
            <div
              ref={progressFillRef}
              className="absolute inset-y-0 left-0 rounded-full bg-accent"
              style={{ width: "0%" }}
            />
          </div>
          <span className="text-[9px] tabular-nums text-ink-muted">{fmt(duration)}</span>
        </div>
      </div>

      {/* Expanded: lyrics panel */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-edge"
          >
            {/* Extra controls row */}
            <div className="flex items-center justify-between px-3 py-1.5">
              <button
                onClick={() => previous()}
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-3 hover:text-ink"
                title="Previous"
              >
                <SkipBack size={12} fill="currentColor" />
              </button>
              <span className="text-[10px] text-ink-muted">
                {state?.device?.name ?? "Spotify"}
              </span>
              <button
                onClick={() => togglePlay()}
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-3 hover:text-ink"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
              </button>
            </div>

            {/* Lyrics scroll area */}
            <div ref={lyricListRef} className="max-h-64 overflow-y-auto px-4 py-3 text-center">
              {lyricsLoading ? (
                <div className="flex h-20 items-center justify-center">
                  <Loader2 size={18} className="animate-spin text-ink-muted" />
                </div>
              ) : lyricsError ? (
                <div className="flex h-20 flex-col items-center justify-center text-ink-muted">
                  <MusicIcon size={24} className="mb-1 opacity-40" />
                  <p className="text-xs">{lyricsError}</p>
                </div>
              ) : lyrics.length === 0 ? (
                <div className="flex h-20 items-center justify-center text-xs text-ink-muted">
                  No lyrics loaded
                </div>
              ) : (
                lyrics.map((line, i) => (
                  <p
                    key={i}
                    data-line={i}
                    className={`py-1 text-xs transition-all duration-200 ${
                      i === activeLineIdx
                        ? "scale-105 font-semibold text-accent"
                        : "text-ink-muted/50"
                    }`}
                  >
                    {line.text || "♪"}
                  </p>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>

      {/* Fullscreen chill mode overlay — rendered outside the widget
          container so it isn't clipped by the widget's overflow-hidden */}
      <AnimatePresence>
        {chilling && <ChillView />}
      </AnimatePresence>
    </>
  );
}
