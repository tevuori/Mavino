// ===== Study Hub: learning workspaces =====
// Named, persistent groups of StudySources — a saved source set the student
// reuses to start grounded chats or podcasts without re-picking sources each
// time. Mounted at /api/study/workspaces.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { resolveAndCache, type SourceDescriptor } from "../services/study/source";

const workspaces = new Hono();
workspaces.use("*", authMiddleware);

function parseSourceIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function serialize(w: any) {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    color: w.color,
    sourceIds: parseSourceIds(w.sourceIds),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  color: z.string().max(20).optional(),
  /** Existing StudySource ids to include. */
  sourceIds: z.array(z.string()).max(50).default([]),
  /** On-the-fly sources to resolve + cache, then add to the workspace. */
  sources: z
    .array(
      z.object({
        kind: z.enum(["note", "file", "paste", "url"]),
        id: z.string().optional(),
        text: z.string().optional(),
        url: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .max(20)
    .optional(),
});

/** POST / — create a workspace. Accepts existing sourceIds and/or on-the-fly
 *  source descriptors (resolved + cached first). */
workspaces.post("/", zValidator("json", createSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  let sourceIds = [...body.sourceIds];
  if (body.sources && body.sources.length > 0) {
    for (const src of body.sources) {
      try {
        const cached = await resolveAndCache(userId, src as SourceDescriptor);
        if (!sourceIds.includes(cached.id)) sourceIds.push(cached.id);
      } catch {
        // skip sources that fail to resolve
      }
    }
  }

  const created = await prisma.learningWorkspace.create({
    data: {
      userId,
      name: body.name.slice(0, 200),
      description: body.description?.slice(0, 1000),
      color: body.color,
      sourceIds: JSON.stringify(sourceIds),
    },
  });

  return c.json({ workspace: serialize(created) }, 201);
});

/** GET / — list the user's workspaces. */
workspaces.get("/", async (c) => {
  const { userId } = c.get("auth");
  const rows = await prisma.learningWorkspace.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return c.json({ workspaces: rows.map(serialize) });
});

/** GET /:id — single workspace. */
workspaces.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const w = await prisma.learningWorkspace.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!w) return c.json({ error: "Workspace not found" }, 404);
  return c.json({ workspace: serialize(w) });
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  sourceIds: z.array(z.string()).max(50).optional(),
});

/** PATCH /:id — update name/description/color/sourceIds. */
workspaces.patch("/:id", zValidator("json", patchSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const w = await prisma.learningWorkspace.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!w) return c.json({ error: "Workspace not found" }, 404);
  const data: any = {};
  if (body.name !== undefined) data.name = body.name.slice(0, 200);
  if (body.description !== undefined) data.description = body.description?.slice(0, 1000) ?? null;
  if (body.color !== undefined) data.color = body.color ?? null;
  if (body.sourceIds !== undefined) data.sourceIds = JSON.stringify(body.sourceIds);
  const updated = await prisma.learningWorkspace.update({ where: { id: w.id }, data });
  return c.json({ workspace: serialize(updated) });
});

/** POST /:id/sources — add one or more sources (existing ids or on-the-fly
 *  descriptors) to the workspace. */
const addSourcesSchema = z.object({
  sourceIds: z.array(z.string()).max(20).optional(),
  sources: z
    .array(
      z.object({
        kind: z.enum(["note", "file", "paste", "url"]),
        id: z.string().optional(),
        text: z.string().optional(),
        url: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .max(20)
    .optional(),
});
workspaces.post("/:id/sources", zValidator("json", addSourcesSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const w = await prisma.learningWorkspace.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!w) return c.json({ error: "Workspace not found" }, 404);

  const current = new Set(parseSourceIds(w.sourceIds));
  const toAdd: string[] = [];
  for (const sid of body.sourceIds ?? []) {
    if (!current.has(sid)) toAdd.push(sid);
  }
  if (body.sources) {
    for (const src of body.sources) {
      try {
        const cached = await resolveAndCache(userId, src as SourceDescriptor);
        if (!current.has(cached.id) && !toAdd.includes(cached.id)) toAdd.push(cached.id);
      } catch { /* skip */ }
    }
  }
  const merged = [...parseSourceIds(w.sourceIds), ...toAdd];
  const updated = await prisma.learningWorkspace.update({
    where: { id: w.id },
    data: { sourceIds: JSON.stringify(merged) },
  });
  return c.json({ workspace: serialize(updated), added: toAdd.length });
});

/** DELETE /:id/sources/:sourceId — remove a source from the workspace. */
workspaces.delete("/:id/sources/:sourceId", async (c) => {
  const { userId } = c.get("auth");
  const w = await prisma.learningWorkspace.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!w) return c.json({ error: "Workspace not found" }, 404);
  const removeId = c.req.param("sourceId");
  const remaining = parseSourceIds(w.sourceIds).filter((sid) => sid !== removeId);
  const updated = await prisma.learningWorkspace.update({
    where: { id: w.id },
    data: { sourceIds: JSON.stringify(remaining) },
  });
  return c.json({ workspace: serialize(updated) });
});

/** DELETE /:id — delete the workspace (sources themselves are kept in the
 *  library for reuse by other workspaces / chats). */
workspaces.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const w = await prisma.learningWorkspace.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!w) return c.json({ error: "Workspace not found" }, 404);
  await prisma.learningWorkspace.delete({ where: { id: w.id } });
  return c.json({ ok: true });
});

export default workspaces;
