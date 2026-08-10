// ===== Plugin / Marketplace API client =====

import { api } from "./api";

export interface PluginCatalogEntry {
  id: string;
  pluginKey: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  author: string;
  category: string;
  minTier: "paid" | "pro";
  featured: boolean;
  installCount: number;
  installed: boolean;
  permissions: string[];
  hasTools: boolean;
}

export interface InstalledPlugin {
  pluginKey: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  author: string;
  category: string;
  entryUrl: string;
  minTier: "paid" | "pro";
  enabled: boolean;
  permissions: string[];
  hasTools: boolean;
}

export interface AdminPlugin extends PluginCatalogEntry {
  entryUrl: string;
  manifest: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export const pluginsApi = {
  /** Browse the published marketplace catalog. */
  getCatalog: () => api.get<{ plugins: PluginCatalogEntry[] }>("/api/plugins"),
  /** Get a single plugin's detail. */
  getPlugin: (pluginKey: string) =>
    api.get<{ plugin: Record<string, unknown>; installed: boolean; enabled: boolean }>(
      `/api/plugins/${pluginKey}`
    ),
  /** List the current user's installed+enabled plugins. */
  getInstalled: () => api.get<{ plugins: InstalledPlugin[] }>("/api/plugins/installed"),
  /** Install a plugin. */
  install: (pluginKey: string) =>
    api.post<{ ok: boolean }>(`/api/plugins/${pluginKey}/install`),
  /** Uninstall a plugin. */
  uninstall: (pluginKey: string) =>
    api.delete<{ ok: boolean }>(`/api/plugins/${pluginKey}/install`),
  /** Enable/disable an installed plugin. */
  setEnabled: (pluginKey: string, enabled: boolean) =>
    api.put<{ ok: boolean; enabled: boolean }>(`/api/plugins/${pluginKey}/enabled`, { enabled }),
};

// ----- admin API -----

export interface PluginManifestInput {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  version?: string;
  author?: string;
  category?: string;
  entryUrl: string;
  minTier?: "paid" | "pro";
  permissions?: string[];
  tools?: Array<{
    name: string;
    description: string;
    parameters: unknown[];
    handlerUrl: string;
    destructive?: boolean;
    requiresConfirmation?: boolean;
  }>;
}

export const pluginsAdminApi = {
  list: () => api.get<{ plugins: AdminPlugin[] }>("/api/plugins/admin"),
  create: (manifest: PluginManifestInput) =>
    api.post<{ ok: boolean }>("/api/plugins/admin", manifest),
  update: (pluginKey: string, manifest: Partial<PluginManifestInput>) =>
    api.put<{ ok: boolean }>(`/api/plugins/admin/${pluginKey}`, manifest),
  remove: (pluginKey: string) =>
    api.delete<{ ok: boolean }>(`/api/plugins/admin/${pluginKey}`),
  setFeatured: (pluginKey: string, featured: boolean) =>
    api.put<{ ok: boolean }>(`/api/plugins/admin/${pluginKey}/featured`, { featured }),
  setPublished: (pluginKey: string, published: boolean) =>
    api.put<{ ok: boolean }>(`/api/plugins/admin/${pluginKey}/published`, { published }),
};
