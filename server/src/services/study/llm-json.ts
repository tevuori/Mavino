// ===== Study Hub LLM JSON helper =====
// Runs the user's configured LlmModel with a strict JSON system prompt and
// parses the (possibly fenced / prose-wrapped) response into a JS value.
// One re-prompt retry on parse failure.

import { Message, Attachment } from "multi-llm-ts";
import type { LlmModel } from "multi-llm-ts";

/** Extract the first balanced JSON value from a possibly noisy string. */
export function extractJson(raw: string): string | null {
  let s = raw.trim();
  // Strip markdown code fences ```json ... ``` or ``` ... ```.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (!s) return null;
  // If it already starts with { or [, return as-is.
  if (s[0] === "{" || s[0] === "[") return s;
  // Otherwise find the first { or [ and the matching close.
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  const openCh = s[start];
  const closeCh = openCh === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Collect the full text content from a model.generate() async stream. */
async function collectText(model: LlmModel, messages: Message[]): Promise<string> {
  let out = "";
  for await (const chunk of model.generate(messages, { tools: false })) {
    if (chunk.type === "content" && chunk.text) out += chunk.text;
  }
  return out;
}

/**
 * Run the model with a JSON-instructing system prompt and parse the result.
 * Retries once (re-prompting for valid JSON) if parsing fails.
 */
export async function generateJson<T = unknown>(
  model: LlmModel,
  userPrompt: string,
  jsonSchemaHint: string
): Promise<T> {
  const system = `You are a study assistant inside the Mavino Student OS. You MUST respond with a single valid JSON object and NOTHING else. No markdown, no code fences, no commentary. ${jsonSchemaHint}`;

  const messages = [new Message("system", system), new Message("user", userPrompt)];

  let raw = await collectText(model, messages);
  let extracted = extractJson(raw);

  if (!extracted) {
    // One retry: ask the model to fix its output.
    messages.push(new Message("assistant", raw));
    messages.push(
      new Message(
        "user",
        "Your previous response was not valid JSON. Respond with ONLY the JSON object, no extra text."
      )
    );
    raw = await collectText(model, messages);
    extracted = extractJson(raw);
  }

  if (!extracted) {
    throw new Error("The AI did not return valid JSON. Please try again.");
  }

  try {
    return JSON.parse(extracted) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse AI JSON: ${e instanceof Error ? e.message : "invalid JSON"}`
    );
  }
}

/** Run the model for free-form text (summaries, explanations, study guides). */
export async function generateText(
  model: LlmModel,
  userPrompt: string,
  systemPrompt: string
): Promise<string> {
  const messages = [new Message("system", systemPrompt), new Message("user", userPrompt)];
  let out = "";
  for await (const chunk of model.generate(messages, { tools: false })) {
    if (chunk.type === "content" && chunk.text) out += chunk.text;
  }
  return out.trim();
}

/** Single image attachment for a vision-enabled prompt. */
export interface VisionImage {
  /** Short label shown to the model, e.g. "Figure 1 (page 3)". */
  label: string;
  mimeType: string;
  /** Raw base64 bytes (not a data URL). */
  base64: string;
}

/** Run the model with mixed text + image attachments. Requires a vision-capable model. */
export async function generateVisionText(
  model: LlmModel,
  systemPrompt: string,
  userPrompt: string,
  images: VisionImage[]
): Promise<string> {
  const userMessage = new Message("user", userPrompt);
  for (const img of images) {
    userMessage.attach(new Attachment(img.base64, img.mimeType));
  }
  const messages = [new Message("system", systemPrompt), userMessage];
  let out = "";
  for await (const chunk of model.generate(messages, { tools: false })) {
    if (chunk.type === "content" && chunk.text) out += chunk.text;
  }
  return out.trim();
}
