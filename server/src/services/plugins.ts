// ===== Plugin / App Marketplace service =====
// Catalog CRUD, per-user install/uninstall, tier gating, and the Athena tool
// loader that turns installed plugin tool manifests into ToolDefs (proxied to
// the plugin's handlerUrl webhook).
//
// Tier gating: the marketplace is available ONLY to paid/pro users. Free users
// get 403 on all marketplace routes and never see the Marketplace app. Each
// plugin also has its own minTier ("paid" | "pro") that further restricts who
// can install it.

import prisma from "../db/client";
import { getSubscriptionTier, type AppTier } from "./features";
import type { ToolDef } from "./athena/tools/plugin";
import type { PluginParameter } from "multi-llm-ts";

const TIER_RANK: Record<AppTier, number> = { free: 0, paid: 1, pro: 2 };

// ----- manifest types -----

export interface PluginToolManifest {
  name: string;
  description: string;
  parameters: PluginParameter[];
  handlerUrl: string;
  destructive?: boolean;
  requiresConfirmation?: boolean;
}

export interface PluginManifest {
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
  tools?: PluginToolManifest[];
}

// ----- public catalog DTO -----

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
  /** Number of active installs (for popularity display). */
  installCount: number;
  /** Whether the requesting user has this plugin installed. */
  installed: boolean;
  permissions: string[];
  hasTools: boolean;
}

// ----- tier gating -----

/** Returns true if the user can access the marketplace (paid or pro). */
export async function canAccessMarketplace(userId: string): Promise<boolean> {
  const tier = await getSubscriptionTier(userId);
  return TIER_RANK[tier] >= TIER_RANK.paid;
}

/** Returns true if the user's tier is high enough to install `plugin`. */
async function canInstallPlugin(userId: string, minTier: "paid" | "pro"): Promise<boolean> {
  const tier = await getSubscriptionTier(userId);
  return TIER_RANK[tier] >= TIER_RANK[minTier];
}

// ----- catalog queries -----

/** Get all published plugins as catalog entries (with install counts). */
export async function getPublishedCatalog(userId: string): Promise<PluginCatalogEntry[]> {
  const [plugins, userInstalls, installCounts] = await Promise.all([
    prisma.plugin.findMany({ where: { published: true }, orderBy: [{ featured: "desc" }, { name: "asc" }] }),
    prisma.userPlugin.findMany({ where: { userId }, select: { pluginKey: true } }),
    prisma.userPlugin.groupBy({ by: ["pluginKey"], _count: true }),
  ]);
  const installedKeys = new Set(userInstalls.map((u) => u.pluginKey));
  const countMap = new Map(installCounts.map((c) => [c.pluginKey, c._count]));
  return plugins.map((p) => ({
    id: p.id,
    pluginKey: p.pluginKey,
    name: p.name,
    description: p.description,
    icon: p.icon,
    version: p.version,
    author: p.author,
    category: p.category,
    minTier: (p.minTier === "pro" ? "pro" : "paid") as "paid" | "pro",
    featured: p.featured,
    installCount: countMap.get(p.pluginKey) ?? 0,
    installed: installedKeys.has(p.pluginKey),
    permissions: parseManifest(p.manifest).permissions ?? [],
    hasTools: (parseManifest(p.manifest).tools?.length ?? 0) > 0,
  }));
}

/** Get a single plugin by key (must be published). */
export async function getPublishedPlugin(pluginKey: string, userId: string) {
  const plugin = await prisma.plugin.findUnique({ where: { pluginKey } });
  if (!plugin || !plugin.published) return null;
  const install = await prisma.userPlugin.findUnique({
    where: { userId_pluginKey: { userId, pluginKey } },
  });
  return { plugin, installed: Boolean(install), enabled: install?.enabled ?? false };
}

// ----- install / uninstall -----

export async function installPlugin(userId: string, pluginKey: string): Promise<void> {
  const plugin = await prisma.plugin.findUnique({ where: { pluginKey } });
  if (!plugin || !plugin.published) throw new Error("Plugin not found");
  if (!(await canInstallPlugin(userId, plugin.minTier as "paid" | "pro"))) {
    throw new Error("Your subscription tier is too low for this plugin");
  }
  await prisma.userPlugin.upsert({
    where: { userId_pluginKey: { userId, pluginKey } },
    create: { userId, pluginKey, enabled: true },
    update: { enabled: true },
  });
}

export async function uninstallPlugin(userId: string, pluginKey: string): Promise<void> {
  await prisma.userPlugin.deleteMany({ where: { userId, pluginKey } });
}

export async function setPluginEnabled(userId: string, pluginKey: string, enabled: boolean): Promise<void> {
  await prisma.userPlugin.update({
    where: { userId_pluginKey: { userId, pluginKey } },
    data: { enabled },
  });
}

// ----- installed plugins (for the client registry) -----

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

export async function getInstalledPlugins(userId: string): Promise<InstalledPlugin[]> {
  const rows = await prisma.userPlugin.findMany({
    where: { userId, enabled: true },
    include: { plugin: true },
  });
  return rows.map((r) => {
    const m = parseManifest(r.plugin.manifest);
    return {
      pluginKey: r.pluginKey,
      name: r.plugin.name,
      description: r.plugin.description,
      icon: r.plugin.icon,
      version: r.plugin.version,
      author: r.plugin.author,
      category: r.plugin.category,
      entryUrl: r.plugin.entryUrl,
      minTier: (r.plugin.minTier === "pro" ? "pro" : "paid") as "paid" | "pro",
      enabled: r.enabled,
      permissions: m.permissions ?? [],
      hasTools: (m.tools?.length ?? 0) > 0,
    };
  });
}

// ----- Athena tool loader (plugin tools) -----

/**
 * Load all Athena tool definitions from a user's installed+enabled plugins.
 * Each plugin tool is proxied: the handler POSTs the tool args to the plugin's
 * handlerUrl webhook. The plugin's backend never sees the user's JWT/session.
 */
export async function loadPluginTools(userId: string): Promise<ToolDef[]> {
  const installed = await getInstalledPlugins(userId);
  const tools: ToolDef[] = [];
  for (const plugin of installed) {
    const pluginRow = await prisma.plugin.findUnique({ where: { pluginKey: plugin.pluginKey } });
    if (!pluginRow) continue;
    const manifest = parseManifest(pluginRow.manifest);
    if (!manifest.tools) continue;
    for (const toolManifest of manifest.tools) {
      tools.push(buildPluginTool(plugin.pluginKey, toolManifest));
    }
  }
  return tools;
}

/** Build a single ToolDef that proxies execution to a plugin webhook. */
function buildPluginTool(pluginKey: string, tm: PluginToolManifest): ToolDef {
  return {
    name: tm.name,
    description: tm.description,
    parameters: tm.parameters,
    destructive: tm.destructive,
    requiresConfirmation: tm.requiresConfirmation,
    handler: async (args: any) => {
      try {
        const res = await fetch(tm.handlerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plugin: pluginKey, arguments: args }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { error: `Plugin tool ${tm.name} returned ${res.status}: ${text.slice(0, 200)}` };
        }
        const data = await res.json().catch(() => ({}));
        return data;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Plugin tool request failed";
        return { error: `Plugin tool ${tm.name} failed: ${msg}` };
      }
    },
  };
}

// ----- admin: catalog management -----

export async function adminListAllPlugins() {
  const plugins = await prisma.plugin.findMany({ orderBy: { createdAt: "desc" } });
  const counts = await prisma.userPlugin.groupBy({ by: ["pluginKey"], _count: true });
  const countMap = new Map(counts.map((c) => [c.pluginKey, c._count]));
  return plugins.map((p) => ({
    ...p,
    installCount: countMap.get(p.pluginKey) ?? 0,
  }));
}

export async function adminCreatePlugin(manifest: PluginManifest): Promise<void> {
  const pluginKey = manifest.id;
  const existing = await prisma.plugin.findUnique({ where: { pluginKey } });
  if (existing) throw new Error(`Plugin "${pluginKey}" already exists`);
  await prisma.plugin.create({
    data: {
      pluginKey,
      name: manifest.name,
      description: manifest.description ?? "",
      icon: manifest.icon ?? "Puzzle",
      version: manifest.version ?? "1.0.0",
      author: manifest.author ?? "",
      category: manifest.category ?? "general",
      entryUrl: manifest.entryUrl,
      manifest: JSON.stringify(manifest),
      minTier: manifest.minTier ?? "paid",
      featured: false,
      published: true,
    },
  });
}

export async function adminUpdatePlugin(pluginKey: string, manifest: Partial<PluginManifest>): Promise<void> {
  const existing = await prisma.plugin.findUnique({ where: { pluginKey } });
  if (!existing) throw new Error("Plugin not found");
  const data: Record<string, unknown> = {};
  if (manifest.name !== undefined) data.name = manifest.name;
  if (manifest.description !== undefined) data.description = manifest.description;
  if (manifest.icon !== undefined) data.icon = manifest.icon;
  if (manifest.version !== undefined) data.version = manifest.version;
  if (manifest.author !== undefined) data.author = manifest.author;
  if (manifest.category !== undefined) data.category = manifest.category;
  if (manifest.entryUrl !== undefined) data.entryUrl = manifest.entryUrl;
  if (manifest.minTier !== undefined) data.minTier = manifest.minTier;
  // If a full manifest is provided, re-serialize it.
  if (manifest.id !== undefined || manifest.tools !== undefined || manifest.permissions !== undefined) {
    const old = parseManifest(existing.manifest);
    const merged: PluginManifest = {
      ...old,
      ...manifest,
      id: pluginKey,
      entryUrl: manifest.entryUrl ?? existing.entryUrl,
    };
    data.manifest = JSON.stringify(merged);
  }
  await prisma.plugin.update({ where: { pluginKey }, data });
}

export async function adminDeletePlugin(pluginKey: string): Promise<void> {
  await prisma.plugin.delete({ where: { pluginKey } });
}

export async function adminSetFeatured(pluginKey: string, featured: boolean): Promise<void> {
  await prisma.plugin.update({ where: { pluginKey }, data: { featured } });
}

export async function adminSetPublished(pluginKey: string, published: boolean): Promise<void> {
  await prisma.plugin.update({ where: { pluginKey }, data: { published } });
}

// ----- helpers -----

function parseManifest(raw: string): PluginManifest {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as PluginManifest;
  } catch {
    /* corrupt JSON — treat as empty */
  }
  return { id: "", name: "", entryUrl: "" };
}
