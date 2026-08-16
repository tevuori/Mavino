// ===== Feature flags / app availability store =====
// Loads the current user's feature state (subscription tier, app tier
// assignments, global disabled-apps kill switch) from /api/features
// and exposes derived helpers used by all app launch surfaces and the window
// manager's open() guard.
//
// App tier classification lives in apps/registry.tsx and is mirrored on the
// server in services/features.ts — keep them in sync.

import { create } from "zustand";
import { useEffect, useMemo } from "react";
import { APPS, APP_MAP, isPluginAppId, type AppDefinition } from "../apps/registry";
import type { AppId } from "./windows";
import { api } from "../services/api";
import { usePlugins, pluginAppId } from "./plugins";
import type { InstalledPlugin } from "../services/plugins";
import PluginAppWrapper from "../apps/plugins/PluginAppWrapper";

export type SubscriptionTier = "free" | "paid" | "pro";
export type AppAccess = "full" | "preview" | "hidden";

interface FeaturesState {
  subscriptionTier: SubscriptionTier;
  /** Admin-configured app tier assignments (appId → minTier). */
  appTiers: Record<string, "free" | "paid" | "pro">;
  /** Globally disabled app ids (admin kill switch). */
  disabledApps: Set<string>;
  loaded: boolean;

  load: () => Promise<void>;
  /** Refresh disabled state (e.g. after an admin change). */
  refresh: () => Promise<void>;
}

export const useFeatures = create<FeaturesState>((set, get) => ({
  subscriptionTier: "free",
  appTiers: {},
  disabledApps: new Set(),
  loaded: false,

  load: async () => {
    try {
      const data = await api.get<{
        subscriptionTier: SubscriptionTier;
        disabledApps: string[];
        appTiers: Record<string, "free" | "paid" | "pro">;
      }>("/api/features");
      set({
        subscriptionTier: data.subscriptionTier,
        appTiers: data.appTiers ?? {},
        disabledApps: new Set(data.disabledApps),
        loaded: true,
      });
    } catch {
      // Non-fatal: default to most-restrictive (free tier). This also
      // covers the pre-login / loading window where launch surfaces
      // aren't rendered yet.
      set({ loaded: true });
    }
  },

  refresh: () => get().load(),
}));

/** Settings is always available (can't be disabled — would lock users out). */
const UNDISABLEABLE = new Set<AppId>(["settings"]);

const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, paid: 1, pro: 2 };

/**
 * Whether an app is accessible to the current user, combining the global kill
 * switch and the tier system.
 * Returns "full" (unlocked), "preview" (locked but visible), or "hidden".
 * Pure function over the store's current state — safe to call from the
 * windows store without subscribing to React updates.
 */
export function isAppAccessible(appId: AppId): AppAccess {
  const { disabledApps, subscriptionTier, appTiers } = useFeatures.getState();
  if (UNDISABLEABLE.has(appId)) return "full";
  if (disabledApps.has(appId)) return "hidden";
  // Plugin apps: always "full" if installed (the marketplace is already
  // paid-gated, so installed plugins are always accessible).
  if (isPluginAppId(appId)) {
    const { plugins } = usePlugins.getState();
    return plugins.some((p) => pluginAppId(p.pluginKey) === appId) ? "full" : "hidden";
  }
  const def = APP_MAP[appId];
  if (!def) return "hidden";
  // Use server-provided tier override if available, otherwise the registry default
  const minTier = appTiers[appId] ?? def.minTier ?? "free";
  if (TIER_RANK[subscriptionTier] >= TIER_RANK[minTier]) return "full";
  return "preview";
}

/**
 * Boolean alias: true only for "full" access. Used by deep-link guards
 * (Athena tool dispatch, etc.) that should block both preview and hidden.
 */
export function isAppAvailable(appId: AppId): boolean {
  return isAppAccessible(appId) === "full";
}

/** Build an AppDefinition for an installed plugin. */
function pluginAppDef(p: InstalledPlugin): AppDefinition {
  return {
    id: pluginAppId(p.pluginKey) as AppId,
    name: p.name,
    icon: p.icon,
    component: PluginAppWrapper,
    pinnedToDesktop: true,
    minTier: p.minTier,
  };
}

/** Apps visible to the current user in launch surfaces (Start menu, desktop,
 *  taskbar, command palette, mobile launcher). Includes both full and
 *  preview apps (preview apps show a lock badge). Also includes installed
 *  plugin apps (always "full" access). */
export function accessibleApps(): Array<AppDefinition & { access: AppAccess }> {
  const builtin = APPS.map((a) => ({ ...a, access: isAppAccessible(a.id) })).filter(
    (a) => a.access !== "hidden"
  );
  const pluginApps = usePlugins.getState().plugins.map((p) => ({
    ...pluginAppDef(p),
    access: "full" as AppAccess,
  }));
  return [...builtin, ...pluginApps];
}

/**
 * Reactive hook: returns the list of accessible apps (full + preview),
 * re-rendering when the feature flags change. Use in launch surfaces.
 */
export function useAccessibleApps(): Array<AppDefinition & { access: AppAccess }> {
  const subscriptionTier = useFeatures((s) => s.subscriptionTier);
  const disabledApps = useFeatures((s) => s.disabledApps);
  const appTiers = useFeatures((s) => s.appTiers);
  const pluginList = usePlugins((s) => s.plugins);
  return useMemo(
    () => {
      const builtin = APPS.map((a) => {
        let access: AppAccess = "full";
        if (UNDISABLEABLE.has(a.id)) access = "full";
        else if (disabledApps.has(a.id)) access = "hidden";
        else {
          const minTier = appTiers[a.id] ?? a.minTier ?? "free";
          access = TIER_RANK[subscriptionTier] >= TIER_RANK[minTier] ? "full" : "preview";
        }
        return { ...a, access };
      }).filter((a) => a.access !== "hidden");
      const pluginApps = pluginList.map((p) => ({
        ...pluginAppDef(p),
        access: "full" as AppAccess,
      }));
      return [...builtin, ...pluginApps];
    },
    [subscriptionTier, disabledApps, appTiers, pluginList]
  );
}

/** Reactive hook: returns isAppAccessible for a single app id. */
export function useAppAccessible(appId: AppId): AppAccess {
  const subscriptionTier = useFeatures((s) => s.subscriptionTier);
  const disabledApps = useFeatures((s) => s.disabledApps);
  const appTiers = useFeatures((s) => s.appTiers);
  const pluginList = usePlugins((s) => s.plugins);
  if (UNDISABLEABLE.has(appId)) return "full";
  if (disabledApps.has(appId)) return "hidden";
  if (isPluginAppId(appId)) {
    return pluginList.some((p) => pluginAppId(p.pluginKey) === appId) ? "full" : "hidden";
  }
  const def = APP_MAP[appId];
  if (!def) return "hidden";
  const minTier = appTiers[appId] ?? def.minTier ?? "free";
  return TIER_RANK[subscriptionTier] >= TIER_RANK[minTier] ? "full" : "preview";
}

/** Backward-compat alias for useAppAccessible returning boolean. */
export function useAppAvailable(appId: AppId): boolean {
  return useAppAccessible(appId) === "full";
}

/** Convenience: ensures features are loaded for the current session. Returns
 *  the loaded flag so callers can defer rendering until ready (optional). */
export function useFeaturesLoaded(): boolean {
  const loaded = useFeatures((s) => s.loaded);
  const load = useFeatures((s) => s.load);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return loaded;
}
