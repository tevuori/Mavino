// ===== Lecture pipeline: vision LLM + OCR =====
// - detectSlideRegion: sends sample frames to a vision LLM to identify the
//   slide/screen bounding box in camera footage.
// - extractSlideContent: sends a slide image to a vision LLM to extract text
//   and describe diagrams/figures; falls back to tesseract OCR.

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { LlmUserConfig } from "../../athena/llm";
import { modelSupportsVision } from "../../athena/llm";

export interface SlideRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Encode an image file to a data URI for the OpenAI vision API. */
async function imageToDataUri(imagePath: string): Promise<string> {
  const buf = await readFile(imagePath);
  const ext = imagePath.split(".").pop()?.toLowerCase() ?? "jpg";
  const mime = ext === "png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Call an OpenAI-compatible chat completions endpoint with image content.
 * Returns the assistant text response.
 */
async function visionChat(
  cfg: { apiKey: string; baseURL?: string; modelId: string },
  systemPrompt: string,
  userContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: string } }>
): Promise<string> {
  const base = (cfg.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${base}/chat/completions`;

  const body = {
    model: cfg.modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: 2000,
    temperature: 0.2,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vision API call failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Detect the slide/screen region in camera footage by sending 3–5 sample
 * frames to a vision LLM and asking it to identify the projected slide area.
 * Returns the bounding box as fractions of frame dimensions, or null if
 * the model can't find a clear region (falls back to full-frame hashing).
 */
export async function detectSlideRegion(
  cfg: LlmUserConfig,
  sampleFramePaths: string[],
  videoWidth: number,
  videoHeight: number
): Promise<SlideRegion | null> {
  if (sampleFramePaths.length === 0) return null;

  // Send up to 3 frames to avoid excessive token usage.
  const framesToSend = sampleFramePaths.slice(0, 3);
  const imageContent: Array<{ type: "image_url"; image_url: { url: string; detail: string } }> = [];

  for (const fp of framesToSend) {
    const uri = await imageToDataUri(fp);
    imageContent.push({ type: "image_url", image_url: { url: uri, detail: "low" } });
  }

  const systemPrompt = `You are a computer vision assistant. The user is showing you frames from a lecture recording where a professor is filmed in a room. There is a projected slide or screen visible in the frame. Your job is to identify the bounding box of the slide/screen/projector area.

Return ONLY a JSON object: {"x": <left pixel>, "y": <top pixel>, "w": <width pixels>, "h": <height pixels>}

The image dimensions are ${videoWidth}x${videoHeight} pixels. Be precise — the bounding box should tightly crop the projected slide content. If you cannot identify a clear slide/screen region, return {"error": "no slide region found"}.`;

  const userContent: any[] = [
    { type: "text", text: "Identify the slide/screen region in these lecture recording frames:" },
    ...imageContent,
  ];

  try {
    const response = await visionChat(cfg, systemPrompt, userContent);
    // Extract JSON from response.
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.error) return null;

    const { x, y, w, h } = parsed;
    if (typeof x !== "number" || typeof y !== "number" ||
        typeof w !== "number" || typeof h !== "number") return null;

    // Sanity: region must be at least 10% of frame in each dimension.
    if (w < videoWidth * 0.1 || h < videoHeight * 0.1) return null;
    // Clamp to frame bounds.
    const region: SlideRegion = {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      w: Math.min(Math.round(w), videoWidth - Math.max(0, Math.round(x))),
      h: Math.min(Math.round(h), videoHeight - Math.max(0, Math.round(y))),
    };
    return region;
  } catch {
    return null;
  }
}

/**
 * Extract text and describe content from a slide image using a vision LLM.
 * Returns structured text content of the slide.
 */
export async function extractSlideContentVision(
  cfg: LlmUserConfig,
  imagePath: string
): Promise<string | null> {
  try {
    const uri = await imageToDataUri(imagePath);
    const systemPrompt = `You are a slide content extractor. Given a lecture slide image, extract ALL text visible on the slide and briefly describe any diagrams, charts, figures, or mathematical formulas. Format:

TEXT:
<all text on the slide, preserving structure>

VISUALS:
<brief description of any diagrams, charts, figures, or formulas>

If the slide is mostly text, the VISUALS section can say "None". Be thorough with text extraction — capture titles, bullet points, footnotes, everything.`;

    const response = await visionChat(cfg, systemPrompt, [
      { type: "text", text: "Extract the content from this lecture slide:" },
      { type: "image_url", image_url: { url: uri, detail: "high" } },
    ]);

    return response || null;
  } catch {
    return null;
  }
}

/**
 * Check if the configured model supports vision. Delegates to the shared
 * provider+model name heuristic in athena/llm.ts.
 */
export async function supportsVision(cfg: LlmUserConfig): Promise<boolean> {
  return modelSupportsVision(cfg.provider, cfg.modelId);
}

/** Run tesseract OCR on an image file. Returns extracted text. */
export async function ocrImage(imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tesseract", [imagePath, "stdout", "-l", "eng"], {
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) {
        // Tesseract may not be installed — degrade gracefully.
        resolve("");
      } else {
        resolve(stdout.trim());
      }
    });
    proc.on("error", () => resolve(""));
  });
}
