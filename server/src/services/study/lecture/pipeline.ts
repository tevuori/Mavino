// ===== Lecture pipeline: orchestrator =====
// Ties together all stages: probe → audio extract → chunked Whisper →
// frame hash → (camera) region detect → slide dedup → per-slide vision/OCR →
// alignment → note generation. Runs fire-and-forget, updating LectureJob
// progress in DB at each stage.

import path from "node:path";
import { mkdir, rm, readdir, stat } from "node:fs/promises";
import prisma from "../../../db/client";
import { getUserConfig, isLlmConfiguredFor, acquireLlmModel } from "../../athena/llm";
import { generateText } from "../llm-json";
import { probeVideo, extractAudio, chunkAudio, sampleFramesForHash, extractFrame, sampleCroppedFramesForHash } from "./ffmpeg";
import { transcribeChunks, getTranscriptionConfig, fullTranscriptText, type TranscriptSegment } from "./transcribe";
import { deduplicateSlides, type SlideKeyframe } from "./slides";
import { detectSlideRegion, extractSlideContentVision, supportsVision, ocrImage, type SlideRegion } from "./vision";
import { alignTranscriptToSlides, formatTimestamp, type AlignedSlide } from "./align";
import { lectureSlideNotePrompt, lectureSummaryPrompt, type NoteStyle, type NoteDetail, type StudyLanguage } from "../prompts";
import { canonicalPair } from "../../../db/links";
import { logSessionSafe } from "../logSession";
import { getStorageStatus } from "../../storage-quota";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const WORK_DIR = path.resolve(process.cwd(), "uploads", "_lecture_work");

/** Active jobs set — prevents concurrent jobs for the same user. */
const activeJobs = new Set<string>();

interface PipelineConfig {
  jobId: string;
  userId: string;
  videoFileId: string;
  videoPath: string;
  style: NoteStyle;
  detail: NoteDetail;
  language: StudyLanguage;
  videoType: "slides" | "camera";
}

/** Update the LectureJob record with current progress. */
async function updateJob(
  jobId: string,
  data: Partial<{
    status: string;
    stage: string;
    progress: number;
    error: string;
    noteId: string;
    folderId: string;
    slideCount: number;
    durationSec: number;
    meta: string;
  }>
) {
  await prisma.lectureJob.update({ where: { id: jobId }, data });
}

/**
 * Run the full lecture processing pipeline. Called fire-and-forget from the
 * route handler. Updates LectureJob progress at each stage.
 */
export async function runLecturePipeline(config: PipelineConfig): Promise<void> {
  const { jobId, userId, videoFileId, videoPath, style, detail, language, videoType } = config;

  // Prevent concurrent jobs for same user.
  if (activeJobs.has(userId)) {
    await updateJob(jobId, { status: "failed", error: "Another lecture is already being processed. Please wait." });
    return;
  }
  activeJobs.add(userId);

  const workDir = path.join(WORK_DIR, jobId);
  await mkdir(workDir, { recursive: true });

  try {
    await updateJob(jobId, { status: "processing", stage: "audio_extract", progress: 5 });

    // ---- Stage 1: Probe video ----
    const probe = await probeVideo(videoPath);
    await updateJob(jobId, { durationSec: Math.round(probe.durationSec), progress: 8 });

    // ---- Stage 2: Extract audio ----
    let segments: TranscriptSegment[] = [];
    if (probe.hasAudio) {
      const audioPath = await extractAudio(videoPath, workDir);
      await updateJob(jobId, { stage: "transcribing", progress: 15 });

      // ---- Stage 3: Chunk + transcribe ----
      const userCfg = await getUserConfig(userId);
      const transcriptionCfg = getTranscriptionConfig(userCfg);
      if (transcriptionCfg.apiKey) {
        const chunks = await chunkAudio(audioPath, workDir);
        segments = await transcribeChunks(transcriptionCfg, chunks, (done, total) => {
          const pct = 15 + Math.round((done / total) * 25);
          updateJob(jobId, { progress: pct });
        });
      }
    }
    await updateJob(jobId, { stage: "frame_sampling", progress: 42 });

    // ---- Stage 4: Frame sampling + slide dedup ----
    const sampleFps = 1;
    let slideRegion: SlideRegion | null = null;
    let framesDir: string;

    if (videoType === "camera") {
      // Camera mode: first sample full frames, detect region, then re-hash cropped.
      await updateJob(jobId, { stage: "region_detect", progress: 45 });
      framesDir = await sampleFramesForHash(videoPath, workDir, sampleFps);

      // Extract a few full-res sample frames for vision LLM region detection.
      const llmCfg = await getUserConfig(userId);
      const hasVision = await supportsVision(llmCfg);
      if (hasVision) {
        const sampleTimestamps = [
          Math.min(30, probe.durationSec * 0.1),
          probe.durationSec * 0.3,
          probe.durationSec * 0.6,
        ];
        const samplePaths: string[] = [];
        for (let i = 0; i < sampleTimestamps.length; i++) {
          const fp = path.join(workDir, `sample_${i}.jpg`);
          await extractFrame(videoPath, sampleTimestamps[i], fp);
          samplePaths.push(fp);
        }
        slideRegion = await detectSlideRegion(llmCfg, samplePaths, probe.width, probe.height);
      }

      if (slideRegion) {
        // Re-hash with cropped region for better dedup.
        await updateJob(jobId, { stage: "slide_dedup", progress: 50 });
        framesDir = await sampleCroppedFramesForHash(videoPath, workDir, slideRegion, sampleFps);
      }
    } else {
      // Screen capture mode: hash full frames directly.
      framesDir = await sampleFramesForHash(videoPath, workDir, sampleFps);
    }

    await updateJob(jobId, { stage: "slide_dedup", progress: 52 });
    const threshold = videoType === "camera" ? 16 : 10;
    const slides = await deduplicateSlides(framesDir, sampleFps, threshold);
    await updateJob(jobId, { slideCount: slides.length, progress: 55 });

    // ---- Stage 5: Extract full-res slide keyframes + content ----
    await updateJob(jobId, { stage: "ocr", progress: 58 });

    // Create a folder for slide images.
    const slideFolder = await prisma.vFolder.create({
      data: {
        name: `Lecture Slides — ${new Date().toLocaleDateString()}`,
        userId,
      },
    });

    const llmCfg = await getUserConfig(userId);
    const hasVision = await supportsVision(llmCfg);

    const slideContents: string[] = [];
    const slideFileIds: string[] = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const imgName = `slide_${String(i + 1).padStart(3, "0")}.jpg`;
      const storageKey = `${userId}/lecture_${jobId}/${imgName}`;
      const absPath = path.join(UPLOAD_DIR, storageKey);
      await mkdir(path.dirname(absPath), { recursive: true });

      // Extract full-res frame (cropped if camera mode detected a region).
      await extractFrame(videoPath, slide.timestampSec, absPath, slideRegion ?? undefined);

      // Save as VFile.
      const { size } = await stat(absPath);

      // Enforce role-based storage quota before persisting the slide image.
      const quota = await getStorageStatus(userId, size);
      if (!quota.allowed) {
        throw new Error(quota.message);
      }

      const vFile = await prisma.vFile.create({
        data: {
          name: imgName,
          mimeType: "image/jpeg",
          size: size,
          storageKey,
          folderId: slideFolder.id,
          userId,
        },
      });
      slideFileIds.push(vFile.id);

      // Extract slide content: vision LLM preferred, OCR fallback.
      let content = "";
      if (hasVision) {
        content = (await extractSlideContentVision(llmCfg, absPath)) ?? "";
      }
      if (!content) {
        content = await ocrImage(absPath);
      }
      slideContents.push(content);

      const pct = 58 + Math.round(((i + 1) / slides.length) * 20);
      await updateJob(jobId, { progress: Math.min(pct, 78) });
    }

    // ---- Stage 6: Align transcript to slides ----
    const aligned = alignTranscriptToSlides(slides, segments);

    // ---- Stage 7: Generate notes per slide via LLM ----
    await updateJob(jobId, { stage: "generating_notes", progress: 80 });

    const llmConfigured = await isLlmConfiguredFor(userId);
    const perSlideNotes: string[] = [];

    if (llmConfigured && slides.length > 0) {
      const { model } = await acquireLlmModel(userId);

      for (let i = 0; i < aligned.length; i++) {
        const a = aligned[i];
        const slideContent = slideContents[i] ?? "";
        const prompt = lectureSlideNotePrompt(
          slideContent,
          a.transcriptText,
          i,
          aligned.length,
          style as NoteStyle,
          { detail: detail as NoteDetail },
          language as StudyLanguage
        );

        const noteText = await generateText(
          model,
          prompt,
          "You are a study assistant taking structured notes from a lecture video. Output Markdown notes only — no preamble, no commentary."
        );
        perSlideNotes.push(noteText);

        const pct = 80 + Math.round(((i + 1) / aligned.length) * 15);
        await updateJob(jobId, { progress: Math.min(pct, 95) });
      }
    } else if (slides.length === 0 && segments.length > 0) {
      // No slides detected — transcript-only fallback.
      if (llmConfigured) {
        const { model } = await acquireLlmModel(userId);
        const fullText = fullTranscriptText(segments);
        const prompt = lectureSlideNotePrompt(
          "",
          fullText.slice(0, 30000),
          0,
          1,
          style as NoteStyle,
          { detail: detail as NoteDetail },
          language as StudyLanguage
        );
        const noteText = await generateText(
          model,
          prompt,
          "You are a study assistant taking structured notes from a lecture video. Output Markdown notes only."
        );
        perSlideNotes.push(noteText);
      } else {
        perSlideNotes.push(fullTranscriptText(segments));
      }
    }

    // ---- Stage 8: Assemble final note ----
    await updateJob(jobId, { progress: 96 });

    let noteBody = "";
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const fileId = slideFileIds[i];
      const ts = formatTimestamp(slide.startSec);
      const endTs = formatTimestamp(slide.timestampSec);
      noteBody += `## Slide ${i + 1} [${ts} – ${endTs}]\n\n`;
      // Embed slide image via file API.
      noteBody += `![Slide ${i + 1}](/api/files/${fileId}/raw)\n\n`;
      noteBody += (perSlideNotes[i] ?? "") + "\n\n---\n\n";
    }

    // If no slides but transcript notes exist:
    if (slides.length === 0 && perSlideNotes.length > 0) {
      noteBody = perSlideNotes[0] + "\n\n";
    }

    // Generate an overall summary if we have notes.
    if (llmConfigured && perSlideNotes.length > 1) {
      try {
        const { model } = await acquireLlmModel(userId);
        const summaryPrompt = lectureSummaryPrompt(
          perSlideNotes.join("\n\n---\n\n"),
          style as NoteStyle,
          language as StudyLanguage
        );
        const summary = await generateText(
          model,
          summaryPrompt,
          "You are a study assistant. Output a concise lecture summary in Markdown."
        );
        noteBody += `## Summary\n\n${summary}\n`;
      } catch {
        // Summary generation is non-critical.
      }
    }

    // Create the Note.
    const note = await prisma.note.create({
      data: {
        userId,
        title: `Lecture Notes — ${new Date().toLocaleDateString()}`,
        content: noteBody,
        tags: "lecture,video,ai-generated",
      },
    });

    // Link note to video file.
    const pair = canonicalPair(
      { type: "note", id: note.id },
      { type: "file", id: videoFileId }
    );
    await prisma.itemLink.create({
      data: { userId, ...pair },
    });

    // Also link note to each slide file.
    for (const fid of slideFileIds) {
      const slidePair = canonicalPair(
        { type: "note", id: note.id },
        { type: "file", id: fid }
      );
      await prisma.itemLink.upsert({
        where: {
          userId_srcType_srcId_dstType_dstId: { userId, ...slidePair },
        },
        update: {},
        create: { userId, ...slidePair },
      });
    }

    // Cache as a StudySource so other study tools can reuse.
    const sourceText = perSlideNotes.join("\n\n---\n\n").slice(0, 30000);
    await prisma.studySource.create({
      data: {
        userId,
        name: note.title,
        kind: "note",
        refId: note.id,
        textCache: sourceText,
        truncated: sourceText.length >= 30000,
        charCount: sourceText.length,
      },
    });

    // Log study session.
    await logSessionSafe(userId, "lecture_notes", note.title, videoFileId, {
      slideCount: slides.length,
      durationSec: Math.round(probe.durationSec),
      segmentCount: segments.length,
    });

    await updateJob(jobId, {
      status: "completed",
      stage: "",
      progress: 100,
      noteId: note.id,
      folderId: slideFolder.id,
      slideCount: slides.length,
      meta: JSON.stringify({
        transcriptWords: fullTranscriptText(segments).split(/\s+/).length,
        slideCount: slides.length,
        hasVision,
        videoType,
        slideRegion: slideRegion ?? null,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pipeline failed";
    console.error(`[lecture-pipeline] Job ${jobId} failed:`, message);
    await updateJob(jobId, {
      status: "failed",
      error: message.slice(0, 1000),
      progress: 0,
    });
  } finally {
    activeJobs.delete(userId);
    // Clean up work directory (non-critical).
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
