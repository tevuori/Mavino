// ===== Voice Notes / Audio Recorder =====
// Records audio from the client (MediaRecorder → webm/ogg), saves it to the
// virtual file system, transcribes it via the OpenAI-compatible Whisper
// endpoint (reusing the per-user / server-wide AI config), optionally runs an
// LLM cleanup pass to punctuate/format + title the transcript, and stores the
// result as a Note linked to the audio file (ItemLink).
//
// No DB migration: reuses VFile + Note + ItemLink.
//
// Env (server-wide fallback, in addition to OPENAI_* used by athena/llm.ts):
//   OPENAI_TRANSCRIPTION_MODEL — model id for /audio/transcriptions (default "whisper-1")
//
// Transcription degrades gracefully: if no AI key is configured or the
// provider does not serve /audio/transcriptions, the audio file is still
// saved and a placeholder note is created.

import { Hono } from "hono";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";
import { acquireLlmModel, getUserConfig, isLlmConfiguredFor } from "../services/athena/llm";
import { generateJson } from "../services/study/llm-json";
import { canonicalPair } from "../db/links";
import path from "node:path";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { getStorageStatus } from "../services/storage-quota";
import { detectAndValidateMime } from "../services/upload-security";

const voice = new Hono();
voice.use("*", authMiddleware, appTierGate("voice"));

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1";

/** Map a MediaRecorder mime type to a file extension. */
function extForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

/** Timestamp string for filenames: YYYYMMDD-HHmmss */
function tsName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Call the OpenAI-compatible /audio/transcriptions endpoint with the audio
 * bytes. Returns the transcript text, or null if unavailable/failed.
 */
async function transcribeAudio(
  cfg: { apiKey: string; baseURL?: string },
  audioBuf: Buffer,
  filename: string,
  mimeType: string
): Promise<string | null> {
  if (!cfg.apiKey) return null;
  const base = (cfg.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${base}/audio/transcriptions`;

  // Build multipart/form-data manually (Bun fetch supports Blob parts).
  const form = new FormData();
  form.append("file", new Blob([audioBuf], { type: mimeType }), filename);
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("response_format", "json");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim() || null;
  } catch {
    return null;
  }
}

interface CleanupResult {
  title: string;
  content: string;
}

/**
 * Run the user's LLM to clean up a raw transcript: add punctuation, paragraph
 * breaks, remove filler, preserve meaning, and produce a concise title.
 */
async function cleanupTranscript(
  userId: string,
  raw: string
): Promise<CleanupResult | null> {
  if (!(await isLlmConfiguredFor(userId))) return null;
  try {
    const { model } = await acquireLlmModel(userId);
    const result = await generateJson<{ title?: string; content?: string }>(
      model,
      `Clean up this voice-to-text transcript. Add punctuation and capitalization, split into paragraphs where natural, remove filler words ("um", "uh", "you know") and false starts, but preserve the speaker's meaning and wording as closely as possible. Do NOT add information that isn't there. Also produce a concise descriptive title (max 60 chars).\n\nTranscript:\n"""${raw}"""`,
      'Respond with JSON: {"title":string,"content":string}. The content is the cleaned transcript in Markdown.'
    );
    const title = (result.title ?? "").trim();
    const content = (result.content ?? "").trim();
    if (!content) return null;
    return { title: title.slice(0, 200), content };
  } catch {
    return null;
  }
}

/** Create (or reuse) a Note for a voice recording and link it to the audio file. */
async function createLinkedNote(
  userId: string,
  fileId: string,
  title: string,
  content: string,
  tags = "voice,audio"
) {
  const note = await prisma.note.create({
    data: { userId, title: title.slice(0, 200) || "Voice Note", content, tags },
  });
  const pair = canonicalPair(
    { type: "note", id: note.id },
    { type: "file", id: fileId }
  );
  await prisma.itemLink.upsert({
    where: {
      userId_srcType_srcId_dstType_dstId: { userId, ...pair },
    },
    update: {},
    create: { userId, ...pair },
  });
  return note;
}

/** Find the note linked to a given audio file (if any). */
async function findLinkedNote(
  userId: string,
  fileId: string
): Promise<{ id: string } | null> {
  const rows = await prisma.itemLink.findMany({
    where: {
      userId,
      OR: [
        { srcType: "file", srcId: fileId },
        { dstType: "file", dstId: fileId },
      ],
    },
  });
  for (const r of rows) {
    if (r.srcType === "note") return { id: r.srcId };
    if (r.dstType === "note") return { id: r.dstId };
  }
  return null;
}

/**
 * POST /api/voice — multipart: audio (Blob) + optional title, folderId, cleanup.
 * Saves the audio file, transcribes it, optionally cleans up the transcript,
 * creates a linked Note, and returns everything.
 */
voice.post("/", async (c) => {
  const { userId } = c.get("auth");
  const formData = await c.req.formData();
  const audio = formData.get("audio");
  const title = (formData.get("title") as string | null)?.trim() || "";
  const folderId = (formData.get("folderId") as string | null) ?? null;
  const cleanup = (formData.get("cleanup") as string | null) !== "false"; // default true

  if (!(audio instanceof File)) {
    return c.json({ error: "No audio provided" }, 400);
  }

  const mimeType = audio.type || "audio/webm";
  const ext = extForMime(mimeType);
  const safeName = `Voice-${tsName()}.${ext}`;
  const storageKey = `${userId}/${Date.now()}-${safeName}`;
  const absPath = path.join(UPLOAD_DIR, storageKey);
  await mkdir(path.dirname(absPath), { recursive: true });
  const audioBuf = Buffer.from(await audio.arrayBuffer());

  // Magic number validation — reject executables disguised as audio.
  const { mime: detectedMime, blocked: mimeBlocked } = await detectAndValidateMime(audioBuf, mimeType);
  if (mimeBlocked) {
    return c.json({ error: `File content does not match a safe type (detected: ${detectedMime}). Upload rejected.` }, 415);
  }

  // Enforce role-based storage quota before writing audio to disk.
  const quota = await getStorageStatus(userId, audioBuf.length);
  if (!quota.allowed) {
    return c.json({ error: quota.message }, 413);
  }

  await writeFile(absPath, audioBuf);

  const file = await prisma.vFile.create({
    data: {
      name: safeName,
      mimeType,
      size: audioBuf.length,
      storageKey,
      folderId: folderId || null,
      userId,
    },
  });

  // Transcribe
  const cfg = await getUserConfig(userId);
  const transcript = await transcribeAudio(cfg, audioBuf, safeName, mimeType);
  const transcribed = Boolean(transcript);

  // Cleanup + title via LLM
  let noteTitle = title;
  let noteContent: string;
  let cleaned = false;
  if (transcript && cleanup) {
    const cleanedRes = await cleanupTranscript(userId, transcript);
    if (cleanedRes) {
      cleaned = true;
      noteContent = cleanedRes.content;
      if (!noteTitle) noteTitle = cleanedRes.title;
    } else {
      noteContent = transcript;
    }
  } else if (transcript) {
    noteContent = transcript;
  } else {
    noteContent =
      "*Transcription unavailable — no AI provider configured or the provider does not support audio transcription. The audio file was saved; configure an OpenAI-compatible key with Whisper in Settings → AI.*";
  }

  if (!noteTitle) {
    const firstLine = transcript?.split("\n").find((l) => l.trim()) ?? "";
    noteTitle = firstLine.slice(0, 60).trim() || `Voice Note ${tsName()}`;
  }

  const note = await createLinkedNote(userId, file.id, noteTitle, noteContent);

  return c.json(
    { file, note, transcript: transcript ?? "", transcribed, cleaned },
    201
  );
});

/**
 * POST /api/voice/transcribe/:fileId — re-transcribe an existing audio file.
 * Updates the linked note (or creates one) with the new transcript.
 */
voice.post("/transcribe/:fileId", async (c) => {
  const { userId } = c.get("auth");
  const fileId = c.req.param("fileId");
  const cleanup = c.req.query("cleanup") !== "false";

  const file = await prisma.vFile.findFirst({ where: { id: fileId, userId } });
  if (!file) return c.json({ error: "Not found" }, 404);
  if (!file.mimeType.startsWith("audio/")) {
    return c.json({ error: "File is not audio" }, 400);
  }

  const absPath = path.join(UPLOAD_DIR, file.storageKey);
  try {
    await stat(absPath);
  } catch {
    return c.json({ error: "File missing on disk" }, 410);
  }
  const audioBuf = await readFile(absPath);

  const cfg = await getUserConfig(userId);
  const transcript = await transcribeAudio(cfg, audioBuf, file.name, file.mimeType);
  const transcribed = Boolean(transcript);

  let noteTitle = "";
  let noteContent: string;
  let cleaned = false;
  if (transcript && cleanup) {
    const cleanedRes = await cleanupTranscript(userId, transcript);
    if (cleanedRes) {
      cleaned = true;
      noteContent = cleanedRes.content;
      noteTitle = cleanedRes.title;
    } else {
      noteContent = transcript;
    }
  } else if (transcript) {
    noteContent = transcript;
  } else {
    return c.json(
      {
        error:
          "Transcription unavailable — no AI provider configured or the provider does not support audio transcription.",
        transcribed: false,
      },
      400
    );
  }

  const existing = await findLinkedNote(userId, file.id);
  let note;
  if (existing) {
    note = await prisma.note.update({
      where: { id: existing.id, userId },
      data: {
        content: noteContent,
        ...(noteTitle ? { title: noteTitle.slice(0, 200) } : {}),
      },
    });
  } else {
    note = await createLinkedNote(
      userId,
      file.id,
      noteTitle || `Voice Note ${tsName()}`,
      noteContent
    );
  }

  return c.json({ note, transcript: transcript ?? "", transcribed, cleaned });
});

export default voice;
