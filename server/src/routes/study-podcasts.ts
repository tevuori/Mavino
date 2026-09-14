import { DescribeVoicesCommand } from "@aws-sdk/client-polly";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import path from "node:path";
import { rm, stat } from "node:fs/promises";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { studyFunctionMiddleware } from "../middleware/study-functions";
import { acquireLlmModel, isLlmConfiguredFor } from "../services/athena/llm";
import { generateText } from "../services/study/llm-json";
import { podcastScriptPrompt, type StudyLanguage } from "../services/study/prompts";
import { logSessionSafe } from "../services/study/logSession";
import { canonicalPair } from "../db/links";
import { createPollyClient, getPollyConfigStatus, getPollySecrets } from "../services/polly-config";
import { runPodcastAudioJob } from "../services/study/podcast-audio";

const podcasts = new Hono();
podcasts.use("*", authMiddleware, studyFunctionMiddleware("podcast"));
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

function parseSourceIds(raw: string): string[] {
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter((x) => typeof x === "string") : []; }
  catch { return []; }
}

function serialize(p: any) {
  return {
    id: p.id, title: p.title, scriptNoteId: p.scriptNoteId,
    sourceIds: parseSourceIds(p.sourceIds), host1Label: p.host1Label, host2Label: p.host2Label,
    language: p.language, format: p.format, length: p.length, tone: p.tone,
    voice1: p.voice1, voice2: p.voice2, engine: p.engine, status: p.status,
    stage: p.stage, error: p.error, hasAudio: Boolean(p.audioKey), audioSize: p.audioSize,
    durationEstimate: p.durationEstimate, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  };
}

function estimateDurationSeconds(script: string): number {
  return Math.round((script.split(/\s+/).filter(Boolean).length / 150) * 60);
}

const languageCodes = { en: "en-US", cs: "cs-CZ" } as const;

podcasts.get("/config", async (c) => c.json(await getPollyConfigStatus()));

podcasts.get("/voices", async (c) => {
  const language = c.req.query("language") === "cs" ? "cs" : "en";
  const config = await getPollySecrets();
  if (!config) return c.json({ error: "AWS Polly is not configured" }, 503);
  const client = createPollyClient(config);
  try {
    const result = await client.send(new DescribeVoicesCommand({ LanguageCode: languageCodes[language], IncludeAdditionalLanguageCodes: true }));
    const voices = (result.Voices ?? []).map((voice) => ({
      id: voice.Id, name: voice.Name, gender: voice.Gender,
      languageCode: voice.LanguageCode, supportedEngines: voice.SupportedEngines ?? [],
    }));
    return c.json({ voices });
  } finally { client.destroy(); }
});

const generateSchema = z.object({
  sourceIds: z.array(z.string()).min(1).max(10), title: z.string().max(200).optional(),
  host1Label: z.string().min(1).max(40).optional(), host2Label: z.string().min(1).max(40).optional(),
  language: z.enum(["en", "cs"]).default("en"), length: z.enum(["short", "medium", "long"]).default("medium"),
  tone: z.enum(["engaging", "academic", "relaxed", "debate"]).default("engaging"),
  focus: z.string().max(500).optional(), engine: z.enum(["standard", "neural", "generative", "long-form"]).default("neural"),
  voice1: z.string().min(1).max(100), voice2: z.string().min(1).max(100),
});

podcasts.post("/generate", zValidator("json", generateSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  if (!(await getPollyConfigStatus()).configured) return c.json({ error: "AWS Polly is not configured. Ask an administrator to configure it in Settings → Study Hub." }, 503);
  if (!(await isLlmConfiguredFor(userId))) return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  const rows = await prisma.studySource.findMany({ where: { id: { in: body.sourceIds }, userId } });
  const sources = body.sourceIds.map((id, index) => {
    const row = rows.find((item) => item.id === id);
    return row ? { index: index + 1, name: row.name, text: row.textCache } : null;
  }).filter((source): source is { index: number; name: string; text: string } => source !== null);
  if (!sources.length) return c.json({ error: "No sources found" }, 404);

  const host1Label = body.host1Label?.trim() || "Alex";
  const host2Label = body.host2Label?.trim() || "Sam";
  const { model } = await acquireLlmModel(userId);
  let script: string;
  try {
    script = await generateText(model, podcastScriptPrompt(sources, host1Label, host2Label, body.language as StudyLanguage, { length: body.length, tone: body.tone, focus: body.focus }), "You are a podcast scriptwriter. Output only dialogue lines in the requested Host: text format.");
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Script generation failed" }, 502); }
  if (!script.trim()) return c.json({ error: "The AI did not produce a script." }, 502);

  const title = (body.title?.trim() || `Podcast: ${sources.map((source) => source.name).join(", ")}`).slice(0, 200);
  const result = await prisma.$transaction(async (tx) => {
    const note = await tx.note.create({ data: { userId, title, content: script, tags: "podcast,ai,aws-polly" } });
    const podcast = await tx.podcast.create({ data: {
      userId, title, scriptNoteId: note.id, sourceIds: JSON.stringify(body.sourceIds), host1Label, host2Label,
      language: body.language, length: body.length, tone: body.tone, format: "conversation",
      voice1: body.voice1, voice2: body.voice2, engine: body.engine, status: "queued", stage: "Queued",
      durationEstimate: estimateDurationSeconds(script),
    } });
    return { note, podcast };
  });

  for (const sourceId of body.sourceIds) {
    const source = rows.find((row) => row.id === sourceId);
    const targetType = source?.kind === "note" ? "note" : source?.kind === "file" ? "file" : null;
    if (source && targetType && source.refId && source.refId !== "paste") {
      const pair = canonicalPair({ type: "podcast", id: result.podcast.id }, { type: targetType, id: source.refId });
      await prisma.itemLink.upsert({ where: { userId_srcType_srcId_dstType_dstId: { userId, ...pair } }, update: {}, create: { userId, ...pair } });
    }
  }
  await logSessionSafe(userId, "podcast", title, body.sourceIds.join(","), { podcastId: result.podcast.id, noteId: result.note.id, sourceCount: sources.length });
  void runPodcastAudioJob(result.podcast.id, userId);
  return c.json({ podcast: { ...serialize(result.podcast), script }, noteId: result.note.id }, 202);
});

podcasts.get("/", async (c) => {
  const { userId } = c.get("auth");
  const rows = await prisma.podcast.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return c.json({ podcasts: rows.map(serialize) });
});

podcasts.get("/:id/audio", async (c) => {
  const { userId } = c.get("auth");
  const podcast = await prisma.podcast.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!podcast?.audioKey) return c.json({ error: "Podcast audio is not ready" }, 404);
  const absolutePath = path.join(UPLOAD_DIR, podcast.audioKey);
  try { await stat(absolutePath); } catch { return c.json({ error: "Podcast audio is missing" }, 410); }
  return new Response(Bun.file(absolutePath), { headers: {
    "Content-Type": "audio/mpeg", "Content-Length": String(podcast.audioSize ?? ""),
    "Content-Disposition": `inline; filename="${podcast.title.replace(/["\\]/g, "_")}.mp3"`, "Cache-Control": "private, max-age=3600",
  } });
});

podcasts.post("/:id/regenerate-audio", async (c) => {
  const { userId } = c.get("auth");
  const podcast = await prisma.podcast.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!podcast) return c.json({ error: "Podcast not found" }, 404);
  if (podcast.status === "processing" || podcast.status === "queued") return c.json({ error: "Audio generation is already running" }, 409);
  await prisma.podcast.update({ where: { id: podcast.id }, data: { status: "queued", stage: "Queued", error: "" } });
  void runPodcastAudioJob(podcast.id, userId);
  return c.json({ ok: true }, 202);
});

podcasts.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const podcast = await prisma.podcast.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!podcast) return c.json({ error: "Podcast not found" }, 404);
  const note = podcast.scriptNoteId ? await prisma.note.findFirst({ where: { id: podcast.scriptNoteId, userId } }) : null;
  return c.json({ podcast: { ...serialize(podcast), script: note?.content ?? "" } });
});

podcasts.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const podcast = await prisma.podcast.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!podcast) return c.json({ error: "Podcast not found" }, 404);
  await prisma.podcast.delete({ where: { id: podcast.id } });
  if (podcast.audioKey) await rm(path.join(UPLOAD_DIR, podcast.audioKey), { force: true }).catch(() => undefined);
  const { cleanupOrphanLinks } = await import("../db/links");
  await cleanupOrphanLinks(userId, "podcast", podcast.id);
  return c.json({ ok: true });
});

export default podcasts;
