// ===== Source outline: list pages/slides of a source =====
// Used by the teacher "list_source_pages" tool so the LLM can discover which
// PDF page / PPTX slide numbers to reference before calling show_source.

import { PDFParse } from "pdf-parse";
import { extractPptxSlides } from "./pptx";

const MAX_PREVIEW_CHARS = 160;
const DEFAULT_MAX_PAGES = 30;

function truncatePreview(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length <= MAX_PREVIEW_CHARS) return cleaned;
  return cleaned.slice(0, MAX_PREVIEW_CHARS) + "…";
}

export interface SourceOutlinePage {
  /** 1-based page/slide number. */
  index: number;
  /** Short text preview for this page/slide. */
  preview: string;
}

export interface SourceOutline {
  pages: SourceOutlinePage[];
  /** Total number of pages/slides in the source. */
  total: number;
  /** True if only a subset of pages was returned. */
  truncated: boolean;
}

function isPdfFile(name: string, mime: string): boolean {
  if (mime === "application/pdf") return true;
  return name.toLowerCase().endsWith(".pdf");
}

function isPptxFile(name: string, mime: string): boolean {
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return true;
  return name.toLowerCase().endsWith(".pptx");
}

/** Build an outline of pages/slides for supported file types. */
export async function buildSourceOutline(
  name: string,
  mimeType: string,
  getBuffer: () => Promise<Buffer>,
  maxPages = DEFAULT_MAX_PAGES
): Promise<SourceOutline> {
  if (isPdfFile(name, mimeType)) {
    const buf = await getBuffer();
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const info = await parser.getInfo();
      const total = typeof info.total === "number" ? info.total : 0;
      const pagesToFetch = Math.min(total, maxPages);
      const pages: SourceOutlinePage[] = [];
      for (let i = 1; i <= pagesToFetch; i++) {
        const textResult = await parser.getText({ partial: [i] });
        pages.push({ index: i, preview: truncatePreview(textResult.text ?? "") });
      }
      return { pages, total, truncated: total > maxPages };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (isPptxFile(name, mimeType)) {
    const buf = await getBuffer();
    const slides = extractPptxSlides(buf);
    const total = slides.length;
    const pages = slides.slice(0, maxPages).map((s) => ({
      index: s.index,
      preview: truncatePreview(s.text),
    }));
    return { pages, total, truncated: total > maxPages };
  }

  // Generic text fallback: treat each non-empty line/paragraph as an "item".
  const buf = await getBuffer();
  const text = buf.toString("utf-8");
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p, i) => ({ index: i + 1, preview: truncatePreview(p) }));
  return { pages: paragraphs.slice(0, maxPages), total: paragraphs.length, truncated: paragraphs.length > maxPages };
}
