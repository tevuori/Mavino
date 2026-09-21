// ===== Shared PPTX slide viewer =====
// Used by the desktop Teach Me source pane, the standalone file Viewer app,
// and the mobile bottom-sheet. Loads slide text from /api/files/:id/pptx and
// supports slide-by-slide navigation + text search highlighting driven by the
// show-control channel.

import { useEffect, useRef, useState } from "react";
import { filesApi } from "../../services/files";
import { useShowControl } from "../../store/showControl";
import type { ShowCommand } from "../../store/showControl";

export interface PptxSlide {
  index: number;
  text: string;
}

interface PptxViewerProps {
  fileId: string;
  /** show-control window/pane id; used to consume scroll/highlight commands. */
  paneId: string;
  /** Initial slide to jump to once slides have loaded. */
  pendingSlide?: number;
  /** Initial text to highlight once slides have loaded. */
  pendingText?: string;
  /** Called after the pending highlight has been applied. */
  onPendingApplied?: () => void;
  navigationKey?: number;
  /** Extra classes for the outer container. */
  className?: string;
}

export function PptxViewer({
  fileId,
  paneId,
  pendingSlide,
  pendingText,
  onPendingApplied,
  navigationKey,
  className = "",
}: PptxViewerProps) {
  const commands = useShowControl((s) => s.commands);
  const reportResult = useShowControl((s) => s.reportResult);
  const [slides, setSlides] = useState<PptxSlide[] | null>(null);
  const [activeSlide, setActiveSlide] = useState(1);
  const [activeSearch, setActiveSearch] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastSeq = useRef(0);
  const appliedPendingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSlides(null);
    setActiveSlide(1);
    setActiveSearch(undefined);
    appliedPendingKeyRef.current = null;
    filesApi
      .getPptx(fileId)
      .then((data) => {
        if (cancelled) return;
        setSlides(data.slides);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load PPTX slides");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fileId]);

  useEffect(() => {
    if (pendingSlide === undefined && !pendingText) {
      appliedPendingKeyRef.current = null;
      return;
    }
    if (!slides) return;
    const key = JSON.stringify([pendingSlide, pendingText, navigationKey]);
    if (appliedPendingKeyRef.current === key) return;
    if (typeof pendingSlide === "number" && Number.isInteger(pendingSlide) && pendingSlide >= 1 && pendingSlide <= slides.length) {
      setActiveSlide(pendingSlide);
    }
    setActiveSearch(pendingText);
    appliedPendingKeyRef.current = key;
    onPendingApplied?.();
  }, [slides, pendingSlide, pendingText, navigationKey, onPendingApplied]);

  const cmd = commands[paneId];
  useEffect(() => {
    if (!cmd || cmd.seq === lastSeq.current || !slides) return;
    lastSeq.current = cmd.seq;
    if (cmd.kind === "highlight" || cmd.kind === "scroll_to") {
      if (typeof cmd.slide === "number" && Number.isInteger(cmd.slide) && cmd.slide >= 1 && cmd.slide <= slides.length) {
        setActiveSlide(cmd.slide);
        setActiveSearch(cmd.text);
        reportResult(paneId, cmd.seq, cmd.kind, true);
        return;
      }
      if (cmd.text) {
        const search = cmd.text;
        const matchingSlide = slides.findIndex((slide) => slide.text.toLowerCase().includes(search.toLowerCase()));
        if (matchingSlide >= 0) {
          setActiveSlide(matchingSlide + 1);
          setActiveSearch(search);
          reportResult(paneId, cmd.seq, cmd.kind, true);
        } else {
          reportResult(paneId, cmd.seq, cmd.kind, false, "no-match");
        }
        return;
      }
      reportResult(paneId, cmd.seq, cmd.kind, cmd.slide === undefined, cmd.slide === undefined ? undefined : "no-match");
    } else if (cmd.kind === "clear_highlight") {
      setActiveSearch(undefined);
      reportResult(paneId, cmd.seq, cmd.kind, true);
    } else {
      reportResult(paneId, cmd.seq, cmd.kind, false, "unsupported-type");
    }
  }, [cmd, slides, paneId, reportResult]);

  if (loading) {
    return (
      <div className={`flex h-full w-full items-center justify-center gap-2 text-xs text-ink-muted ${className}`}>
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-accent" />
        Loading slides…
      </div>
    );
  }
  if (error) {
    return (
      <div className={`flex h-full w-full items-center justify-center p-4 text-center text-xs text-red-400 ${className}`}>
        {error}
      </div>
    );
  }
  if (!slides || slides.length === 0) {
    return (
      <div className={`flex h-full w-full items-center justify-center p-4 text-center text-xs text-ink-muted ${className}`}>
        No slides found in this presentation.
      </div>
    );
  }

  const slide = slides[activeSlide - 1];
  const total = slides.length;

  const renderText = () => {
    if (!slide || !slide.text) {
      return <p className="text-sm italic text-ink-muted">Empty slide</p>;
    }
    const text = slide.text;
    if (!activeSearch) {
      return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{text}</p>;
    }
    const idx = text.toLowerCase().indexOf(activeSearch.toLowerCase());
    if (idx === -1) {
      return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{text}</p>;
    }
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + activeSearch.length);
    const after = text.slice(idx + activeSearch.length);
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
        {before}
        <mark className="rounded bg-amber-300 px-0.5 text-black">{match}</mark>
        {after}
      </p>
    );
  };

  return (
    <div className={`flex h-full flex-col ${className}`}>
      <div className="flex items-center justify-between border-b border-edge bg-surface-2 px-3 py-2">
        <button
          type="button"
          disabled={activeSlide <= 1}
          onClick={() => setActiveSlide((s) => Math.max(1, s - 1))}
          className="rounded px-2 py-1 text-xs font-medium text-ink disabled:opacity-40 hover:bg-surface-3"
        >
          Previous
        </button>
        <span className="text-xs font-semibold text-ink">
          Slide {activeSlide} of {total}
        </span>
        <button
          type="button"
          disabled={activeSlide >= total}
          onClick={() => setActiveSlide((s) => Math.min(total, s + 1))}
          className="rounded px-2 py-1 text-xs font-medium text-ink disabled:opacity-40 hover:bg-surface-3"
        >
          Next
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{renderText()}</div>
    </div>
  );
}
