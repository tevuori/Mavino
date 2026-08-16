// ===== Shared source picker for Study Hub workflows =====
// Pick a note, a text file, pasted text, or a web URL.
// Returns a SourceDescriptor.

import { useState, useEffect, useMemo } from "react";
import {
  StickyNote, FileText, ClipboardPaste, Search,
  Globe,
} from "lucide-react";
import { notesApi } from "../../services/notes";
import { filesApi } from "../../services/files";
import type { Note, VFile } from "../../types";
import type { SourceDescriptor, SourceKind } from "../../services/study";

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "html", "htm", "css", "xml", "svg", "py",
  "rb", "php", "go", "rs", "java", "c", "h", "cpp", "cs", "kt", "swift", "sh",
  "bash", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "sql", "csv",
  "tsv", "log", "js", "jsx", "ts", "tsx",
]);

/** A file is pickable as a study source if it's a text file OR a PDF. */
function isStudyFile(f: VFile): boolean {
  if (f.mimeType.startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/javascript", "application/x-yaml"].includes(f.mimeType)) return true;
  if (f.mimeType === "application/pdf") return true;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT.has(ext) || ext === "pdf";
}

export interface SourcePickerProps {
  value: SourceDescriptor | null;
  onChange: (src: SourceDescriptor | null) => void;
  /** Hide the paste option (e.g. for study-guide which uses note multi-select). */
  hidePaste?: boolean;
}

export default function SourcePicker({ value, onChange, hidePaste }: SourcePickerProps) {
  const [kind, setKind] = useState<SourceKind>(value?.kind ?? "note");
  const [notes, setNotes] = useState<Note[]>([]);
  const [files, setFiles] = useState<VFile[]>([]);
  const [noteQuery, setNoteQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [pasteText, setPasteText] = useState(value?.kind === "paste" ? value.text ?? "" : "");
  const [selectedNoteId, setSelectedNoteId] = useState(value?.kind === "note" ? value.id ?? "" : "");
  const [selectedFileId, setSelectedFileId] = useState(value?.kind === "file" ? value.id ?? "" : "");
  const [urlText, setUrlText] = useState(value?.kind === "url" ? value.url ?? "" : "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (kind === "note" && notes.length === 0) {
      setLoading(true);
      notesApi.list().then((r) => setNotes(r.notes)).finally(() => setLoading(false));
    }
    if (kind === "file" && files.length === 0) {
      setLoading(true);
      filesApi.all().then((r) => setFiles(r.files.filter(isStudyFile))).finally(() => setLoading(false));
    }
  }, [kind, notes.length, files.length]);

  // Emit the current selection up.
  useEffect(() => {
    if (kind === "paste") {
      if (pasteText.trim()) onChange({ kind: "paste", text: pasteText });
      else onChange(null);
    } else if (kind === "note") {
      if (selectedNoteId) onChange({ kind: "note", id: selectedNoteId });
      else onChange(null);
    } else if (kind === "file") {
      if (selectedFileId) onChange({ kind: "file", id: selectedFileId });
      else onChange(null);
    } else if (kind === "url") {
      if (urlText.trim()) onChange({ kind: "url", url: urlText.trim() });
      else onChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, pasteText, selectedNoteId, selectedFileId, urlText]);

  const filteredNotes = useMemo(() => {
    if (!noteQuery.trim()) return notes;
    const q = noteQuery.toLowerCase();
    return notes.filter((n) => n.title.toLowerCase().includes(q));
  }, [notes, noteQuery]);

  const filteredFiles = useMemo(() => {
    if (!fileQuery.trim()) return files;
    const q = fileQuery.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, fileQuery]);

  const tabs: { k: SourceKind; label: string; icon: typeof StickyNote }[] = [
    { k: "note", label: "Note", icon: StickyNote },
    { k: "file", label: "File", icon: FileText },
    ...(!hidePaste ? [{ k: "paste" as SourceKind, label: "Paste", icon: ClipboardPaste }] : []),
    { k: "url", label: "URL", icon: Globe },
  ];

  return (
    <div className="rounded-lg border border-edge bg-surface-2 p-3">
      <div className="mb-2 flex gap-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = kind === t.k;
          return (
            <button
              key={t.k}
              onClick={() => setKind(t.k)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                active ? "bg-accent text-accent-fg" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
              }`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {kind === "note" && (
        <div>
          <div className="relative mb-2">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={noteQuery}
              onChange={(e) => setNoteQuery(e.target.value)}
              placeholder="Search notes…"
              className="w-full rounded-md border border-edge bg-surface px-7 py-1.5 text-xs text-ink outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-edge bg-surface">
            {loading ? (
              <div className="p-2 text-xs text-ink-muted">Loading…</div>
            ) : filteredNotes.length === 0 ? (
              <div className="p-2 text-xs text-ink-muted">No notes found.</div>
            ) : (
              filteredNotes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setSelectedNoteId(n.id)}
                  className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs hover:bg-surface-2 ${
                    selectedNoteId === n.id ? "bg-surface-2 text-accent" : "text-ink"
                  }`}
                >
                  <span className="truncate">{n.title || "Untitled"}</span>
                  {n.pinned && <span className="text-accent">★</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {kind === "file" && (
        <div>
          <div className="relative mb-2">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={fileQuery}
              onChange={(e) => setFileQuery(e.target.value)}
              placeholder="Search text files…"
              className="w-full rounded-md border border-edge bg-surface px-7 py-1.5 text-xs text-ink outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-edge bg-surface">
            {loading ? (
              <div className="p-2 text-xs text-ink-muted">Loading…</div>
            ) : filteredFiles.length === 0 ? (
              <div className="p-2 text-xs text-ink-muted">No text files found.</div>
            ) : (
              filteredFiles.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelectedFileId(f.id)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-2 ${
                    selectedFileId === f.id ? "bg-surface-2 text-accent" : "text-ink"
                  }`}
                >
                  <FileText size={12} className="shrink-0 text-ink-muted" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {kind === "paste" && (
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste your study material here…"
          rows={6}
          className="w-full resize-y rounded-md border border-edge bg-surface px-2.5 py-2 text-xs text-ink outline-none focus:border-accent"
        />
      )}

      {kind === "url" && (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Globe size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              placeholder="https://example.com/article"
              className="w-full rounded-md border border-edge bg-surface px-7 py-1.5 text-xs text-ink outline-none focus:border-accent"
            />
          </div>
          <p className="text-[10px] text-ink-muted">The page's main article text is extracted server-side (Readability).</p>
        </div>
      )}
    </div>
  );
}
