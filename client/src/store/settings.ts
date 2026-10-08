import { create } from "zustand";
import { DEFAULT_SHORTCUTS, DEFAULT_DOCK_FAVORITES } from "./shortcuts";
import type { ShortcutAction, Shortcut } from "./shortcuts";
import type { AppId } from "./windows";

export type ThemeMode = "light" | "dark";
export type WallpaperId = "aurora" | "sunset" | "ocean" | "forest" | "mesh" | "mono";
export type AthenaRollEdge = "bottom" | "top" | "left" | "right";

/** Animated background id — null means use static wallpaper. */
export type AnimatedBgId =
  | "none"
  | "starfield"
  | "particles"
  | "matrix"
  | "aurora-waves"
  | "bubbles"
  | "geometric"
  | "fireflies"
  | "rain"
  | "plasma"
  | "constellation"
  | "neon-grid"
  | "bokeh"
  | "snow"
  | "waves";

export interface AthenaQuickSize {
  width: number;
  height: number;
}

interface SettingsState {
  theme: ThemeMode;
  accent: string; // hex
  wallpaper: WallpaperId;
  animatedBg: AnimatedBgId;
  volume: number; // 0-100
  notificationsEnabled: boolean;
  doNotDisturb: boolean;
  athenaRollEdge: AthenaRollEdge;
  athenaQuickSize: AthenaQuickSize | null;
  /** Auto-enter Spotify fullscreen chill mode after 10 min of inactivity while music plays. */
  autoChillOnIdle: boolean;
  /** IDs of users who completed the first-run onboarding tour on this browser.
   *  Tracked per account (not globally) so a new account on a shared browser
   *  still gets the tour. */
  onboardedUserIds: string[];
  /** User-configurable keyboard shortcuts. */
  shortcuts: Record<ShortcutAction, Shortcut>;
  /** App IDs pinned to the taskbar. */
  dockFavorites: AppId[];
  setTheme: (t: ThemeMode) => void;
  setAccent: (hex: string) => void;
  setWallpaper: (w: WallpaperId) => void;
  setAnimatedBg: (b: AnimatedBgId) => void;
  setVolume: (v: number) => void;
  setNotificationsEnabled: (b: boolean) => void;
  setDoNotDisturb: (b: boolean) => void;
  setAthenaRollEdge: (e: AthenaRollEdge) => void;
  setAthenaQuickSize: (s: AthenaQuickSize) => void;
  setAutoChillOnIdle: (b: boolean) => void;
  setOnboarded: (userId: string, done: boolean) => void;
  setShortcut: (action: ShortcutAction, shortcut: Shortcut) => void;
  resetShortcuts: () => void;
  setDockFavorites: (favorites: AppId[]) => void;
}

const STORAGE_KEY = "athena.settings";
const APPEARANCE_RESET_KEY = "mavino.appearance-reset.v1";

interface PersistedSettings {
  theme: ThemeMode;
  accent: string;
  wallpaper: WallpaperId;
  animatedBg: AnimatedBgId;
  volume: number;
  notificationsEnabled: boolean;
  doNotDisturb: boolean;
  athenaRollEdge: AthenaRollEdge;
  athenaQuickSize: AthenaQuickSize | null;
  autoChillOnIdle: boolean;
  onboardedUserIds: string[];
  shortcuts: Record<ShortcutAction, Shortcut>;
  dockFavorites: AppId[];
}

function load(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist(s: PersistedSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/** Convert hex (#rrggbb) to "r g b" for CSS var. */
function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function mixRgb(color: [number, number, number], target: number, amount: number): [number, number, number] {
  return color.map((channel) => Math.round(channel + (target - channel) * amount)) as [number, number, number];
}

function rgbTriplet(color: [number, number, number]): string {
  return color.join(" ");
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channels = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

const defaults: PersistedSettings = {
  theme: "dark",
  accent: "#3b82f6",
  wallpaper: "ocean",
  animatedBg: "none",
  volume: 70,
  notificationsEnabled: true,
  doNotDisturb: false,
  athenaRollEdge: "bottom",
  athenaQuickSize: null,
  autoChillOnIdle: false,
  onboardedUserIds: [],
  shortcuts: { ...DEFAULT_SHORTCUTS },
  dockFavorites: [...DEFAULT_DOCK_FAVORITES] as AppId[],
};

const loaded = { ...defaults, ...load() };
// Merge nested defaults so new settings fields are back-filled on old stored data.
if (!loaded.shortcuts || Object.keys(loaded.shortcuts).length === 0) {
  loaded.shortcuts = { ...DEFAULT_SHORTCUTS };
}
if (!loaded.dockFavorites || loaded.dockFavorites.length === 0) {
  loaded.dockFavorites = [...DEFAULT_DOCK_FAVORITES] as AppId[];
}
if (!Array.isArray(loaded.onboardedUserIds)) {
  loaded.onboardedUserIds = [];
}
// One-time appearance migration: reset every existing browser profile to the
// new default background/accent while preserving theme and other preferences.
if (localStorage.getItem(APPEARANCE_RESET_KEY) !== "done") {
  loaded.accent = defaults.accent;
  loaded.wallpaper = defaults.wallpaper;
  loaded.animatedBg = defaults.animatedBg;
  localStorage.setItem(APPEARANCE_RESET_KEY, "done");
  persist(loaded);
}
// Drop the legacy browser-global flag so it stops round-tripping into persist().
delete (loaded as Partial<Record<string, unknown>>).hasOnboarded;

/** Apply theme + accent to <html> as CSS vars / classes. */
export function applySettings(s: PersistedSettings) {
  const root = document.documentElement;
  const dark = s.theme === "dark";
  const selected = hexToRgb(s.accent);
  const accent = dark ? mixRgb(selected, 255, 0.35) : mixRgb(selected, 0, 0.08);
  const hover = mixRgb(accent, dark ? 255 : 0, 0.12);
  const pressed = mixRgb(accent, 0, dark ? 0.14 : 0.2);
  const soft = mixRgb(accent, dark ? 20 : 255, dark ? 0.72 : 0.88);
  root.classList.toggle("dark", dark);
  root.style.setProperty("--accent", rgbTriplet(accent));
  root.style.setProperty("--accent-hover", rgbTriplet(hover));
  root.style.setProperty("--accent-pressed", rgbTriplet(pressed));
  root.style.setProperty("--accent-soft", rgbTriplet(soft));
  root.style.setProperty("--accent-fg", relativeLuminance(accent) > 0.2 ? "15 23 42" : "255 255 255");
}

applySettings(loaded);

export const useSettings = create<SettingsState>((set, get) => ({
  ...loaded,

  setTheme: (theme) => {
    set({ theme });
    persist({ ...get(), theme } as PersistedSettings);
    applySettings({ ...get(), theme } as PersistedSettings);
  },
  setAccent: (accent) => {
    set({ accent });
    persist({ ...get(), accent } as PersistedSettings);
    applySettings({ ...get(), accent } as PersistedSettings);
  },
  setWallpaper: (wallpaper) => {
    set({ wallpaper });
    persist({ ...get(), wallpaper } as PersistedSettings);
  },
  setAnimatedBg: (animatedBg) => {
    set({ animatedBg });
    persist({ ...get(), animatedBg } as PersistedSettings);
  },
  setVolume: (volume) => {
    set({ volume });
    persist({ ...get(), volume } as PersistedSettings);
  },
  setNotificationsEnabled: (notificationsEnabled) => {
    set({ notificationsEnabled });
    persist({ ...get(), notificationsEnabled } as PersistedSettings);
  },
  setDoNotDisturb: (doNotDisturb) => {
    set({ doNotDisturb });
    persist({ ...get(), doNotDisturb } as PersistedSettings);
  },
  setAthenaRollEdge: (athenaRollEdge) => {
    set({ athenaRollEdge });
    persist({ ...get(), athenaRollEdge } as PersistedSettings);
  },
  setAthenaQuickSize: (athenaQuickSize) => {
    set({ athenaQuickSize });
    persist({ ...get(), athenaQuickSize } as PersistedSettings);
  },
  setAutoChillOnIdle: (autoChillOnIdle) => {
    set({ autoChillOnIdle });
    persist({ ...get(), autoChillOnIdle } as PersistedSettings);
  },
  setOnboarded: (userId, done) => {
    const cur = get().onboardedUserIds;
    const onboardedUserIds = done
      ? cur.includes(userId) ? cur : [...cur, userId]
      : cur.filter((id) => id !== userId);
    set({ onboardedUserIds });
    persist({ ...get(), onboardedUserIds } as PersistedSettings);
  },
  setShortcut: (action, shortcut) => {
    const shortcuts = { ...get().shortcuts, [action]: shortcut };
    set({ shortcuts });
    persist({ ...get(), shortcuts } as PersistedSettings);
  },
  resetShortcuts: () => {
    const shortcuts = { ...DEFAULT_SHORTCUTS };
    set({ shortcuts });
    persist({ ...get(), shortcuts } as PersistedSettings);
  },
  setDockFavorites: (dockFavorites) => {
    set({ dockFavorites });
    persist({ ...get(), dockFavorites } as PersistedSettings);
  },
}));

/** Whether the given user has completed the first-run onboarding tour on this browser. */
export function useHasOnboarded(userId: string | undefined): boolean {
  return useSettings((s) => (userId ? s.onboardedUserIds.includes(userId) : false));
}
