import { describe, expect, test } from "bun:test";
import { modelSupportsVision } from "./llm";

describe("modelSupportsVision", () => {
  test("recognizes DeepSeek Flash vision models", () => {
    expect(modelSupportsVision("deepseek", "deepseek-flash")).toBe(true);
    expect(modelSupportsVision("openrouter", "deepseek/deepseek-flash")).toBe(true);
  });

  test("does not mark text-only DeepSeek models as vision capable", () => {
    expect(modelSupportsVision("deepseek", "deepseek-chat")).toBe(false);
    expect(modelSupportsVision("deepseek", "deepseek-v4-pro")).toBe(false);
  });
});
