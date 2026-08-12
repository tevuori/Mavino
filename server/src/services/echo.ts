// ===== Echo: live lecture companion service (Pro tier) =====
// Transcribes audio chunks via the OpenAI-compatible Whisper endpoint (same
// config as the lecture pipeline), matches the running transcript against the
// user's Atlas concepts in real time, and on stop generates a structured note
// + extracts new terms for flashcard suggestions.
//
// The flow is chunk-by-chunk (not fire-and-forget):
//   1. startSession() — creates an EchoSession row with status "active".
//   2. processChunk() — transcribes one audio chunk, appends to the transcript,
//      re-matches concepts, and updates the row synchronously.
//   3. stopSession() — runs an LLM pass to generate a structured note from the
//      full transcript, extracts new terms (not in Atlas), saves the note,
//      and flips status to "completed".
//
// Concept matching reuses Atlas's textContains() logic: for each concept label
// in the user's Atlas, check if it appears in the running transcript. This is
// cheap (a few hundred regex matches over a growing string) and runs on every
// chunk. If the user has no Atlas, concepts is always empty — Echo still works
// as a live transcriber + note generator.

import type { LlmModel } from "multi-llm-ts";
import { Prisma } from "@prisma/client";
import prisma from "../db/client";
import { getUserConfig } from "./athena/llm";
import { generateText, generateJson } from "./study/llm-json";
import { getTranscriptionConfig } from "./study/lecture/transcribe";
import { lectureSlideNotePrompt, type NoteStyle, type NoteDetail, type StudyLanguage } from "./study/prompts";
import { logSessionSafe } from "./study/logSession";
import { textContains, countOccurrences } from "./atlas";

// ----- types (stored as JSON in the EchoSession row) -----

export interface EchoTranscriptSegment {
  /** Start time in seconds (absolute, from session start). */
  start: number;
  /** End time in seconds (absolute, from session start). */
  end: number;
  /** Transcribed text for this segment. */
  text: string;
}

export interface EchoConceptMatch {
  id: string;
  label: string;
  type: string;
  definition: string;
  mastery: number; // 0..1; -1 = no data
  weak: boolean;
  /** First time this concept was mentioned (seconds from session start). */
  firstMentionedSec: number;
  /** Number of times mentioned across the transcript. */
  mentionCount: number;
}

export interface EchoNewTerm {
  term: string;
  /** Why it seems important (context from the transcript). */
  context: string;
  /** Suggested flashcard front/back for this term. */
  suggestedFront: string;
  suggestedBack: string;
}

export interface EchoSessionData {
  transcript: EchoTranscriptSegment[];
  concepts: EchoConceptMatch[];
  newTerms: EchoNewTerm[];
}

export interface EchoSessionStatus {
  id: string;
  title: string;
  status: "active" | "completed" | "failed";
  language: string;
  transcript: EchoTranscriptSegment[];
  concepts: EchoConceptMatch[];
  newTerms: EchoNewTerm[];
  noteId: string | null;
  durationSec: number;
  meta: Record<string, unknown>;
  error: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ----- helpers -----

function serialize(row: any): EchoSessionStatus {
  let transcript: EchoTranscriptSegment[] = [];
  let concepts: EchoConceptMatch[] = [];
  let newTerms: EchoNewTerm[] = [];
  let meta: Record<string, unknown> = {};
  try { transcript = JSON.parse(row.transcript); } catch { /* keep default */ }
  try { concepts = JSON.parse(row.concepts); } catch { /* keep default */ }
  try { newTerms = JSON.parse(row.newTerms); } catch { /* keep default */ }
  try { meta = JSON.parse(row.meta); } catch { /* keep default */ }
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    language: row.language,
    transcript,
    concepts,
    newTerms,
    noteId: row.noteId,
    durationSec: row.durationSec,
    meta,
    error: row.error,
    startedAt: row.startedAt?.toISOString?.() ?? row.startedAt,
    endedAt: row.endedAt?.toISOString?.() ?? row.endedAt,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

// ----- session lifecycle -----

/** Start a new live lecture session. Only one active session per user. */
export async function startSession(
  userId: string,
  opts: { title?: string; language?: string }
): Promise<EchoSessionStatus> {
  // Check for existing active session — reuse it if found (don't create duplicates).
  const existing = await prisma.echoSession.findFirst({
    where: { userId, status: "active" },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return serialize(existing);

  const row = await prisma.echoSession.create({
    data: {
      userId,
      title: opts.title?.trim() || `Lecture — ${new Date().toLocaleDateString()}`,
      language: opts.language ?? "en",
      status: "active",
    },
  });
  return serialize(row);
}

/** Get a session by id (must belong to the user). */
export async function getSession(userId: string, sessionId: string): Promise<EchoSessionStatus | null> {
  const row = await prisma.echoSession.findFirst({ where: { id: sessionId, userId } });
  return row ? serialize(row) : null;
}

/** Get the user's active session (if any). */
export async function getActiveSession(userId: string): Promise<EchoSessionStatus | null> {
  const row = await prisma.echoSession.findFirst({
    where: { userId, status: "active" },
    orderBy: { startedAt: "desc" },
  });
  return row ? serialize(row) : null;
}

/** List the user's past sessions (completed, most recent first). */
export async function listSessions(userId: string, limit = 20): Promise<EchoSessionStatus[]> {
  const rows = await prisma.echoSession.findMany({
    where: { userId, status: { in: ["completed", "failed"] } },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return rows.map(serialize);
}

/** Delete a session (must belong to the user). */
export async function deleteSession(userId: string, sessionId: string): Promise<boolean> {
  const row = await prisma.echoSession.findFirst({ where: { id: sessionId, userId } });
  if (!row) return false;
  await prisma.echoSession.delete({ where: { id: sessionId } });
  return true;
}

// ----- chunk processing -----

/**
 * Process one audio chunk: transcribe it via Whisper, append the segment(s)
 * to the transcript, re-match concepts against the full transcript, and
 * update the session row. Returns the updated session.
 *
 * `chunkOffsetSec` is the absolute time (from session start) at which this
 * chunk begins — the client tracks this from its MediaRecorder timer.
 * `chunkDurationSec` is the duration of the audio in this chunk (seconds),
 * used to set the segment's `end` time.
 *
 * Concurrency: the transcription (a slow network call) runs outside the
 * transaction. The transcript read-modify-write is then performed inside an
 * interactive transaction with a `SELECT ... FOR UPDATE` row lock, so that
 * concurrent chunk uploads for the same session are serialized and no
 * transcript segments are lost to a read-then-overwrite race.
 */
export async function processChunk(
  userId: string,
  sessionId: string,
  audioBuf: Buffer,
  mimeType: string,
  chunkOffsetSec: number,
  chunkDurationSec: number
): Promise<EchoSessionStatus | null> {
  // Verify ownership + active status up front (cheap).
  const owned = await prisma.echoSession.findFirst({
    where: { id: sessionId, userId, status: "active" },
    select: { id: true, language: true },
  });
  if (!owned) return null;

  // Transcribe the chunk via the Whisper-compatible endpoint (outside the
  // transaction — this is a slow network call and must not hold the row lock).
  const userCfg = await getUserConfig(userId);
  const cfg = getTranscriptionConfig(userCfg);
  let newSegment: EchoTranscriptSegment | null = null;
  let transcriptionError: string | null = null;

  if (cfg.apiKey) {
    const result = await transcribeChunkSync(cfg, audioBuf, mimeType, owned.language);
    if (result && "text" in result) {
      // Whisper /audio/transcriptions with response_format=json returns a
      // single text blob (no timestamps). We create one segment spanning the
      // chunk duration. The client sends the chunk's start offset + duration
      // so we can place it correctly in the timeline.
      newSegment = {
        start: chunkOffsetSec,
        end: chunkOffsetSec + Math.max(0, chunkDurationSec),
        text: result.text,
      };
    } else if (result && "error" in result) {
      // Store the transcription error in meta so the client can display it.
      transcriptionError = result.error;
    }
  } else {
    transcriptionError = "No transcription API key configured. Set OPENAI_TRANSCRIPTION_API_KEY or configure an AI provider in Settings.";
    console.warn("[echo] No transcription API key configured — chunk skipped.");
  }

  if (!newSegment) {
    // Nothing transcribed — but still advance durationSec so the UI shows the
    // correct elapsed time even when Whisper is temporarily unavailable. The
    // `durationSec: { lt: newDuration }` guard avoids regressing the value if
    // chunks arrive out of order.
    const newDuration = Math.round(chunkOffsetSec + Math.max(0, chunkDurationSec));
    // Store the transcription error in meta so the client can display it.
    if (transcriptionError) {
      const metaRow = await prisma.echoSession.findUnique({ where: { id: sessionId }, select: { meta: true } });
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(metaRow?.meta ?? "{}"); } catch { /* keep default */ }
      meta.transcriptionError = transcriptionError;
      await prisma.echoSession.updateMany({
        where: { id: sessionId, userId, status: "active", durationSec: { lt: newDuration } },
        data: { durationSec: newDuration, meta: JSON.stringify(meta) },
      });
    } else {
      await prisma.echoSession.updateMany({
        where: { id: sessionId, userId, status: "active", durationSec: { lt: newDuration } },
        data: { durationSec: newDuration },
      });
    }
    const row = await prisma.echoSession.findUnique({ where: { id: sessionId } });
    return row ? serialize(row) : null;
  }

  // Atomically append the segment + re-derive concepts + meta under a row
  // lock so concurrent processChunk calls can't overwrite each other.
  const updated = await prisma.$transaction(async (tx) => {
    // SELECT ... FOR UPDATE serializes concurrent updates to this row.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "EchoSession"
      WHERE id = ${sessionId} AND "userId" = ${userId} AND status = 'active'
      FOR UPDATE
    `;
    if (locked.length === 0) return null;

    const row = await tx.echoSession.findUnique({ where: { id: sessionId } });
    if (!row || row.status !== "active") return null;

    let transcript: EchoTranscriptSegment[] = [];
    try { transcript = JSON.parse(row.transcript); } catch { /* keep default */ }
    transcript.push(newSegment!);

    const concepts = await matchConceptsWithTx(tx, userId, transcript);

    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.meta); } catch { /* keep default */ }
    meta.chunkCount = ((meta.chunkCount as number) ?? 0) + 1;
    meta.wordCount = transcript.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
    meta.lastChunkAt = new Date().toISOString();
    // Clear any previous transcription error since we got a successful segment.
    delete meta.transcriptionError;

    await tx.echoSession.update({
      where: { id: sessionId },
      data: {
        transcript: JSON.stringify(transcript),
        concepts: JSON.stringify(concepts),
        meta: JSON.stringify(meta),
        durationSec: Math.round(chunkOffsetSec + Math.max(0, chunkDurationSec)),
      },
    });

    return tx.echoSession.findUnique({ where: { id: sessionId } });
  });

  return updated ? serialize(updated) : null;
}

/** Transcribe a single audio chunk synchronously via the Whisper endpoint.
 *  Returns { text } on success, { error } on failure, or null if the request
 *  itself couldn't be made (no API key). */
async function transcribeChunkSync(
  cfg: { apiKey: string; baseURL: string },
  audioBuf: Buffer,
  mimeType: string,
  language: string
): Promise<{ text: string } | { error: string } | null> {
  const base = cfg.baseURL.replace(/\/+$/, "");
  const url = `${base}/audio/transcriptions`;
  // Map mime type to a filename extension.
  const ext = mimeType.includes("webm") ? "webm"
    : mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("mp4") ? "m4a"
    : mimeType.includes("wav") ? "wav"
    : "webm";
  const filename = `chunk.${ext}`;

  const form = new FormData();
  form.append("file", new Blob([audioBuf], { type: mimeType }), filename);
  form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1");
  form.append("response_format", "json");
  // Language hint improves accuracy for non-English lectures (e.g. Czech).
  // Whisper auto-detects, but the hint avoids misdetection on short chunks.
  if (language && language !== "auto") {
    form.append("language", language);
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[echo] Whisper failed (${res.status}): ${text.slice(0, 200)}`);
      if (res.status === 404) {
        return { error: `Transcription endpoint not found at ${base}. Your AI provider may not support audio transcription. Set OPENAI_TRANSCRIPTION_BASE_URL and OPENAI_TRANSCRIPTION_API_KEY in .env to use a dedicated Whisper endpoint (e.g. OpenAI).` };
      }
      return { error: `Transcription failed (${res.status}): ${text.slice(0, 100)}` };
    }
    const data = (await res.json()) as { text?: string };
    const text = (data.text ?? "").trim();
    return text ? { text } : null;
  } catch (err) {
    console.warn("[echo] Whisper request error:", err instanceof Error ? err.message : err);
    return { error: `Transcription request failed: ${err instanceof Error ? err.message : "network error"}` };
  }
}

// ----- concept matching -----

/** A Prisma client or an interactive-transaction client (both expose the
 *  same model accessors like `atlasGraph.findUnique`). */
type TxClient = typeof prisma | Prisma.TransactionClient;

/**
 * Match the running transcript against the user's Atlas concepts.
 * Returns concepts that appear in the transcript, enriched with
 * firstMentionedSec + mentionCount. Sorted by firstMentionedSec.
 *
 * Accepts a transaction client so it can run inside the processChunk
 * transaction (reads the Atlas row under the same lock scope).
 */
async function matchConceptsWithTx(
  tx: TxClient,
  userId: string,
  transcript: EchoTranscriptSegment[]
): Promise<EchoConceptMatch[]> {
  // Load the user's Atlas (if built).
  const atlasRow = await tx.atlasGraph.findUnique({ where: { userId } });
  if (!atlasRow || atlasRow.status !== "ready") return [];

  let atlasData: { concepts?: Array<{ id: string; label: string; type: string; definition: string; mastery: number; weak: boolean }> };
  try { atlasData = JSON.parse(atlasRow.data); } catch { return []; }
  if (!atlasData.concepts || atlasData.concepts.length === 0) return [];

  // Build a single transcript string for matching, plus a per-segment index
  // so we can find the first mention time.
  const fullText = transcript.map((s) => s.text).join(" ");
  if (!fullText.trim()) return [];

  const matches: EchoConceptMatch[] = [];
  for (const c of atlasData.concepts) {
    if (!c.label || c.label.length < 2) continue;
    const count = countOccurrences(fullText, c.label);
    if (count === 0) continue;

    // Find the first segment that mentions this concept.
    let firstSec = 0;
    for (const seg of transcript) {
      if (textContains(seg.text, c.label)) {
        firstSec = seg.start;
        break;
      }
    }

    matches.push({
      id: c.id,
      label: c.label,
      type: c.type,
      definition: c.definition,
      mastery: c.mastery,
      weak: c.weak,
      firstMentionedSec: firstSec,
      mentionCount: count,
    });
  }

  // Sort by first mention time.
  matches.sort((a, b) => a.firstMentionedSec - b.firstMentionedSec);
  return matches;
}

// ----- stop + finalize -----

/**
 * Stop the session: run an LLM pass to generate a structured note from the
 * full transcript, extract new terms (not in Atlas), save the note, and
 * flip status to "completed".
 */
export async function stopSession(
  userId: string,
  sessionId: string,
  model: LlmModel
): Promise<EchoSessionStatus | null> {
  const row = await prisma.echoSession.findFirst({ where: { id: sessionId, userId, status: "active" } });
  if (!row) return null;

  let transcript: EchoTranscriptSegment[] = [];
  try { transcript = JSON.parse(row.transcript); } catch { /* keep default */ }

  const fullText = transcript.map((s) => s.text).join(" ").trim();
  if (!fullText) {
    // No transcript — just mark as completed with no note.
    await prisma.echoSession.update({
      where: { id: sessionId },
      data: { status: "completed", endedAt: new Date() },
    });
    const after = await prisma.echoSession.findUnique({ where: { id: sessionId } });
    return after ? serialize(after) : null;
  }

  try {
    // 1. Generate a structured note from the transcript (reuse lecture prompts).
    //    Echo is transcript-only (no slides), so we use the transcript-only
    //    fallback path from the lecture pipeline: lectureSlideNotePrompt with
    //    empty slide content + the full transcript.
    const language = row.language as StudyLanguage;
    const noteText = await generateText(
      model,
      lectureSlideNotePrompt(
        "",
        fullText.slice(0, 30000),
        0,
        1,
        "outline" as NoteStyle,
        { detail: "standard" as NoteDetail },
        language
      ),
      "You are a study assistant taking structured notes from a live lecture transcript. Output Markdown notes only — no preamble, no commentary."
    );

    // 2. Extract new terms (mentioned but not in the user's Atlas).
    const newTerms = await extractNewTerms(userId, model, fullText);

    // 3. Save the note.
    const note = await prisma.note.create({
      data: {
        userId,
        title: row.title || `Lecture Notes — ${new Date().toLocaleDateString()}`,
        content: noteText,
        tags: "lecture,live,ai-generated",
      },
    });

    // 4. Update the session.
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.meta); } catch { /* keep default */ }
    meta.wordCount = fullText.split(/\s+/).filter(Boolean).length;
    meta.llmModel = (model as any)?.id ?? "unknown";

    await prisma.echoSession.update({
      where: { id: sessionId },
      data: {
        status: "completed",
        endedAt: new Date(),
        noteId: note.id,
        newTerms: JSON.stringify(newTerms),
        meta: JSON.stringify(meta),
      },
    });

    // 5. Log a study session.
    await logSessionSafe(userId, "lecture_notes", row.title, sessionId, {
      wordCount: fullText.split(/\s+/).length,
      segmentCount: transcript.length,
      newTermCount: newTerms.length,
    });

    const done = await prisma.echoSession.findUnique({ where: { id: sessionId } });
    return done ? serialize(done) : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to finalize session";
    console.error(`[echo] stopSession ${sessionId} failed:`, message);
    await prisma.echoSession.update({
      where: { id: sessionId },
      data: { status: "failed", error: message.slice(0, 1000), endedAt: new Date() },
    });
    const failed = await prisma.echoSession.findUnique({ where: { id: sessionId } });
    return failed ? serialize(failed) : null;
  }
}

/**
 * Extract new terms from the transcript that are NOT in the user's Atlas.
 * Uses one LLM call with a JSON schema. Falls back to empty array on failure.
 */
async function extractNewTerms(
  userId: string,
  model: LlmModel,
  transcriptText: string
): Promise<EchoNewTerm[]> {
  // Load the user's Atlas concept labels (to exclude known terms).
  const atlasRow = await prisma.atlasGraph.findUnique({ where: { userId } });
  let knownLabels: string[] = [];
  if (atlasRow?.status === "ready") {
    try {
      const data = JSON.parse(atlasRow.data) as { concepts?: Array<{ label: string }> };
      knownLabels = (data.concepts ?? []).map((c) => c.label.toLowerCase());
    } catch { /* ignore */ }
  }

  const prompt = `Analyze this lecture transcript and extract up to 10 important terms or concepts that are likely NEW to the student (i.e. NOT in their existing knowledge base).

Existing known concepts (do NOT include these): ${knownLabels.length > 0 ? knownLabels.slice(0, 100).join(", ") : "(none yet)"}

Transcript:
${transcriptText.slice(0, 15000)}

For each new term, provide:
- term: the term or concept name
- context: a brief note on why it's important (1 sentence from the transcript context)
- suggestedFront: a flashcard front (a question or prompt about this term)
- suggestedBack: a concise flashcard back (the answer or definition)

Only include terms that are clearly important to the lecture topic. Skip generic words, filler, and proper nouns of people/places unless they're key concepts.`;

  try {
    const result = await generateJson<{ terms?: EchoNewTerm[] }>(
      model,
      prompt,
      'Respond as JSON: { "terms": [{ "term": "...", "context": "...", "suggestedFront": "...", "suggestedBack": "..." }] }'
    );
    return (result.terms ?? []).slice(0, 10);
  } catch {
    return [];
  }
}
