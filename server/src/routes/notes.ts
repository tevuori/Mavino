import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { cleanupOrphanLinks } from "../db/links";
import { getAccessibleFolders, checkFolderAccess } from "../services/circle";
import {
  ensureSyncedVFolder,
  syncRename,
  syncMove,
  getSyncedFolderStats,
  deleteSyncedCounterpart,
} from "../services/folderSync";

const notes = new Hono();
notes.use("*", authMiddleware);

// ---------- Folders ----------
const folderSchema = z.object({
  name: z.string().min(1).max(64),
  parentId: z.string().nullable().optional(),
  position: z.number().int().optional().default(0),
});

notes.get("/folders", async (c) => {
  const { userId } = c.get("auth");
  const ownFolders = await prisma.noteFolder.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
  // Merge in note folders shared with this user via Circle groups.
  const shared = await getAccessibleFolders(userId);
  const sharedFolders = shared.map((s) => ({
    id: s.folderId,
    name: s.folderName,
    parentId: null,
    position: 0,
    shared: true,
    sharedPermission: s.permission,
    sharedGroupName: s.groupName,
    sharedByName: s.sharedByName,
  }));
  return c.json({ folders: [...ownFolders, ...sharedFolders] });
});

notes.post("/folders", zValidator("json", folderSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const folder = await prisma.noteFolder.create({
    data: { ...body, userId, parentId: body.parentId ?? null },
  });
  // Mirror the new folder in the Files app so the two folder trees stay aligned.
  try {
    await ensureSyncedVFolder(userId, folder.id);
  } catch {
    // Non-fatal: the note folder exists even if the sync fails.
  }
  return c.json({ folder }, 201);
});

notes.patch("/folders/:id", zValidator("json", folderSchema.partial()), async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const folder = await prisma.noteFolder.update({
    where: { id, userId },
    data: body,
  });
  if (body.name !== undefined) {
    try {
      await syncRename(userId, "note", id, body.name);
    } catch {
      // Non-fatal: note folder rename succeeded.
    }
  }
  return c.json({ folder });
});

// Move a note folder under a new parent (or root) with sync to files.
const moveFolderSchema = z.object({ parentId: z.string().nullable() });
notes.patch("/folders/:id/move", zValidator("json", moveFolderSchema), async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  const { parentId } = c.req.valid("json");

  if (parentId === id) return c.json({ error: "Cannot move folder into itself" }, 400);

  // Cycle detection: parentId must not be a descendant of id.
  if (parentId !== null) {
    const allFolders = await prisma.noteFolder.findMany({ where: { userId } });
    const byParent = new Map<string | null, typeof allFolders>();
    for (const f of allFolders) {
      const key = f.parentId ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(f);
    }
    const descendants = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of byParent.get(cur) ?? []) {
        if (!descendants.has(child.id)) {
          descendants.add(child.id);
          stack.push(child.id);
        }
      }
    }
    if (descendants.has(parentId)) {
      return c.json({ error: "Cannot move folder into its own descendant" }, 400);
    }
    const target = allFolders.find((f) => f.id === parentId);
    if (!target) return c.json({ error: "Target folder not found" }, 404);
  }

  await prisma.noteFolder.update({
    where: { id, userId },
    data: { parentId: parentId ?? null },
  });
  try {
    await syncMove(userId, "note", id, parentId ?? null);
  } catch {
    // Non-fatal: note folder moved successfully.
  }
  return c.json({ ok: true });
});

notes.delete("/folders/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  const cascadeToSynced = c.req.query("cascadeToSynced") === "true";

  if (!cascadeToSynced) {
    const stats = await getSyncedFolderStats(userId, "note", id);
    if (stats.syncedFolderId && (stats.fileCount > 0 || stats.noteCount > 0)) {
      return c.json(
        {
          error: "Synced folder contains items",
          syncedFolderId: stats.syncedFolderId,
          noteCount: stats.noteCount,
          fileCount: stats.fileCount,
        },
        409
      );
    }
  }

  if (cascadeToSynced) {
    try {
      await deleteSyncedCounterpart(userId, "note", id);
    } catch {
      // Counterpart may already be gone.
    }
  }
  await prisma.noteFolder.delete({ where: { id, userId } });
  return c.json({ ok: true });
});

// ---------- Notes ----------
const noteSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().optional(),
  tags: z.string().optional(),
  folderId: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
});

notes.get("/", async (c) => {
  const { userId } = c.get("auth");
  const q = c.req.query("q");
  const folderId = c.req.query("folderId");

  // If a shared folder is requested, verify access and return its notes
  // (scoped to that folder, owned by whoever shared it — not the current user).
  if (folderId && folderId !== "null") {
    const access = await checkFolderAccess(userId, folderId);
    if (access.hasAccess) {
      const where: Record<string, unknown> = { folderId };
      if (q) {
        where.OR = [
          { title: { contains: q, mode: "insensitive" } },
          { content: { contains: q, mode: "insensitive" } },
          { tags: { contains: q, mode: "insensitive" } },
        ];
      }
      const list = await prisma.note.findMany({
        where: where as never,
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      });
      return c.json({ notes: list, sharedFolderPermission: access.permission });
    }
  }

  const where: Record<string, unknown> = { userId };
  if (folderId) where.folderId = folderId === "null" ? null : folderId;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { content: { contains: q, mode: "insensitive" } },
      { tags: { contains: q, mode: "insensitive" } },
    ];
  }
  const list = await prisma.note.findMany({
    where: where as never,
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
  });
  return c.json({ notes: list });
});

notes.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  // Own note?
  const note = await prisma.note.findFirst({ where: { id, userId } });
  if (note) return c.json({ note });
  // Otherwise check whether the note lives in a shared folder the user can access.
  const anyNote = await prisma.note.findUnique({ where: { id } });
  if (anyNote && anyNote.folderId) {
    const access = await checkFolderAccess(userId, anyNote.folderId);
    if (access.hasAccess) {
      return c.json({ note: anyNote, sharedFolderPermission: access.permission });
    }
  }
  return c.json({ error: "Not found" }, 404);
});

notes.post("/", zValidator("json", noteSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const note = await prisma.note.create({
    data: { ...body, userId, folderId: body.folderId ?? null } as never,
  });
  return c.json({ note }, 201);
});

notes.patch("/:id", zValidator("json", noteSchema), async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  // Own note?
  const own = await prisma.note.findFirst({ where: { id, userId } });
  if (own) {
    const note = await prisma.note.update({ where: { id }, data: body as never });
    return c.json({ note });
  }
  // Otherwise, allow editing if the note is in a shared folder with write access.
  const anyNote = await prisma.note.findUnique({ where: { id } });
  if (anyNote && anyNote.folderId) {
    const access = await checkFolderAccess(userId, anyNote.folderId);
    if (access.hasAccess && access.permission === "write") {
      const note = await prisma.note.update({ where: { id }, data: body as never });
      return c.json({ note });
    }
    if (access.hasAccess) {
      return c.json({ error: "This shared folder is read-only" }, 403);
    }
  }
  return c.json({ error: "Not found" }, 404);
});

notes.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  // Own note?
  const own = await prisma.note.findFirst({ where: { id, userId } });
  if (own) {
    await prisma.note.delete({ where: { id } });
    await cleanupOrphanLinks(userId, "note", id);
    return c.json({ ok: true });
  }
  // Allow deleting from a shared folder only with write access.
  const anyNote = await prisma.note.findUnique({ where: { id } });
  if (anyNote && anyNote.folderId) {
    const access = await checkFolderAccess(userId, anyNote.folderId);
    if (access.hasAccess && access.permission === "write") {
      await prisma.note.delete({ where: { id } });
      return c.json({ ok: true });
    }
    if (access.hasAccess) {
      return c.json({ error: "This shared folder is read-only" }, 403);
    }
  }
  return c.json({ error: "Not found" }, 404);
});

export default notes;
