import { create } from "zustand";

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
  /** Whether the user has completed the first-run onboarding tour. */
  hasOnboarded: boolean;
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
  setHasOnboarded: (b: boolean) => void;
}

const STORAGE_KEY = "athena.settings";

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
  hasOnboarded: boolean;
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
function hexToRgbTriplet(hex: string): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

const defaults: PersistedSettings = {
  theme: "dark",
  accent: "#8b5cf6",
  wallpaper: "aurora",
  animatedBg: "none",
  volume: 70,
  notificationsEnabled: true,
  doNotDisturb: false,
  athenaRollEdge: "bottom",
  athenaQuickSize: null,
  autoChillOnIdle: false,
  hasOnboarded: false,
};

const loaded = { ...defaults, ...load() };

/** Apply theme + accent to <html> as CSS vars / classes. */
export function applySettings(s: PersistedSettings) {
  const root = document.documentElement;
  root.classList.toggle("dark", s.theme === "dark");
  root.style.setProperty("--accent", hexToRgbTriplet(s.accent));
  // accent-fg: white for most accents; could compute luminance but keep simple
  root.style.setProperty("--accent-fg", "255 255 255");
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
  setHasOnboarded: (hasOnboarded) => {
    set({ hasOnboarded });
    persist({ ...get(), hasOnboarded } as PersistedSettings);
  },
}));
