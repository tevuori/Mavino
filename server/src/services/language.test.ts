import { describe, expect, test } from "bun:test";
import { isAppLanguage, languageInstruction, languageName } from "./language";

describe("application language", () => {
  test("validates supported languages", () => {
    expect(isAppLanguage("en")).toBe(true);
    expect(isAppLanguage("cs")).toBe(true);
    expect(isAppLanguage("de")).toBe(false);
    expect(isAppLanguage(null)).toBe(false);
  });

  test("explicitly instructs both supported languages", () => {
    expect(languageInstruction("en")).toContain("English");
    expect(languageInstruction("cs")).toContain("Czech (čeština)");
    expect(languageInstruction("en")).toContain("Do not infer the output language from source material");
  });

  test("returns display names", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("cs")).toBe("Czech (čeština)");
  });
});
