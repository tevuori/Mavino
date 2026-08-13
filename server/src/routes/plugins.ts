// ===== Plugin / App Marketplace routes =====
// Marketplace catalog browsing + install/uninstall (paid/pro users only),
// and admin catalog management (publish/update/delete plugins).
//
// Tier gating: ALL marketplace routes require a paid or pro subscription.
// Free users get 402 (Payment Required) — the marketplace is a paid feature.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import {
  canAccessMarketplace,
  getPublishedCatalog,
  getPublishedPlugin,
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  getInstalledPlugins,
  adminListAllPlugins,
  adminCreatePlugin,
  adminUpdatePlugin,
  adminDeletePlugin,
  adminSetFeatured,
  adminSetPublished,
  type PluginManifest,
} from "../services/plugins";

const plugins = new Hono();
plugins.use("*", authMiddleware);

/** Middleware: 402 if the user is on the free tier (marketplace is paid-only). */
async function marketplaceGate(c: Parameters<Parameters<typeof plugins.use>[1]>[0], next: Parameters<Parameters<typeof plugins.use>[1]>[1]) {
  const { userId } = c.get("auth");
  if (!(await canAccessMarketplace(userId))) {
    return c.json({ error: "The Plugin Marketplace is a paid feature. Upgrade to Paid or Pro to browse and install plugins." }, 402);
  }
  await next();
}

// ----- marketplace browsing (paid/pro only) -----

/** GET /api/plugins — published catalog (with install status + counts). */
plugins.get("/", marketplaceGate, async (c) => {
  const { userId } = c.get("auth");
  const catalog = await getPublishedCatalog(userId);
  return c.json({ plugins: catalog });
});

/** GET /api/plugins/:pluginKey — single plugin detail. */
plugins.get("/:pluginKey", marketplaceGate, async (c) => {
  const { userId } = c.get("auth");
  const pluginKey = c.req.param("pluginKey")!;
  const detail = await getPublishedPlugin(pluginKey, userId);
  if (!detail) return c.json({ error: "Plugin not found" }, 404);
  return c.json(detail);
});

// ----- installed plugins (for the client registry) -----

/** GET /api/plugins/installed — the current user's installed+enabled plugins. */
plugins.get("/installed", marketplaceGate, async (c) => {
  const { userId } = c.get("auth");
  const installed = await getInstalledPlugins(userId);
  return c.json({ plugins: installed });
});

// ----- install / uninstall / toggle -----

const installSchema = z.object({}).optional().default({});

/** POST /api/plugins/:pluginKey/install — install a plugin. */
plugins.post("/:pluginKey/install", marketplaceGate, zValidator("json", installSchema), async (c) => {
  const { userId } = c.get("auth");
  const pluginKey = c.req.param("pluginKey")!;
  try {
    await installPlugin(userId, pluginKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Install failed";
    const status = msg.includes("not found") ? 404 : msg.includes("tier") ? 402 : 400;
    return c.json({ error: msg }, status as 400 | 402 | 404);
  }
  return c.json({ ok: true });
});

/** DELETE /api/plugins/:pluginKey/install — uninstall a plugin. */
plugins.delete("/:pluginKey/install", marketplaceGate, async (c) => {
  const { userId } = c.get("auth");
  const pluginKey = c.req.param("pluginKey")!;
  await uninstallPlugin(userId, pluginKey);
  return c.json({ ok: true });
});

const enabledSchema = z.object({ enabled: z.boolean() });

/** PUT /api/plugins/:pluginKey/enabled — enable/disable an installed plugin. */
plugins.put("/:pluginKey/enabled", marketplaceGate, zValidator("json", enabledSchema), async (c) => {
  const { userId } = c.get("auth");
  const pluginKey = c.req.param("pluginKey")!;
  const { enabled } = c.req.valid("json");
  try {
    await setPluginEnabled(userId, pluginKey, enabled);
  } catch {
    return c.json({ error: "Plugin not installed" }, 404);
  }
  return c.json({ ok: true, enabled });
});

// ----- admin: catalog management -----

const admin = new Hono();
admin.use("*", adminMiddleware);

/** GET /api/plugins/admin — all plugins (including unpublished) + install counts. */
admin.get("/", async (c) => {
  const list = await adminListAllPlugins();
  return c.json({ plugins: list });
});

const createSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "id must be lowercase kebab-case"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  version: z.string().max(20).optional(),
  author: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  entryUrl: z.string().url(),
  minTier: z.enum(["paid", "pro"]).optional(),
  permissions: z.array(z.string()).optional(),
  tools: z.array(z.object({
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(500),
    parameters: z.array(z.any()),
    handlerUrl: z.string().url(),
    destructive: z.boolean().optional(),
    requiresConfirmation: z.boolean().optional(),
  })).optional(),
});

/** POST /api/plugins/admin — publish a new plugin from a manifest. */
admin.post("/", zValidator("json", createSchema), async (c) => {
  const manifest = c.req.valid("json") as PluginManifest;
  try {
    await adminCreatePlugin(manifest);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Create failed" }, 400);
  }
  return c.json({ ok: true }, 201);
});

/** PUT /api/plugins/admin/:pluginKey — update an existing plugin. */
admin.put("/:pluginKey", zValidator("json", createSchema.partial()), async (c) => {
  const pluginKey = c.req.param("pluginKey")!;
  const manifest = c.req.valid("json") as Partial<PluginManifest>;
  try {
    await adminUpdatePlugin(pluginKey, manifest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    return c.json({ error: msg }, msg.includes("not found") ? 404 : 400);
  }
  return c.json({ ok: true });
});

/** DELETE /api/plugins/admin/:pluginKey — remove a plugin from the catalog. */
admin.delete("/:pluginKey", async (c) => {
  const pluginKey = c.req.param("pluginKey")!;
  try {
    await adminDeletePlugin(pluginKey);
  } catch {
    return c.json({ error: "Plugin not found" }, 404);
  }
  return c.json({ ok: true });
});

const featuredSchema = z.object({ featured: z.boolean() });

/** PUT /api/plugins/admin/:pluginKey/featured — toggle featured status. */
admin.put("/:pluginKey/featured", zValidator("json", featuredSchema), async (c) => {
  const pluginKey = c.req.param("pluginKey")!;
  const { featured } = c.req.valid("json");
  try {
    await adminSetFeatured(pluginKey, featured);
  } catch {
    return c.json({ error: "Plugin not found" }, 404);
  }
  return c.json({ ok: true });
});

const publishedSchema = z.object({ published: z.boolean() });

/** PUT /api/plugins/admin/:pluginKey/published — toggle published status. */
admin.put("/:pluginKey/published", zValidator("json", publishedSchema), async (c) => {
  const pluginKey = c.req.param("pluginKey")!;
  const { published } = c.req.valid("json");
  try {
    await adminSetPublished(pluginKey, published);
  } catch {
    return c.json({ error: "Plugin not found" }, 404);
  }
  return c.json({ ok: true });
});

plugins.route("/admin", admin);

export default plugins;
