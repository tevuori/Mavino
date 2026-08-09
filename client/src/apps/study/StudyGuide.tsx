// ===== Study Hub: Study Guide (consolidate multiple sources) =====

import { useState } from "react";
import { Sparkles, FileText, GraduationCap } from "lucide-react";
import { ActionButton, ErrorBanner, Loading, PinnedGraph, SuccessBanner } from "./ui";
import { studyApi, type SourceDescriptor } from "../../services/study";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import WorkspaceSourceSelector, { studySourceToDescriptor } from "./WorkspaceSourceSelector";
import { useWindows } from "../../store/windows";
import HighlightableMarkdown from "./HighlightableMarkdown";

export default function StudyGuide({ initialGraphId, language }: { initialGraphId?: string | null; language?: "en" | "cs" }) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [graphId, setGraphId] = useState<string | null>(initialGraphId ?? null);
  const [title, setTitle] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [guide, setGuide] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const openWindow = useWindows((s) => s.open);

  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getSources = async (): Promise<SourceDescriptor[]> => {
    const { sources: lib } = await studySourcesApi.list();
    return [...selectedSourceIds]
      .map((id) => {
        const s = lib.find((x) => x.id === id);
        return s ? studySourceToDescriptor(s) : null;
      })
      .filter((x): x is SourceDescriptor => x !== null);
  };

  const hasSource = graphId !== null || selectedSourceIds.size > 0;

  const run = async () => {
    if (!hasSource) return;
    setGenLoading(true);
    setError("");
    setSuccess("");
    setGuide("");
    setNoteId(null);
    try {
      const res = await studyApi.studyGuide({
        ...(graphId ? { graphId } : { sources: await getSources() }),
        saveAsNote: true,
        noteTitle: title.trim() || undefined,
        language,
      });
      setGuide(res.guide);
      setNoteId(res.noteId);
      if (res.noteId) setSuccess("Study guide saved as a new note.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate study guide");
    } finally {
      setGenLoading(false);
    }
  };

  const openNote = () => {
    if (!noteId) return;
    openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId } });
  };

  const studyFurther = (mode: "flashcards" | "quiz") => {
    if (!noteId) return;
    openWindow({
      appId: "study",
      title: "Study Hub",
      icon: "GraduationCap",
      payload: { mode, sourceKind: "note", sourceId: noteId },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-muted">
        Select sources to consolidate into a single study guide / cheat sheet.
      </p>

      {graphId ? (
        <PinnedGraph graphId={graphId} onDismiss={() => setGraphId(null)} />
      ) : (
        <WorkspaceSourceSelector
          selectedIds={selectedSourceIds}
          onToggle={toggleSource}
          disabled={genLoading}
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Study Guide"
            className="w-48 rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-ink outline-none focus:border-accent"
          />
        </label>
        <ActionButton onClick={run} disabled={!hasSource} loading={genLoading}>
          <Sparkles size={13} /> Generate{graphId ? "" : ` (${selectedSourceIds.size})`}
        </ActionButton>
      </div>

      {genLoading && <Loading label="Generating study guide…" />}
      {error && <ErrorBanner message={error} />}
      {success && (
        <div className="flex flex-wrap items-center gap-2">
          <SuccessBanner message={success} />
          {noteId && (
            <ActionButton onClick={openNote} variant="ghost">
              <FileText size={12} /> Open note
            </ActionButton>
          )}
          {noteId && (
            <ActionButton onClick={() => studyFurther("flashcards")} variant="ghost">
              <GraduationCap size={12} /> Flashcards
            </ActionButton>
          )}
          {noteId && (
            <ActionButton onClick={() => studyFurther("quiz")} variant="ghost">
              <GraduationCap size={12} /> Quiz me
            </ActionButton>
          )}
        </div>
      )}
      {guide && (
        <HighlightableMarkdown
          content={guide}
          scope="study_guide"
          scopeId={noteId ?? "study-guide"}
          sourceName={title.trim() || noteId ? `Study Guide${noteId ? ` (note ${noteId})` : ""}` : "Study Guide"}
        />
      )}
    </div>
  );
}
