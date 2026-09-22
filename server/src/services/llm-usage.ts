import type { LlmChunk, LlmCompletionOpts, LlmModel, LlmUsage, Message } from "multi-llm-ts";
import prisma from "../db/client";
import { releaseBudgetReservation, settleBudgetReservation } from "./llm-budget";
import { calculateUsageCostMicros, getModelPrice } from "./llm-pricing";

export type LlmSource = "hosted" | "byok" | "demo";

export interface MeteredModelContext {
  userId: string;
  source: LlmSource;
  provider: string;
  modelId: string;
  feature: string;
  requestId: string;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

export function meterModel(model: LlmModel, context: MeteredModelContext): LlmModel {
  const originalGenerate = model.generate.bind(model);
  model.generate = (thread: Message[], opts?: LlmCompletionOpts): AsyncIterable<LlmChunk> => {
    return (async function* () {
      let usage: LlmUsage | null = null;
      let output = "";
      let toolCalls = 0;
      let completed = false;
      try {
        for await (const chunk of originalGenerate(thread, { ...opts, usage: true })) {
          if (chunk.type === "usage") usage = chunk.usage;
          if (chunk.type === "content") output += chunk.text ?? "";
          if (chunk.type === "tool" && chunk.state === "completed") toolCalls++;
          yield chunk;
        }
        completed = true;
      } finally {
        const finalUsage: LlmUsage = usage ?? {
          prompt_tokens: thread.reduce((total, message) => total + estimateTokens(message.contentForModel), 0),
          completion_tokens: estimateTokens(output),
        };
        const price = getModelPrice(context.provider, context.modelId);
        const estimatedCostMicros = price ? calculateUsageCostMicros(price, finalUsage) : 0;
        try {
          await prisma.llmUsage.create({
            data: {
              userId: context.userId,
              source: context.source,
              provider: context.provider,
              modelId: context.modelId,
              feature: context.feature,
              requestId: context.requestId,
              status: completed ? (usage ? "completed" : "estimated") : "failed",
              inputTokens: finalUsage.prompt_tokens,
              cachedInputTokens: finalUsage.prompt_tokens_details?.cached_tokens ?? 0,
              outputTokens: finalUsage.completion_tokens,
              reasoningTokens: finalUsage.completion_tokens_details?.reasoning_tokens ?? 0,
              providerCalls: 1,
              toolCalls,
              estimatedCostMicros: BigInt(estimatedCostMicros),
            },
          });
          if (context.source === "hosted") await settleBudgetReservation(context.requestId);
        } catch (error) {
          if (context.source === "hosted") await releaseBudgetReservation(context.requestId).catch(() => undefined);
          console.error("[llm-usage] failed to persist usage", error);
        }
      }
    })();
  };
  return model;
}
