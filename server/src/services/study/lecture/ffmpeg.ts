// ===== Lecture pipeline: ffmpeg helpers =====
// Audio extraction, video probing, frame sampling — all via CLI ffmpeg/ffprobe.

import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";

/** Result of probing a video file. */
export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

/** Run a command and collect stdout/stderr. */
function run(
  cmd: string,
  args: string[],
  opts?: { timeout?: number }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = opts?.timeout
      ? setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`${cmd} timed out after ${opts.timeout}ms`));
        }, opts.timeout)
      : null;
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    proc.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
  });
}

/** Probe a video file for duration, resolution, fps, audio presence. */
export async function probeVideo(videoPath: string): Promise<ProbeResult> {
  const { stdout } = await run("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ], { timeout: 30_000 });

  const info = JSON.parse(stdout);
  const videoStream = info.streams?.find((s: any) => s.codec_type === "video");
  const audioStream = info.streams?.find((s: any) => s.codec_type === "audio");
  const durationSec = parseFloat(info.format?.duration ?? videoStream?.duration ?? "0");
  const width = videoStream?.width ?? 0;
  const height = videoStream?.height ?? 0;
  const fpsStr = videoStream?.r_frame_rate ?? "30/1";
  const [num, den] = fpsStr.split("/").map(Number);
  const fps = den ? num / den : 30;

  return { durationSec, width, height, fps, hasAudio: Boolean(audioStream) };
}

/**
 * Extract the audio track from a video to a compressed mono file.
 * Output is mono, 32 kbps opus in an ogg container (small enough for Whisper).
 * Returns the output file path.
 */
export async function extractAudio(
  videoPath: string,
  outDir: string
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "audio.ogg");
  const { code, stderr } = await run("ffmpeg", [
    "-y", "-i", videoPath,
    "-vn",                    // no video
    "-ac", "1",               // mono
    "-ar", "16000",           // 16 kHz (Whisper optimal)
    "-c:a", "libopus",
    "-b:a", "32k",
    outPath,
  ], { timeout: 600_000 }); // 10 min max

  if (code !== 0) throw new Error(`ffmpeg audio extract failed: ${stderr.slice(-500)}`);
  return outPath;
}

/**
 * Split an audio file into chunks of ≤maxDurationSec (default 900s = 15 min).
 * Returns ordered list of { path, offsetSec }. If the file is short enough,
 * returns a single chunk (the original file).
 */
export async function chunkAudio(
  audioPath: string,
  outDir: string,
  maxDurationSec = 900
): Promise<{ path: string; offsetSec: number }[]> {
  const probe = await run("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", audioPath,
  ], { timeout: 15_000 });
  const duration = parseFloat(JSON.parse(probe.stdout).format?.duration ?? "0");

  if (duration <= maxDurationSec + 30) {
    // Short enough — one chunk.
    return [{ path: audioPath, offsetSec: 0 }];
  }

  const chunks: { path: string; offsetSec: number }[] = [];
  let offset = 0;
  let idx = 0;
  while (offset < duration) {
    const chunkPath = path.join(outDir, `chunk_${idx}.ogg`);
    const segLen = Math.min(maxDurationSec, duration - offset);
    const { code } = await run("ffmpeg", [
      "-y", "-i", audioPath,
      "-ss", String(offset),
      "-t", String(segLen),
      "-c", "copy",
      chunkPath,
    ], { timeout: 120_000 });
    if (code !== 0) throw new Error(`ffmpeg chunk split failed at offset ${offset}`);
    chunks.push({ path: chunkPath, offsetSec: offset });
    offset += maxDurationSec;
    idx++;
  }
  return chunks;
}

/**
 * Sample frames from a video at the given fps (default 1) as tiny grayscale
 * raw buffers (9×8 pixels = 72 bytes each) for dHash computation.
 * Also outputs a timestamp list. Returns the output directory path.
 */
export async function sampleFramesForHash(
  videoPath: string,
  outDir: string,
  sampleFps = 1
): Promise<string> {
  const framesDir = path.join(outDir, "hash_frames");
  await mkdir(framesDir, { recursive: true });
  // Output 9×8 grayscale PGM images (pgm has a tiny header we can parse).
  // 20 min ceiling gives headroom for long / slow-to-decode videos.
  const { code, stderr } = await run("ffmpeg", [
    "-y", "-i", videoPath,
    "-vf", `fps=${sampleFps},scale=9:8,format=gray`,
    "-f", "image2",
    path.join(framesDir, "frame_%06d.pgm"),
  ], { timeout: 1_200_000 });

  if (code !== 0) throw new Error(`ffmpeg frame sampling failed: ${stderr.slice(-500)}`);
  return framesDir;
}

/**
 * Extract a single full-resolution JPEG frame at a given timestamp (seconds).
 * Returns the output file path.
 */
export async function extractFrame(
  videoPath: string,
  timestampSec: number,
  outPath: string,
  crop?: { x: number; y: number; w: number; h: number }
): Promise<string> {
  await mkdir(path.dirname(outPath), { recursive: true });
  const vfParts: string[] = [];
  if (crop) {
    vfParts.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  }
  const args = [
    "-y", "-ss", String(timestampSec),
    "-i", videoPath,
    "-frames:v", "1",
    ...(vfParts.length > 0 ? ["-vf", vfParts.join(",")] : []),
    "-q:v", "3",
    outPath,
  ];
  const { code, stderr } = await run("ffmpeg", args, { timeout: 30_000 });
  if (code !== 0) throw new Error(`ffmpeg frame extract failed at ${timestampSec}s: ${stderr.slice(-300)}`);
  return outPath;
}

/**
 * Sample frames from a cropped region for dHash computation (camera mode).
 */
export async function sampleCroppedFramesForHash(
  videoPath: string,
  outDir: string,
  crop: { x: number; y: number; w: number; h: number },
  sampleFps = 1
): Promise<string> {
  const framesDir = path.join(outDir, "hash_frames_cropped");
  await mkdir(framesDir, { recursive: true });
  // 20 min ceiling gives headroom for long / slow-to-decode videos.
  const { code, stderr } = await run("ffmpeg", [
    "-y", "-i", videoPath,
    "-vf", `fps=${sampleFps},crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=9:8,format=gray`,
    "-f", "image2",
    path.join(framesDir, "frame_%06d.pgm"),
  ], { timeout: 1_200_000 });

  if (code !== 0) throw new Error(`ffmpeg cropped frame sampling failed: ${stderr.slice(-500)}`);
  return framesDir;
}
