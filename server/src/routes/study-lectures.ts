// ===== Study Hub: Lecture Video → Notes routes =====
// Upload a lecture video (or reference an existing VFile), configure style,
// and start the background processing pipeline. Poll for status.
// Mounted at /api/study/lectures.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import path from "node:path";
import { mkdir, writeFile, stat } from "node:fs/promises";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { studyFunctionMiddleware } from "../middleware/study-functions";
import { runLecturePipeline } from "../services/study/lecture/pipeline";

const lectures = new Hono();
lectures.use("*", authMiddleware, studyFunctionMiddleware("lecture"));

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

function serialize(job: any) {
  return {
    id: job.id,
    videoFileId: job.videoFileId,
    style: job.style,
    detail: job.detail,
    language: job.language,
    videoType: job.videoType,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    noteId: job.noteId,
    folderId: job.folderId,
    slideCount: job.slideCount,
    durationSec: job.durationSec,
    meta: (() => { try { return JSON.parse(job.meta); } catch { return {}; } })(),
    createdAt: job.createdAt?.toISOString?.() ?? job.createdAt,
    updatedAt: job.updatedAt?.toISOString?.() ?? job.updatedAt,
  };
}

const startFromFileSchema = z.object({
  videoFileId: z.string(),
  style: z.enum(["cornell", "outline", "summary", "bullets"]).optional().default("outline"),
  detail: z.enum(["brief", "standard", "detailed"]).optional().default("standard"),
  language: z.enum(["en", "cs"]).optional().default("en"),
  videoType: z.enum(["slides", "camera"]).optional().default("slides"),
});

/**
 * POST /start — Start a lecture processing job from an existing VFile.
 */
lectures.post("/start", zValidator("json", startFromFileSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  // Verify the file exists and is a video.
  const file = await prisma.vFile.findFirst({
    where: { id: body.videoFileId, userId },
  });
  if (!file) return c.json({ error: "Video file not found" }, 404);
  if (!file.mimeType.startsWith("video/")) {
    return c.json({ error: "File is not a video" }, 400);
  }

  // Check no active job for this user.
  const active = await prisma.lectureJob.findFirst({
    where: { userId, status: { in: ["queued", "processing"] } },
  });
  if (active) {
    return c.json({ error: "A lecture is already being processed", activeJobId: active.id }, 409);
  }

  const job = await prisma.lectureJob.create({
    data: {
      userId,
      videoFileId: body.videoFileId,
      style: body.style,
      detail: body.detail,
      language: body.language,
      videoType: body.videoType,
      status: "queued",
    },
  });

  const videoPath = path.join(UPLOAD_DIR, file.storageKey);

  // Fire-and-forget the pipeline.
  runLecturePipeline({
    jobId: job.id,
    userId,
    videoFileId: body.videoFileId,
    videoPath,
    style: body.style as any,
    detail: body.detail as any,
    language: body.language as any,
    videoType: body.videoType as any,
  }).catch((err) => {
    console.error("[study-lectures] Pipeline error:", err);
  });

  return c.json({ job: serialize(job) }, 201);
});

/**
 * POST /upload — Upload a video file and immediately start processing.
 * Multipart: video (File) + style, detail, language, videoType (strings).
 */
lectures.post("/upload", async (c) => {
  const { userId } = c.get("auth");
  const formData = await c.req.formData();
  const video = formData.get("video");
  const style = (formData.get("style") as string) || "outline";
  const detail = (formData.get("detail") as string) || "standard";
  const language = (formData.get("language") as string) || "en";
  const videoType = (formData.get("videoType") as string) || "slides";
  const folderId = (formData.get("folderId") as string) || null;

  if (!(video instanceof File)) {
    return c.json({ error: "No video file provided" }, 400);
  }
  if (!video.type.startsWith("video/")) {
    return c.json({ error: "File is not a video" }, 400);
  }

  // Check no active job.
  const active = await prisma.lectureJob.findFirst({
    where: { userId, status: { in: ["queued", "processing"] } },
  });
  if (active) {
    return c.json({ error: "A lecture is already being processed", activeJobId: active.id }, 409);
  }

  // Save the video file.
  const safeName = video.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `${userId}/${Date.now()}-${safeName}`;
  const absPath = path.join(UPLOAD_DIR, storageKey);
  await mkdir(path.dirname(absPath), { recursive: true });
  const buf = Buffer.from(await video.arrayBuffer());
  await writeFile(absPath, buf);

  const vFile = await prisma.vFile.create({
    data: {
      name: safeName,
      mimeType: video.type,
      size: buf.length,
      storageKey,
      folderId: folderId || null,
      userId,
    },
  });

  const job = await prisma.lectureJob.create({
    data: {
      userId,
      videoFileId: vFile.id,
      style,
      detail,
      language,
      videoType,
      status: "queued",
    },
  });

  // Fire-and-forget.
  runLecturePipeline({
    jobId: job.id,
    userId,
    videoFileId: vFile.id,
    videoPath: absPath,
    style: style as any,
    detail: detail as any,
    language: language as any,
    videoType: videoType as any,
  }).catch((err) => {
    console.error("[study-lectures] Pipeline error:", err);
  });

  return c.json({ job: serialize(job), file: vFile }, 201);
});

/**
 * GET /status/:jobId — Poll the status of a lecture job.
 */
lectures.get("/status/:jobId", async (c) => {
  const { userId } = c.get("auth");
  const jobId = c.req.param("jobId");

  const job = await prisma.lectureJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!job) return c.json({ error: "Job not found" }, 404);

  return c.json({ job: serialize(job) });
});

/**
 * GET / — List all lecture jobs for the user (most recent first).
 */
lectures.get("/", async (c) => {
  const { userId } = c.get("auth");
  const jobs = await prisma.lectureJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return c.json({ jobs: jobs.map(serialize) });
});

/**
 * DELETE /:jobId — Delete a lecture job record (does not delete files/notes).
 */
lectures.delete("/:jobId", async (c) => {
  const { userId } = c.get("auth");
  const jobId = c.req.param("jobId");

  const job = await prisma.lectureJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!job) return c.json({ error: "Job not found" }, 404);

  // Don't delete active jobs.
  if (job.status === "queued" || job.status === "processing") {
    return c.json({ error: "Cannot delete an active job" }, 400);
  }

  await prisma.lectureJob.delete({ where: { id: jobId } });
  return c.json({ ok: true });
});

/**
 * POST /retry/:jobId — Retry a failed lecture job.
 */
lectures.post("/retry/:jobId", async (c) => {
  const { userId } = c.get("auth");
  const jobId = c.req.param("jobId");

  const job = await prisma.lectureJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!job) return c.json({ error: "Job not found" }, 404);
  if (job.status !== "failed") {
    return c.json({ error: "Only failed jobs can be retried" }, 400);
  }

  // Check no active job.
  const active = await prisma.lectureJob.findFirst({
    where: { userId, status: { in: ["queued", "processing"] }, id: { not: jobId } },
  });
  if (active) {
    return c.json({ error: "A lecture is already being processed" }, 409);
  }

  // Reset job status.
  await prisma.lectureJob.update({
    where: { id: jobId },
    data: { status: "queued", stage: "", progress: 0, error: "" },
  });

  const file = await prisma.vFile.findFirst({ where: { id: job.videoFileId, userId } });
  if (!file) return c.json({ error: "Video file no longer exists" }, 410);

  const videoPath = path.join(UPLOAD_DIR, file.storageKey);

  runLecturePipeline({
    jobId,
    userId,
    videoFileId: job.videoFileId,
    videoPath,
    style: job.style as any,
    detail: job.detail as any,
    language: job.language as any,
    videoType: job.videoType as any,
  }).catch((err) => {
    console.error("[study-lectures] Pipeline retry error:", err);
  });

  const updated = await prisma.lectureJob.findUnique({ where: { id: jobId } });
  return c.json({ job: serialize(updated) });
});

export default lectures;
