import { describe, it, expect } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { buildSourceOutline } from "./source-outline";

function makePptx(slides: Record<number, string>): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const [num, text] of Object.entries(slides)) {
    files[`ppt/slides/slide${num}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lst><a:t>${text}</a:t></a:lst></p:txBody></p:sp></p:spTree></p:cSld>` +
      `</p:sld>`
    );
  }
  return Buffer.from(zipSync(files));
}

describe("buildSourceOutline", () => {
  it("returns paragraphs for a plain text file", async () => {
    const text = "First paragraph.\n\nSecond paragraph with more words.\n\nThird.";
    const outline = await buildSourceOutline("notes.txt", "text/plain", async () => Buffer.from(text));
    expect(outline.total).toBe(3);
    expect(outline.truncated).toBe(false);
    expect(outline.pages.map((p) => p.preview)).toEqual([
      "First paragraph.",
      "Second paragraph with more words.",
      "Third.",
    ]);
  });

  it("returns slides for a PPTX file", async () => {
    const buf = makePptx({ 1: "Intro slide", 2: "Detailed content here" });
    const outline = await buildSourceOutline("deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", async () => buf);
    expect(outline.total).toBe(2);
    expect(outline.pages[0].index).toBe(1);
    expect(outline.pages[0].preview).toBe("Intro slide");
    expect(outline.pages[1].index).toBe(2);
    expect(outline.pages[1].preview).toBe("Detailed content here");
  });

  it("truncates long previews", async () => {
    const long = "a".repeat(300);
    const outline = await buildSourceOutline("long.txt", "text/plain", async () => Buffer.from(long));
    expect(outline.pages[0].preview.endsWith("…")).toBe(true);
    expect(outline.pages[0].preview.length).toBeLessThan(200);
  });
});
