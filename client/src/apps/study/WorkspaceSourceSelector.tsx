// ===== Study Hub: workspace-based source selector =====
// Reusable component for selecting sources across all study modes.
// Shows workspaces as expandable items — click to reveal the sources inside.
// Sources have checkboxes for multiselect. Also shows unassigned sources
// (library sources not in any workspace) and an "add source" button.

import { useState, useEffect, useCallback } from "react";
import {
  FolderOpen, ChevronRight, ChevronDown, Plus, FileText, File as FileIcon,
  Link2, GraduationCap, ClipboardPaste, Check, X, Loader2,
} from "lucide-react";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import { studyWorkspacesApi, type LearningWorkspace } from "../../services/study-workspaces";
import type { SourceDescriptor } from "../../services/study";
import SourcePicker from "./SourcePicker";
import { ActionButton } from "./ui";

const KIND_ICON: Record<string, typeof FileText> = {
  note: FileText,
  file: FileIcon,
  paste: ClipboardPaste,
  url: Link2,
};

export function studySourceToDescriptor(s: StudySource): SourceDescriptor {
  switch (s.kind) {
    case "note":
      return { kind: "note", id: s.refId };
    case "file":
      return { kind: "file", id: s.refId };
    case "paste":
      return { kind: "paste", text: s.textCache, name: s.name };
    case "url":
      return { kind: "url", url: s.refId, name: s.name };
    default:
      return { kind: "paste", text: s.textCache, name: s.name };
  }
}

interface Props {
  /** Currently selected source IDs. */
  selectedIds: Set<string>;
  /** Toggle a source selection. */
  onToggle: (id: string) => void;
  /** Called when a new source is added to the library (so parent can refresh). */
  onSourceAdded?: (source: StudySource) => void;
  /** Whether to allow selecting multiple sources (default true). */
  multi?: boolean;
  /** Compact mode (smaller padding, for inline use). */
  compact?: boolean;
  /** Disabled (e.g. during streaming). */
  disabled?: boolean;
  /**
   * Sources already attached to the session: shown as such and not selectable
   * (used by the Teach Me session settings, where adding is additive).
   */
  attachedIds?: Set<string>;
  /** Show an excerpt + reading-time preview of the last clicked source. */
  showPreview?: boolean;
}

/** Rough reading time of a cached source text, in whole minutes (min 1). */
export function readingTimeMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export default function WorkspaceSourceSelector({
  selectedIds,
  onToggle,
  onSourceAdded,
  multi = true,
  compact = false,
  disabled = false,
  attachedIds,
  showPreview = false,
}: Props) {
  const [workspaces, setWorkspaces] = useState<LearningWorkspace[]>([]);
  const [library, setLibrary] = useState<StudySource[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPicker, setShowPicker] = useState(false);
  const [pickerValue, setPickerValue] = useState<SourceDescriptor | null>(null);
  const [addingSource, setAddingSource] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ws, src] = await Promise.all([
      studyWorkspacesApi.list().then((r) => r.workspaces).catch(() => [] as LearningWorkspace[]),
      studySourcesApi.list().then((r) => r.sources).catch(() => [] as StudySource[]),
    ]);
    setWorkspaces(ws);
    setLibrary(src);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Sources that belong to at least one workspace.
  const assignedSourceIds = new Set(workspaces.flatMap((w) => w.sourceIds));
  // Sources not in any workspace.
  const unassigned = library.filter((s) => !assignedSourceIds.has(s.id));

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggle = (id: string) => {
    if (disabled || attachedIds?.has(id)) return;
    if (showPreview) setPreviewId(id);
    if (!multi) {
      // Single-select: clear all others. Parent handles via onToggle.
      // We need a different approach — call onToggle for the new one
      // and the parent will clear others. But we don't have that info here.
      // For single-select, we emit a "select one" by toggling off all others.
      // Simpler: just toggle, and parent manages exclusivity.
      onToggle(id);
    } else {
      onToggle(id);
    }
  };

  const addPickerSource = async (closeAfter: boolean) => {
    if (!pickerValue) return;
    setAddingSource(true);
    try {
      const { source } = await studySourcesApi.create(pickerValue);
      setLibrary((prev) => [source, ...prev.filter((s) => s.id !== source.id)]);
      onSourceAdded?.(source);
      setJustAdded(source.name);
      setPickerValue(null);
      if (closeAfter) setShowPicker(false);
    } catch { /* non-fatal */ } finally {
      setAddingSource(false);
    }
  };

  const renderSource = (s: StudySource) => {
    const Icon = KIND_ICON[s.kind] ?? FileText;
    const attached = attachedIds?.has(s.id) ?? false;
    const checked = attached || selectedIds.has(s.id);
    return (
      <button
        key={s.id}
        onClick={() => handleToggle(s.id)}
        disabled={disabled || attached}
        title={attached ? "Already part of this lesson" : s.name}
        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition disabled:opacity-50 ${
          compact ? "" : "ml-4"
        } ${
          checked
            ? "border-accent bg-accent/10 text-accent"
            : "border-edge bg-surface text-ink hover:bg-surface-2"
        }`}
      >
        <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${checked ? "border-accent bg-accent text-accent-fg" : "border-edge"}`}>
          {checked && <Check size={10} />}
        </span>
        <Icon size={12} className="shrink-0 opacity-60" />
        <span className="flex-1 truncate">{s.name}</span>
        {showPreview && s.textCache && (
          <span className="shrink-0 text-[9px] opacity-50">~{readingTimeMinutes(s.textCache)} min</span>
        )}
        <span className="shrink-0 text-[9px] uppercase opacity-50">{attached ? "in lesson" : s.kind}</span>
      </button>
    );
  };

  const renderWorkspace = (ws: LearningWorkspace) => {
    const isExpanded = expanded.has(ws.id);
    const wsSources = ws.sourceIds
      .map((sid) => library.find((s) => s.id === sid))
      .filter((s): s is StudySource => s !== null);
    const wsSelected = ws.sourceIds.filter((sid) => selectedIds.has(sid)).length;

    return (
      <div key={ws.id} className="flex flex-col gap-1">
        <button
          onClick={() => toggleExpand(ws.id)}
          className="flex items-center gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2 text-left text-xs text-ink transition hover:bg-surface-3"
        >
          {isExpanded ? <ChevronDown size={13} className="shrink-0 text-ink-muted" /> : <ChevronRight size={13} className="shrink-0 text-ink-muted" />}
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ws.color ?? "#6366f1" }} />
          <span className="flex-1 truncate font-medium">{ws.name}</span>
          <span className="shrink-0 text-[10px] text-ink-muted">
            {wsSelected}/{wsSources.length} selected
          </span>
        </button>
        {isExpanded && (
          <div className="flex flex-col gap-1">
            {wsSources.length === 0 ? (
              <p className="ml-4 px-2.5 py-1.5 text-[11px] text-ink-muted">No sources in this workspace yet.</p>
            ) : (
              wsSources.map(renderSource)
            )}
          </div>
        )}
      </div>
    );
  };

  const previewSource = previewId ? library.find((s) => s.id === previewId) ?? null : null;
  // The shortest selected source is the gentlest way into a topic.
  const selectedSources = library.filter((s) => selectedIds.has(s.id));
  const suggestedStart = selectedSources.length > 1
    ? [...selectedSources].sort((a, b) => (a.textCache?.length ?? 0) - (b.textCache?.length ?? 0))[0]
    : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface-2 p-3 text-xs text-ink-muted">
        <Loader2 size={13} className="animate-spin" /> Loading sources…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Sources {selectedIds.size > 0 && `(${selectedIds.size} selected)`}
        </span>
        {!disabled && (
          <button
            onClick={() => { setShowPicker(true); setJustAdded(null); }}
            className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <Plus size={11} /> Add source
          </button>
        )}
      </div>

      {workspaces.length === 0 && unassigned.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge bg-surface-2 p-4 text-center">
          <FolderOpen size={20} className="mx-auto mb-1.5 text-ink-muted opacity-40" />
          <p className="text-xs text-ink-muted">
            No sources yet. Click "Add source" to add a note, file (incl. PDF), URL, or pasted text.
          </p>
        </div>
      ) : (
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {workspaces.map(renderWorkspace)}
          {unassigned.length > 0 && (
            <div className="flex flex-col gap-1">
              {workspaces.length > 0 && (
                <span className="ml-1 mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Other sources
                </span>
              )}
              {unassigned.map(renderSource)}
            </div>
          )}
        </div>
      )}

      {showPreview && previewSource && (
        <div className="flex flex-col gap-1 rounded-lg border border-edge bg-surface-2 p-2.5">
          <div className="flex items-center gap-2 text-[11px] font-medium text-ink">
            <span className="flex-1 truncate">{previewSource.name}</span>
            {previewSource.textCache && (
              <span className="shrink-0 text-ink-muted">~{readingTimeMinutes(previewSource.textCache)} min read</span>
            )}
          </div>
          <p className="line-clamp-4 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-muted">
            {previewSource.textCache?.slice(0, 400) || "No extracted text cached for this source yet."}
          </p>
          {suggestedStart && (
            <p className="text-[10px] text-accent">Suggested starting point: {suggestedStart.name}</p>
          )}
        </div>
      )}

      {showPicker && (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface-2 p-3">
          {justAdded && !pickerValue && (
            <div className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400">
              <Check size={11} /> Added "{justAdded}" — add another or close.
            </div>
          )}
          <SourcePicker value={pickerValue} onChange={(v) => { setPickerValue(v); setJustAdded(null); }} />
          <div className="flex justify-end gap-2">
            <ActionButton onClick={() => { setShowPicker(false); setPickerValue(null); setJustAdded(null); }} variant="ghost">
              Done
            </ActionButton>
            <ActionButton onClick={() => void addPickerSource(false)} disabled={!pickerValue} loading={addingSource}>
              <Plus size={13} /> Add another
            </ActionButton>
            <ActionButton onClick={() => void addPickerSource(true)} disabled={!pickerValue} loading={addingSource}>
              <Plus size={13} /> Add & close
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}
