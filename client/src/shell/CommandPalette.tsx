import { useState, useEffect, useRef, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search, CornerDownLeft, AppWindow, StickyNote, CheckSquare,
  Calculator, Play, Brain, GraduationCap, Timer, Folder, Settings as SettingsIcon,
  FileText, Image as ImageIcon, FileCode, Eye, Code2, Music as MusicIcon, Video as VideoIcon,
  Calendar, Flame, Zap,
} from "lucide-react";
import { useWindows, type AppId } from "../store/windows";
import { useAccessibleApps } from "../store/features";
import { api } from "../services/api";
import { openTargetForFile, isImageFile, isPdfFile, isAudioFile, isVideoFile, isTextFile } from "../services/files";
import { useShortcut, formatShortcut } from "../store/shortcuts";
import { useQuickCapture } from "../store/quickCapture";
import { useSettings } from "../store/settings";
import type { Note, Task, VFile } from "../types";

interface SearchResult {
  id: string;
  type: "app" | "note" | "task" | "action" | "calc" | "file";
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  action: () => void;
}

/** Try to evaluate a math expression safely. */
function tryCalculate(input: string): string | null {
  const trimmed = input.trim();
  // Only allow numbers, operators, parens, decimal points, spaces, and common math functions
  if (!/^[\d+\-*/().%\s,e]*(sin|cos|tan|sqrt|abs|pow|log|ln|pi|e)?[\d+\-*/().%\s,e]*$/.test(trimmed)) {
    // More permissive check for basic arithmetic
    if (!/^[\d+\-*/().\s]+$/.test(trimmed)) return null;
  }
  try {
    // Replace common math tokens
    let expr = trimmed
      .replace(/\^/g, "**")
      .replace(/%/g, "/100");
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr})`)();
    if (typeof result === "number" && isFinite(result)) {
      return String(Math.round(result * 1e10) / 1e10);
    }
  } catch {
    return null;
  }
  return null;
}

const APP_ICONS: Record<string, React.ReactNode> = {
  notes: <StickyNote size={18} />,
  tasks: <CheckSquare size={18} />,
  files: <Folder size={18} />,
  settings: <SettingsIcon size={18} />,
  pomodoro: <Timer size={18} />,
  flashcards: <Brain size={18} />,
  grades: <GraduationCap size={18} />,
  editor: <Code2 size={18} />,
  viewer: <Eye size={18} />,
};

function fileIcon(file: VFile): React.ReactNode {
  if (isImageFile(file)) return <ImageIcon size={18} className="text-green-400" />;
  if (isPdfFile(file)) return <FileText size={18} className="text-red-400" />;
  if (isAudioFile(file)) return <MusicIcon size={18} className="text-purple-400" />;
  if (isVideoFile(file)) return <VideoIcon size={18} className="text-pink-400" />;
  if (isTextFile(file)) return <FileCode size={18} className="text-blue-400" />;
  return <FileText size={18} className="text-ink-muted" />;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [fileList, setFileList] = useState<VFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { open: openWindow } = useWindows();
  const apps = useAccessibleApps();

  // Load notes + tasks + files when palette opens
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    Promise.all([
      api.get<{ notes: Note[] }>("/api/notes").catch(() => ({ notes: [] })),
      api.get<{ tasks: Task[] }>("/api/tasks").catch(() => ({ tasks: [] })),
      api.get<{ files: VFile[] }>("/api/files/all").catch(() => ({ files: [] })),
    ]).then(([n, t, f]) => {
      setNotes(n.notes ?? []);
      setTasks(t.tasks ?? []);
      setFileList(f.files ?? []);
    });
  }, [open]);

  // Configurable keyboard shortcut for command palette toggle
  useShortcut("toggleCommandPalette", () => setOpen((v) => !v));

  // Escape closes the palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    const out: SearchResult[] = [];

    // Calculator result (if query looks like math)
    if (q) {
      const calc = tryCalculate(query);
      if (calc !== null) {
        out.push({
          id: "calc",
          type: "calc",
          title: `= ${calc}`,
          subtitle: "Calculator",
          icon: <Calculator size={18} className="text-accent" />,
          action: () => {
            navigator.clipboard?.writeText(calc).catch(() => {});
            setOpen(false);
          },
        });
      }
    }

    // Apps
    for (const app of apps) {
      if (!q || app.name.toLowerCase().includes(q)) {
        out.push({
          id: `app-${app.id}`,
          type: "app",
          title: app.name,
          subtitle: "Application",
          icon: APP_ICONS[app.id] ?? <AppWindow size={18} />,
          action: () => {
            openWindow({ appId: app.id as AppId, title: app.name, icon: app.icon });
            setOpen(false);
          },
        });
      }
    }

    // Quick actions
    const quickActions: { title: string; subtitle: string; icon: React.ReactNode; action: () => void; keywords: string[] }[] = [
      {
        title: "New Note",
        subtitle: "Create a note",
        icon: <StickyNote size={18} className="text-amber-400" />,
        action: () => {
          openWindow({ appId: "notes", title: "Notes", icon: "StickyNote" });
          setOpen(false);
        },
        keywords: ["note", "create", "write"],
      },
      {
        title: "New Task",
        subtitle: "Create a task",
        icon: <CheckSquare size={18} className="text-green-400" />,
        action: () => {
          openWindow({ appId: "tasks", title: "Tasks", icon: "CheckSquare" });
          setOpen(false);
        },
        keywords: ["task", "todo", "create"],
      },
      {
        title: "Start Pomodoro",
        subtitle: "Begin a focus session",
        icon: <Timer size={18} className="text-red-400" />,
        action: () => {
          openWindow({ appId: "pomodoro", title: "Pomodoro", icon: "Timer" });
          setOpen(false);
        },
        keywords: ["pomodoro", "focus", "timer", "study"],
      },
      {
        title: "Review Flashcards",
        subtitle: "Study due cards",
        icon: <Brain size={18} className="text-purple-400" />,
        action: () => {
          openWindow({ appId: "flashcards", title: "Flashcards", icon: "Brain" });
          setOpen(false);
        },
        keywords: ["flashcard", "review", "study", "quiz"],
      },
      {
        title: "Study Hub: Summarize from clipboard",
        subtitle: "Paste text and get an AI summary",
        icon: <GraduationCap size={18} className="text-sky-400" />,
        action: async () => {
          const text = await navigator.clipboard.readText().catch(() => "");
          openWindow({
            appId: "study",
            title: "Study Hub",
            icon: "GraduationCap",
            payload: text.trim()
              ? { mode: "summarize", sourceKind: "paste", text: text.trim() }
              : { mode: "summarize" },
          });
          setOpen(false);
        },
        keywords: ["study", "summarize", "summary", "tldr", "clipboard", "paste"],
      },
      {
        title: "Study Hub: Quiz me on clipboard",
        subtitle: "Paste text and take an AI quiz",
        icon: <GraduationCap size={18} className="text-amber-400" />,
        action: async () => {
          const text = await navigator.clipboard.readText().catch(() => "");
          openWindow({
            appId: "study",
            title: "Study Hub",
            icon: "GraduationCap",
            payload: text.trim()
              ? { mode: "quiz", sourceKind: "paste", text: text.trim() }
              : { mode: "quiz" },
          });
          setOpen(false);
        },
        keywords: ["study", "quiz", "test", "clipboard", "paste"],
      },
      {
        title: "Study Hub: Flashcards from clipboard",
        subtitle: "Paste text and generate AI flashcards",
        icon: <GraduationCap size={18} className="text-indigo-400" />,
        action: async () => {
          const text = await navigator.clipboard.readText().catch(() => "");
          openWindow({
            appId: "study",
            title: "Study Hub",
            icon: "GraduationCap",
            payload: text.trim()
              ? { mode: "flashcards", sourceKind: "paste", text: text.trim() }
              : { mode: "flashcards" },
          });
          setOpen(false);
        },
        keywords: ["study", "flashcard", "generate", "clipboard", "paste"],
      },
      {
        title: "Open Calendar",
        subtitle: "View schedule",
        icon: <Calendar size={18} className="text-indigo-400" />,
        action: () => {
          openWindow({ appId: "calendar", title: "Calendar", icon: "Calendar" });
          setOpen(false);
        },
        keywords: ["calendar", "schedule", "event", "planner"],
      },
      {
        title: "Open Habits",
        subtitle: "Track streaks",
        icon: <Flame size={18} className="text-orange-400" />,
        action: () => {
          openWindow({ appId: "habits", title: "Habits", icon: "Flame" });
          setOpen(false);
        },
        keywords: ["habit", "streak", "tracker", "daily"],
      },
      {
        title: "Quick Capture",
        subtitle: `Capture anything (${formatShortcut(useSettings.getState().shortcuts.toggleQuickCapture)})`,
        icon: <Zap size={18} className="text-yellow-400" />,
        action: () => {
          useQuickCapture.getState().toggle();
          setOpen(false);
        },
        keywords: ["capture", "quick", "inbox", "idea", "note", "task"],
      },
    ];
    for (const qa of quickActions) {
      if (!q || qa.title.toLowerCase().includes(q) || qa.keywords.some((k) => k.includes(q))) {
        out.push({
          id: `action-${qa.title}`,
          type: "action",
          title: qa.title,
          subtitle: qa.subtitle,
          icon: qa.icon,
          action: qa.action,
        });
      }
    }

    // Notes
    if (q) {
      for (const note of notes.slice(0, 8)) {
        if (note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q)) {
          out.push({
            id: `note-${note.id}`,
            type: "note",
            title: note.title || "Untitled",
            subtitle: "Note",
            icon: <StickyNote size={18} className="text-amber-400" />,
            action: () => {
              openWindow({
                appId: "notes",
                title: "Notes",
                icon: "StickyNote",
                payload: { noteId: note.id },
              });
              setOpen(false);
            },
          });
        }
      }
      // Tasks
      for (const task of tasks.slice(0, 8)) {
        if (task.title.toLowerCase().includes(q)) {
          out.push({
            id: `task-${task.id}`,
            type: "task",
            title: task.title,
            subtitle: `Task · ${task.status.replace("_", " ")}`,
            icon: <CheckSquare size={18} className="text-green-400" />,
            action: () => {
              openWindow({ appId: "tasks", title: "Tasks", icon: "CheckSquare" });
              setOpen(false);
            },
          });
        }
      }
      // Files
      for (const file of fileList.slice(0, 20)) {
        if (file.name.toLowerCase().includes(q)) {
          const target = openTargetForFile(file);
          out.push({
            id: `file-${file.id}`,
            type: "file",
            title: file.name,
            subtitle: target === "editor" ? "Open in Editor" : "Open in Viewer",
            icon: fileIcon(file),
            action: () => {
              openWindow({
                appId: target,
                title: file.name,
                icon: target === "editor" ? "Code2" : "Eye",
                payload: { fileId: file.id },
              });
              setOpen(false);
            },
          });
        }
      }
    }

    return out.slice(0, 12);
  }, [query, notes, tasks, fileList, openWindow, apps]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[selectedIndex]?.action();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[14000] flex items-start justify-center pt-[15vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ y: -20, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-edge bg-surface/95 shadow-window backdrop-blur-xl"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-edge px-4 py-3.5">
              <Search size={20} className="text-ink-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search apps, files, notes, tasks, or calculate..."
                className="flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
              />
              <kbd className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-muted">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-muted">
                  No results{query ? ` for "${query}"` : ""}
                </p>
              ) : (
                results.map((r, i) => (
                  <button
                    key={r.id}
                    data-idx={i}
                    onClick={() => r.action()}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                      i === selectedIndex ? "bg-accent/15" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      i === selectedIndex ? "bg-accent/20" : "bg-surface-2"
                    }`}>
                      {r.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${r.type === "calc" ? "font-mono text-accent" : "text-ink"}`}>
                        {r.title}
                      </p>
                      <p className="truncate text-xs text-ink-muted">{r.subtitle}</p>
                    </div>
                    {i === selectedIndex && (
                      <CornerDownLeft size={14} className="text-ink-muted" />
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-edge px-4 py-2 text-[10px] text-ink-muted">
              <span className="flex items-center gap-2">
                <kbd className="rounded border border-edge px-1 py-0.5">↑↓</kbd> navigate
                <kbd className="rounded border border-edge px-1 py-0.5">↵</kbd> select
              </span>
              <span>{results.length} results</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
