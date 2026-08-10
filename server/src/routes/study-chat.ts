// ===== Study Hub: source-grounded Q&A (NotebookLM-style) =====
// Persisted StudyChat conversations scoped to a set of StudySources. The
// /:id/stream endpoint injects the sources as numbered SOURCE blocks into the
// system prompt and streams a cited answer via SSE (reusing the Athena chat
// streaming pattern). Inline [n] citations are persisted with each assistant
// message so the client can render them as clickable chips on resume.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { Message } from "multi-llm-ts";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { studyFunctionMiddleware } from "../middleware/study-functions";
import { acquireLlmModel, isLlmConfiguredFor } from "../services/athena/llm";
import { groundedQaSystemPrompt, type GroundedSource, type StudyLanguage } from "../services/study/prompts";
import { logSessionSafe } from "../services/study/logSession";
import { canonicalPair } from "../db/links";

const chat = new Hono();
chat.use("*", authMiddleware, studyFunctionMiddleware("chat"));

interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  citations?: { index: number; name: string; kind: string; refId: string }[];
  timestamp: string;
}

function parseMessages(raw: string): StoredMessage[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseSourceIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Load the GroundedSource list (with cached text) for a chat. */
async function loadChatSources(userId: string, sourceIds: string[]): Promise<GroundedSource[]> {
  if (sourceIds.length === 0) return [];
  const rows = await prisma.studySource.findMany({
    where: { id: { in: sourceIds }, userId },
  });
  // Preserve the sourceIds order so citation indices are stable.
  return sourceIds
    .map((id, i) => {
      const r = rows.find((x) => x.id === id);
      if (!r) return null;
      return {
        index: i + 1,
        name: r.name,
        kind: r.kind,
        refId: r.refId,
        text: r.textCache,
      } as GroundedSource;
    })
    .filter((x): x is GroundedSource => x !== null);
}

/** Extract [n] citations present in an assistant message and resolve them
 *  against the chat's sources for persistent, clickable references. */
function extractCitations(
  text: string,
  sources: GroundedSource[]
): { index: number; name: string; kind: string; refId: string }[] {
  const found = new Set<number>();
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(Number(m[1]));
  }
  const out: { index: number; name: string; kind: string; refId: string }[] = [];
  for (const idx of [...found].sort((a, b) => a - b)) {
    const s = sources.find((x) => x.index === idx);
    if (s) out.push({ index: s.index, name: s.name, kind: s.kind, refId: s.refId });
  }
  return out;
}

function serialize(c: any) {
  return {
    id: c.id,
    title: c.title,
    sourceIds: parseSourceIds(c.sourceIds),
    messages: parseMessages(c.messages),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lastMessageAt: c.lastMessageAt.toISOString(),
  };
}

// ---------- CRUD ----------

const createSchema = z.object({
  title: z.string().max(200).optional(),
  sourceIds: z.array(z.string()).max(10).default([]),
  /** Optional on-the-fly sources to resolve + cache before creating the chat. */
  sources: z
    .array(
      z.object({
        kind: z.enum(["note", "file", "paste", "moodle", "url"]),
        id: z.string().optional(),
        text: z.string().optional(),
        url: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .max(10)
    .optional(),
});

/** POST / — create a chat. Accepts either existing sourceIds or on-the-fly
 *  source descriptors (which are resolved + cached first). */
chat.post("/", zValidator("json", createSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  let sourceIds = [...body.sourceIds];
  if (body.sources && body.sources.length > 0) {
    const { resolveAndCache } = await import("../services/study/source");
    for (const src of body.sources) {
      try {
        const cached = await resolveAndCache(userId, src as any);
        if (!sourceIds.includes(cached.id)) sourceIds.push(cached.id);
      } catch {
        // skip sources that fail to resolve
      }
    }
  }

  // Derive a title from the first source name if none provided.
  let title = body.title?.trim();
  if (!title) {
    if (sourceIds.length > 0) {
      const first = await prisma.studySource.findFirst({
        where: { id: sourceIds[0], userId },
        select: { name: true },
      });
      title = first ? `Study chat: ${first.name}` : "New Study Chat";
    } else {
      title = "New Study Chat";
    }
  }

  const created = await prisma.studyChat.create({
    data: {
      userId,
      title: title.slice(0, 200),
      sourceIds: JSON.stringify(sourceIds),
      messages: "[]",
    },
  });

  // Auto-link the chat to each underlying note/file source (so the source's
  // "Linked items" panel surfaces this chat).
  for (const sid of sourceIds) {
    const src = await prisma.studySource.findFirst({ where: { id: sid, userId } });
    if (!src) continue;
    const targetType = src.kind === "note" ? "note" : src.kind === "file" ? "file" : null;
    if (targetType && src.refId && src.refId !== "paste") {
      const pair = canonicalPair(
        { type: "studyChat", id: created.id },
        { type: targetType, id: src.refId }
      );
      await prisma.itemLink.upsert({
        where: { userId_srcType_srcId_dstType_dstId: { userId, ...pair } },
        update: {},
        create: { userId, ...pair },
      });
    }
  }

  return c.json({ chat: serialize(created) }, 201);
});

/** GET / — list the user's chats (no messages). */
chat.get("/", async (c) => {
  const { userId } = c.get("auth");
  const rows = await prisma.studyChat.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return c.json({ chats: rows.map((r) => ({ ...serialize(r), messages: undefined })) });
});

/** GET /:id — full chat incl. messages. */
chat.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const row = await prisma.studyChat.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Chat not found" }, 404);
  return c.json({ chat: serialize(row) });
});

/** PATCH /:id — update title or sourceIds. */
const patchSchema = z.object({
  title: z.string().max(200).optional(),
  sourceIds: z.array(z.string()).max(10).optional(),
});
chat.patch("/:id", zValidator("json", patchSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const row = await prisma.studyChat.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Chat not found" }, 404);
  const data: any = {};
  if (body.title !== undefined) data.title = body.title.slice(0, 200);
  if (body.sourceIds !== undefined) data.sourceIds = JSON.stringify(body.sourceIds);
  const updated = await prisma.studyChat.update({ where: { id: row.id }, data });
  return c.json({ chat: serialize(updated) });
});

/** DELETE /:id */
chat.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const row = await prisma.studyChat.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Chat not found" }, 404);
  await prisma.studyChat.delete({ where: { id: row.id } });
  const { cleanupOrphanLinks } = await import("../db/links");
  await cleanupOrphanLinks(userId, "studyChat", row.id);
  return c.json({ ok: true });
});

// ---------- Streaming grounded answer ----------

const streamSchema = z.object({
  message: z.string().min(1).max(20000),
  language: z.enum(["en", "cs"]).optional().default("en"),
});

/** POST /:id/stream — stream a grounded answer for the chat.
 *  SSE events: content | done | error. */
chat.post("/:id/stream", zValidator("json", streamSchema), async (c) => {
  const { userId } = c.get("auth");
  const chatId = c.req.param("id");
  const body = c.req.valid("json");

  const row = await prisma.studyChat.findFirst({ where: { id: chatId, userId } });
  if (!row) return c.json({ error: "Chat not found" }, 404);

  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  }

  const sourceIds = parseSourceIds(row.sourceIds);
  const sources = await loadChatSources(userId, sourceIds);
  if (sources.length === 0) {
    return c.json({ error: "This chat has no sources. Add at least one source first." }, 400);
  }

  const { model } = await acquireLlmModel(userId);
  const systemPrompt = groundedQaSystemPrompt(sources, body.language as StudyLanguage);

  // Build the message thread from stored history + the new user message.
  const history = parseMessages(row.messages);
  const thread: Message[] = [new Message("system", systemPrompt)];
  for (const m of history) {
    // Strip the "## Sources" section from prior assistant turns to keep the
    // thread compact and avoid re-injecting stale citation lists.
    const content = m.role === "assistant" ? m.content.replace(/\n*##\s*Sources[\s\S]*$/i, "").trim() : m.content;
    thread.push(new Message(m.role, content));
  }
  thread.push(new Message("user", body.message));

  // Persist the user message immediately.
  const userMsg: StoredMessage = {
    role: "user",
    content: body.message,
    timestamp: new Date().toISOString(),
  };
  const updatedMessages = [...history, userMsg];
  await prisma.studyChat.update({
    where: { id: row.id },
    data: {
      messages: JSON.stringify(updatedMessages),
      lastMessageAt: new Date(),
      title: history.length === 0 ? body.message.slice(0, 80) : row.title,
    },
  });

  const abort = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => abort.abort());

  return streamSSE(c, async (stream) => {
    let full = "";
    let errored = false;
    try {
      for await (const chunk of model.generate(thread, { tools: false, abortSignal: abort.signal })) {
        if (chunk.type === "content" && chunk.text) {
          full += chunk.text;
          await stream.writeSSE({ event: "content", data: JSON.stringify({ text: chunk.text }) });
        }
      }
    } catch (e) {
      errored = true;
      const msg = e instanceof Error ? e.message : "Generation failed";
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: msg }) });
      // If we got partial content, still persist it so the user doesn't lose it.
      if (!full.trim()) return;
    }

    // Persist the assistant message (with extracted citations) BEFORE sending
    // the done event — otherwise the client reloads the chat before citations
    // are stored, and [n] markers aren't clickable.
    const citations = extractCitations(full, sources);
    const assistantMsg: StoredMessage = {
      role: "assistant",
      content: full.trim(),
      citations: citations.length > 0 ? citations : undefined,
      timestamp: new Date().toISOString(),
    };
    const prior = parseMessages((await prisma.studyChat.findFirst({ where: { id: row.id }, select: { messages: true } }))?.messages ?? "[]");
    await prisma.studyChat.update({
      where: { id: row.id },
      data: {
        messages: JSON.stringify([...prior, assistantMsg]),
        lastMessageAt: new Date(),
      },
    });

    await logSessionSafe(userId, "chat", row.title, sourceIds.join(","), {
      chatId: row.id,
      citations: citations.length,
    });

    // Send done AFTER persistence so the client reload picks up citations.
    if (!errored) {
      await stream.writeSSE({ event: "done", data: JSON.stringify({ done: true }) });
    }
  });
});

export default chat;
