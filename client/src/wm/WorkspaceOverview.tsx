// ===== Workspace Overview overlay (GNOME Activities-style) =====
// Full-screen overlay showing all workspaces as a vertical stack of horizontal
// strips. Each strip shows its windows as labeled cards. Click a strip to
// switch; drag a card to another strip to move the window; rename inline;
// delete/reorder via buttons. A "+" strip creates a new workspace.

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, ChevronUp, ChevronDown, X } from "lucide-react";
import { renderAppIcon } from "../shell/AppIcon";
import { useWindows, type WindowInstance } from "../store/windows";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function WorkspaceOverview({ open, onClose }: Props) {
  const workspaces = useWindows((s) => s.workspaces);
  const windows = useWindows((s) => s.windows);
  const activeWorkspaceId = useWindows((s) => s.activeWorkspaceId);
  const switchWorkspace = useWindows((s) => s.switchWorkspace);
  const focus = useWindows((s) => s.focus);
  const moveWindowToWorkspace = useWindows((s) => s.moveWindowToWorkspace);
  const createWorkspace = useWindows((s) => s.createWorkspace);
  const renameWorkspace = useWindows((s) => s.renameWorkspace);
  const removeWorkspace = useWindows((s) => s.removeWorkspace);
  const reorderWorkspace = useWindows((s) => s.reorderWorkspace);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragWinId, setDragWinId] = useState<string | null>(null);
  const [dragOverWs, setDragOverWs] = useState<string | null>(null);
  const dragWinIdRef = useRef<string | null>(null);
  dragWinIdRef.current = dragWinId;

  const windowsOn = (wsId: string) => windows.filter((w) => w.workspaceId === wsId);

  const handleSwitchAndClose = (wsId: string) => {
    switchWorkspace(wsId);
    onClose();
  };

  const handleCardClick = (win: WindowInstance) => {
    if (win.workspaceId !== activeWorkspaceId) {
      switchWorkspace(win.workspaceId);
    }
    focus(win.id);
    onClose();
  };

  const commitRename = (wsId: string) => {
    renameWorkspace(wsId, renameValue);
    setRenaming(null);
    setRenameValue("");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[13000] flex flex-col bg-black/70 backdrop-blur-md"
          onClick={onClose}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">Workspaces</h2>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
              title="Close (Esc)"
            >
              <X size={20} />
            </button>
          </div>

          {/* Workspace strips */}
          <div
            className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            {workspaces.map((ws, i) => {
              const wsWindows = windowsOn(ws.id);
              const isActive = ws.id === activeWorkspaceId;
              const isDragOver = dragOverWs === ws.id;
              const isRenaming = renaming === ws.id;
              return (
                <div
                  key={ws.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverWs !== ws.id) setDragOverWs(ws.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverWs === ws.id) setDragOverWs(null);
                  }}
                  onDrop={() => {
                    const id = dragWinIdRef.current;
                    if (id) moveWindowToWorkspace(id, ws.id);
                    setDragOverWs(null);
                    setDragWinId(null);
                  }}
                  className={`flex flex-col gap-2 rounded-xl border p-3 transition ${
                    isActive
                      ? "border-accent/50 bg-accent/5"
                      : isDragOver
                        ? "border-accent bg-accent/10"
                        : "border-white/10 bg-white/5"
                  }`}
                >
                  {/* Strip header */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSwitchAndClose(ws.id)}
                      className="flex items-center gap-2 text-left"
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${
                          isActive ? "bg-accent text-accent-fg" : "bg-white/10 text-white/80"
                        }`}
                      >
                        {i + 1}
                      </span>
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(ws.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(ws.id);
                            if (e.key === "Escape") {
                              setRenaming(null);
                              setRenameValue("");
                            }
                          }}
                          className="w-40 rounded border border-accent bg-surface px-2 py-0.5 text-sm text-ink outline-none"
                          placeholder="Workspace name"
                        />
                      ) : (
                        <span
                          className="cursor-text text-sm font-medium text-white hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenaming(ws.id);
                            setRenameValue(ws.name);
                          }}
                        >
                          {ws.name}
                        </span>
                      )}
                    </button>
                    <span className="text-xs text-white/40">
                      {wsWindows.length} {wsWindows.length === 1 ? "window" : "windows"}
                    </span>
                    <div className="ml-auto flex items-center gap-0.5">
                      <button
                        onClick={() => reorderWorkspace(ws.id, -1)}
                        disabled={i === 0}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                        title="Move up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        onClick={() => reorderWorkspace(ws.id, 1)}
                        disabled={i === workspaces.length - 1}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
                        title="Move down"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        onClick={() => removeWorkspace(ws.id)}
                        disabled={workspaces.length <= 1}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition hover:bg-red-500 hover:text-white disabled:opacity-30"
                        title="Delete workspace"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Window cards */}
                  <div className="flex min-h-[60px] flex-wrap gap-2">
                    {wsWindows.length === 0 ? (
                      <div className="flex w-full items-center justify-center rounded-lg border border-dashed border-white/10 py-4 text-xs text-white/30">
                        {isDragOver ? "Drop here" : "Empty workspace"}
                      </div>
                    ) : (
                      wsWindows.map((win) => (
                        <div
                          key={win.id}
                          draggable
                          onDragStart={() => setDragWinId(win.id)}
                          onDragEnd={() => {
                            setDragWinId(null);
                            setDragOverWs(null);
                          }}
                          onClick={() => handleCardClick(win)}
                          className="flex w-36 cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 p-3 text-center transition hover:border-accent/50 hover:bg-accent/10"
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white">
                            {renderAppIcon(win.appId, { size: 18 })}
                          </div>
                          <span className="line-clamp-2 text-[11px] text-white/80">
                            {win.title}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}

            {/* "+" strip to create a new workspace */}
            <button
              onClick={() => {
                const id = createWorkspace();
                // Don't close — let the user see the new workspace and add windows.
                void id;
              }}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-4 text-sm text-white/50 transition hover:border-accent/50 hover:bg-white/5 hover:text-white"
            >
              <Plus size={16} /> Add workspace
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
