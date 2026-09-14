import { SynthesizeSpeechCommand, type Engine, type VoiceId } from "@aws-sdk/client-polly";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import prisma from "../../db/client";
import { createPollyClient, getPollySecrets } from "../polly-config";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const WORK_DIR = path.join(UPLOAD_DIR, "_podcast_work");
const active = new Set<string>();

interface Turn { host: string; text: string }

function parseScript(script: string, labels: [string, string]): Turn[] {
  const turns: Turn[] = [];
  for (const raw of script.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^([^:]{1,40}):\s*(.*)$/);
    if (match && labels.some((label) => match[1].trim().toLowerCase() === label.toLowerCase())) {
      turns.push({ host: match[1].trim(), text: match[2].trim() });
    } else if (turns.length) turns[turns.length - 1].text += ` ${line}`;
  }
  return turns.filter((turn) => turn.text);
}

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  if (typeof stream?.transformToByteArray === "function") return Buffer.from(await stream.transformToByteArray());
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function runPodcastAudioJob(podcastId: string, userId: string) {
  if (active.has(podcastId)) return;
  active.add(podcastId);
  const workDir = path.join(WORK_DIR, podcastId);
  try {
    await prisma.podcast.update({ where: { id: podcastId }, data: { status: "processing", stage: "Preparing voices", error: "" } });
    const config = await getPollySecrets();
    if (!config) throw new Error("AWS Polly is not configured. Ask an administrator to configure it in Settings → Study Hub.");
    const podcast = await prisma.podcast.findFirst({ where: { id: podcastId, userId }, include: { scriptNote: true } });
    if (!podcast?.scriptNote) throw new Error("Podcast script is missing");
    const turns = parseScript(podcast.scriptNote.content, [podcast.host1Label, podcast.host2Label]);
    if (!turns.length) throw new Error("The generated script contains no valid dialogue turns");

    await mkdir(workDir, { recursive: true });
    const client = createPollyClient(config);
    const files: string[] = [];
    try {
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const isHost1 = turn.host.toLowerCase() === podcast.host1Label.toLowerCase();
        const voice = (isHost1 ? podcast.voice1 : podcast.voice2) as VoiceId;
        await prisma.podcast.update({ where: { id: podcastId }, data: { stage: `Voicing turn ${i + 1} of ${turns.length}` } });
        const response = await client.send(new SynthesizeSpeechCommand({
          Engine: podcast.engine as Engine,
          VoiceId: voice,
          OutputFormat: "mp3",
          TextType: "ssml",
          Text: `<speak>${escapeXml(turn.text)}<break time="350ms"/></speak>`,
        }));
        if (!response.AudioStream) throw new Error(`Polly returned no audio for turn ${i + 1}`);
        const file = path.join(workDir, `${String(i).padStart(4, "0")}.mp3`);
        await writeFile(file, await streamToBuffer(response.AudioStream));
        files.push(file);
      }
    } finally {
      client.destroy();
    }

    await prisma.podcast.update({ where: { id: podcastId }, data: { stage: "Mixing episode" } });
    const listPath = path.join(workDir, "concat.txt");
    await writeFile(listPath, files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"));
    const storageKey = `${userId}/podcasts/${podcastId}.mp3`;
    const outputPath = path.join(UPLOAD_DIR, storageKey);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const proc = Bun.spawn(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath], { stdout: "ignore", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new Error(`Audio mixing failed: ${(await new Response(proc.stderr).text()).slice(-500)}`);
    const info = await stat(outputPath);
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: "ready", stage: "Ready", audioKey: storageKey, audioSize: info.size, error: "" },
    });
  } catch (error) {
    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: "failed", stage: "Failed", error: error instanceof Error ? error.message.slice(0, 1000) : "Audio generation failed" },
    }).catch(() => undefined);
  } finally {
    active.delete(podcastId);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
