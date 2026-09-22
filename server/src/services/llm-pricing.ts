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
