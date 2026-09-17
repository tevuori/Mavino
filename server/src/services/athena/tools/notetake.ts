// ===== Athena notetaking tools =====
// create_notes_from_url: fetch a web page → AI generates structured notes → save Note.
// create_notes_from_pdf: extract text from an uploaded PDF file → AI notes → save Note.

import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ToolDef } from "./plugin";
import prisma from "../../../db/client";
import { getUserConfig, acquireLlmModel, modelSupportsVision } from "../llm";
import { fetchUrl } from "../../../services/fetcher";
import { generateText } from "../../study/llm-json";
import { notetakingPrompt, type NoteStyle, type NoteDetail } from "../../study/prompts";
import { generateImageAwareNotes } from "../../study/image-aware-notes";
import { logSessionSafe } from "../../study/logSession";
import { getUserLanguage } from "../../language";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

/** Extract text from a PDF file on disk using pdf-parse. */
async function extractPdfText(storageKey: string): Promise<string> {
  const abs = path.join(UPLOAD_DIR, storageKey);
  const buf = await readFile(abs);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text || "";
}

function parseStyle(s: unknown): NoteStyle {
  const v = String(s ?? "outline");
  return (["cornell", "outline", "summary", "bullets"] as const).includes(v as NoteStyle)
    ? (v as NoteStyle)
    : "outline";
}

function parseDetail(s: unknown): NoteDetail {
  const v = String(s ?? "standard");
  return (["brief", "standard", "detailed"] as const).includes(v as NoteDetail)
    ? (v as NoteDetail)
    : "standard";
}

function parseCustomStructure(s: unknown): string | undefined {
  const v = String(s ?? "").trim();
  return v ? v.slice(0, 2000) : undefined;
}

export const notetakeTools: ToolDef[] = [
  {
    name: "create_notes_from_url",
    description:
      "Fetch a web page, generate structured notes from its content, save them as a new Note, and open it in the Notes app. Use when the user pastes a URL and asks to 'take notes on this', 'summarize this page', or 'make notes from this link'.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "url", type: "string", description: "Full http(s) URL of the page to take notes from", required: true },
      {
        name: "style",
        type: "string",
        description: "Note style",
        enum: ["cornell", "outline", "summary", "bullets"],
      },
      {
        name: "detail",
        type: "string",
        description: "How detailed the notes should be",
        enum: ["brief", "standard", "detailed"],
      },
      { name: "customStructure", type: "string", description: "Optional freeform instructions describing how the notes should be structured (e.g. 'start with a glossary, then one section per chapter, end with 5 review questions')" },
      { name: "title", type: "string", description: "Optional title for the new note" },
      { name: "tags", type: "string", description: "Comma-separated tags (defaults to 'notes,ai,web')" },
      { name: "folderId", type: "string", description: "Optional folder id from list_note_folders to store the note in" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      const url = String(args.url ?? "").trim();
      if (!url) return { error: "url is required" };

      let page;
      try {
        page = await fetchUrl(url, 20_000);
      } catch (e) {
        return { error: `Failed to fetch URL: ${e instanceof Error ? e.message : "unknown"}` };
      }
      if (!page.content.trim()) {
        return { error: "The page had no extractable text content." };
      }

      const style = parseStyle(args.style);
      const detail = parseDetail(args.detail);
      const customStructure = parseCustomStructure(args.customStructure);
      let notes: string;
      try {
        notes = await generateText(
          model,
          notetakingPrompt(page.content, style, page.title || page.finalUrl, { detail, customStructure }, await getUserLanguage(userId)),
          "You are a study assistant. Take accurate, well-organized notes in Markdown. Do not invent information."
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Note generation failed" };
      }

      const title = (String(args.title ?? "").trim() || `Notes: ${page.title || "Web Page"}`).slice(0, 200);
      const tags = String(args.tags ?? "notes,ai,web");

      let folderId: string | null = null;
      if (args.folderId !== undefined && args.folderId !== null) {
        const fid = String(args.folderId).trim();
        if (fid !== "" && fid !== "null") {
          const folder = await prisma.noteFolder.findFirst({ where: { id: fid, userId } });
          if (!folder) return { error: "Folder not found" };
          folderId = fid;
        }
      }

      const note = await prisma.note.create({
        data: { userId, title, content: notes, tags, folderId },
      });

      // Include source URL as a footer in the note for traceability.
      const withSource = `${notes}\n\n---\n_Source: [${page.title || page.finalUrl}](${page.finalUrl})_`;
      await prisma.note.update({ where: { id: note.id }, data: { content: withSource } });

      await logSessionSafe(userId, "notes", title, page.finalUrl, {
        noteId: note.id,
        style,
        sourceUrl: page.finalUrl,
      });

      return {
        action: "open_app",
        appId: "notes",
        title,
        noteId: note.id,
        note: { id: note.id, title: note.title },
        sourceUrl: page.finalUrl,
        created: true,
      };
    },
  },
  {
    name: "create_notes_from_pdf",
    description:
      "Extract text from an uploaded PDF file, generate structured notes, save them as a new Note, and open it in the Notes app. Use search_files / list_files first to get the file id. The file must be a PDF in the user's virtual file system. When the configured model supports vision and includeImages is true, embedded images are extracted and passed to the model so they can be embedded, ASCII-ified, or described in the notes.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "fileId", type: "string", description: "PDF file id from list_files / search_files", required: true },
      {
        name: "style",
        type: "string",
        description: "Note style",
        enum: ["cornell", "outline", "summary", "bullets"],
      },
      {
        name: "detail",
        type: "string",
        description: "How detailed the notes should be",
        enum: ["brief", "standard", "detailed"],
      },
      { name: "customStructure", type: "string", description: "Optional freeform instructions describing how the notes should be structured (e.g. 'start with a glossary, then one section per chapter, end with 5 review questions')" },
      { name: "title", type: "string", description: "Optional title for the new note" },
      { name: "tags", type: "string", description: "Comma-separated tags (defaults to 'notes,ai,pdf')" },
      { name: "folderId", type: "string", description: "Optional folder id from list_note_folders to store the note in" },
      { name: "includeImages", type: "boolean", description: "Whether to extract and send embedded images to a vision-capable model (defaults to true if the model supports vision)" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      const fileId = String(args.fileId ?? "").trim();
      if (!fileId) return { error: "fileId is required" };

      const file = await prisma.vFile.findFirst({ where: { id: fileId, userId } });
      if (!file) return { error: "File not found" };

      const isPdf =
        file.mimeType === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        return { error: `File '${file.name}' is not a PDF.` };
      }

      let text: string;
      try {
        text = await extractPdfText(file.storageKey);
      } catch (e) {
        return { error: `PDF text extraction failed: ${e instanceof Error ? e.message : "unknown"}` };
      }
      if (!text.trim()) {
        return { error: "The PDF had no extractable text (it may be a scanned image PDF)." };
      }

      // Truncate to a reasonable size for the LLM.
      const MAX = 20_000;
      let truncated = false;
      if (text.length > MAX) {
        text = text.slice(0, MAX);
        truncated = true;
      }

      const style = parseStyle(args.style);
      const detail = parseDetail(args.detail);
      const customStructure = parseCustomStructure(args.customStructure);

      const visionCapable = modelSupportsVision(cfg.provider, cfg.modelId);
      const includeImages = args.includeImages !== false;
      let notes: string;
      let extractedImageCount = 0;
      let imagesIncluded = false;
      try {
        const generated = await generateImageAwareNotes({
          model,
          userId,
          sourceText: text,
          sourceLabel: file.name,
          style,
          detail,
          customStructure,
          language: await getUserLanguage(userId),
          includeImages,
          visionCapable,
          sourceFiles: [{ fileId: file.id, sourceName: file.name }],
        });
        notes = generated.notes;
        extractedImageCount = generated.extractedImageCount;
        imagesIncluded = generated.imagesIncluded;
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Note generation failed" };
      }

      const title = (String(args.title ?? "").trim() || `Notes: ${file.name}`).slice(0, 200);
      const tags = String(args.tags ?? "notes,ai,pdf");

      let folderId: string | null = null;
      if (args.folderId !== undefined && args.folderId !== null) {
        const fid = String(args.folderId).trim();
        if (fid !== "" && fid !== "null") {
          const folder = await prisma.noteFolder.findFirst({ where: { id: fid, userId } });
          if (!folder) return { error: "Folder not found" };
          folderId = fid;
        }
      }

      const note = await prisma.note.create({
        data: { userId, title, content: notes, tags, folderId },
      });

      await logSessionSafe(userId, "notes", title, file.id, {
        noteId: note.id,
        style,
        detail,
        fileId: file.id,
        fileName: file.name,
        truncated,
        customStructure: customStructure || undefined,
        includeImages,
        visionCapable,
        extractedImageCount,
        imagesIncluded,
      });

      return {
        action: "open_app",
        appId: "notes",
        title,
        noteId: note.id,
        note: { id: note.id, title: note.title },
        sourceFile: file.name,
        created: true,
      };
    },
  },
];
