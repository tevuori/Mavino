import { create } from "zustand";
import { isAppAccessible, isAppAvailable } from "./features";

export type AppId =
  | "notes"
  | "tasks"
  | "files"
  | "settings"
  | "terminal"
  | "pomodoro"
  | "flashcards"
  | "grades"
  | "vut"
  | "editor"
  | "viewer"
  | "athena"
  | "study"
  | "today"
  | "calendar"
  | "habits"
  | "whiteboard"
  | "ntfy"
  | "voice"
  | "browser"
  | "reminders"
  | "analytics"
  | "moodle"
  | "maps"
  | "plans"
  | "marketplace"
  | "atlas"
  | "crunch"
  | "echo"
  // Plugin apps use synthetic ids of the form `plugin:<pluginKey>`. The
  // `(string & {})` catch-all preserves autocomplete for the literal union
  // above while allowing any string for dynamically-installed plugins.
  | (string & {});

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SnapZone =
  | "none"
  | "left"
  | "right"
  | "maximized"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface WindowInstance {
  id: string; // unique instance id (allows multiple windows of same app)
  appId: AppId;
  title: string;
  icon: string; // lucide icon name
  rect: WindowRect;
  prevRect?: WindowRect; // saved before maximize/snap
  snap: SnapZone;
  zIndex: number;
  minimized: boolean;
  closing: boolean; // true while exit animation plays before removal
  alwaysOnTop?: boolean; // window stays above all others (e.g. Athena)
  /** When true, position/size changes animate via CSS transition (auto-tiling). */
  tiling?: boolean;
  /** Workspace this window belongs to. */
  workspaceId: string;
  // Optional payload passed to the app (e.g. noteId to open)
  payload?: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  name: string;
  /** True when the user renamed it (affects auto-naming on reorder). */
  custom?: boolean;
}

interface WindowsState {
  windows: WindowInstance[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  focusedId: string | null;
  zCounter: number;

  open: (input: {
    appId: AppId;
    title: string;
    icon: string;
    payload?: Record<string, unknown>;
    rect?: Partial<WindowRect>;
  }) => string;
  /** Marks window as closing (triggers exit animation), then removes after a delay. */
  close: (id: string) => void;
  /** Immediately removes a window from state (called after animation). */
  removeWindow: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  snap: (id: string, zone: SnapZone) => void;
  setRect: (id: string, rect: WindowRect) => void;
  setTitle: (id: string, title: string) => void;
  restoreOrMinimize: (id: string) => void; // taskbar click behavior
  cycleFocus: (direction: 1 | -1) => void; // Alt+Tab
  /** Close all windows on the active workspace. */
  closeAll: () => void;
  /** Close all windows across every workspace. */
  closeAllEverywhere: () => void;
  /** Re-tile all visible windows into a grid. Called automatically on open/close. */
  retile: () => void;

  // ----- workspace actions -----
  switchWorkspace: (id: string) => void;
  switchRelative: (direction: 1 | -1) => void;
  moveWindowToWorkspace: (winId: string, workspaceId: string) => void;
  moveFocusedToWorkspace: (workspaceId: string) => void;
  moveFocusedRelative: (direction: 1 | -1) => void;
  createWorkspace: (name?: string) => string;
  renameWorkspace: (id: string, name: string) => void;
  removeWorkspace: (id: string) => void;
  reorderWorkspace: (id: string, direction: 1 | -1) => void;
}

let idCounter = 0;
const nextId = () => `win-${++idCounter}`;

let wsIdCounter = 0;
const nextWsId = () => `ws-${++wsIdCounter}`;

const WS_STORAGE_KEY = "athena.workspaces";

function defaultWorkspaceName(n: number): string {
  return `Workspace ${n}`;
}

/** Auto-name workspaces by position, preserving custom names. */
function renumberWorkspaces(workspaces: Workspace[]): Workspace[] {
  let auto = 0;
  return workspaces.map((ws) => {
    if (ws.custom) return ws;
    auto++;
    return { ...ws, name: defaultWorkspaceName(auto) };
  });
}

/** Load persisted workspace structure from localStorage. Returns null if none. */
function loadPersistedWorkspaces(): { workspaces: Workspace[]; activeWorkspaceId: string } | null {
  try {
    const raw = localStorage.getItem(WS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) return null;
    // Ensure the trailing empty workspace exists (dynamic workspace invariant).
    const workspaces = parsed.workspaces as Workspace[];
    const active = typeof parsed.activeWorkspaceId === "string" ? parsed.activeWorkspaceId : workspaces[0].id;
    return { workspaces, activeWorkspaceId: active };
  } catch {
    return null;
  }
}

function saveWorkspaces(workspaces: Workspace[], activeWorkspaceId: string) {
  try {
    localStorage.setItem(WS_STORAGE_KEY, JSON.stringify({ workspaces, activeWorkspaceId }));
  } catch { /* non-fatal */ }
}

/** Seed the initial workspace set: one default workspace + one trailing empty. */
function seedWorkspaces(): { workspaces: Workspace[]; activeWorkspaceId: string } {
  const persisted = loadPersistedWorkspaces();
  if (persisted) return persisted;
  const w1: Workspace = { id: nextWsId(), name: defaultWorkspaceName(1) };
  const w2: Workspace = { id: nextWsId(), name: defaultWorkspaceName(2) };
  return { workspaces: [w1, w2], activeWorkspaceId: w1.id };
}

const DEFAULT_SIZE: Partial<Record<AppId, WindowRect>> = {
  notes: { x: 120, y: 80, width: 880, height: 600 },
  tasks: { x: 180, y: 100, width: 920, height: 560 },
  files: { x: 100, y: 60, width: 820, height: 560 },
  settings: { x: 260, y: 140, width: 720, height: 540 },
  terminal: { x: 200, y: 160, width: 700, height: 440 },
  pomodoro: { x: 300, y: 100, width: 420, height: 560 },
  flashcards: { x: 160, y: 80, width: 880, height: 600 },
  grades: { x: 140, y: 70, width: 920, height: 620 },
  vut: { x: 120, y: 60, width: 960, height: 660 },
  editor: { x: 160, y: 70, width: 920, height: 640 },
  viewer: { x: 200, y: 90, width: 820, height: 620 },
  athena: { x: 200, y: 90, width: 760, height: 620 },
  study: { x: 120, y: 50, width: 1120, height: 740 },
  today: { x: 160, y: 70, width: 880, height: 640 },
  calendar: { x: 120, y: 60, width: 1000, height: 680 },
  habits: { x: 200, y: 100, width: 820, height: 600 },
  whiteboard: { x: 120, y: 60, width: 1040, height: 700 },
  ntfy: { x: 220, y: 90, width: 760, height: 620 },
  voice: { x: 280, y: 120, width: 480, height: 640 },
  browser: { x: 120, y: 60, width: 1000, height: 680 },
  reminders: { x: 240, y: 100, width: 780, height: 620 },
  analytics: { x: 140, y: 70, width: 980, height: 680 },
  moodle: { x: 120, y: 60, width: 960, height: 660 },
  maps: { x: 120, y: 60, width: 1040, height: 700 },
  plans: { x: 200, y: 80, width: 720, height: 640 },
  echo: { x: 140, y: 60, width: 960, height: 680 },
};

function clampToViewport(rect: WindowRect): WindowRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight - 48; // taskbar height
  const width = Math.min(rect.width, vw - 20);
  const height = Math.min(rect.height, vh - 20);
  const x = Math.max(0, Math.min(rect.x, vw - width - 4));
  const y = Math.max(0, Math.min(rect.y, vh - height - 4));
  return { x, y, width, height };
}

const TASKBAR_H = 48;

/** True when a rect covers (nearly) the entire usable viewport. */
function isFullscreenRect(rect: WindowRect): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight - TASKBAR_H;
  return rect.width >= vw - 4 && rect.height >= vh - 4;
}

/**
 * Compute a sensible "restored" rect for a window that is currently full-screen.
 * Prefers the saved prevRect (if it's not itself fullscreen), otherwise falls
 * back to the app's default size. The result is centered + clamped.
 */
function computeRestoredRect(win: WindowInstance): WindowRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight - TASKBAR_H;
  const prev = win.prevRect && !isFullscreenRect(win.prevRect) ? win.prevRect : null;
  const base = prev ?? DEFAULT_SIZE[win.appId] ?? { x: 200, y: 100, width: 880, height: 600 };
  const width = Math.min(base.width, vw - 20);
  const height = Math.min(base.height, vh - 20);
  const x = Math.max(0, Math.floor((vw - width) / 2));
  const y = Math.max(0, Math.floor((vh - height) / 2));
  return { x, y, width, height };
}

/**
 * Compute a grid layout for the given windows (on a specific workspace).
 * Returns a map of windowId → rect.
 * Always-on-top, minimized, and closing windows are excluded.
 */
function computeGridLayout(windows: WindowInstance[], workspaceId: string): Record<string, WindowRect> {
  const vw = window.innerWidth;
  const vh = window.innerHeight - TASKBAR_H;
  const tileable = windows.filter(
    (w) => w.workspaceId === workspaceId && !w.alwaysOnTop && !w.minimized && !w.closing
  );
  if (tileable.length === 0) return {};

  // Single window → full screen
  if (tileable.length === 1) {
    return { [tileable[0].id]: { x: 0, y: 0, width: vw, height: vh } };
  }

  const cols = Math.ceil(Math.sqrt(tileable.length));
  const rows = Math.ceil(tileable.length / cols);
  const cw = Math.floor(vw / cols);
  const ch = Math.floor(vh / rows);
  const result: Record<string, WindowRect> = {};
  tileable.forEach((win, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Last row may have fewer items — stretch them to fill remaining width
    const isLastRow = row === rows - 1;
    const itemsInLastRow = tileable.length - row * cols;
    const width = isLastRow && itemsInLastRow < cols ? Math.floor(vw / itemsInLastRow) : cw;
    const x = isLastRow && itemsInLastRow < cols ? col * width : col * cw;
    result[win.id] = { x, y: row * ch, width, height: ch };
  });
  return result;
}

const initialWs = seedWorkspaces();

export const useWindows = create<WindowsState>((set, get) => ({
  windows: [],
  workspaces: initialWs.workspaces,
  activeWorkspaceId: initialWs.activeWorkspaceId,
  focusedId: null,
  zCounter: 10,

  open: ({ appId, title, icon, payload, rect }) => {
    const state = get();
    // If a window for this app+payload already exists, focus it (and switch to
    // its workspace — GNOME dash behavior).
    const existing = state.windows.find(
      (w) => w.appId === appId && JSON.stringify(w.payload) === JSON.stringify(payload)
    );
    if (existing) {
      if (existing.workspaceId !== state.activeWorkspaceId) {
        get().switchWorkspace(existing.workspaceId);
      }
      get().focus(existing.id);
      if (existing.minimized) get().minimize(existing.id);
      return existing.id;
    }
    // App availability guard: refuse to open apps the user can't access
    // (tier too low with no preview, VUT not granted, or admin kill-switched).
    // Preview-mode apps are allowed to open — the window content is wrapped
    // in a paywall overlay by the window renderer. This catches deep links /
    // Athena tool dispatch that bypass the filtered launch surfaces.
    // Settings is always openable.
    const access = isAppAccessible(appId);
    if (access === "hidden") {
      return "";
    }
    const isPreview = access === "preview";
    const id = nextId();
    const base = DEFAULT_SIZE[appId] ?? { x: 200, y: 100, width: 880, height: 600 };
    // If an explicit rect with x/y is provided, use it directly (no cascade, no auto-tile).
    // Otherwise, the window will be auto-tiled with the other windows.
    const hasExplicitPos = rect && (rect.x !== undefined || rect.y !== undefined);
    const alwaysOnTop = appId === "athena";
    const z = alwaysOnTop ? 10000 + state.zCounter + 1 : state.zCounter + 1;

    // For auto-tiling, start the new window at a reasonable size.
    // The retile() call will position it in the grid.
    const finalRect = clampToViewport(
      hasExplicitPos
        ? { ...base, ...rect }
        : { ...base, ...rect }
    );
    const win: WindowInstance = {
      id,
      appId,
      title,
      icon,
      rect: finalRect,
      snap: "none",
      zIndex: z,
      minimized: false,
      closing: false,
      alwaysOnTop,
      workspaceId: state.activeWorkspaceId,
      payload: isPreview ? { ...payload, preview: true } : payload,
    };
    set({ windows: [...state.windows, win], focusedId: id, zCounter: z });

    // Auto-tile all windows unless an explicit position was provided.
    if (!hasExplicitPos) {
      get().retile();
    }
    return id;
  },

  close: (id) => {
    // Mark as closing to trigger exit animation, then remove after it plays.
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, closing: true } : w
      ),
      focusedId: s.focusedId === id ? null : s.focusedId,
    }));
    // Remove after animation duration (must match Window.tsx exit duration),
    // then retile remaining windows to fill the gap.
    setTimeout(() => {
      get().removeWindow(id);
      get().retile();
    }, 180);
  },

  removeWindow: (id) =>
    set((s) => ({
      windows: s.windows.filter((w) => w.id !== id),
    })),

  focus: (id) => {
    const s = get();
    const target = s.windows.find((w) => w.id === id);
    if (!target) return;
    // Focusing a window on another workspace switches to it (GNOME behavior).
    if (target.workspaceId !== s.activeWorkspaceId) {
      get().switchWorkspace(target.workspaceId);
    }
    set((st) => {
      const t = st.windows.find((w) => w.id === id);
      if (!t) return st;
      // Always-on-top windows get z in the 10000+ range; normal windows stay below.
      const z = t.alwaysOnTop ? 10000 + st.zCounter + 1 : st.zCounter + 1;
      return {
        zCounter: st.zCounter + 1,
        focusedId: id,
        windows: st.windows.map((w) =>
          w.id === id ? { ...w, zIndex: z, minimized: false } : w
        ),
      };
    });
  },

  minimize: (id) => {
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, minimized: !w.minimized } : w
      ),
      focusedId: s.focusedId === id ? null : s.focusedId,
    }));
    // Retile to fill/restore the gap when a window is minimized/restored.
    get().retile();
  },

  toggleMaximize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        const vw = window.innerWidth;
        const vh = window.innerHeight - TASKBAR_H;
        // Restore when explicitly maximized OR when effectively fullscreen
        // (e.g. auto-tiled single window has snap="none" but fills the screen).
        if (w.snap === "maximized" || isFullscreenRect(w.rect)) {
          return {
            ...w,
            snap: "none",
            rect: computeRestoredRect(w),
            prevRect: undefined,
          };
        }
        return {
          ...w,
          snap: "maximized",
          prevRect: w.rect,
          rect: { x: 0, y: 0, width: vw, height: vh },
        };
      }),
    })),

  snap: (id, zone) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        const vw = window.innerWidth;
        const vh = window.innerHeight - 48;
        if (zone === "none") {
          // If prevRect is missing or itself fullscreen, fall back to a
          // sensible default size so the window doesn't stay stuck fullscreen.
          const prev = w.prevRect;
          if (!prev || isFullscreenRect(prev)) {
            return {
              ...w,
              snap: "none",
              rect: computeRestoredRect(w),
              prevRect: undefined,
            };
          }
          return { ...w, snap: "none", rect: prev, prevRect: undefined };
        }
        if (zone === "maximized") {
          return {
            ...w,
            snap: "maximized",
            prevRect: w.snap === "none" ? w.rect : w.prevRect,
            rect: { x: 0, y: 0, width: vw, height: vh },
          };
        }
        const halfW = Math.floor(vw / 2);
        const halfH = Math.floor(vh / 2);
        const prevRect = w.snap === "none" ? w.rect : w.prevRect;
        let rect: WindowRect;
        switch (zone) {
          case "left":
            rect = { x: 0, y: 0, width: halfW, height: vh };
            break;
          case "right":
            rect = { x: halfW, y: 0, width: vw - halfW, height: vh };
            break;
          case "top-left":
            rect = { x: 0, y: 0, width: halfW, height: halfH };
            break;
          case "top-right":
            rect = { x: halfW, y: 0, width: vw - halfW, height: halfH };
            break;
          case "bottom-left":
            rect = { x: 0, y: halfH, width: halfW, height: vh - halfH };
            break;
          case "bottom-right":
            rect = { x: halfW, y: halfH, width: vw - halfW, height: vh - halfH };
            break;
          default:
            rect = w.rect;
        }
        return { ...w, snap: zone, prevRect, rect };
      }),
    })),

  setRect: (id, rect) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, rect } : w)),
    })),

  setTitle: (id, title) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, title } : w)),
    })),

  restoreOrMinimize: (id) => {
    const w = get().windows.find((x) => x.id === id);
    if (!w) return;
    // If the window is on another workspace, switch to it first.
    if (w.workspaceId !== get().activeWorkspaceId) {
      get().switchWorkspace(w.workspaceId);
    }
    if (w.minimized) {
      // Restoring from minimized — un-minimize and retile so the window
      // fits into the grid alongside the others (instead of overlapping).
      get().focus(id);
      get().retile();
    } else if (get().focusedId === id) {
      get().minimize(id);
    } else {
      get().focus(id);
    }
  },

  cycleFocus: (direction) => {
    const s = get();
    const visible = s.windows.filter(
      (w) => !w.minimized && w.workspaceId === s.activeWorkspaceId
    );
    if (visible.length === 0) return;
    const sorted = [...visible].sort((a, b) => a.zIndex - b.zIndex);
    const currentIdx = sorted.findIndex((w) => w.id === s.focusedId);
    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = direction === 1 ? sorted.length - 1 : 0;
    } else {
      nextIdx = (currentIdx + direction + sorted.length) % sorted.length;
    }
    get().focus(sorted[nextIdx].id);
  },

  closeAll: () => {
    const wsId = get().activeWorkspaceId;
    set((s) => ({
      windows: s.windows.filter((w) => w.workspaceId !== wsId),
      focusedId: null,
    }));
  },

  closeAllEverywhere: () => set({ windows: [], focusedId: null }),

  retile: () => {
    const wsId = get().activeWorkspaceId;
    const layout = computeGridLayout(get().windows, wsId);
    if (Object.keys(layout).length === 0) return;
    set((s) => ({
      windows: s.windows.map((w) => {
        const newRect = layout[w.id];
        if (!newRect) return w;
        // Set tiling=true so the Window component enables CSS transitions
        // for a smooth slide animation. The flag is cleared on next interaction.
        return { ...w, rect: newRect, tiling: true, snap: "none" };
      }),
    }));
    // Clear the tiling flag after the transition completes so that
    // subsequent drag/resize operations don't have transitions.
    setTimeout(() => {
      set((s) => ({
        windows: s.windows.map((w) =>
          w.tiling ? { ...w, tiling: false } : w
        ),
      }));
    }, 350);
  },

  // ===== workspace actions =====

  switchWorkspace: (id) => {
    const s = get();
    if (id === s.activeWorkspaceId) return;
    if (!s.workspaces.some((ws) => ws.id === id)) return;
    set({ activeWorkspaceId: id, focusedId: null });
    saveWorkspaces(s.workspaces, id);
    // Retile the newly-active workspace's windows.
    get().retile();
  },

  switchRelative: (direction) => {
    const s = get();
    const idx = s.workspaces.findIndex((ws) => ws.id === s.activeWorkspaceId);
    if (idx === -1) return;
    const next = (idx + direction + s.workspaces.length) % s.workspaces.length;
    get().switchWorkspace(s.workspaces[next].id);
  },

  moveWindowToWorkspace: (winId, workspaceId) => {
    const s = get();
    const win = s.windows.find((w) => w.id === winId);
    if (!win) return;
    if (win.workspaceId === workspaceId) return;
    const targetExists = s.workspaces.some((ws) => ws.id === workspaceId);
    if (!targetExists) return;
    let workspaces = s.workspaces;
    // Dynamic workspace: if the target is the last (trailing empty) workspace,
    // append a new empty workspace so there's always a fresh one.
    const isLast = s.workspaces[s.workspaces.length - 1]?.id === workspaceId;
    if (isLast) {
      const newWs: Workspace = { id: nextWsId(), name: `Workspace ${s.workspaces.length + 1}` };
      workspaces = [...s.workspaces, newWs];
    }
    const wasFocused = s.focusedId === winId;
    set((st) => ({
      workspaces,
      windows: st.windows.map((w) =>
        w.id === winId ? { ...w, workspaceId, snap: "none" } : w
      ),
    }));
    saveWorkspaces(workspaces, s.activeWorkspaceId);
    // If the moved window was focused, follow it to the target workspace.
    if (wasFocused) {
      get().switchWorkspace(workspaceId);
      get().focus(winId);
    } else {
      // Retile both the source and target workspaces if either is active.
      get().retile();
    }
  },

  moveFocusedToWorkspace: (workspaceId) => {
    const fid = get().focusedId;
    if (fid) get().moveWindowToWorkspace(fid, workspaceId);
  },

  moveFocusedRelative: (direction) => {
    const s = get();
    const fid = s.focusedId;
    if (!fid) return;
    const win = s.windows.find((w) => w.id === fid);
    if (!win) return;
    const idx = s.workspaces.findIndex((ws) => ws.id === win.workspaceId);
    if (idx === -1) return;
    const next = (idx + direction + s.workspaces.length) % s.workspaces.length;
    get().moveWindowToWorkspace(fid, s.workspaces[next].id);
  },

  createWorkspace: (name) => {
    const s = get();
    // Insert before the trailing empty workspace so the fresh empty stays last.
    const newWs: Workspace = {
      id: nextWsId(),
      name: name?.trim() || `Workspace ${s.workspaces.length}`,
      custom: !!name?.trim(),
    };
    const workspaces = [
      ...s.workspaces.slice(0, -1),
      newWs,
      ...s.workspaces.slice(-1),
    ];
    const renumbered = renumberWorkspaces(workspaces);
    set({ workspaces: renumbered });
    saveWorkspaces(renumbered, s.activeWorkspaceId);
    return newWs.id;
  },

  renameWorkspace: (id, name) => {
    const s = get();
    const trimmed = name.trim();
    const workspaces = s.workspaces.map((ws) =>
      ws.id === id ? { ...ws, name: trimmed || ws.name, custom: !!trimmed } : ws
    );
    const renumbered = renumberWorkspaces(workspaces);
    set({ workspaces: renumbered });
    saveWorkspaces(renumbered, s.activeWorkspaceId);
  },

  removeWorkspace: (id) => {
    const s = get();
    if (s.workspaces.length <= 1) return; // never remove the last workspace
    const idx = s.workspaces.findIndex((ws) => ws.id === id);
    if (idx === -1) return;
    // Move this workspace's windows to the previous workspace (or next if first).
    const targetIdx = idx > 0 ? idx - 1 : idx + 1;
    const targetWsId = s.workspaces[targetIdx].id;
    const windows = s.windows.map((w) =>
      w.workspaceId === id ? { ...w, workspaceId: targetWsId } : w
    );
    let workspaces = s.workspaces.filter((ws) => ws.id !== id);
    // Ensure there's always a trailing empty workspace.
    const last = workspaces[workspaces.length - 1];
    const hasWindowsOnLast = windows.some((w) => w.workspaceId === last.id);
    if (hasWindowsOnLast) {
      workspaces = [...workspaces, { id: nextWsId(), name: `Workspace ${workspaces.length + 1}` }];
    }
    const renumbered = renumberWorkspaces(workspaces);
    let activeWorkspaceId = s.activeWorkspaceId;
    if (activeWorkspaceId === id) {
      activeWorkspaceId = targetWsId;
    }
    set({ workspaces: renumbered, windows, activeWorkspaceId, focusedId: null });
    saveWorkspaces(renumbered, activeWorkspaceId);
    get().retile();
  },

  reorderWorkspace: (id, direction) => {
    const s = get();
    const idx = s.workspaces.findIndex((ws) => ws.id === id);
    if (idx === -1) return;
    const swapWith = idx + direction;
    if (swapWith < 0 || swapWith >= s.workspaces.length) return;
    const workspaces = [...s.workspaces];
    [workspaces[idx], workspaces[swapWith]] = [workspaces[swapWith], workspaces[idx]];
    const renumbered = renumberWorkspaces(workspaces);
    set({ workspaces: renumbered });
    saveWorkspaces(renumbered, s.activeWorkspaceId);
  },
}));
