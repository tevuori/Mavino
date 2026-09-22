import { describe, expect, test } from "bun:test";
import { calculateUsageCostMicros, getModelPrice } from "./llm-pricing";

describe("LLM pricing", () => {
  test("separates cached input and reasoning tokens", () => {
    const price = getModelPrice("openai", "gpt-5.6-luna");
    expect(price).not.toBeNull();
    expect(calculateUsageCostMicros(price!, {
      prompt_tokens: 10_000,
      completion_tokens: 2_000,
      prompt_tokens_details: { cached_tokens: 4_000 },
      completion_tokens_details: { reasoning_tokens: 500 },
    })).toBe(3680);
  });

  test("rejects unknown hosted model pricing", () => {
    expect(getModelPrice("openai", "unknown-model")).toBeNull();
  });
});
