import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold, Code, Folder, GraduationCap, Heading, Image as ImageIcon, Italic, Link2,
  List, MoreVertical, Pin, Plus, Search, Sparkles, Tag, Trash2, Download, FileText,
} from "lucide-react";
import { notesApi } from "../services/notes";
import { filesApi } from "../services/files";
import type { Note, NoteFolder } from "../types";
import type { MobileTool } from "./MobileLauncher";
import type { MobileToolPayload } from "./MobileToolPage";
import {
  MobileButton, MobileCard, MobileChip, MobileContainer, MobileEmpty, MobileFab,
  MobileHeader, MobileInput, MobileLoading, MobileMarkdown, MobileModal, MobileTextarea,
} from "./MobileUi";

type DetailMode = "edit" | "preview";
type StudyMode = "summarize" | "explain" | "flashcards" | "quiz" | "study_guide";

export default function MobileNotes({
  onClose,
  onOpenTool,
}: {
  onClose?: () => void;
  onOpenTool?: (tool: MobileTool, payload?: MobileToolPayload) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [view, setView] = useState<"list" | "detail">("list");
  const [selected, setSelected] = useState<Note | null>(null);
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<DetailMode>("edit");

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");

  // Folder management
  const [folderMenuOpen, setFolderMenuOpen] = useState<NoteFolder | null>(null);
  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // Note actions menu
  const [noteMenuOpen, setNoteMenuOpen] = useState(false);
  const [studyMenuOpen, setStudyMenuOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const loadFolders = useCallback(async () => {
    const res = await notesApi.listFolders().catch(() => null);
    if (res) setFolders(res.folders);
  }, []);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    const res = await notesApi
      .list({ q: query || undefined, folderId: folderId ?? undefined })
      .catch(() => null);
    const list = res?.notes ?? [];
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
      return +new Date(b.updatedAt) - +new Date(a.updatedAt);
    });
    setNotes(list);
    setLoading(false);
  }, [query, folderId]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadNotes();
    }, 250);
    return () => clearTimeout(t);
  }, [loadNotes]);

  const openDetail = (note: Note) => {
    setSelected(note);
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags ?? "");
    setMode("edit");
    setView("detail");
  };

  const createNote = async () => {
    const res = await notesApi
      .create({ title: "", content: "", folderId })
      .catch(() => null);
    if (res?.note) {
      setNotes((list) => [res.note, ...list]);
      openDetail(res.note);
    }
  };

  const save = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await notesApi.update(selected.id, { title, content, tags });
      if (res?.note) {
        setSelected(res.note);
        setNotes((list) => list.map((n) => (n.id === res.note.id ? res.note : n)));
      }
    } catch {
      /* ignore */
    }
    setSaving(false);
  }, [selected, title, content, tags]);

  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(() => {
      if (title !== selected.title || content !== selected.content || tags !== selected.tags) void save();
    }, 1000);
    return () => clearTimeout(t);
  }, [title, content, tags, selected?.id]);

  const togglePin = async () => {
    if (!selected) return;
    const next = !selected.pinned;
    setSelected((n) => (n ? { ...n, pinned: next } : null));
    setNotes((list) => list.map((n) => (n.id === selected.id ? { ...n, pinned: next } : n)));
    await notesApi.update(selected.id, { pinned: next }).catch(() => {});
    setNoteMenuOpen(false);
  };

  const deleteNote = async () => {
    if (!selected) return;
    if (!window.confirm("Delete this note?")) return;
    await notesApi.delete(selected.id).catch(() => {});
    setNotes((list) => list.filter((n) => n.id !== selected.id));
    setSelected(null);
    setView("list");
    setNoteMenuOpen(false);
  };

  const createFolder = async () => {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    const res = await notesApi.createFolder({ name: name.trim() }).catch(() => null);
    if (res?.folder) setFolders((list) => [...list, res.folder]);
  };

  const startRenameFolder = (folder: NoteFolder) => {
    setRenameValue(folder.name);
    setRenameFolderOpen(true);
    setFolderMenuOpen(null);
  };

  const confirmRenameFolder = async () => {
    const folder = folderMenuOpen;
    if (!folder || !renameValue.trim()) {
      setRenameFolderOpen(false);
      return;
    }
    const res = await notesApi.updateFolder(folder.id, { name: renameValue.trim() }).catch(() => null);
    if (res?.folder) setFolders((list) => list.map((f) => (f.id === res.folder.id ? res.folder : f)));
    setRenameFolderOpen(false);
  };

  const deleteFolder = async (folder: NoteFolder) => {
    setFolderMenuOpen(null);
    if (!window.confirm(`Delete folder "${folder.name}"? Notes inside will be moved to All Notes.`)) return;
    await notesApi.deleteFolder(folder.id).catch(() => {});
    setFolders((list) => list.filter((f) => f.id !== folder.id));
    if (folderId === folder.id) setFolderId(null);
    void loadNotes();
  };

  // ===== Markdown toolbar: insert markdown at cursor =====
  const wrapSelection = (before: string, after = before, placeholder = "") => {
    const el = textareaRef.current;
    if (!el) {
      setContent((c) => c + before + placeholder + after);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = content.slice(0, start) + before + (content.slice(start, end) || placeholder) + after + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + before.length + (end - start || placeholder.length);
      el.setSelectionRange(cursor, cursor);
    });
  };

  const prefixLines = (prefix: string) => {
    const el = textareaRef.current;
    if (!el) {
      setContent((c) => c + prefix + " ");
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;
    const block = content.slice(lineStart, end);
    const replaced = block.split("\n").map((l) => (l.startsWith(prefix) ? l : prefix + l)).join("\n");
    const next = content.slice(0, lineStart) + replaced + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + replaced.length);
    });
  };

  const insertText = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      setContent((c) => c + text);
      return;
    }
    const start = el.selectionStart;
    const next = content.slice(0, start) + text + content.slice(el.selectionEnd);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const onImagePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    try {
      const { file: uploaded } = await filesApi.upload(file);
      const url = filesApi.downloadUrl(uploaded.id);
      const alt = file.name.replace(/\.[^.]+$/, "");
      insertText(`\n![${alt}](${url})\n`);
    } catch (err) {
      console.error("Image upload failed", err);
    } finally {
      e.target.value = "";
    }
  };

  const insertLink = () => {
    const url = window.prompt("Link URL");
    if (!url) return;
    const el = textareaRef.current;
    const text = el && el.selectionStart !== el.selectionEnd ? content.slice(el.selectionStart, el.selectionEnd) : window.prompt("Link text") || "link";
    insertText(`[${text}](${url})`);
  };

  // ===== AI study actions =====
  const studyFromNote = (studyMode: StudyMode) => {
    if (!selected) return;
    onOpenTool?.("study", {
      study: { mode: studyMode, sourceKind: "note", sourceId: selected.id, sourceName: selected.title || "Untitled" },
    });
    setStudyMenuOpen(false);
  };

  // ===== Export =====
  const exportMarkdown = () => {
    if (!selected) return;
    const blob = new Blob([`# ${selected.title}\n\n${selected.content}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected.title || "untitled"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setNoteMenuOpen(false);
  };

  const exportPDF = () => {
    if (!selected) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>${selected.title}</title>
      <style>body{font-family:Inter,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1e293b}
      h1,h2,h3{color:#0f172a}code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-family:monospace}
      pre{background:#f1f5f9;padding:12px;border-radius:8px;overflow-x:auto}blockquote{border-left:3px solid #cbd5e1;padding-left:16px;color:#64748b}</style>
      </head><body><h1>${selected.title}</h1><div id="c"></div>
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <script>document.getElementById('c').innerHTML=marked.parse(${JSON.stringify(selected.content)});setTimeout(()=>window.print(),300)</script>
      </body></html>`);
    w.document.close();
    setNoteMenuOpen(false);
  };

  // ===== Detail view =====
  if (view === "detail" && selected) {
    return (
      <MobileContainer>
        <MobileHeader
          compact
          title={title || "Untitled"}
          subtitle="Note"
          onBack={() => setView("list")}
          right={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNoteMenuOpen((v) => !v)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:bg-surface-3"
                aria-label="More"
              >
                <MoreVertical size={20} />
              </button>
            </div>
          }
        />

        {/* Note actions dropdown */}
        {noteMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setNoteMenuOpen(false)} />
            <div className="absolute right-5 top-20 z-50 w-56 rounded-2xl border border-edge bg-surface p-1.5 shadow-2xl">
              <button type="button" onClick={togglePin} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-ink active:bg-surface-2">
                <Pin size={16} /> {selected.pinned ? "Unpin" : "Pin"}
              </button>
              <button type="button" onClick={() => { setStudyMenuOpen(true); setNoteMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-ink active:bg-surface-2">
                <GraduationCap size={16} /> Study from note
              </button>
              <div className="my-1 border-t border-edge" />
              <button type="button" onClick={exportMarkdown} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-ink active:bg-surface-2">
                <Download size={16} /> Export Markdown
              </button>
              <button type="button" onClick={exportPDF} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-ink active:bg-surface-2">
                <FileText size={16} /> Export PDF
              </button>
              <div className="my-1 border-t border-edge" />
              <button type="button" onClick={deleteNote} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-rose-400 active:bg-surface-2">
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </>
        )}

        {/* Study mode picker */}
        <MobileModal open={studyMenuOpen} onClose={() => setStudyMenuOpen(false)} title="Study from this note">
          {([
            { id: "summarize", label: "Summarize", icon: <FileText size={18} /> },
            { id: "explain", label: "Explain", icon: <Sparkles size={18} /> },
            { id: "flashcards", label: "Make Flashcards", icon: <GraduationCap size={18} /> },
            { id: "quiz", label: "Quiz Me", icon: <GraduationCap size={18} /> },
            { id: "study_guide", label: "Add to Study Guide", icon: <FileText size={18} /> },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => studyFromNote(opt.id)}
              className="flex w-full items-center gap-3 rounded-xl bg-surface-2 px-3 py-3 text-left text-ink active:bg-surface-3"
            >
              <span className="text-accent">{opt.icon}</span>
              <span className="text-sm font-medium">{opt.label}</span>
            </button>
          ))}
        </MobileModal>

        {saving && <p className="mb-2 text-xs text-ink-muted">Saving…</p>}

        {/* Edit / Preview toggle */}
        <div className="mb-4 flex justify-center">
          <div className="inline-flex rounded-full border border-edge bg-surface-2 p-1">
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={`rounded-full px-5 py-1.5 text-sm font-medium transition ${mode === "edit" ? "bg-accent text-accent-fg" : "text-ink-muted"}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              className={`rounded-full px-5 py-1.5 text-sm font-medium transition ${mode === "preview" ? "bg-accent text-accent-fg" : "text-ink-muted"}`}
            >
              Preview
            </button>
          </div>
        </div>

        {mode === "edit" ? (
          <>
            {/* Markdown toolbar */}
            <div className="mb-3 flex gap-1 overflow-x-auto rounded-2xl border border-edge bg-surface-2 p-1.5">
              <ToolbarBtn icon={<Bold size={18} />} label="Bold" onClick={() => wrapSelection("**", "**", "bold")} />
              <ToolbarBtn icon={<Italic size={18} />} label="Italic" onClick={() => wrapSelection("*", "*", "italic")} />
              <ToolbarBtn icon={<Heading size={18} />} label="Heading" onClick={() => prefixLines("## ")} />
              <ToolbarBtn icon={<List size={18} />} label="List" onClick={() => prefixLines("- ")} />
              <ToolbarBtn icon={<Code size={18} />} label="Code" onClick={() => wrapSelection("`", "`", "code")} />
              <ToolbarBtn icon={<Link2 size={18} />} label="Link" onClick={insertLink} />
              <ToolbarBtn icon={<ImageIcon size={18} />} label="Image" onClick={() => imageInputRef.current?.click()} />
            </div>
            <input type="file" accept="image/*" ref={imageInputRef} onChange={(e) => void onImagePicked(e)} className="hidden" />
            <MobileInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title"
              className="mb-3"
            />
            {/* Tags */}
            <div className="mb-3 flex items-center gap-2 rounded-2xl border border-edge bg-surface-2 px-4 py-2.5">
              <Tag size={16} className="shrink-0 text-ink-muted" />
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Tags (comma-separated)"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
              />
            </div>
            <MobileTextarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write in markdown…"
              rows={16}
            />
          </>
        ) : (
          <div className="rounded-2xl border border-edge bg-surface-2 p-5">
            <h1 className="font-display mb-3 text-2xl font-semibold tracking-tight text-ink">{title || "Untitled"}</h1>
            {tags && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {tags.split(",").map((t) => t.trim()).filter(Boolean).map((t, i) => (
                  <span key={i} className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">#{t}</span>
                ))}
              </div>
            )}
            {content.trim() ? (
              <MobileMarkdown content={content} />
            ) : (
              <p className="text-sm text-ink-muted">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </MobileContainer>
    );
  }

  // ===== List view =====
  return (
    <MobileContainer>
      <MobileHeader
        title="Notes"
        subtitle="Capture ideas"
        onClose={onClose}
        right={<MobileFab onClick={createNote} icon={<Plus size={22} />} label="New note" />}
      />

      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-edge bg-surface-2 px-3 py-2">
        <Search size={18} className="text-ink-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes"
          className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>

      <div className="relative mb-4 flex gap-2 overflow-x-auto pb-1">
        <MobileChip active={folderId === null} onClick={() => setFolderId(null)}>All</MobileChip>
        {folders.map((f) => (
          <div key={f.id} className="relative">
            <MobileChip active={folderId === f.id} onClick={() => setFolderId(f.id)}>
              <span className="flex items-center gap-1">
                <Folder size={14} /> {f.name}
              </span>
            </MobileChip>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFolderMenuOpen(f); }}
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-ink-muted active:bg-surface-3"
              aria-label="Folder options"
            >
              <MoreVertical size={11} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={createFolder}
          className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-4 py-2 text-sm font-medium text-ink-muted active:bg-surface-3"
        >
          <Plus size={14} /> New
        </button>
      </div>

      {/* Folder context menu */}
      {folderMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFolderMenuOpen(null)} />
          <div className="absolute left-5 top-44 z-50 w-44 rounded-2xl border border-edge bg-surface p-1.5 shadow-2xl">
            <button type="button" onClick={() => startRenameFolder(folderMenuOpen)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-ink active:bg-surface-2">
              Rename
            </button>
            <button type="button" onClick={() => deleteFolder(folderMenuOpen)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-rose-400 active:bg-surface-2">
              Delete
            </button>
          </div>
        </>
      )}

      {/* Folder rename modal */}
      <MobileModal
        open={renameFolderOpen}
        onClose={() => setRenameFolderOpen(false)}
        title="Rename folder"
        footer={
          <>
            <MobileButton variant="ghost" onClick={() => setRenameFolderOpen(false)}>Cancel</MobileButton>
            <MobileButton onClick={() => void confirmRenameFolder()}>Save</MobileButton>
          </>
        }
      >
        <MobileInput value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="Folder name" autoFocus />
      </MobileModal>

      <div className="space-y-2">
        {loading ? (
          <MobileLoading />
        ) : notes.length ? (
          notes.map((note) => {
            const stripped = note.content.replace(/[#*`>\-]/g, "").trim();
            return (
              <MobileCard key={note.id} onClick={() => openDetail(note)}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{note.title || "Untitled"}</span>
                  {note.pinned && <Pin size={16} className="shrink-0 text-accent" />}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{stripped || "Empty note"}</p>
                <div className="mt-2 flex items-center gap-2">
                  <p className="text-[11px] text-ink-muted">{new Date(note.updatedAt).toLocaleDateString()}</p>
                  {note.tags && note.tags.trim() && (
                    <div className="flex flex-wrap gap-1">
                      {note.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 2).map((t, i) => (
                        <span key={i} className="rounded-full bg-accent/15 px-2 py-0 text-[10px] font-medium text-accent">#{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </MobileCard>
            );
          })
        ) : (
          <MobileEmpty text="No notes yet. Tap + to capture an idea." />
        )}
      </div>
    </MobileContainer>
  );
}

function ToolbarBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-muted active:bg-surface-3 active:text-ink"
    >
      {icon}
    </button>
  );
}
