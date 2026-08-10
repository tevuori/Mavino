// ===== Plugin store =====
// Loads the current user's installed+enabled plugins from /api/plugins/installed
// and exposes them to the app registry so installed plugin apps appear in the
// taskbar, start menu, desktop, and command palette alongside built-in apps.
//
// Plugin apps use a synthetic appId of `plugin:<pluginKey>` to avoid collisions
// with built-in app ids. The registry merges these into the app list at render
// time via useAccessibleApps().

import { create } from "zustand";
import { useEffect } from "react";
import { pluginsApi, type InstalledPlugin } from "../services/plugins";
import { useFeatures } from "./features";

export interface PluginsState {
  plugins: InstalledPlugin[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const usePlugins = create<PluginsState>((set, get) => ({
  plugins: [],
  loaded: false,
  error: null,

  load: async () => {
    try {
      const data = await pluginsApi.getInstalled();
      set({ plugins: data.plugins ?? [], loaded: true, error: null });
    } catch (e) {
      // 402 = free tier (marketplace not available) — not an error, just no plugins.
      set({ plugins: [], loaded: true, error: e instanceof Error ? e.message : null });
    }
  },

  refresh: () => get().load(),
}));

/** The synthetic appId for a plugin: `plugin:<pluginKey>`. */
export function pluginAppId(pluginKey: string): string {
  return `plugin:${pluginKey}`;
}

/** Extract the pluginKey from a synthetic appId, or null if not a plugin id. */
export function parsePluginAppId(appId: string): string | null {
  if (!appId.startsWith("plugin:")) return null;
  return appId.slice("plugin:".length);
}

/** Convenience: ensures plugins are loaded for the current session. */
export function usePluginsLoaded(): boolean {
  const loaded = usePlugins((s) => s.loaded);
  const load = usePlugins((s) => s.load);
  const subscriptionTier = useFeatures((s) => s.subscriptionTier);
  useEffect(() => {
    // Only load for paid/pro users — free users have no marketplace access.
    if (subscriptionTier === "free") {
      usePlugins.setState({ plugins: [], loaded: true });
      return;
    }
    if (!loaded) void load();
  }, [loaded, load, subscriptionTier]);
  return loaded;
}
