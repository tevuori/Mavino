// ===== Circle routes (Pro-tier shared study spaces) =====
// CRUD for study groups; join/leave; member management; sharing decks and
// note folders; accessible resources lookup.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { isAppAvailableFor } from "../services/features";
import {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  joinGroup,
  leaveGroup,
  updateMemberRole,
  removeMember,
  shareDeck,
  unshareDeck,
  shareNoteFolder,
  unshareNoteFolder,
  getAccessibleDecks,
  getAccessibleFolders,
} from "../services/circle";

const circle = new Hono();
circle.use("*", authMiddleware);

/** Middleware: 402 if the user can't access the Circle app (Pro-only). */
async function circleGate(c: any, next: any) {
  const { userId } = c.get("auth");
  if (!(await isAppAvailableFor(userId, "circle"))) {
    return c.json({ error: "Circle is a Pro feature. Upgrade to Pro to create shared study spaces." }, 402);
  }
  await next();
}

circle.use("*", circleGate);

const createGroupSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
});

const updateGroupSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
});

const joinSchema = z.object({
  inviteCode: z.string().max(20),
});

const shareDeckSchema = z.object({
  deckId: z.string().max(200),
  permission: z.enum(["read", "write"]).optional(),
});

const shareFolderSchema = z.object({
  folderId: z.string().max(200),
  permission: z.enum(["read", "write"]).optional(),
});

const updateRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

/** GET /groups — list the user's groups. */
circle.get("/groups", async (c) => {
  const { userId } = c.get("auth");
  const groups = await listGroups(userId);
  return c.json({ groups });
});

/** POST /groups — create a new group. */
circle.post("/groups", zValidator("json", createGroupSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  if (!body.name?.trim()) return c.json({ error: "Group name is required." }, 400);
  const group = await createGroup(userId, { name: body.name, description: body.description });
  return c.json({ group }, 201);
});

/** GET /groups/:id — get a group with members + shared resources. */
circle.get("/groups/:id", async (c) => {
  const { userId } = c.get("auth");
  const group = await getGroup(userId, c.req.param("id"));
  if (!group) return c.json({ error: "Group not found or you're not a member" }, 404);
  return c.json({ group });
});

/** PATCH /groups/:id — update group metadata. */
circle.patch("/groups/:id", zValidator("json", updateGroupSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  try {
    await updateGroup(userId, c.req.param("id"), body);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Update failed" }, 400);
  }
});

/** DELETE /groups/:id — delete a group (owner only). */
circle.delete("/groups/:id", async (c) => {
  const { userId } = c.get("auth");
  try {
    await deleteGroup(userId, c.req.param("id"));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Delete failed" }, 400);
  }
});

/** POST /groups/join — join a group via invite code. */
circle.post("/groups/join", zValidator("json", joinSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  try {
    const group = await joinGroup(userId, body.inviteCode);
    return c.json({ group }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Join failed" }, 400);
  }
});

/** POST /groups/:id/leave — leave a group. */
circle.post("/groups/:id/leave", async (c) => {
  const { userId } = c.get("auth");
  try {
    await leaveGroup(userId, c.req.param("id"));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Leave failed" }, 400);
  }
});

/** PATCH /groups/:id/members/:memberUserId — update a member's role (owner only). */
circle.patch("/groups/:id/members/:memberUserId", zValidator("json", updateRoleSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  try {
    await updateMemberRole(userId, c.req.param("id"), c.req.param("memberUserId"), body.role);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Update failed" }, 400);
  }
});

/** DELETE /groups/:id/members/:memberUserId — remove a member (owner/admin only). */
circle.delete("/groups/:id/members/:memberUserId", async (c) => {
  const { userId } = c.get("auth");
  try {
    await removeMember(userId, c.req.param("id"), c.req.param("memberUserId"));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Remove failed" }, 400);
  }
});

/** POST /groups/:id/decks — share a deck to the group. */
circle.post("/groups/:id/decks", zValidator("json", shareDeckSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  try {
    await shareDeck(userId, c.req.param("id"), body.deckId, body.permission ?? "read");
    return c.json({ ok: true }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Share failed" }, 400);
  }
});

/** DELETE /groups/:id/decks/:deckId — unshare a deck. */
circle.delete("/groups/:id/decks/:deckId", async (c) => {
  const { userId } = c.get("auth");
  try {
    await unshareDeck(userId, c.req.param("id"), c.req.param("deckId"));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Unshare failed" }, 400);
  }
});

/** POST /groups/:id/folders — share a note folder to the group. */
circle.post("/groups/:id/folders", zValidator("json", shareFolderSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  try {
    await shareNoteFolder(userId, c.req.param("id"), body.folderId, body.permission ?? "read");
    return c.json({ ok: true }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Share failed" }, 400);
  }
});

/** DELETE /groups/:id/folders/:folderId — unshare a note folder. */
circle.delete("/groups/:id/folders/:folderId", async (c) => {
  const { userId } = c.get("auth");
  try {
    await unshareNoteFolder(userId, c.req.param("id"), c.req.param("folderId"));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Unshare failed" }, 400);
  }
});

/** GET /decks — list all decks accessible to the user via shared groups. */
circle.get("/decks", async (c) => {
  const { userId } = c.get("auth");
  const decks = await getAccessibleDecks(userId);
  return c.json({ decks });
});

/** GET /folders — list all note folders accessible to the user via shared groups. */
circle.get("/folders", async (c) => {
  const { userId } = c.get("auth");
  const folders = await getAccessibleFolders(userId);
  return c.json({ folders });
});

export default circle;
