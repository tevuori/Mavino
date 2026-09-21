// ===== PPTX text extraction =====
// PPTX files are ZIP archives containing Office Open XML. We unzip them with
// fflate (already a server dependency), parse the slide XML with cheerio, and
// collect text from <a:t> elements (DrawingML text runs). This gives us a
// per-slide text representation that can be cached as a StudySource and shown
// in the PPTX viewer.

import { unzipSync, strFromU8 } from "fflate";
import { load } from "cheerio";

export interface PptxSlide {
  /** 1-based slide index. */
  index: number;
  /** Plain text extracted from the slide. */
  text: string;
}

export function extractPptxSlides(buf: Buffer): PptxSlide[] {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(new Uint8Array(buf));
  } catch {
    throw new Error("Invalid PPTX file: could not unzip");
  }

  const slideFiles = Object.keys(zip).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/i.test(name)
  );

  // Sort by the numeric suffix, not lexicographically (slide10 before slide2).
  slideFiles.sort((a, b) => {
    const na = parseInt(a.match(/slide(\d+)\.xml$/i)![1], 10);
    const nb = parseInt(b.match(/slide(\d+)\.xml$/i)![1], 10);
    return na - nb;
  });

  const slides: PptxSlide[] = [];
  for (const file of slideFiles) {
    const xml = strFromU8(zip[file]);
    const $ = load(xml, { xmlMode: true });
    const texts: string[] = [];
    $("a\\:t").each((_, el) => {
      const t = $(el).text().trim();
      if (t) texts.push(t);
    });
    // Slide notes live in ppt/notesSlides/ and are intentionally skipped.
    const text = texts.join(" ").replace(/\s+/g, " ").trim();
    slides.push({ index: slides.length + 1, text });
  }

  return slides;
}

export function extractPptxText(buf: Buffer): { slides: PptxSlide[]; text: string } {
  const slides = extractPptxSlides(buf);
  const text = slides
    .map((s) => `--- SLIDE ${s.index} ---\n${s.text}`)
    .join("\n\n");
  return { slides, text };
}
