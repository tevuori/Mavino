import { describe, expect, it } from "bun:test";
import { quizFromGraphPrompt, quizGeneratePrompt } from "./prompts";
import type { ConceptGraphDataLike } from "./prompts";

const emptyGraph: ConceptGraphDataLike = {
  summary: "summary",
  sources: [],
  concepts: [],
  relationships: [],
};

describe("quiz prompts", () => {
  it("quizGeneratePrompt uses real option strings and warns against placeholder letters", () => {
    const prompt = quizGeneratePrompt("Some material", 3, ["mcq"], "en");
    expect(prompt).toContain("exact text of the correct option");
    expect(prompt).toContain('"options": ["Berlin", "Madrid", "Paris", "Rome"]');
    expect(prompt).toContain('"answer": "Paris"');
    expect(prompt).not.toContain('["a","b","c","d"]');
    expect(prompt).toContain("do not always make it the first option");
  });

  it("quizFromGraphPrompt uses real option strings and warns against placeholder letters", () => {
    const prompt = quizFromGraphPrompt(emptyGraph, 3, ["mcq"], "en");
    expect(prompt).toContain("exact text of the correct option");
    expect(prompt).toContain('"options": ["Berlin", "Madrid", "Paris", "Rome"]');
    expect(prompt).toContain('"answer": "Paris"');
    expect(prompt).not.toContain('["a","b","c","d"]');
    expect(prompt).toContain("do not always make it the first option");
  });
});
