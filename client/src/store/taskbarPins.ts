// ===== Taskbar pinned apps store =====
// Stores the user's pinned app ids for the desktop taskbar. Pinned apps are
// always shown in the taskbar; running apps that aren't pinned are appended
// after them. Persisted to localStorage so pin state survives reloads.

import { create } from "zustand";
import type { AppId } from "./windows";

const STORAGE_KEY = "athena.taskbarPins";

/** Default pinned apps — a compact set of commonly-used free apps so the
 *  taskbar isn't empty on first run. Users can pin/unpin freely. */
const DEFAULT_PINS: AppId[] = ["today", "tasks", "notes", "files", "study", "athena"];

function loadPins(): AppId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PINS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PINS;
    // Filter to strings only (defensive — plugin ids may no longer be installed)
    return parsed.filter((x): x is AppId => typeof x === "string");
  } catch {
    return DEFAULT_PINS;
  }
}

function persistPins(pins: AppId[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}

interface TaskbarPinsState {
  pins: AppId[];
  isPinned: (appId: AppId) => boolean;
  pin: (appId: AppId) => void;
  unpin: (appId: AppId) => void;
  togglePin: (appId: AppId) => void;
}

export const useTaskbarPins = create<TaskbarPinsState>((set, get) => ({
  pins: loadPins(),

  isPinned: (appId) => get().pins.includes(appId),

  pin: (appId) =>
    set((s) => {
      if (s.pins.includes(appId)) return s;
      const pins = [...s.pins, appId];
      persistPins(pins);
      return { pins };
    }),

  unpin: (appId) =>
    set((s) => {
      const pins = s.pins.filter((p) => p !== appId);
      persistPins(pins);
      return { pins };
    }),

  togglePin: (appId) => {
    if (get().isPinned(appId)) get().unpin(appId);
    else get().pin(appId);
  },
}));
