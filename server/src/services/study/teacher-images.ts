// ===== Teacher session image extraction =====
// Extracts embedded images from PDF sources attached to a Teach Me session
// and prepares them for vision-capable LLM attachment. Reuses the existing
// pdf-images.ts infrastructure (extractPdfImages + saveExtractedImages).
//
// Called asynchronously after session creation so the first turn can proceed
// without waiting for extraction. The metadata is persisted in the session
// state (TeacherSessionState.sourceImages) and the actual image bytes are
// loaded on demand when attaching to the LLM thread.

import path from "node:path";
import { readFile } from "node:fs/promises";
import prisma from "../../db/client";
import { extractPdfImages, saveExtractedImages, type SavedImage } from "../pdf-images";
import type { GroundedSource } from "./prompts";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

/** Maximum images across all sources in a single session. */
const MAX_SESSION_IMAGES = 12;

/** Maximum combined image bytes to attach to the LLM thread. */
const DEFAULT_MAX_ATTACH_BYTES = 8 * 1024 * 1024;

/** Metadata for an extracted image, persisted in session state. */
export interface SourceImageMeta {
  /** 1-based, matches SOURCE [n] in the prompt. */
  sourceIndex: number;
  sourceRefId: string;
  sourceName: string;
  pageNumber: number;
  /** 0-based within the page. */
  imageIndex: number;
  /** e.g. "figure-arch-p3-img1.png" */
  name: string;
  width: number;
  height: number;
  mimeType: string;
  /** VFile id of the saved image. */
  fileId: string;
  /** Relative path under uploads/. */
  storageKey: string;
}

/**
 * Extract embedded images from PDF sources attached to a session.
 *
 * For each source with kind "file" that is a PDF, extracts images via
 * extractPdfImages(), saves them as VFiles via saveExtractedImages(), and
 * returns metadata. Errors per-source are caught silently (non-fatal).
 * Caps at MAX_SESSION_IMAGES total across all sources.
 */
export async function extractSessionImages(
  userId: string,
  sources: GroundedSource[]
): Promise<SourceImageMeta[]> {
  const result: SourceImageMeta[] = [];
  let remaining = MAX_SESSION_IMAGES;

  for (const src of sources) {
    if (remaining <= 0) break;
    if (src.kind !== "file") continue;

    // Check if the file is a PDF.
    const file = await prisma.vFile.findFirst({
      where: { id: src.refId, userId },
      select: { id: true, name: true, mimeType: true, storageKey: true, folderId: true },
    });
    if (!file) continue;
    const isPdf =
      file.mimeType === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) continue;

    try {
      const absPath = path.join(UPLOAD_DIR, file.storageKey);
      const buf = await readFile(absPath);
      const extracted = await extractPdfImages(buf, {
        maxImages: remaining,
        minDimension: 100,
      });
      if (extracted.length === 0) continue;

      const saved = await saveExtractedImages(userId, extracted, file.folderId, file.name);
      for (const img of saved) {
        if (result.length >= MAX_SESSION_IMAGES) break;
        result.push({
          sourceIndex: src.index,
          sourceRefId: src.refId,
          sourceName: src.name,
          pageNumber: img.pageNumber,
          imageIndex: img.index,
          name: img.file.name,
          width: img.width,
          height: img.height,
          mimeType: img.mimeType,
          fileId: img.file.id,
          storageKey: img.file.storageKey,
        });
      }
      remaining = MAX_SESSION_IMAGES - result.length;
    } catch (e) {
      console.error(
        `[teacher-images] image extraction failed for source "${src.name}" (${src.refId}):`,
        e instanceof Error ? e.message : e
      );
      // Non-fatal — continue with other sources.
    }
  }

  return result;
}

/** Image attachment ready for the LLM (base64 bytes + label). */
export interface ImageAttachment {
  label: string;
  mimeType: string;
  base64: string;
}

/**
 * Load image bytes from disk for LLM attachment.
 * Caps total bytes at maxBytes to avoid exceeding provider limits.
 */
export async function loadImageAttachments(
  images: SourceImageMeta[],
  maxBytes = DEFAULT_MAX_ATTACH_BYTES
): Promise<ImageAttachment[]> {
  const attachments: ImageAttachment[] = [];
  let totalBytes = 0;

  for (const img of images) {
    try {
      const absPath = path.join(UPLOAD_DIR, img.storageKey);
      const buf = await readFile(absPath);
      if (totalBytes + buf.length > maxBytes) break;
      totalBytes += buf.length;
      attachments.push({
        label: `Source [${img.sourceIndex}] page ${img.pageNumber}: ${img.name}`,
        mimeType: img.mimeType,
        base64: buf.toString("base64"),
      });
    } catch (e) {
      console.error(
        `[teacher-images] failed to load image ${img.name}:`,
        e instanceof Error ? e.message : e
      );
      // Skip this image, continue with others.
    }
  }

  return attachments;
}
