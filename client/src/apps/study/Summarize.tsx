// ===== Study Hub: Summarize =====

import { useState } from "react";
import { Sparkles, FileText, GraduationCap } from "lucide-react";
import WorkspaceSourceSelector, { studySourceToDescriptor } from "./WorkspaceSourceSelector";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import { ActionButton, ErrorBanner, Loading, PinnedGraph, PreselectedSource, SuccessBanner, TruncationNote } from "./ui";
import { studyApi, type SourceDescriptor } from "../../services/study";
import { useWindows } from "../../store/windows";
import HighlightableMarkdown from "./HighlightableMarkdown";

export default function Summarize({ initialSource, initialGraphId, language }: { initialSource?: SourceDescriptor | null; initialGraphId?: string | null; language?: "en" | "cs" }) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [pinnedSource, setPinnedSource] = useState<SourceDescriptor | null>(initialSource ?? null);
  const [graphId, setGraphId] = useState<string | null>(initialGraphId ?? null);
  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const getSources = async (): Promise<SourceDescriptor[]> => {
    if (pinnedSource) return [pinnedSource];
    const { sources: lib } = await studySourcesApi.list();
    return [...selectedSourceIds].map((id) => {
      const s = lib.find((x) => x.id === id);
      return s ? studySourceToDescriptor(s) : null;
    }).filter((x): x is SourceDescriptor => x !== null);
  };
  const [mode, setMode] = useState<"tldr" | "outline" | "keypoints">("keypoints");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [summary, setSummary] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const openWindow = useWindows((s) => s.open);

  const hasSource = graphId !== null || pinnedSource !== null || selectedSourceIds.size > 0;

  const run = async () => {
    if (!hasSource) return;
    setLoading(true);
    setError("");
    setSuccess("");
    setSummary("");
    setNoteId(null);
    try {
      const res = graphId
        ? await studyApi.summarize({ graphId, mode, saveAsNote: true, language })
        : await studyApi.summarize({ sources: await getSources(), mode, saveAsNote: true, language });
      setSummary(res.summary);
      setNoteId(res.noteId);
      setTruncated(res.truncated);
      if (res.noteId) setSuccess("Saved as a new note.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to summarize");
    } finally {
      setLoading(false);
    }
  };

  const openNote = () => {
    if (!noteId) return;
    openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId } });
  };

  const studyFurther = (mode: "flashcards" | "quiz" | "explain") => {
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
      {graphId ? (
        <PinnedGraph graphId={graphId} onDismiss={() => setGraphId(null)} />
      ) : pinnedSource ? (
        <PreselectedSource source={pinnedSource} onDismiss={() => setPinnedSource(null)} />
      ) : (
        <WorkspaceSourceSelector selectedIds={selectedSourceIds} onToggle={toggleSource} disabled={loading} />
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Style
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            className="rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-ink outline-none focus:border-accent"
          >
            <option value="keypoints">Key points</option>
            <option value="outline">Outline</option>
            <option value="tldr">TL;DR</option>
          </select>
        </label>
        <ActionButton onClick={run} disabled={!hasSource} loading={loading}>
          <Sparkles size={13} /> Summarize
        </ActionButton>
      </div>

      {loading && <Loading label="Summarizing…" />}
      {error && <ErrorBanner message={error} />}
      <TruncationNote show={truncated} />
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
      {summary && (
        <HighlightableMarkdown
          content={summary}
          scope="summarize"
          scopeId={noteId ?? "summary"}
          sourceName={noteId ? `Summary (note ${noteId})` : "Summary"}
        />
      )}
    </div>
  );
}
