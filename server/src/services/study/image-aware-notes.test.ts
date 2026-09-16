import { describe, expect, test } from "bun:test";
import { ensureMarkdownImages } from "./image-aware-notes";
import type { SavedImage } from "../pdf-images";

function image(id: string, pageNumber: number): SavedImage {
  return {
    pageNumber,
    index: 0,
    name: `figure-${id}`,
    width: 640,
    height: 480,
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AA==",
    data: new Uint8Array([0]),
    hash: id,
    downloadUrl: `/api/files/${id}/download`,
    file: { id, name: `figure-${id}.png` } as SavedImage["file"],
  };
}

describe("ensureMarkdownImages", () => {
  test("keeps markdown unchanged when every image is present", () => {
    const markdown = "# Notes\n\n![Diagram](/api/files/a/download)";
    expect(ensureMarkdownImages(markdown, [image("a", 2)])).toBe(markdown);
  });

  test("appends only missing source images", () => {
    const markdown = "# Notes\n\n![Existing](/api/files/a/download)";
    const result = ensureMarkdownImages(markdown, [image("a", 2), image("b", 5)]);
    expect(result.match(/\/api\/files\/a\/download/g)).toHaveLength(1);
    expect(result.match(/\/api\/files\/b\/download/g)).toHaveLength(1);
    expect(result).toContain("## Figures from the source");
    expect(result).toContain("Figure from page 5");
  });

  test("does not add a figures section without images", () => {
    expect(ensureMarkdownImages("# Text only", [])).toBe("# Text only");
  });
});
