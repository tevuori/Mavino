import { useState, useRef, useEffect } from "react";
import { Link2, X, FileText, CheckSquare, Brain, Calendar, File as FileIcon, GraduationCap, Mic } from "lucide-react";
import type { LinkType, LinkedItem } from "../../types";
import { useWindows, type AppId } from "../../store/windows";
import { useLinks } from "./useLinks";

const TYPE_META: Record<LinkType, { icon: typeof FileText; appId: AppId; label: string }> = {
  note: { icon: FileText, appId: "notes", label: "Note" },
  task: { icon: CheckSquare, appId: "tasks", label: "Task" },
  flashcardDeck: { icon: Brain, appId: "flashcards", label: "Deck" },
  calendarEvent: { icon: Calendar, appId: "calendar", label: "Event" },
  file: { icon: FileIcon, appId: "viewer", label: "File" },
  studySource: { icon: FileText, appId: "study", label: "Source" },
  studyChat: { icon: GraduationCap, appId: "study", label: "Study Chat" },
  podcast: { icon: Mic, appId: "study", label: "Podcast" },
};

/** Open a linked item in its app. */
function openLinked(item: LinkedItem) {
  const meta = TYPE_META[item.type];
  const open = useWindows.getState().open;
  const payload: Record<string, unknown> = {};
  switch (item.type) {
    case "note":
      payload.noteId = item.refId;
      break;
    case "flashcardDeck":
      payload.deckId = item.refId;
      break;
    case "file":
      payload.fileId = item.refId;
      break;
    case "studyChat":
      payload.mode = "chat";
      payload.chatId = item.refId;
      break;
    case "podcast":
      payload.mode = "podcast";
      payload.podcastId = item.refId;
      break;
    case "studySource":
      payload.mode = "chat";
      break;
    case "task":
    case "calendarEvent":
      // No per-item payload; just open the app.
      break;
  }
  open({
    appId: meta.appId,
    title: meta.label,
    icon: "",
    payload,
  });
}

interface Props {
  type: LinkType;
  id: string | undefined;
  /** Compact mode: just the chain icon + count (default). */
  compact?: boolean;
  className?: string;
  /** Bump this number to force a re-fetch (e.g. after a drop creates a link). */
  refreshSignal?: number;
}

/**
 * Chain-icon badge showing the count of attached links. Click opens a
 * popover listing each linked item with open + unlink actions.
 */
export default function LinkBadge({ type, id, compact = true, className = "", refreshSignal }: Props) {
  const { links, count, remove } = useLinks(type, id, refreshSignal);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (count === 0 && !open) return null;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:border-accent/50 hover:text-accent"
        title={`${count} attached item${count === 1 ? "" : "s"}`}
      >
        <Link2 size={11} />
        {count > 0 && <span>{count}</span>}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-edge bg-surface py-1 shadow-window"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
            Attached ({count})
          </div>
          {links.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-muted">No attachments yet. Drag an item here to link.</p>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {links.map((l) => {
                const meta = TYPE_META[l.type];
                const Icon = meta.icon;
                return (
                  <div
                    key={l.id}
                    className="group flex items-center gap-2 px-2 py-1.5 text-xs text-ink hover:bg-surface-2"
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openLinked(l);
                        setOpen(false);
                      }}
                      className="flex flex-1 items-center gap-2 truncate text-left"
                      title={`Open ${meta.label.toLowerCase()}`}
                    >
                      <Icon size={13} className="shrink-0 text-ink-muted" />
                      <span className="truncate">{l.title}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(l.id);
                      }}
                      className="shrink-0 rounded p-0.5 text-ink-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
                      title="Unlink"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
