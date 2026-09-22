import type { LlmUsage } from "multi-llm-ts";

export interface ModelPrice {
  inputMicrosPerMillion: number;
  cachedInputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  reasoningMicrosPerMillion: number;
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  "openai:gpt-5.6-luna": {
    inputMicrosPerMillion: 200_000,
    cachedInputMicrosPerMillion: 20_000,
    outputMicrosPerMillion: 1_200_000,
    reasoningMicrosPerMillion: 1_200_000,
  },
  "openai:gpt-4o-mini": {
    inputMicrosPerMillion: 150_000,
    cachedInputMicrosPerMillion: 75_000,
    outputMicrosPerMillion: 600_000,
    reasoningMicrosPerMillion: 600_000,
  },
  // DeepSeek official pricing (deepseek-chat): $0.27/1M input (cache miss),
  // $0.07/1M cached, $1.10/1M output. "deepseek-flash" is an alias some
  // proxies use for the chat model — priced identically so hosted mode works.
  "deepseek:deepseek-chat": {
    inputMicrosPerMillion: 270_000,
    cachedInputMicrosPerMillion: 70_000,
    outputMicrosPerMillion: 1_100_000,
    reasoningMicrosPerMillion: 1_100_000,
  },
  "deepseek:deepseek-flash": {
    inputMicrosPerMillion: 270_000,
    cachedInputMicrosPerMillion: 70_000,
    outputMicrosPerMillion: 1_100_000,
    reasoningMicrosPerMillion: 1_100_000,
  },
  "deepseek:deepseek-reasoner": {
    inputMicrosPerMillion: 550_000,
    cachedInputMicrosPerMillion: 140_000,
    outputMicrosPerMillion: 2_190_000,
    reasoningMicrosPerMillion: 2_190_000,
  },
};

export function getModelPrice(provider: string, modelId: string): ModelPrice | null {
  return MODEL_PRICES[`${provider}:${modelId}`] ?? null;
}

export function calculateUsageCostMicros(price: ModelPrice, usage: LlmUsage): number {
  const cached = Math.min(usage.prompt_tokens, usage.prompt_tokens_details?.cached_tokens ?? 0);
  const uncached = Math.max(0, usage.prompt_tokens - cached);
  const reasoning = Math.min(usage.completion_tokens, usage.completion_tokens_details?.reasoning_tokens ?? 0);
  const output = Math.max(0, usage.completion_tokens - reasoning);
  return Math.ceil(
    (uncached * price.inputMicrosPerMillion
      + cached * price.cachedInputMicrosPerMillion
      + output * price.outputMicrosPerMillion
      + reasoning * price.reasoningMicrosPerMillion) / 1_000_000
  );
}

/** Whisper-compatible transcription is billed per audio minute ($0.006). */
const TRANSCRIPTION_MICROS_PER_MINUTE = 6_000;

/** Estimate transcription cost from upload size for budget accounting.
 *  Compressed audio (opus/m4a/mp3/webm) runs roughly 0.5–1 MB/min; WAV ~2 MB/min. */
export function estimateTranscriptionCostMicros(bytes: number, mimeType: string): number {
  const bytesPerMinute = mimeType.includes("wav") ? 2_000_000 : 800_000;
  return Math.ceil(Math.max(0.25, bytes / bytesPerMinute) * TRANSCRIPTION_MICROS_PER_MINUTE);
}

/** Estimate the cost of one vision chat call (image input + short answer). */
export function estimateVisionCallCostMicros(provider: string, modelId: string): number {
  const price = getModelPrice(provider, modelId);
  if (!price) return 0;
  return calculateUsageCostMicros(price, { prompt_tokens: 1500, completion_tokens: 500 });
}
