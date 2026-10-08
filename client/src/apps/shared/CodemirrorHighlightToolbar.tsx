// ===== CodemirrorHighlightToolbar =====
// Floating toolbar rendered by apps using useCodemirrorHighlights. Handles both
// create mode (selection doesn't match an existing highlight) and edit mode
// (selection matches an existing highlight → color change / annotation / delete).
// On phone form factor it renders as a bottom sheet.

import { useState, useEffect } from "react";
import { Highlighter, Trash2, X, MessageSquarePlus } from "lucide-react";
import { useFormFactor } from "../../store/formfactor";
import { HIGHLIGHT_COLORS, COLOR_LABEL } from "../study/highlightUtils";
import type {
  CodemirrorSelection,
} from "./useCodemirrorHighlights";
import type { HighlightColor } from "../../services/study-highlights";

const COLOR_SWATCH_BG: Record<HighlightColor, string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  purple: "#c084fc",
};

interface Props {
  selection: CodemirrorSelection | null;
  onCreate: (color: HighlightColor, annotation?: string) => void;
  onUpdate: (id: string, patch: { color?: HighlightColor; annotation?: string | null }) => void;
  onDelete: (id: string) => void;
  onDismiss: () => void;
}

export default function CodemirrorHighlightToolbar({
  selection, onCreate, onUpdate, onDelete, onDismiss,
}: Props) {
  const formFactor = useFormFactor((s) => s.mode);
  const isPhone = formFactor === "phone";
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotation, setAnnotation] = useState("");
  const [pendingColor, setPendingColor] = useState<HighlightColor>("yellow");

  // Reset internal state when the selection changes.
  useEffect(() => {
    if (selection) {
      setAnnotateMode(false);
      setAnnotation(selection.existing?.annotation ?? "");
      setPendingColor(selection.existing?.color ?? "yellow");
    }
  }, [selection]);

  if (!selection) return null;

  const existing = selection.existing;

  const handleSave = () => {
    if (existing) {
      onUpdate(existing.id, { color: pendingColor, annotation: annotation.trim() || null });
    } else {
      onCreate(pendingColor, annotation);
    }
    onDismiss();
  };

  const swatches = (
    <div className="flex items-center gap-1">
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => setPendingColor(c)}
          className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 ${
            pendingColor === c ? "border-accent" : "border-edge"
          }`}
          style={{ background: COLOR_SWATCH_BG[c] }}
          title={COLOR_LABEL[c]}
        />
      ))}
    </div>
  );

  const annotateToggle = (
    <button
      onClick={() => setAnnotateMode((v) => !v)}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition ${
        annotateMode ? "border-accent text-accent" : "border-edge text-ink-muted hover:text-ink"
      }`}
      title="Add annotation"
    >
      <MessageSquarePlus size={11} /> Note
    </button>
  );

  const annotateInput = (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={annotation}
        onChange={(e) => setAnnotation(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onDismiss();
        }}
        placeholder="Annotation…"
        className="w-44 rounded-md border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink outline-none focus:border-focus"
      />
      <button
        onClick={handleSave}
        className="rounded-md bg-accent px-2 py-1 text-[10px] font-medium text-accent-fg"
      >
        Save
      </button>
    </div>
  );

  if (isPhone) {
    return (
      <div className="fixed inset-0 z-50 flex items-end" onClick={onDismiss}>
        <div
          className="w-full rounded-t-xl border border-edge bg-surface p-3 shadow-window"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-edge" />
          <div className="mb-2 flex items-center gap-2">
            <Highlighter size={13} className="text-accent" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              {existing ? "Edit highlight" : "Highlight"}
            </span>
          </div>
          <div className="mb-2 line-clamp-2 text-[11px] text-ink-muted">“{selection.text}”</div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {swatches}
            {annotateToggle}
          </div>
          {annotateMode && <div className="mb-2">{annotateInput}</div>}
          <div className="flex items-center justify-between">
            {existing ? (
              <button
                onClick={() => { onDelete(existing.id); onDismiss(); }}
                className="flex items-center gap-1 rounded-md border border-danger px-2 py-1.5 text-[11px] text-danger hover:bg-danger-soft"
              >
                <Trash2 size={12} /> Delete
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={handleSave}
              className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
            >
              {existing ? "Update" : "Highlight"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed z-50 flex flex-col gap-1.5 rounded-lg border border-edge bg-surface p-2 shadow-window"
      style={{
        left: Math.min(
          Math.max(selection.rect.left + selection.rect.width / 2 - 90, 8),
          window.innerWidth - 220
        ),
        top: Math.max(selection.rect.top - 56, 8),
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1">
        {swatches}
        {annotateToggle}
        {existing && (
          <button
            onClick={() => { onDelete(existing.id); onDismiss(); }}
            className="ml-1 flex items-center gap-1 rounded-md border border-danger px-1.5 py-1 text-[10px] text-danger hover:bg-danger-soft"
            title="Delete highlight"
          >
            <Trash2 size={11} />
          </button>
        )}
        <button
          onClick={onDismiss}
          className="ml-0.5 rounded p-0.5 text-ink-muted hover:text-ink"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
      {annotateMode && annotateInput}
    </div>
  );
}
