// ===== Intelligent bulk upload & processing for study materials =====
// Shared backend for the "Mavino, what should I do with these files?" flow.
// Stages files, suggests a plan, and executes the chosen actions (folder,
// directory structure, notes, flashcards, Teach Me session).

import path from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import prisma from "../db/client";
import { detectAndValidateMime } from "./upload-security";
import { getStorageStatus } from "./storage-quota";
import { getUserConfig, acquireLlmModel, LlmError } from "./athena/llm";
import { resolveSource, resolveAndCache } from "./study/source";
import { generateText, generateJson } from "./study/llm-json";
import {
  notetakingPrompt,
  flashcardsPrompt,
  flashcardsSchemaHint,
  type NoteStyle,
  type NoteDetail,
} from "./study/prompts";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const BULK_STAGING_DIR = path.join(UPLOAD_DIR, "bulk-staging");

/** Text/PDF/code files we can extract study text from. */
const SUPPORTED_EXT = new Set([
  "pdf", "txt", "md", "markdown", "c", "h", "cpp", "cc", "cxx", "hpp",
  "java", "ts", "tsx", "js", "jsx", "py", "json", "html", "htm", "css",
  "xml", "svg", "csv", "yaml", "yml", "log", "diff", "patch",
]);

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PREVIEW_CHARS = 2000;
const MAX_SOURCE_CHARS = 30_000;
const MAX_COMBINED_CHARS = 40_000;

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function safeFileName(name: string): string {
  return path.basename(name).replace(/[^\w.\- ]+/g, "_");
}

function mimeFromExt(ext: string): string {
  if (ext === "pdf") return "application/pdf";
  if (ext === "md" || ext === "markdown") return "text/markdown";
  if (ext === "json") return "application/json";
  if (ext === "html" || ext === "htm") return "text/html";
  if (ext === "css") return "text/css";
  if (ext === "js" || ext === "jsx") return "text/javascript";
  if (ext === "ts" || ext === "tsx") return "text/typescript";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "xml") return "application/xml";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return `image/${ext}`;
  return "text/plain";
}

function isTextOrPdf(name: string, ext: string, mime: string): boolean {
  if (mime === "application/pdf" || ext === "pdf") return true;
  if (mime.startsWith("text/")) return true;
  if (["json", "xml", "yaml", "csv", "svg"].includes(ext)) return true;
  if (SUPPORTED_EXT.has(ext)) return true;
  return false;
}

function sanitizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export interface StagedFile {
  tempId: string;
  name: string;
  ext: string;
  mimeType: string;
  size: number;
  text: string;
  truncated: boolean;
}

export interface PlanSuggestion {
  createFolder: boolean;
  folderName: string | null;
  createStructure: boolean;
  structure: { folderName: string; fileIndexes: number[] }[] | null;
  notes: {
    style: NoteStyle;
    detail: NoteDetail;
    customStructure: string;
    title: string;
  } | null;
  flashcards: {
    count: number;
    mode: "mixed" | "concept" | "factual" | "cloze";
    deckName: string;
  } | null;
  teach: {
    level: "beginner" | "intermediate" | "advanced";
    title: string;
  } | null;
  workspace: {
    name: string;
  } | null;
  reasoning: string;
}

export interface ProcessRequestFile {
  /** Staged file path id returned by stageFiles. */
  tempId: string;
  /** Original file name. */
  name: string;
}

export interface ProcessActions {
  createFolder: boolean;
  folderName?: string | null;
  createStructure: boolean;
  structure?: { folderName: string; fileIndexes: number[] }[] | null;
  notes?: {
    style: NoteStyle;
    detail: NoteDetail;
    customStructure?: string;
    title?: string;
  } | null;
  flashcards?: {
    count: number;
    mode: "mixed" | "concept" | "factual" | "cloze";
    deckName?: string;
  } | null;
  teach?: {
    level: "beginner" | "intermediate" | "advanced";
    title?: string;
  } | null;
  workspace?: {
    name: string;
  } | null;
}

export interface ProcessedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  folderId: string | null;
}

export interface ProcessResult {
  savedFiles: ProcessedFile[];
  createdFolders: { id: string; name: string; parentId: string | null }[];
  note: { id: string; title: string } | null;
  flashcardDeck: { id: string; name: string; cardCount: number } | null;
  teacherSession: { id: string; title: string } | null;
  workspace: { id: string; name: string; sourceIds: string[] } | null;
  studySourceIds: string[];
}

/** Extract plain text from a buffer for preview / source processing. */
async function extractText(buf: Buffer, name: string, mime: string): Promise<{ text: string; truncated: boolean }> {
  const ext = extOf(name);
  let text = "";
  if (mime === "application/pdf" || ext === "pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      const result = await parser.getText();
      text = result.text || "";
      await parser.destroy();
    } catch (e) {
      console.error("[intelligent-upload] PDF extraction failed:", e);
      text = `[PDF text extraction failed for ${name}]`;
    }
  } else if (isTextOrPdf(name, ext, mime)) {
    text = buf.toString("utf-8");
  }
  const clean = sanitizeText(text);
  if (clean.length > MAX_SOURCE_CHARS) {
    return { text: clean.slice(0, MAX_SOURCE_CHARS) + "\n\n[…truncated…]", truncated: true };
  }
  return { text: clean, truncated: false };
}

function combinedSourceText(resolved: { name: string; text: string }[]): string {
  const parts = resolved.map((r) => `### ${r.name}\n\n${r.text}`);
  let combined = parts.join("\n\n---\n\n");
  if (combined.length > MAX_COMBINED_CHARS) {
    combined = combined.slice(0, MAX_COMBINED_CHARS) + "\n\n[…truncated…]";
  }
  return combined;
}

/** Stage multiple files for the intelligent upload dialog. */
export async function stageFiles(userId: string, files: File[]): Promise<StagedFile[]> {
  const staged: StagedFile[] = [];
  const dir = path.join(BULK_STAGING_DIR, userId);
  await mkdir(dir, { recursive: true });

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      throw new LlmError(413, `${file.name} is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
    }
    const ext = extOf(file.name);
    if (ext && !SUPPORTED_EXT.has(ext)) {
      throw new LlmError(415, `${file.name} has unsupported type ".${ext}".`);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const { mime, blocked } = await detectAndValidateMime(buf, file.type);
    if (blocked) {
      throw new LlmError(415, `${file.name} was rejected: unsafe content detected (${mime}).`);
    }

    const safeName = safeFileName(file.name);
    const tempId = `${userId}/${Date.now()}-${safeName}`;
    const tempPath = path.join(BULK_STAGING_DIR, tempId);
    await mkdir(path.dirname(tempPath), { recursive: true });
    await writeFile(tempPath, buf);

    const mimeType = mime || mimeFromExt(ext);
    const { text, truncated } = await extractText(buf, file.name, mimeType);
    const preview = text.length > MAX_PREVIEW_CHARS ? text.slice(0, MAX_PREVIEW_CHARS) + "…" : text;
    staged.push({
      tempId,
      name: file.name,
      ext,
      mimeType,
      size: file.size,
      text: preview,
      truncated,
    });
  }
  return staged;
}

/** Build a display path for the user's folder tree. */
async function folderTreeText(userId: string): Promise<string> {
  const folders = await prisma.vFolder.findMany({ where: { userId }, orderBy: { name: "asc" } });
  const byId = new Map(folders.map((f) => [f.id, f]));
  function pathOf(id: string | null): string {
    const parts: string[] = [];
    let cur: string | null = id;
    let guard = 0;
    while (cur && guard++ < 50) {
      const f = byId.get(cur);
      if (!f) break;
      parts.unshift(f.name);
      cur = f.parentId;
    }
    return parts.join("/") || "Root";
  }
  return folders.length === 0
    ? "No existing folders."
    : folders.map((f) => `- ${f.id} | ${pathOf(f.id)}`).join("\n");
}

/** Ask the LLM to suggest a plan for the uploaded materials. */
export async function suggestUploadPlan(
  userId: string,
  files: { name: string; text: string; mimeType: string }[]
): Promise<PlanSuggestion> {
  const cfg = await getUserConfig(userId);
  if (!cfg.apiKey) {
    // No AI configured — return a conservative default plan.
    return {
      createFolder: true,
      folderName: "New study materials",
      createStructure: false,
      structure: null,
      notes: null,
      flashcards: null,
      teach: null,
      workspace: { name: "New study materials" },
      reasoning: "AI not configured. Files will be saved to a single folder and a Study Hub workspace.",
    };
  }
  const { model } = await acquireLlmModel(userId);

  const fileList = files
    .map((f, i) => `${i + 1}. ${f.name} (${f.mimeType})\nPreview: ${f.text.slice(0, 500).replace(/\s+/g, " ").trim()}`)
    .join("\n\n");

  const folderTree = await folderTreeText(userId);

  const userPrompt = `You are helping organize a student's study materials. Given the uploaded files and the existing folder tree, suggest the best plan for what to do with the files.

Uploaded files:
${fileList}

Existing folder tree (id | path):
${folderTree}

Suggest the following JSON plan. Use ": null" for actions you do not recommend.
{
  "createFolder": boolean,
  "folderName": "suggested folder name or null",
  "createStructure": boolean,
  "structure": [{ "folderName": "...", "fileIndexes": [0, 2] }] or null,
  "notes": { "style": "outline" | "cornell" | "summary" | "bullets", "detail": "brief" | "standard" | "detailed", "customStructure": "optional instructions or empty string", "title": "note title or empty" } or null,
  "flashcards": { "count": 10, "mode": "mixed" | "concept" | "factual" | "cloze", "deckName": "..." } or null,
  "teach": { "level": "beginner" | "intermediate" | "advanced", "title": "..." } or null,
  "workspace": { "name": "workspace title in Study Hub" } or null,
  "reasoning": "short Czech explanation of the plan"
}`;

  const hint =
    'Schema: { "createFolder": boolean, "folderName": string|null, "createStructure": boolean, "structure": [{"folderName":"string","fileIndexes":[number]}]|null, "notes": {"style":"outline"|"cornell"|"summary"|"bullets","detail":"brief"|"standard"|"detailed","customStructure":"string","title":"string"}|null, "flashcards": {"count":number,"mode":"mixed"|"concept"|"factual"|"cloze","deckName":"string"}|null, "teach": {"level":"beginner"|"intermediate"|"advanced","title":"string"}|null, "workspace": {"name":"string"}|null, "reasoning":"string" }';

  const result = await generateJson<PlanSuggestion>(model, userPrompt, hint);
  return {
    createFolder: Boolean(result.createFolder),
    folderName: result.folderName || null,
    createStructure: Boolean(result.createStructure),
    structure: Array.isArray(result.structure) ? result.structure.filter((s) => s.folderName && Array.isArray(s.fileIndexes)) : null,
    notes: result.notes ?? null,
    flashcards: result.flashcards ?? null,
    teach: result.teach ?? null,
    workspace: result.workspace && result.workspace.name ? result.workspace : null,
    reasoning: result.reasoning || "AI-suggested plan",
  };
}

/** Execute the chosen plan: save files, create folders, and run AI workflows. */
export async function processUploads(
  userId: string,
  files: ProcessRequestFile[],
  actions: ProcessActions
): Promise<ProcessResult> {
  const cfg = await getUserConfig(userId);
  const anyAi = Boolean(actions.notes || actions.flashcards || actions.teach);
  if (anyAi && !cfg.apiKey) {
    throw new LlmError(400, "No AI provider configured. Add an API key in Settings → AI.");
  }

  if (files.length === 0) {
    throw new LlmError(400, "No files to process.");
  }

  // Read staged files from disk and validate quota.
  const staged: { tempId: string; name: string; buf: Buffer; mimeType: string }[] = [];
  let totalBytes = 0;
  for (const f of files) {
    const src = path.join(BULK_STAGING_DIR, f.tempId);
    const buf = await readFile(src).catch(() => {
      throw new LlmError(404, `Temporary file not found for ${f.name}. It may have expired.`);
    });
    const ext = extOf(f.name);
    const { mime } = await detectAndValidateMime(buf, "");
    const mimeType = mime || mimeFromExt(ext);
    staged.push({ tempId: f.tempId, name: f.name, buf, mimeType });
    totalBytes += buf.length;
  }

  const quota = await getStorageStatus(userId, totalBytes);
  if (!quota.allowed) {
    throw new LlmError(413, quota.message);
  }

  // Decide base folder.
  let baseFolderId: string | null = null;
  const createdFolders: { id: string; name: string; parentId: string | null }[] = [];
  if (actions.createFolder) {
    const folderName = (actions.folderName || "New study materials").trim().slice(0, 64);
    const folder = await prisma.vFolder.create({
      data: { name: folderName, parentId: null, userId },
    });
    baseFolderId = folder.id;
    createdFolders.push({ id: folder.id, name: folder.name, parentId: null });
  }

  // Save all staged files to permanent VFile records.
  const savedFiles: ProcessedFile[] = [];
  for (const s of staged) {
    const safeName = safeFileName(s.name);
    const storageKey = `${userId}/${Date.now()}-${safeName}`;
    const destPath = path.join(UPLOAD_DIR, storageKey);
    await mkdir(path.dirname(destPath), { recursive: true });
    await rename(path.join(BULK_STAGING_DIR, s.tempId), destPath);

    const record = await prisma.vFile.create({
      data: {
        name: s.name,
        mimeType: s.mimeType,
        size: s.buf.length,
        storageKey,
        folderId: baseFolderId,
        userId,
        lastOpenedAt: new Date(),
      },
    });
    savedFiles.push({ id: record.id, name: record.name, mimeType: record.mimeType, size: record.size, folderId: record.folderId });
  }

  // Build per-folder file mapping for structure creation.
  const fileIdByIndex = savedFiles.map((f) => f.id);
  if (actions.createStructure && actions.structure && actions.structure.length > 0) {
    const parentId = baseFolderId;
    for (const item of actions.structure) {
      const sub = await prisma.vFolder.create({
        data: { name: item.folderName.slice(0, 64), parentId, userId },
      });
      createdFolders.push({ id: sub.id, name: sub.name, parentId });
      const ids = item.fileIndexes
        .map((idx) => fileIdByIndex[idx])
        .filter(Boolean);
      if (ids.length > 0) {
        await prisma.vFile.updateMany({
          where: { id: { in: ids }, userId },
          data: { folderId: sub.id },
        });
      }
    }
    // Update in-memory savedFiles.
    for (const f of savedFiles) {
      const reloaded = await prisma.vFile.findFirst({ where: { id: f.id, userId } });
      if (reloaded) f.folderId = reloaded.folderId;
    }
  }

  // Resolve text sources for Study Hub workspace and any AI actions.
  const sources: { fileId: string; sourceId: string; name: string; text: string }[] = [];
  for (const file of savedFiles) {
    if (isTextOrPdf(file.name, extOf(file.name), file.mimeType)) {
      try {
        const resolved = await resolveSource(userId, { kind: "file", id: file.id });
        const cached = await resolveAndCache(userId, { kind: "file", id: file.id });
        sources.push({ fileId: file.id, sourceId: cached.id, name: resolved.name, text: resolved.text });
      } catch (e) {
        console.error("[intelligent-upload] resolve source failed for", file.id, e);
      }
    }
  }

  let noteResult: { id: string; title: string } | null = null;
  let flashcardDeckResult: { id: string; name: string; cardCount: number } | null = null;
  let teacherSessionResult: { id: string; title: string } | null = null;

  if ((actions.notes || actions.flashcards) && sources.length > 0) {
    const { model } = await acquireLlmModel(userId);

    if (actions.notes) {
      const { style, detail, customStructure, title } = actions.notes;
      const combined = combinedSourceText(sources);
      const notes = await generateText(
        model,
        notetakingPrompt(combined, style, "Study materials", { detail, customStructure }),
        "You are a study assistant. Take accurate, well-organized notes in Markdown. Do not invent information."
      );
      const noteTitle = (title || `Notes: ${actions.createFolder ? actions.folderName : sources[0].name}`).trim().slice(0, 200);
      const note = await prisma.note.create({
        data: { userId, title: noteTitle, content: notes, tags: "notes,ai,upload" },
      });
      noteResult = { id: note.id, title: note.title };
    }

    if (actions.flashcards) {
      const { count, mode, deckName } = actions.flashcards;
      const cardCount = Math.max(1, Math.min(40, Number(count) || 10));
      const combined = combinedSourceText(sources);
      const result = await generateJson<{ cards: { front: string; back: string }[] }>(
        model,
        flashcardsPrompt(combined, cardCount, mode),
        flashcardsSchemaHint()
      );
      const cards = (result.cards || []).filter((c) => c.front?.trim() && c.back?.trim());
      const deckTitle = (deckName || `Flashcards: ${actions.createFolder ? actions.folderName : sources[0].name}`).trim().slice(0, 100);
      const deck = await prisma.flashcardDeck.create({
        data: { name: deckTitle, color: "#6366f1", userId },
      });
      if (cards.length > 0) {
        await prisma.flashcard.createMany({
          data: cards.map((c) => ({
            deckId: deck.id,
            front: String(c.front).slice(0, 2000),
            back: String(c.back).slice(0, 2000),
            sourceRef: sources.map((s) => s.name).join(", ").slice(0, 200),
          })),
        });
      }
      flashcardDeckResult = { id: deck.id, name: deck.name, cardCount: cards.length };
    }
  }

  if (actions.teach && sources.length > 0) {
    const { level, title } = actions.teach;
    const sessionTitle = (title || `Teach Me: ${actions.createFolder ? actions.folderName : sources[0].name}`).trim().slice(0, 200);
    const state = {
      studentLevel: level,
      sourceHistory: [],
      coveredConcepts: [],
      comprehensionLog: [],
    };
    const session = await prisma.teacherSession.create({
      data: {
        userId,
        title: sessionTitle,
        sourceIds: JSON.stringify(sources.map((s) => s.sourceId)),
        messages: "[]",
        state: JSON.stringify(state),
      },
    });
    teacherSessionResult = { id: session.id, title: session.title };
  }

  let workspaceResult: { id: string; name: string; sourceIds: string[] } | null = null;
  if (actions.workspace && actions.workspace.name && sources.length > 0) {
    const workspaceName = actions.workspace.name.trim().slice(0, 200) || "Study materials";
    const ws = await prisma.learningWorkspace.create({
      data: {
        userId,
        name: workspaceName,
        description: `Workspace created from ${savedFiles.length} uploaded file(s).`,
        color: "#6366f1",
        sourceIds: JSON.stringify(sources.map((s) => s.sourceId)),
      },
    });
    workspaceResult = { id: ws.id, name: ws.name, sourceIds: JSON.parse(ws.sourceIds) as string[] };
  }

  // Clean up any remaining temp files for staged files we failed to move.
  for (const s of staged) {
    try {
      await unlink(path.join(BULK_STAGING_DIR, s.tempId));
    } catch { /* already moved */ }
  }

  return {
    savedFiles,
    createdFolders,
    note: noteResult,
    flashcardDeck: flashcardDeckResult,
    teacherSession: teacherSessionResult,
    workspace: workspaceResult,
    studySourceIds: sources.map((s) => s.sourceId),
  };
}
