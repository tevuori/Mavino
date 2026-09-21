import { describe, it, expect } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { extractPptxSlides } from "./pptx";

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

describe("extractPptxSlides", () => {
  it("extracts text from multiple slides in numeric order", () => {
    const buf = makePptx({ 2: "Second slide", 1: "Hello world", 10: "Tenth" });
    const slides = extractPptxSlides(buf);
    expect(slides).toHaveLength(3);
    expect(slides[0].index).toBe(1);
    expect(slides[0].text).toBe("Hello world");
    expect(slides[1].index).toBe(2);
    expect(slides[1].text).toBe("Second slide");
    expect(slides[2].index).toBe(3);
    expect(slides[2].text).toBe("Tenth");
  });

  it("returns an empty list for a PPTX with no slides", () => {
    const buf = Buffer.from(zipSync({ "[Content_Types].xml": strToU8("<Types/>") }));
    const slides = extractPptxSlides(buf);
    expect(slides).toHaveLength(0);
  });

  it("throws on invalid PPTX (not a zip)", () => {
    expect(() => extractPptxSlides(Buffer.from("not a zip"))).toThrow();
  });
});
