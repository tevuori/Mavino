import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare, FileText, Search, StickyNote, X,
} from "lucide-react";
import { api } from "../services/api";
import { isImageFile, isPdfFile, isTextFile } from "../services/files";
import type { Note, Task, VFile } from "../types";
import type { MobileTool } from "./MobileLauncher";
import type { MobileToolPayload } from "./MobileToolPage";

interface SearchResult {
  id: string;
  kind: "note" | "task" | "file";
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  action: () => void;
}

export default function MobileSearch({
  onOpenTool,
}: {
  onOpenTool: (tool: MobileTool, payload?: MobileToolPayload) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [files, setFiles] = useState<VFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    const [n, t, f] = await Promise.all([
      api.get<{ notes: Note[] }>("/api/notes").catch(() => ({ notes: [] as Note[] })),
      api.get<{ tasks: Task[] }>("/api/tasks").catch(() => ({ tasks: [] as Task[] })),
      api.get<{ files: VFile[] }>("/api/files/all").catch(() => ({ files: [] as VFile[] })),
    ]);
    setNotes(n.notes ?? []);
    setTasks(t.tasks ?? []);
    setFiles(f.files ?? []);
  }, []);

  useEffect(() => {
    if (expanded) {
      void loadData();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [expanded, loadData]);

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const out: SearchResult[] = [];

    for (const n of notes) {
      if (out.length >= 20) break;
      if (n.title.toLowerCase().includes(q) || (n.content && n.content.toLowerCase().includes(q))) {
        out.push({
          id: `note-${n.id}`,
          kind: "note",
          title: n.title || "Untitled",
          subtitle: n.content?.slice(0, 60) || "Note",
          icon: <StickyNote size={16} className="text-amber-400" />,
          action: () => { onOpenTool("notes"); setExpanded(false); setQuery(""); },
        });
      }
    }

    for (const t of tasks) {
      if (out.length >= 20) break;
      if (t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q))) {
        out.push({
          id: `task-${t.id}`,
          kind: "task",
          title: t.title,
          subtitle: t.status === "DONE" ? "Completed" : t.dueDate ? `Due ${new Date(t.dueDate).toLocaleDateString()}` : "Task",
          icon: <CheckSquare size={16} className={t.status === "DONE" ? "text-emerald-400" : "text-sky-400"} />,
          action: () => { setExpanded(false); setQuery(""); },
        });
      }
    }

    for (const f of files) {
      if (out.length >= 20) break;
      if (f.name.toLowerCase().includes(q)) {
        out.push({
          id: `file-${f.id}`,
          kind: "file",
          title: f.name,
          subtitle: `${(f.size / 1024).toFixed(0)} KB`,
          icon: <FileText size={16} className="text-blue-400" />,
          action: () => { onOpenTool("files"); setExpanded(false); setQuery(""); },
        });
      }
    }

    return out;
  }, [query, notes, tasks, files, onOpenTool]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-left active:bg-surface-3"
      >
        <Search size={18} className="text-ink-muted" />
        <span className="text-sm text-ink-muted">Search notes, tasks, files...</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-edge px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <Search size={18} className="shrink-0 text-ink-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes, tasks, files..."
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        <button
          type="button"
          onClick={() => { setExpanded(false); setQuery(""); }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-ink-muted active:bg-surface-2"
        >
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {query.trim() && results.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-muted">No results for "{query}"</p>
        )}
        {results.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={r.action}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-surface-2"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2">
              {r.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{r.title}</p>
              <p className="truncate text-xs text-ink-muted">{r.subtitle}</p>
            </div>
            <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-muted">
              {r.kind}
            </span>
          </button>
        ))}
        {!query.trim() && (
          <p className="py-8 text-center text-sm text-ink-muted">Type to search across all your content</p>
        )}
      </div>
    </div>
  );
}
