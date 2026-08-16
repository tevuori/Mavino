// ===== Performance monitor store =====
// Holds the enabled state (persisted to localStorage) + the live samples +
// summary so the monitoring can continue running even when the Settings
// window is closed. The actual monitoring is driven by the
// <PerformanceMonitorRunner /> component rendered at the app level.

import { create } from "zustand";
import type { PerfSample, PerfSummary } from "../apps/settings/usePerformanceMonitor";

const STORAGE_KEY = "athena.perf";

interface PersistedPerf {
  enabled: boolean;
}

function load(): PersistedPerf {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { enabled: false };
  } catch {
    return { enabled: false };
  }
}

function persist(s: PersistedPerf) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const loaded = load();

interface PerformanceState {
  enabled: boolean;
  samples: PerfSample[];
  summary: PerfSummary | null;
  running: boolean;

  setEnabled: (enabled: boolean) => void;
  setSamples: (samples: PerfSample[]) => void;
  setSummary: (summary: PerfSummary) => void;
  setRunning: (running: boolean) => void;
  clear: () => void;
}

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  enabled: loaded.enabled,
  samples: [],
  summary: null,
  running: false,

  setEnabled: (enabled) => {
    set({ enabled });
    persist({ enabled });
    if (!enabled) {
      set({ samples: [], running: false });
    }
  },
  setSamples: (samples) => set({ samples }),
  setSummary: (summary) => set({ summary }),
  setRunning: (running) => set({ running }),
  clear: () => set({ samples: [] }),
}));
