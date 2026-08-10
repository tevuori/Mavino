// ===== Study Hub: podcast / audio overview routes =====
// Generates a 2-host dialogue script from one or more StudySources (LLM),
// saves the script as a Note, and records a Podcast row. Audio is played back
// in-browser via the Web Speech API (client side); the script note is the
// persistent artifact. Mounted at /api/study/podcasts.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { studyFunctionMiddleware } from "../middleware/study-functions";
import { acquireLlmModel, isLlmConfiguredFor } from "../services/athena/llm";
import { generateText } from "../services/study/llm-json";
import { podcastScriptPrompt, type StudyLanguage } from "../services/study/prompts";
import { logSessionSafe } from "../services/study/logSession";
import { canonicalPair } from "../db/links";

const podcasts = new Hono();
podcasts.use("*", authMiddleware, studyFunctionMiddleware("podcast"));

function parseSourceIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function serialize(p: any) {
  return {
    id: p.id,
    title: p.title,
    scriptNoteId: p.scriptNoteId,
    sourceIds: parseSourceIds(p.sourceIds),
    host1Label: p.host1Label,
    host2Label: p.host2Label,
    durationEstimate: p.durationEstimate,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Rough spoken-duration estimate from script length (~150 wpm). */
function estimateDurationSeconds(script: string): number {
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.round((words / 150) * 60);
}

const generateSchema = z.object({
  sourceIds: z.array(z.string()).min(1).max(10),
  title: z.string().max(200).optional(),
  host1Label: z.string().max(40).optional(),
  host2Label: z.string().max(40).optional(),
  language: z.enum(["en", "cs"]).optional().default("en"),
});

/** POST /generate — generate a podcast script from sources. */
podcasts.post("/generate", zValidator("json", generateSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  }

  const rows = await prisma.studySource.findMany({
    where: { id: { in: body.sourceIds }, userId },
  });
  if (rows.length === 0) return c.json({ error: "No sources found" }, 404);

  // Preserve the requested sourceIds order for citation stability.
  const sources = body.sourceIds
    .map((id, i) => {
      const r = rows.find((x) => x.id === id);
      return r ? { index: i + 1, name: r.name, text: r.textCache } : null;
    })
    .filter((x): x is { index: number; name: string; text: string } => x !== null);

  if (sources.length === 0) return c.json({ error: "No sources found" }, 404);

  const host1Label = body.host1Label?.trim() || "Host A";
  const host2Label = body.host2Label?.trim() || "Host B";

  const { model: llmModel } = await acquireLlmModel(userId);
  let script: string;
  try {
    script = await generateText(
      llmModel,
      podcastScriptPrompt(sources, host1Label, host2Label, body.language as StudyLanguage),
      "You are a podcast scriptwriter. Output ONLY the dialogue lines in the exact 'Host: text' format requested. No preamble, no commentary, no markdown fences."
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Script generation failed" }, 502);
  }

  if (!script.trim()) {
    return c.json({ error: "The AI did not produce a script." }, 502);
  }

  const title = (body.title?.trim() || `Podcast: ${sources.map((s) => s.name).join(", ")}`).slice(0, 200);

  // Save the script as a note (the persistent, downloadable artifact).
  const note = await prisma.note.create({
    data: {
      userId,
      title,
      content: script,
      tags: "podcast,ai",
    },
  });

  const podcast = await prisma.podcast.create({
    data: {
      userId,
      title,
      scriptNoteId: note.id,
      sourceIds: JSON.stringify(body.sourceIds),
      host1Label,
      host2Label,
      durationEstimate: estimateDurationSeconds(script),
    },
  });

  // Auto-link the podcast to each underlying note/file source.
  for (const sid of body.sourceIds) {
    const src = rows.find((r) => r.id === sid);
    if (!src) continue;
    const targetType = src.kind === "note" ? "note" : src.kind === "file" ? "file" : null;
    if (targetType && src.refId && src.refId !== "paste") {
      const pair = canonicalPair(
        { type: "podcast", id: podcast.id },
        { type: targetType, id: src.refId }
      );
      await prisma.itemLink.upsert({
        where: { userId_srcType_srcId_dstType_dstId: { userId, ...pair } },
        update: {},
        create: { userId, ...pair },
      });
    }
  }

  await logSessionSafe(userId, "podcast", title, body.sourceIds.join(","), {
    podcastId: podcast.id,
    noteId: note.id,
    sourceCount: sources.length,
    durationEstimate: podcast.durationEstimate,
  });

  return c.json(
    {
      podcast: { ...serialize(podcast), script },
      noteId: note.id,
    },
    201
  );
});

/** GET / — list the user's podcasts. */
podcasts.get("/", async (c) => {
  const { userId } = c.get("auth");
  const rows = await prisma.podcast.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return c.json({ podcasts: rows.map(serialize) });
});

/** GET /:id — single podcast incl. the script (from the linked note). */
podcasts.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const p = await prisma.podcast.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!p) return c.json({ error: "Podcast not found" }, 404);
  let script = "";
  if (p.scriptNoteId) {
    const note = await prisma.note.findFirst({ where: { id: p.scriptNoteId, userId } });
    if (note) script = note.content;
  }
  return c.json({ podcast: { ...serialize(p), script } });
});

/** DELETE /:id — remove the podcast (and its links). The script note is kept
 *  (it's a user note); the user can delete it from Notes if desired. */
podcasts.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const p = await prisma.podcast.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!p) return c.json({ error: "Podcast not found" }, 404);
  await prisma.podcast.delete({ where: { id: p.id } });
  const { cleanupOrphanLinks } = await import("../db/links");
  await cleanupOrphanLinks(userId, "podcast", p.id);
  return c.json({ ok: true });
});

export default podcasts;
