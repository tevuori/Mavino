// ===== Shared UI bits for Study Hub modes =====

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, GraduationCap, FileText, File as FileIcon, Link2, ClipboardPaste, X, Network } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SourceDescriptor } from "../../services/study";
import { studyGraphApi } from "../../services/study-graph";

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="selectable markdown-body prose-sm max-w-none rounded-lg border border-edge bg-surface-2 p-3 text-sm text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export function Loading({ label = "Working…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface-2 p-3 text-xs text-ink-muted">
      <Loader2 size={14} className="animate-spin text-accent" /> {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
      <AlertCircle size={14} /> {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-500">
      <CheckCircle2 size={14} /> {message}
    </div>
  );
}

export function ActionButton({
  onClick,
  disabled,
  loading,
  children,
  variant = "primary",
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  const base =
    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-40";
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-fg hover:opacity-90"
      : "border border-edge text-ink-muted hover:bg-surface-2 hover:text-ink";
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${styles}`}>
      {loading && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

export function TruncationNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-500">
      Source was truncated (over 20,000 chars) — results are based on the first part.
    </div>
  );
}

const SOURCE_ICONS: Record<string, typeof FileText> = {
  note: FileText,
  file: FileIcon,
  paste: ClipboardPaste,
  moodle: GraduationCap,
  url: Link2,
};

/**
 * Shows a pre-selected source (e.g. from Moodle app "Summarize" button) as a
 * card with an option to dismiss it and go back to manual source selection.
 */
export function PreselectedSource({
  source,
  onDismiss,
}: {
  source: SourceDescriptor;
  onDismiss?: () => void;
}) {
  const Icon = SOURCE_ICONS[source.kind] ?? FileText;
  const label = source.name || source.url || source.id || source.kind;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 p-2.5 text-xs">
      <Icon size={14} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">{source.kind}</span>
        <p className="truncate font-medium text-ink">{label}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-3 hover:text-ink"
          title="Choose a different source"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * Shows a pinned Knowledge Graph (from the Knowledge Graph app's action bar,
 * or a deep-linked graphId) as a card. When a graph is pinned, generation
 * derives from its persisted concepts/relationships instead of re-resolving
 * and re-analyzing raw source text.
 */
export function PinnedGraph({ graphId, onDismiss }: { graphId: string; onDismiss?: () => void }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    studyGraphApi
      .get(graphId)
      .then((g) => { if (!cancelled) setName(g.name); })
      .catch(() => { if (!cancelled) setName(null); });
    return () => { cancelled = true; };
  }, [graphId]);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 p-2.5 text-xs">
      <Network size={14} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <span className="text-[10px] uppercase tracking-wide text-ink-muted">Knowledge graph</span>
        <p className="truncate font-medium text-ink">{name ?? "Loading…"}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-3 hover:text-ink"
          title="Choose a different source"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
