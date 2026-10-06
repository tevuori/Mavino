import { describe, expect, test } from "bun:test";
import { isTextFile } from "./files";

describe("isTextFile", () => {
  test.each([
    ["paper.tex", "application/octet-stream"],
    ["paper.tex", "application/x-tex"],
    ["paper.latex", "application/octet-stream"],
  ])("recognizes LaTeX source %s with MIME %s", (name, mime) => {
    expect(isTextFile(name, mime)).toBe(true);
  });
});
