// ===== Study Hub: Highlights mode =====
// Central browser for all the user's saved highlights & annotations. Lists
// every StudyHighlight (across all surfaces), grouped by source, with filter
// by color/scope, inline annotation edit, delete, and "Export as Note".

import { useState, useEffect, useMemo } from "react";
import {
  Highlighter, Trash2, FileText, Filter, Search,
} from "lucide-react";
import { useHighlights } from "../../store/highlights";
import { studyHighlightsApi, type HighlightColor, type HighlightScope } from "../../services/study-highlights";
import { HIGHLIGHT_COLORS, COLOR_LABEL } from "./highlightUtils";
import { ActionButton, ErrorBanner, Loading, SuccessBanner } from "./ui";
import { useWindows } from "../../store/windows";
import { teachLaunchInput } from "../teach/launch";

const COLOR_SWATCH_BG: Record<HighlightColor, string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  purple: "#c084fc",
};

const SCOPE_LABEL: Record<HighlightScope, string> = {
  chat: "Chat",
  teacher: "Teach Me",
  summarize: "Summary",
  explain: "Explanation",
  study_guide: "Study Guide",
  podcast: "Podcast",
  note: "Note",
  editor: "Editor",
};

/** Reopen the source where a highlight was made (best-effort deep link). */
function useReopenHighlight() {
  const openWindow = useWindows((s) => s.open);
  return (h: { scope: HighlightScope; scopeId: string; sourceName?: string | null }) => {
    const { scope, scopeId } = h;
    if (scope === "note") {
      openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId: scopeId } });
    } else if (scope === "editor") {
      openWindow({ appId: "editor", title: "Editor", icon: "Code", payload: { fileId: scopeId } });
    } else if (scope === "chat") {
      const chatId = scopeId.split("#")[0];
      openWindow({ appId: "study", title: "Study Hub", icon: "GraduationCap", payload: { mode: "chat", chatId } });
    } else if (scope === "teacher") {
      const sessionId = scopeId.split("#")[0];
      openWindow(teachLaunchInput(sessionId));
    } else if (scope === "podcast") {
      openWindow({ appId: "study", title: "Study Hub", icon: "GraduationCap", payload: { mode: "podcast", podcastId: scopeId } });
    } else {
      openWindow({ appId: "study", title: "Study Hub", icon: "GraduationCap" });
    }
  };
}

export default function Highlights() {
  const all = useHighlights((s) => s.all);
  const loadedAll = useHighlights((s) => s.loadedAll);
  const loadAll = useHighlights((s) => s.loadAll);
  const updateHighlight = useHighlights((s) => s.update);
  const removeHighlight = useHighlights((s) => s.remove);

  const [colorFilter, setColorFilter] = useState<HighlightColor | null>(null);
  const [scopeFilter, setScopeFilter] = useState<HighlightScope | null>(null);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportTitle, setExportTitle] = useState("");
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const openWindow = useWindows((s) => s.open);
  const reopen = useReopenHighlight();

  useEffect(() => {
    if (!loadedAll) void loadAll();
  }, [loadedAll, loadAll]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((h) => {
      if (colorFilter && h.color !== colorFilter) return false;
      if (scopeFilter && h.scope !== scopeFilter) return false;
      if (q) {
        const hay = `${h.text} ${h.annotation ?? ""} ${h.sourceName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, colorFilter, scopeFilter, query]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected(new Set(filtered.map((h) => h.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const exportSelected = async () => {
    if (selected.size === 0) return;
    setExporting(true);
    setError("");
    setSuccess("");
    try {
      const { noteId } = await studyHighlightsApi.exportAsNote(
        [...selected],
        exportTitle.trim() || undefined
      );
      setSuccess(`Exported ${selected.size} highlights to a new note.`);
      clearSelection();
      setExportTitle("");
      // Offer to open the note.
      setTimeout(() => {
        openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId } });
      }, 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export");
    } finally {
      setExporting(false);
    }
  };

  const scopesPresent = useMemo(
    () => [...new Set(all.map((h) => h.scope))] as HighlightScope[],
    [all]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Highlighter size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-ink">Highlights</h2>
        <span className="text-[11px] text-ink-muted">
          {all.length} saved{filtered.length !== all.length ? ` · ${filtered.length} shown` : ""}
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface-2 p-2">
        <div className="flex items-center gap-1 text-[11px] text-ink-muted">
          <Filter size={12} /> Color:
        </div>
        <button
          onClick={() => setColorFilter(null)}
          className={`rounded-full border px-1.5 py-0.5 text-[10px] transition ${
            colorFilter === null ? "border-accent text-accent" : "border-edge text-ink-muted hover:text-ink"
          }`}
        >
          All
        </button>
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColorFilter(colorFilter === c ? null : c)}
            className={`h-5 w-5 rounded-full border-2 transition hover:scale-110 ${
              colorFilter === c ? "border-accent" : "border-edge"
            }`}
            style={{ background: COLOR_SWATCH_BG[c] }}
            title={COLOR_LABEL[c]}
          />
        ))}
        {scopesPresent.length > 1 && (
          <>
            <div className="mx-1 h-4 w-px bg-edge" />
            <select
              value={scopeFilter ?? ""}
              onChange={(e) => setScopeFilter((e.target.value || null) as HighlightScope | null)}
              className="rounded-md border border-edge bg-surface px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-accent"
            >
              <option value="">All sources</option>
              {scopesPresent.map((s) => (
                <option key={s} value={s}>{SCOPE_LABEL[s] ?? s}</option>
              ))}
            </select>
          </>
        )}
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search highlights…"
            className="w-44 rounded-md border border-edge bg-surface py-1 pl-7 pr-2 text-[11px] text-ink outline-none focus:border-accent"
          />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {success && <SuccessBanner message={success} />}

      {/* Export bar */}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface-2 p-2">
          <span className="text-[11px] text-ink-muted">
            {selected.size > 0 ? `${selected.size} selected` : "Select highlights to export"}
          </span>
          <button
            onClick={selected.size === filtered.length ? clearSelection : selectAllFiltered}
            className="rounded-md border border-edge px-2 py-0.5 text-[10px] text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            {selected.size === filtered.length && selected.size > 0 ? "Clear" : "Select all"}
          </button>
          <input
            value={exportTitle}
            onChange={(e) => setExportTitle(e.target.value)}
            placeholder="Note title (optional)"
            className="flex-1 rounded-md border border-edge bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
          />
          <ActionButton
            onClick={exportSelected}
            disabled={selected.size === 0}
            loading={exporting}
          >
            <FileText size={12} /> Export as Note
          </ActionButton>
        </div>
      )}

      {/* List */}
      {!loadedAll ? (
        <Loading label="Loading highlights…" />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-edge py-12 text-center">
          <Highlighter size={28} className="text-ink-muted opacity-40" />
          <p className="text-xs text-ink-muted">
            {all.length === 0
              ? "No highlights yet. Select text in a summary, chat answer, or note to highlight it."
              : "No highlights match your filters."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((h) => {
            const isSel = selected.has(h.id);
            return (
              <div
                key={h.id}
                className={`flex gap-2.5 rounded-lg border p-2.5 transition ${
                  isSel ? "border-accent/50 bg-accent/5" : "border-edge bg-surface-2 hover:bg-surface-3/40"
                }`}
              >
                <button
                  onClick={() => toggleSelect(h.id)}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition ${
                    isSel ? "border-accent bg-accent text-accent-fg" : "border-edge"
                  }`}
                  title="Select for export"
                >
                  {isSel && "✓"}
                </button>
                <div
                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                  style={{ background: COLOR_SWATCH_BG[h.color] }}
                  title={COLOR_LABEL[h.color]}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <blockquote className="border-l-2 pl-2 text-xs text-ink">
                    {h.text}
                  </blockquote>
                  <textarea
                    defaultValue={h.annotation ?? ""}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val !== (h.annotation ?? "")) {
                        void updateHighlight(h.id, { annotation: val || null });
                      }
                    }}
                    placeholder="Add an annotation…"
                    rows={1}
                    className="w-full resize-none rounded-md border border-edge bg-surface px-2 py-1 text-[11px] text-ink-muted outline-none focus:border-accent"
                  />
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-muted">
                    <button
                      onClick={() => reopen(h)}
                      className="rounded-md border border-edge px-1.5 py-0.5 hover:bg-surface-3 hover:text-ink"
                      title="Open source"
                    >
                      {h.sourceName ?? SCOPE_LABEL[h.scope] ?? h.scope}
                    </button>
                    <span>{new Date(h.createdAt).toLocaleDateString()}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {HIGHLIGHT_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => void updateHighlight(h.id, { color: c })}
                          className={`h-3.5 w-3.5 rounded-full border transition hover:scale-110 ${
                            h.color === c ? "border-accent" : "border-edge"
                          }`}
                          style={{ background: COLOR_SWATCH_BG[c] }}
                          title={COLOR_LABEL[c]}
                        />
                      ))}
                      <button
                        onClick={() => void removeHighlight(h.id)}
                        className="ml-1 rounded p-0.5 text-ink-muted hover:text-red-400"
                        title="Delete highlight"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
