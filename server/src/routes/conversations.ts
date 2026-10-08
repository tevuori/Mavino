// ===== Athena chat conversation history =====
// Conversations are persisted as a single row with a JSON messages array.
// The "active" conversation is the one the user is currently chatting in.
// After 30 minutes of inactivity (or when the user starts a new chat),
// the active conversation is archived. Archived conversations are view-only.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { Message } from "multi-llm-ts";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { acquireLlmModel, getUserConfig } from "../services/athena/llm";
import { generateJson } from "../services/study/llm-json";

const conversations = new Hono();
conversations.use("*", authMiddleware);

const ARCHIVE_AFTER_MS = 30 * 60 * 1000; // 30 minutes

/** GET / — list conversations (active + archived). */
conversations.get("/", async (c) => {
  const { userId } = c.get("auth");

  // Auto-archive any active conversation older than 30 minutes.
  await autoArchive(userId);

  const list = await prisma.chatConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
    },
  });
  return c.json({ conversations: list });
});

/** GET /:id — full conversation with messages. */
conversations.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const conv = await prisma.chatConversation.findFirst({
    where: { id: c.req.param("id"), userId },
  });
  if (!conv) return c.json({ error: "Conversation not found" }, 404);
  return c.json({ conversation: conv });
});

/** POST / — create a new active conversation. Archives any existing active one. */
conversations.post("/", async (c) => {
  const { userId } = c.get("auth");

  // Archive any existing active conversation.
  await prisma.chatConversation.updateMany({
    where: { userId, status: "active" },
    data: { status: "archived" },
  });

  const conv = await prisma.chatConversation.create({
    data: { userId, status: "active", title: "New Chat" },
  });
  return c.json({ conversation: conv }, 201);
});

/** PUT /:id — update messages (called after each turn). */
const updateSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      tools: z.array(z.any()).optional(),
      timestamp: z.string().optional(),
    })
  ),
  title: z.string().optional(),
});

conversations.put("/:id", zValidator("json", updateSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const conv = await prisma.chatConversation.findFirst({
    where: { id: c.req.param("id"), userId },
  });
  if (!conv) return c.json({ error: "Conversation not found" }, 404);

  const updateData: Record<string, unknown> = {
    messages: body.messages,
    lastMessageAt: new Date(),
  };
  if (body.title) updateData.title = body.title;

  const updated = await prisma.chatConversation.update({
    where: { id: conv.id },
    data: updateData,
  });
  return c.json({ conversation: updated });
});

/** POST /:id/generate-title — use the LLM to generate a short title from the conversation. */
conversations.post("/:id/generate-title", async (c) => {
  const { userId } = c.get("auth");
  const conv = await prisma.chatConversation.findFirst({
    where: { id: c.req.param("id"), userId },
  });
  if (!conv) return c.json({ error: "Conversation not found" }, 404);

  const messages = conv.messages as Array<{ role: string; content: string }>;
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ title: conv.title });
  }

  // Build a summary of the conversation for the LLM.
  const transcript = messages
    .slice(0, 6) // first 6 messages are enough for a title
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join("\n");

  const cfg = await getUserConfig(userId);
  if (!cfg.apiKey) {
    // Fallback: use first user message as title.
    const firstUser = messages.find((m) => m.role === "user");
    const fallbackTitle = firstUser
      ? firstUser.content.slice(0, 50).replace(/\n/g, " ").trim() + (firstUser.content.length > 50 ? "…" : "")
      : "Untitled Chat";
    await prisma.chatConversation.update({
      where: { id: conv.id },
      data: { title: fallbackTitle },
    });
    return c.json({ title: fallbackTitle });
  }

  try {
    const { model } = await acquireLlmModel(userId, { feature: "conversations" });
    const title = await generateJson<{ title: string }>(
      model,
      `Based on this conversation, generate a very short descriptive title (max 5 words). The title should describe what the chat was about.\n\nConversation:\n${transcript}\n\nRespond with JSON: { "title": "short title here" }`,
      'Respond with: { "title": "string (max 5 words)" }'
    );

    const cleanTitle = (title.title || "Untitled Chat").slice(0, 80);
    await prisma.chatConversation.update({
      where: { id: conv.id },
      data: { title: cleanTitle },
    });
    return c.json({ title: cleanTitle });
  } catch {
    // Fallback: use first user message.
    const firstUser = messages.find((m) => m.role === "user");
    const fallbackTitle = firstUser
      ? firstUser.content.slice(0, 50).replace(/\n/g, " ").trim() + (firstUser.content.length > 50 ? "…" : "")
      : "Untitled Chat";
    await prisma.chatConversation.update({
      where: { id: conv.id },
      data: { title: fallbackTitle },
    });
    return c.json({ title: fallbackTitle });
  }
});

/** POST /:id/reactivate — make an archived conversation the active one. */
conversations.post("/:id/reactivate", async (c) => {
  const { userId } = c.get("auth");
  const conv = await prisma.chatConversation.findFirst({
    where: { id: c.req.param("id"), userId },
  });
  if (!conv) return c.json({ error: "Conversation not found" }, 404);

  // Archive any currently-active conversation first.
  await prisma.chatConversation.updateMany({
    where: { userId, status: "active" },
    data: { status: "archived" },
  });

  // Reactivate the selected conversation.
  const updated = await prisma.chatConversation.update({
    where: { id: conv.id },
    data: { status: "active" },
  });
  return c.json({ conversation: updated });
});

/** DELETE /:id — delete a conversation. */
conversations.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const conv = await prisma.chatConversation.findFirst({
    where: { id: c.req.param("id"), userId },
  });
  if (!conv) return c.json({ error: "Conversation not found" }, 404);
  await prisma.chatConversation.delete({ where: { id: conv.id } });
  return c.json({ ok: true });
});

/** POST /archive-all — archive all active conversations (used on logout etc). */
conversations.post("/archive-all", async (c) => {
  const { userId } = c.get("auth");
  await prisma.chatConversation.updateMany({
    where: { userId, status: "active" },
    data: { status: "archived" },
  });
  return c.json({ ok: true });
});

/** Auto-archive active conversations that have been inactive for >30 minutes. */
async function autoArchive(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_MS);
  await prisma.chatConversation.updateMany({
    where: {
      userId,
      status: "active",
      lastMessageAt: { lt: cutoff },
    },
    data: { status: "archived" },
  });
}

export default conversations;
