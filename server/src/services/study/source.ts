// ===== Study Hub source resolution =====
// Resolves a source descriptor ({ kind, id?, text?, url? }) to plain text
// content from a note, a text file or PDF on disk, a fetched web URL, or pasted
// text. Reused by all study workflows so the LLM always receives clean source
// text. Also provides resolveAndCache() to persist the extracted text as a
// StudySource for reuse across grounded Q&A / podcasts.

import path from "node:path";
import { readFile } from "node:fs/promises";
import prisma from "../../db/client";
import { fetchUrl } from "../fetcher";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

/** Maximum source text length sent to the LLM (protects context windows). */
export const MAX_SOURCE_CHARS = 30000;

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "html", "htm", "css", "xml", "svg", "py",
  "rb", "php", "go", "rs", "java", "c", "h", "cpp", "cs", "kt", "swift", "sh",
  "bash", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "sql", "csv",
  "tsv", "log", "js", "jsx", "ts", "tsx",
]);

export type SourceKind = "note" | "file" | "paste" | "url";

export interface SourceDescriptor {
  kind: SourceKind;
  /** Note id or file id (required for kind "note" / "file"). */
  id?: string;
  /** Pasted text (required for kind "paste"). */
  text?: string;
  /** Web URL (required for kind "url"). */
  url?: string;
  /** URL display name (optional, for display). */
  name?: string;
}

export interface ResolvedSource {
  /** Display name for logging / UI. */
  name: string;
  /** Full (possibly truncated) text content. */
  text: string;
  /** Reference id for the StudySession log (note id / file id / "paste" / url). */
  ref: string;
  truncated: boolean;
  /** The source kind (echoed back for callers that build StudySource rows). */
  kind: SourceKind;
  /** 1-based index when resolved as part of a multi-source list. */
  index?: number;
}

function isTextFile(name: string, mime: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/javascript", "application/x-yaml"].includes(mime)) return true;
  if (mime.includes("yaml") || mime.includes("csv")) return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXT.has(ext);
}

function isPdfFile(name: string, mime: string): boolean {
  if (mime === "application/pdf") return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "pdf";
}

/**
 * Strip NUL bytes and other C0 control characters (keeping \n, \r, \t) that
 * Postgres' text type rejects outright ("invalid byte sequence for encoding
 * UTF8: 0x00"). PDF extraction (and occasionally scraped HTML pages)
 * can produce embedded NULs that would otherwise crash the StudySource
 * upsert. Applied before truncation so every resolveSource() caller —
 * including plain resolveSource() callers that never touch the DB — gets
 * clean text.
 */
function sanitizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function truncate(text: string): { text: string; truncated: boolean } {
  const clean = sanitizeText(text);
  if (clean.length <= MAX_SOURCE_CHARS) return { text: clean, truncated: false };
  return {
    text: clean.slice(0, MAX_SOURCE_CHARS) + "\n\n[…truncated…]",
    truncated: true,
  };
}

/** Extract text from a PDF buffer using pdf-parse v2 API. */
async function extractPdfText(buf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** Resolve a source descriptor to text content for the LLM. */
export async function resolveSource(
  userId: string,
  src: SourceDescriptor
): Promise<ResolvedSource> {
  if (src.kind === "paste" || (!src.id && src.text != null && src.kind !== "url")) {
    const text = String(src.text ?? "");
    const t = truncate(text);
    return { name: "Pasted text", text: t.text, ref: "paste", truncated: t.truncated, kind: "paste" };
  }

  if (src.kind === "note") {
    if (!src.id) throw new Error("Note id is required");
    const note = await prisma.note.findFirst({ where: { id: src.id, userId } });
    if (!note) throw new Error("Note not found");
    const t = truncate(note.content);
    return { name: note.title || "Untitled note", text: t.text, ref: note.id, truncated: t.truncated, kind: "note" };
  }

  if (src.kind === "file") {
    if (!src.id) throw new Error("File id is required");
    const file = await prisma.vFile.findFirst({ where: { id: src.id, userId } });
    if (!file) throw new Error("File not found");
    const abs = path.join(UPLOAD_DIR, file.storageKey);
    const buf = await readFile(abs);
    let content: string;
    if (isPdfFile(file.name, file.mimeType)) {
      content = await extractPdfText(buf);
      if (!content.trim()) {
        throw new Error(`Could not extract text from '${file.name}' (it may be a scanned/image-only PDF).`);
      }
    } else if (isTextFile(file.name, file.mimeType)) {
      content = buf.toString("utf-8");
    } else {
      throw new Error(`File '${file.name}' is not a supported text or PDF file`);
    }
    const t = truncate(content);
    return { name: file.name, text: t.text, ref: file.id, truncated: t.truncated, kind: "file" };
  }

  if (src.kind === "url") {
    if (!src.url) throw new Error("URL is required");
    const page = await fetchUrl(src.url, MAX_SOURCE_CHARS);
    const name = src.name?.trim() || page.title || src.url;
    return {
      name,
      text: page.content,
      ref: src.url,
      truncated: page.truncated,
      kind: "url",
    };
  }

  throw new Error(`Unknown source kind: ${src.kind}`);
}

/**
 * Resolve a source descriptor and persist (or refresh) it as a StudySource row
 * with the extracted text cached. Returns the StudySource. Dedupes by
 * (userId, kind, refId) — re-resolving the same note/file/url updates the
 * cached text in place rather than creating a duplicate.
 */
export async function resolveAndCache(
  userId: string,
  src: SourceDescriptor
): Promise<{ id: string; name: string; kind: SourceKind; refId: string; textCache: string; truncated: boolean; charCount: number }> {
  const resolved = await resolveSource(userId, src);
  const refId = resolved.ref;
  const existing = await prisma.studySource.findFirst({
    where: { userId, kind: resolved.kind, refId },
  });

  const data = {
    name: resolved.name.slice(0, 300),
    textCache: resolved.text,
    truncated: resolved.truncated,
    charCount: resolved.text.length,
  };

  if (existing) {
    const updated = await prisma.studySource.update({ where: { id: existing.id }, data });
    return { id: updated.id, ...data, kind: resolved.kind, refId };
  }
  const created = await prisma.studySource.create({
    data: { userId, kind: resolved.kind, refId, ...data },
  });
  return { id: created.id, ...data, kind: resolved.kind, refId };
}
