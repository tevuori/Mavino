import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, ArrowLeft, Pencil, Trash2, Loader2, AlertCircle } from "lucide-react";
import type { WindowInstance } from "../../store/windows";
import { useWindows } from "../../store/windows";
import { confirmDialog, promptDialog } from "../../store/mobileDialog";
import { whiteboardsApi } from "../../services/whiteboards";
import type { WhiteboardSummary } from "../../types";
import type { WhiteboardElement, Tool, ImageEl } from "./elements";
import { serialize, deserialize, newId, downscaleDataUrl } from "./elements";
import Canvas from "./Canvas";
import Toolbar from "./Toolbar";

const CANVAS_W = 2000;
const CANVAS_H = 1400;

type View = "list" | "editor";

export default function WhiteboardApp({ win }: { win: WindowInstance }) {
  const [view, setView] = useState<View>("list");
  const [boards, setBoards] = useState<WhiteboardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state
  const [boardId, setBoardId] = useState<string | null>(null);
  const [boardName, setBoardName] = useState("Untitled");
  const [elements, setElements] = useState<WhiteboardElement[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#111827");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [fill, setFill] = useState("none");
  const [fontSize, setFontSize] = useState(36);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Undo / redo
  const [undoStack, setUndoStack] = useState<WhiteboardElement[][]>([]);
  const [redoStack, setRedoStack] = useState<WhiteboardElement[][]>([]);

  // Save state
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTitle = useWindows((s) => s.setTitle);

  const loadBoards = useCallback(async () => {
    setLoading(true);
    try {
      const { whiteboards } = await whiteboardsApi.list();
      setBoards(whiteboards);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  // Dirty indicator in window title
  useEffect(() => {
    if (view !== "editor") return;
    setTitle(win.id, `${dirty ? "● " : ""}${boardName} — Whiteboard`);
  }, [dirty, boardName, view, win.id, setTitle]);

  const openBoard = useCallback(async (id: string) => {
    setError(null);
    try {
      const { whiteboard } = await whiteboardsApi.get(id);
      setBoardId(whiteboard.id);
      setBoardName(whiteboard.name);
      setElements(deserialize(whiteboard.content));
      setUndoStack([]);
      setRedoStack([]);
      setDirty(false);
      setSelectedId(null);
      setView("editor");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const createBoard = useCallback(async () => {
    setError(null);
    try {
      const { whiteboard } = await whiteboardsApi.create({ name: "Untitled", content: "[]" });
      setBoards((b) => [
        { id: whiteboard.id, name: whiteboard.name, createdAt: whiteboard.createdAt, updatedAt: whiteboard.updatedAt },
        ...b,
      ]);
      setBoardId(whiteboard.id);
      setBoardName(whiteboard.name);
      setElements([]);
      setUndoStack([]);
      setRedoStack([]);
      setDirty(false);
      setSelectedId(null);
      setView("editor");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const deleteBoard = useCallback(async (id: string) => {
    if (!(await confirmDialog("Delete this whiteboard? This cannot be undone.", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await whiteboardsApi.delete(id);
      setBoards((b) => b.filter((x) => x.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const renameBoard = useCallback(async (id: string, name: string) => {
    try {
      await whiteboardsApi.update(id, { name });
      setBoards((b) => b.map((x) => (x.id === id ? { ...x, name } : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // ---- Commit / undo / redo ----
  const commit = useCallback((prev: WhiteboardElement[], next: WhiteboardElement[]) => {
    setUndoStack((u) => [...u, prev]);
    setRedoStack([]);
    setElements(next);
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const prev = u[u.length - 1];
      setRedoStack((r) => [elements, ...r]);
      setElements(prev);
      setDirty(true);
      setSelectedId(null);
      return u.slice(0, -1);
    });
  }, [elements]);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[0];
      setUndoStack((u) => [...u, elements]);
      setElements(next);
      setDirty(true);
      setSelectedId(null);
      return r.slice(1);
    });
  }, [elements]);

  const clearCanvas = useCallback(async () => {
    if (elements.length === 0) return;
    if (!(await confirmDialog("Clear the entire canvas?", { danger: true, confirmLabel: "Clear" }))) return;
    commit(elements, []);
    setSelectedId(null);
  }, [elements, commit]);

  // ---- Save ----
  const save = useCallback(async () => {
    if (!boardId) return;
    setSaving(true);
    try {
      await whiteboardsApi.update(boardId, {
        name: boardName,
        content: serialize(elements),
      });
      setDirty(false);
      setBoards((b) =>
        b.map((x) => (x.id === boardId ? { ...x, name: boardName, updatedAt: new Date().toISOString() } : x))
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [boardId, boardName, elements]);

  // Debounced auto-save
  useEffect(() => {
    if (!dirty || !boardId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      save();
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, boardId, elements, save]);

  // ---- Keyboard shortcuts (undo/redo/save) ----
  useEffect(() => {
    if (view !== "editor") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, undo, redo, save]);

  // ---- Clipboard image paste ----
  useEffect(() => {
    if (view !== "editor") return;
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = async () => {
            const href = await downscaleDataUrl(reader.result as string);
            const el: ImageEl = {
              id: newId(),
              type: "image",
              x: CANVAS_W / 2 - 150,
              y: CANVAS_H / 2 - 100,
              w: 300,
              h: 200,
              href,
            };
            commit(elements, [...elements, el]);
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          break;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [view, elements, commit]);

  // ---- Export ----
  const buildSvgString = useCallback((): string => {
    const svg = document.querySelector(".whiteboard-canvas-svg");
    if (svg) {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      return new XMLSerializer().serializeToString(clone);
    }
    return "";
  }, []);

  const download = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  const exportSvg = useCallback(() => {
    const str = buildSvgString();
    if (!str) return;
    const blob = new Blob([str], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    download(url, `${sanitize(boardName)}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [boardName, buildSvgString]);

  const exportPng = useCallback(() => {
    const str = buildSvgString();
    if (!str) return;
    const svgBlob = new Blob([str], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        download(pngUrl, `${sanitize(boardName)}.png`);
        setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
      }, "image/png");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [boardName, buildSvgString]);

  // Auto-open a specific board via payload
  useEffect(() => {
    const p = win.payload as { boardId?: string } | undefined;
    if (p?.boardId && view === "list" && !loading) {
      openBoard(p.boardId);
    }
  }, [win.payload, view, loading, openBoard]);

  if (view === "list") {
    return (
      <BoardList
        boards={boards}
        loading={loading}
        error={error}
        onOpen={openBoard}
        onCreate={createBoard}
        onDelete={deleteBoard}
        onRename={renameBoard}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        fill={fill}
        setFill={setFill}
        fontSize={fontSize}
        setFontSize={setFontSize}
        onUndo={undo}
        onRedo={redo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onClear={clearCanvas}
        onExportSvg={exportSvg}
        onExportPng={exportPng}
        onSave={save}
        saving={saving}
      />
      {/* Editor header: back, name, save status */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
        <button
          onClick={() => {
            if (dirty) save();
            setView("list");
          }}
          className="p-1.5 rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          title="Back to list"
        >
          <ArrowLeft size={18} />
        </button>
        <input
          value={boardName}
          onChange={(e) => {
            setBoardName(e.target.value);
            setDirty(true);
          }}
          onBlur={() => boardId && renameBoard(boardId, boardName)}
          className="flex-1 bg-transparent text-sm font-medium text-zinc-800 dark:text-zinc-100 outline-none border-b border-transparent focus:border-indigo-500"
        />
        <span className="text-xs text-zinc-400">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
        </span>
      </div>
      {/* Canvas */}
      <div className="flex-1 min-h-0 overflow-hidden bg-zinc-100 dark:bg-zinc-800 p-2">
        <div className="w-full h-full rounded-lg overflow-hidden shadow-inner">
          <Canvas
            elements={elements}
            tool={tool}
            color={color}
            strokeWidth={strokeWidth}
            fill={fill}
            fontSize={fontSize}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={setElements}
            onCommit={commit}
          />
        </div>
      </div>
      {error && (
        <div className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5 border-t border-red-200 dark:border-red-900">
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </div>
  );
}

function BoardList({
  boards, loading, error, onOpen, onCreate, onDelete, onRename,
}: {
  boards: WhiteboardSummary[];
  loading: boolean;
  error: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Whiteboards</h2>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors"
        >
          <Plus size={16} /> New
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center text-zinc-400">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : boards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2">
            <Pencil size={32} />
            <p className="text-sm">No whiteboards yet. Click "New" to create one.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {boards.map((b) => (
              <div
                key={b.id}
                className="group relative rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => onOpen(b.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-100 truncate">
                      {b.name}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-1">
                      {new Date(b.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const name = await promptDialog("Rename whiteboard:", b.name);
                      if (name && name.trim()) onRename(b.id, name.trim());
                    }}
                    className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    title="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(b.id);
                    }}
                    className="p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="mt-3 text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>
    </div>
  );
}

function sanitize(name: string): string {
  return (name || "whiteboard").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
}
