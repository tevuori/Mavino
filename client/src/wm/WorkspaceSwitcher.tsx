// ===== Workspace switcher pills (GNOME-style) =====
// Renders one pill per workspace in the taskbar. Click to switch; right-click
// for a context menu (Rename / Delete / Move left / Move right). A "+" button
// creates a new workspace. An "Overview" button toggles the full overview.

import { useState } from "react";
import { Plus, LayoutGrid } from "lucide-react";
import { useWindows } from "../store/windows";
import ContextMenu, { type MenuItem } from "../shell/ContextMenu";

interface Props {
  onOpenOverview: () => void;
}

export default function WorkspaceSwitcher({ onOpenOverview }: Props) {
  const workspaces = useWindows((s) => s.workspaces);
  const activeWorkspaceId = useWindows((s) => s.activeWorkspaceId);
  // Only needs per-workspace window membership — a scalar key keeps this
  // from re-rendering on every rect change while dragging windows.
  useWindows((s) => s.windows.map((w) => w.workspaceId).join(","));
  const windows = useWindows.getState().windows;
  const switchWorkspace = useWindows((s) => s.switchWorkspace);
  const createWorkspace = useWindows((s) => s.createWorkspace);
  const renameWorkspace = useWindows((s) => s.renameWorkspace);
  const removeWorkspace = useWindows((s) => s.removeWorkspace);
  const reorderWorkspace = useWindows((s) => s.reorderWorkspace);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; wsId: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const windowCount = (wsId: string) =>
    windows.filter((w) => w.workspaceId === wsId).length;

  const startRename = (wsId: string, currentName: string) => {
    setRenaming(wsId);
    setRenameValue(currentName);
    setCtxMenu(null);
  };

  const commitRename = () => {
    if (renaming) {
      renameWorkspace(renaming, renameValue);
    }
    setRenaming(null);
    setRenameValue("");
  };

  const ctxItems: MenuItem[] = ctxMenu
    ? [
        {
          label: "Rename",
          onClick: () => {
            const ws = workspaces.find((w) => w.id === ctxMenu.wsId);
            if (ws) startRename(ws.id, ws.name);
          },
        },
        {
          label: "Move left",
          disabled: ctxMenu.wsId === workspaces[0]?.id,
          onClick: () => {
            reorderWorkspace(ctxMenu.wsId, -1);
            setCtxMenu(null);
          },
        },
        {
          label: "Move right",
          disabled: ctxMenu.wsId === workspaces[workspaces.length - 1]?.id,
          onClick: () => {
            reorderWorkspace(ctxMenu.wsId, 1);
            setCtxMenu(null);
          },
        },
        { separator: true },
        {
          label: "Delete",
          danger: true,
          disabled: workspaces.length <= 1,
          onClick: () => {
            removeWorkspace(ctxMenu.wsId);
            setCtxMenu(null);
          },
        },
      ]
    : [];

  return (
    <div className="flex items-center gap-0.5">
      {workspaces.map((ws, i) => {
        const isActive = ws.id === activeWorkspaceId;
        const count = windowCount(ws.id);
        const isRenaming = renaming === ws.id;
        return (
          <button
            key={ws.id}
            onClick={() => switchWorkspace(ws.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu({ x: e.clientX, y: e.clientY, wsId: ws.id });
            }}
            className={`group relative flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[11px] font-medium transition ${
              isActive
                ? "bg-accent/20 text-accent"
                : "text-ink-muted hover:bg-surface-3 hover:text-ink"
            }`}
            title={ws.name}
          >
            {isRenaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setRenaming(null);
                    setRenameValue("");
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-16 rounded border border-accent bg-surface px-1 text-[11px] text-ink outline-none"
                placeholder="Name"
              />
            ) : (
              <>
                <span>{i + 1}</span>
                {count > 0 && (
                  <span
                    className={`ml-1 h-1.5 w-1.5 rounded-full ${
                      isActive ? "bg-accent" : "bg-ink-muted/50"
                    }`}
                  />
                )}
              </>
            )}
          </button>
        );
      })}

      <button
        onClick={() => createWorkspace()}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-surface-3 hover:text-ink"
        title="New workspace"
      >
        <Plus size={14} />
      </button>

      <button
        onClick={onOpenOverview}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition hover:bg-surface-3 hover:text-ink"
        title="Workspace overview (Alt+Space)"
      >
        <LayoutGrid size={14} />
      </button>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
