import path from "node:path";
import { readFile } from "node:fs/promises";
import type { LlmModel } from "multi-llm-ts";
import prisma from "../../db/client";
import { extractPdfImages, renderPdfPages, saveExtractedImages, type PdfPageImage, type SavedImage } from "../pdf-images";
import { generateText, generateVisionText } from "./llm-json";
import {
  notetakingPrompt,
  visionNotetakingPrompt,
  type NoteDetail,
  type NoteStyle,
  type StudyLanguage,
} from "./prompts";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const TEXT_SYSTEM_PROMPT = "You are a study assistant. Take accurate, well-organized notes in Markdown. Do not invent information not present in the source.";

interface SourceFileRef {
  fileId: string;
  sourceName?: string;
}

interface GenerateImageAwareNotesOptions {
  model: LlmModel;
  userId: string;
  sourceText: string;
  sourceLabel: string;
  style: NoteStyle;
  detail: NoteDetail;
  customStructure?: string;
  language?: StudyLanguage;
  includeImages: boolean;
  visionCapable: boolean;
  sourceFiles?: SourceFileRef[];
}

export interface ImageAwareNotesResult {
  notes: string;
  imagesIncluded: boolean;
  extractedImageCount: number;
}

function markdownImage(image: SavedImage): string {
  const alt = `Figure from page ${image.pageNumber} of ${image.file.name.replace(/\.[^.]+$/, "")}`;
  return `![${alt}](${image.downloadUrl})`;
}

export function ensureMarkdownImages(notes: string, images: SavedImage[]): string {
  const missing = images.filter((image) => !notes.includes(`](${image.downloadUrl})`));
  if (missing.length === 0) return notes.trim();
  const figures = missing.map(markdownImage).join("\n\n");
  return `${notes.trim()}\n\n## Figures from the source\n\n${figures}`.trim();
}

async function extractSourceImages(userId: string, sources: SourceFileRef[]): Promise<{ saved: SavedImage[]; pages: PdfPageImage[] }> {
  const saved: SavedImage[] = [];
  const pages: PdfPageImage[] = [];
  let totalBytes = 0;
  for (const source of sources) {
    const file = await prisma.vFile.findFirst({ where: { id: source.fileId, userId } });
    if (!file || (file.mimeType !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) continue;
    try {
      const buf = await readFile(path.join(UPLOAD_DIR, file.storageKey));
      const remaining = Math.max(0, 12 - saved.length);
      const remainingBytes = Math.max(0, 8 * 1024 * 1024 - totalBytes);
      const extracted = remaining > 0 && remainingBytes > 0
        ? await extractPdfImages(buf, { minDimension: 120, maxImages: remaining, maxTotalBytes: remainingBytes })
        : [];
      if (extracted.length > 0) {
        const sourceImages = await saveExtractedImages(userId, extracted, file.folderId, source.sourceName || file.name);
        saved.push(...sourceImages);
        totalBytes += sourceImages.reduce((sum, image) => sum + image.data.length, 0);
      }
      pages.push(...await renderPdfPages(buf));
    } catch (error) {
      console.error(`[image-aware-notes] image extraction failed for ${file.name}:`, error);
    }
  }
  return { saved, pages };
}

export async function generateImageAwareNotes(options: GenerateImageAwareNotesOptions): Promise<ImageAwareNotesResult> {
  const noteOptions = { detail: options.detail, customStructure: options.customStructure };
  if (!options.includeImages || !options.visionCapable || !options.sourceFiles?.length) {
    const notes = await generateText(
      options.model,
      notetakingPrompt(options.sourceText, options.style, options.sourceLabel, noteOptions, options.language),
      TEXT_SYSTEM_PROMPT
    );
    return { notes, imagesIncluded: false, extractedImageCount: 0 };
  }

  const { saved: images, pages } = await extractSourceImages(options.userId, options.sourceFiles);
  if (pages.length === 0) {
    const notes = await generateText(
      options.model,
      notetakingPrompt(options.sourceText, options.style, options.sourceLabel, noteOptions, options.language),
      TEXT_SYSTEM_PROMPT
    );
    return { notes, imagesIncluded: false, extractedImageCount: 0 };
  }

  const refs = images.map((image, index) => ({
    index: index + 1,
    pageNumber: image.pageNumber,
    name: image.file.name,
    width: image.width,
    height: image.height,
    url: image.downloadUrl,
  }));
  const { systemPrompt, userPrompt } = visionNotetakingPrompt(
    options.sourceText,
    options.style,
    options.sourceLabel,
    refs,
    noteOptions,
    options.language
  );
  const generated = await generateVisionText(
    options.model,
    systemPrompt,
    `${userPrompt}\n\nThe ${pages.length} attached vision images are full-page PDF renders in page order. Read all visible text, mathematical notation, formulas, diagrams, and worked examples from them. Use LaTeX for mathematical notation. Treat extracted text as a supplement; when it omits formula glyphs or diagram content, recover that content from the page renders.`,
    pages.map((page) => ({
      label: `PDF page ${page.pageNumber}`,
      mimeType: page.mimeType,
      base64: Buffer.from(page.data).toString("base64"),
    }))
  );
  return {
    notes: ensureMarkdownImages(generated, images),
    imagesIncluded: true,
    extractedImageCount: images.length,
  };
}
