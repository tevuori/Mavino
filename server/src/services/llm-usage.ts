import type { LlmChunk, LlmCompletionOpts, LlmModel, LlmUsage, Message } from "multi-llm-ts";
import prisma from "../db/client";
import { releaseBudgetReservation, settleBudgetReservation } from "./llm-budget";
import { calculateUsageCostMicros, getModelPrice } from "./llm-pricing";
import { isContentFlagged } from "./llm-safety";

export type LlmSource = "hosted" | "byok" | "demo";

export interface MeteredModelContext {
  userId: string;
  source: LlmSource;
  provider: string;
  modelId: string;
  feature: string;
  requestId: string;
  minor?: boolean;
  safetyApiKey?: string;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

export interface UsageRecordResult {
  status: "completed" | "estimated" | "failed";
  usage?: LlmUsage | null;
  providerCalls?: number;
  toolCalls?: number;
  estimatedCostMicros?: number;
}

/** Persist one usage row and settle (or release, on write failure) the hosted
 *  budget reservation. Shared by metered generate() calls and direct provider
 *  calls such as transcription. */
export async function recordLlmUsage(
  context: MeteredModelContext,
  result: UsageRecordResult
): Promise<void> {
  const usage = result.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const price = getModelPrice(context.provider, context.modelId);
  const estimatedCostMicros = result.estimatedCostMicros
    ?? (price ? calculateUsageCostMicros(price, usage) : 0);
  try {
    await prisma.llmUsage.create({
      data: {
        userId: context.userId,
        source: context.source,
        provider: context.provider,
        modelId: context.modelId,
        feature: context.feature,
        requestId: context.requestId,
        status: result.status,
        inputTokens: usage.prompt_tokens,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage.completion_tokens,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        providerCalls: result.providerCalls ?? 0,
        toolCalls: result.toolCalls ?? 0,
        estimatedCostMicros: BigInt(estimatedCostMicros),
      },
    });
    if (context.source === "hosted") await settleBudgetReservation(context.requestId);
  } catch (error) {
    if (context.source === "hosted") await releaseBudgetReservation(context.requestId).catch(() => undefined);
    console.error("[llm-usage] failed to persist usage", error);
  }
}

export function meterModel(model: LlmModel, context: MeteredModelContext): LlmModel {
  const originalGenerate = model.generate.bind(model);
  model.generate = (thread: Message[], opts?: LlmCompletionOpts): AsyncIterable<LlmChunk> => {
    return (async function* () {
      let usage: LlmUsage | null = null;
      let output = "";
      let toolCalls = 0;
      let completed = false;
      let providerStarted = false;
      const buffered: LlmChunk[] = [];
      try {
        if (context.minor) {
          if (!context.safetyApiKey) throw new Error("SAFETY_CHECK_UNAVAILABLE");
          const userInput = thread.filter((message) => message.role === "user").map((message) => message.contentForModel).join("\n");
          if (await isContentFlagged(context.safetyApiKey, userInput)) throw new Error("CONTENT_BLOCKED");
        }
        providerStarted = true;
        for await (const chunk of originalGenerate(thread, { ...opts, usage: true })) {
          if (chunk.type === "usage") usage = chunk.usage;
          if (chunk.type === "content") output += chunk.text ?? "";
          if (chunk.type === "tool" && chunk.state === "completed") toolCalls++;
          if (context.minor && (chunk.type === "content" || chunk.type === "reasoning" || chunk.type === "usage")) {
            buffered.push(chunk);
          } else {
            yield chunk;
          }
        }
        if (context.minor) {
          if (await isContentFlagged(context.safetyApiKey!, output)) {
            yield { type: "content", text: "I can't help with that request. Try asking about a safe study topic instead.", done: true };
            const usageChunk = buffered.find((chunk) => chunk.type === "usage");
            if (usageChunk) yield usageChunk;
          } else {
            for (const chunk of buffered) yield chunk;
          }
        }
        completed = true;
      } finally {
        const finalUsage: LlmUsage = usage ?? {
          prompt_tokens: providerStarted ? thread.reduce((total, message) => total + estimateTokens(message.contentForModel), 0) : 0,
          completion_tokens: providerStarted ? estimateTokens(output) : 0,
        };
        await recordLlmUsage(context, {
          status: completed ? (usage ? "completed" : "estimated") : "failed",
          usage: finalUsage,
          providerCalls: providerStarted ? 1 : 0,
          toolCalls,
        });
      }
    })();
  };
  return model;
}
