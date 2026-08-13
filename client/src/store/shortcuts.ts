import { useEffect } from "react";
import { useSettings } from "./settings";

export type ShortcutAction =
  | "toggleDock"
  | "toggleCommandPalette"
  | "toggleWorkspaceOverview"
  | "toggleAthenaQuickPanel"
  | "toggleQuickCapture"
  | "toggleFullscreen"
  | "snapWindowLeft"
  | "snapWindowRight"
  | "snapWindowTopLeft"
  | "snapWindowTopRight"
  | "maximizeWindow"
  | "toggleMaximize"
  | "minimizeWindow"
  | "restoreWindow"
  | "closeWindow"
  | "previousWorkspace"
  | "nextWorkspace"
  | "moveWindowPreviousWorkspace"
  | "moveWindowNextWorkspace";

export interface Shortcut {
  /** Accept either Ctrl or Meta/Super/Win (OS-agnostic). */
  super?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
}

/** Readable label for each configurable action. */
export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  toggleDock: "Toggle bottom dock",
  toggleCommandPalette: "Command palette",
  toggleWorkspaceOverview: "Workspace overview",
  toggleAthenaQuickPanel: "Mavino quick panel",
  toggleQuickCapture: "Quick capture",
  toggleFullscreen: "Toggle fullscreen",
  snapWindowLeft: "Snap window left",
  snapWindowRight: "Snap window right",
  snapWindowTopLeft: "Snap window top-left",
  snapWindowTopRight: "Snap window top-right",
  maximizeWindow: "Maximize window",
  toggleMaximize: "Toggle maximize",
  minimizeWindow: "Minimize window",
  restoreWindow: "Restore window",
  closeWindow: "Close window",
  previousWorkspace: "Previous workspace",
  nextWorkspace: "Next workspace",
  moveWindowPreviousWorkspace: "Move window to previous workspace",
  moveWindowNextWorkspace: "Move window to next workspace",
};

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, Shortcut> = {
  toggleDock: { key: "Meta" },
  toggleCommandPalette: { super: true, key: " " },
  toggleWorkspaceOverview: { alt: true, key: " " },
  toggleAthenaQuickPanel: { super: true, key: "y" },
  toggleQuickCapture: { super: true, shift: true, key: "n" },
  toggleFullscreen: { super: true, key: "f" },
  snapWindowLeft: { super: true, key: "ArrowLeft" },
  snapWindowRight: { super: true, key: "ArrowRight" },
  snapWindowTopLeft: { super: true, shift: true, key: "ArrowLeft" },
  snapWindowTopRight: { super: true, shift: true, key: "ArrowRight" },
  maximizeWindow: { super: true, key: "ArrowUp" },
  toggleMaximize: { super: true, shift: true, key: "ArrowUp" },
  minimizeWindow: { super: true, shift: true, key: "ArrowDown" },
  restoreWindow: { super: true, key: "ArrowDown" },
  closeWindow: { super: true, key: "w" },
  previousWorkspace: { ctrl: true, alt: true, key: "PageUp" },
  nextWorkspace: { ctrl: true, alt: true, key: "PageDown" },
  moveWindowPreviousWorkspace: { ctrl: true, shift: true, key: "PageUp" },
  moveWindowNextWorkspace: { ctrl: true, shift: true, key: "PageDown" },
};

/** Default set of favorites shown in the bottom dock. */
export const DEFAULT_DOCK_FAVORITES = ["notes", "tasks", "study", "files", "today"];

export function matchesShortcut(e: KeyboardEvent, shortcut: Shortcut | undefined): boolean {
  if (!shortcut) return false;

  const key = shortcut.key;

  // Meta/Super on its own is the shortcut, not a modifier.
  if (key === "Meta" || key === "OS") {
    return (e.key === "Meta" || e.key === "OS") && !e.ctrlKey && !e.altKey && !e.shiftKey;
  }

  const superDown = e.ctrlKey || e.metaKey;

  if (shortcut.ctrl && !e.ctrlKey) return false;
  if (shortcut.meta && !e.metaKey) return false;
  if (shortcut.super && !superDown) return false;

  // If no ctrl/meta/super is requested, make sure neither is held.
  if (!shortcut.ctrl && !shortcut.meta && !shortcut.super && superDown) return false;

  if (e.shiftKey !== !!shortcut.shift) return false;
  if (e.altKey !== !!shortcut.alt) return false;

  if (key === " " || key.toLowerCase() === "space") {
    return e.key === " " || e.code === "Space";
  }

  return e.key.toLowerCase() === key.toLowerCase();
}

export function formatKey(key: string): string {
  const k = key.toLowerCase();
  if (key === " " || k === "space") return "Space";
  if (key === "Meta" || key === "OS" || key === "Super") return "Win";
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  if (key === "ArrowLeft") return "←";
  if (key === "ArrowRight") return "→";
  if (key === "PageUp") return "PgUp";
  if (key === "PageDown") return "PgDn";
  if (key.length === 1 && key === key.toLowerCase() && /[a-z]/.test(key)) {
    return key.toUpperCase();
  }
  return key;
}

export function formatShortcut(shortcut: Shortcut | undefined): string {
  if (!shortcut) return "—";
  const parts: string[] = [];
  if (shortcut.super) parts.push("Win");
  else {
    if (shortcut.ctrl) parts.push("Ctrl");
    if (shortcut.meta) parts.push("Win");
  }
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  parts.push(formatKey(shortcut.key));
  return parts.join(" + ");
}

export function captureShortcut(e: KeyboardEvent): Shortcut | null {
  // Modifier-only keypresses (except Super) aren't a valid shortcut on their own.
  if (e.key === "Control" || e.key === "Alt" || e.key === "Shift") return null;

  let key = e.key;
  if (key === "OS") key = "Meta";

  const shortcut: Shortcut = { key };
  if (e.ctrlKey) shortcut.ctrl = true;
  if (e.metaKey && key !== "Meta") shortcut.meta = true;
  if (e.shiftKey) shortcut.shift = true;
  if (e.altKey) shortcut.alt = true;

  return shortcut;
}

export function useShortcut(
  action: ShortcutAction,
  callback: (e: KeyboardEvent) => void,
  options?: { allowInput?: boolean }
) {
  const shortcut = useSettings((s) => s.shortcuts[action]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!options?.allowInput) {
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (matchesShortcut(e, shortcut)) {
        e.preventDefault();
        callback(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut, callback, options?.allowInput]);
}
