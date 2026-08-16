import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { cleanupOrphanLinks } from "../db/links";
import { getAccessibleFolders, checkFolderAccess } from "../services/circle";

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
  return c.json({ folder });
});

notes.delete("/folders/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
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
          { title: { contains: q } },
          { content: { contains: q } },
          { tags: { contains: q } },
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
      { title: { contains: q } },
      { content: { contains: q } },
      { tags: { contains: q } },
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
