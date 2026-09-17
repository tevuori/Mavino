// ===== PDF embedded image extraction and persistence =====
// Used by vision-aware note generation: extracts raster images from a PDF,
// filters out decorative/tiny duplicates, persists the useful ones as VFiles,
// and returns metadata the LLM can reference.

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import prisma from "../db/client";
import { getStorageStatus } from "./storage-quota";
import type { VFile } from "@prisma/client";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

/** Raw image extracted from a PDF page. */
export interface ExtractedImage {
  pageNumber: number;
  index: number;
  name: string;
  width: number;
  height: number;
  mimeType: string;
  /** Base64 data URL, e.g. "data:image/png;base64,...". */
  dataUrl: string;
  /** Raw bytes of the decoded image. */
  data: Uint8Array;
  /** Hex SHA-256 of `data`, useful for deduplication. */
  hash: string;
}

/** Saved image with a VFile record and an auth-aware download URL. */
export interface SavedImage extends ExtractedImage {
  file: VFile;
  downloadUrl: string;
}

export interface PdfPageImage {
  pageNumber: number;
  width: number;
  height: number;
  mimeType: "image/png";
  data: Uint8Array;
}

/** Options controlling extraction. */
export interface ExtractPdfImagesOptions {
  /** Skip images whose width OR height is smaller than this (px). */
  minDimension?: number;
  /** Maximum number of images to return (most important first, by area). */
  maxImages?: number;
  /** Maximum decoded image size in bytes; larger images are skipped. */
  maxImageBytes?: number;
  /** Maximum combined byte size of all returned images. */
  maxTotalBytes?: number;
}

const DEFAULT_OPTS: Required<ExtractPdfImagesOptions> = {
  minDimension: 80,
  maxImages: 20,
  maxImageBytes: 4 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
};

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    default:
      return "png";
  }
}

function sha256(buffer: Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(buffer);
  return hash.digest("hex");
}

/**
 * Extract embedded raster images from a PDF buffer using the existing
 * pdf-parse dependency. Returns images sorted by descending area, with
 * small/duplicate/large images removed.
 */
export async function extractPdfImages(
  buffer: Buffer | Uint8Array,
  opts: ExtractPdfImagesOptions = {}
): Promise<ExtractedImage[]> {
  const { minDimension, maxImages, maxImageBytes, maxTotalBytes } = { ...DEFAULT_OPTS, ...opts };
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  let imageResult;
  try {
    imageResult = await parser.getImage({
      imageThreshold: minDimension,
      imageDataUrl: true,
      imageBuffer: true,
    });
  } finally {
    await parser.destroy();
  }

  const extracted: ExtractedImage[] = [];
  for (const page of imageResult.pages) {
    for (let i = 0; i < page.images.length; i++) {
      const img = page.images[i];
      if (!img.dataUrl || img.data.length === 0) continue;
      const parsed = parseDataUrl(img.dataUrl);
      if (!parsed) continue;
      if (img.width < minDimension || img.height < minDimension) continue;
      if (img.data.length > maxImageBytes) continue;

      extracted.push({
        pageNumber: page.pageNumber,
        index: i,
        name: img.name || `image-${page.pageNumber}-${i}`,
        width: img.width,
        height: img.height,
        mimeType: parsed.mimeType,
        dataUrl: img.dataUrl,
        data: img.data,
        hash: sha256(img.data),
      });
    }
  }

  // Deduplicate by content hash, preferring the first occurrence.
  const seen = new Set<string>();
  const unique: ExtractedImage[] = [];
  for (const img of extracted) {
    if (seen.has(img.hash)) continue;
    seen.add(img.hash);
    unique.push(img);
  }

  // Sort by visual area so the most prominent images are kept if we cap.
  unique.sort((a, b) => b.width * b.height - a.width * a.height);

  // Cap total returned images and combined byte size.
  const result: ExtractedImage[] = [];
  let totalBytes = 0;
  for (const img of unique) {
    if (result.length >= maxImages) break;
    if (totalBytes + img.data.length > maxTotalBytes) break;
    result.push(img);
    totalBytes += img.data.length;
  }

  return result;
}

export async function renderPdfPages(
  buffer: Buffer | Uint8Array,
  desiredWidth = 1200
): Promise<PdfPageImage[]> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getScreenshot({
      desiredWidth,
      imageDataUrl: false,
      imageBuffer: true,
    });
    return result.pages.map((page) => ({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      mimeType: "image/png" as const,
      data: page.data,
    }));
  } finally {
    await parser.destroy();
  }
}

/**
 * Persist extracted images as VFile records in the given folder and return
 * auth-aware download URLs (same pattern used by the Notes image button).
 */
export async function saveExtractedImages(
  userId: string,
  images: ExtractedImage[],
  folderId: string | null,
  sourceName: string
): Promise<SavedImage[]> {
  const saved: SavedImage[] = [];

  // Check quota for the full batch up front.
  const totalSize = images.reduce((sum, img) => sum + img.data.length, 0);
  const quota = await getStorageStatus(userId, totalSize);
  if (!quota.allowed) {
    throw new Error(quota.message);
  }

  const baseSafe = path.basename(sourceName).replace(/\.pdf$/i, "").replace(/[^\w.\- ]+/g, "_");
  const dir = path.join(UPLOAD_DIR, userId);
  await mkdir(dir, { recursive: true });

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const ext = extensionForMime(img.mimeType);
    const fileName = `${baseSafe}-p${img.pageNumber}-img${i + 1}.${ext}`;
    const storageKey = `${userId}/${Date.now()}-${fileName}`;
    const absPath = path.join(UPLOAD_DIR, storageKey);

    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, Buffer.from(img.data));

    const file = await prisma.vFile.create({
      data: {
        userId,
        name: fileName,
        mimeType: img.mimeType,
        size: img.data.length,
        storageKey,
        folderId,
      },
    });

    saved.push({
      ...img,
      file,
      downloadUrl: `/api/files/${file.id}/download`,
    });
  }

  return saved;
}

