import { describe, expect, it } from "bun:test";
import { parseCitationHref, preprocessStudyMarkdown } from "./studyMarkdown";

describe("preprocessStudyMarkdown", () => {
  it("normalizes TeX delimiters and unambiguous bare display math", () => {
    expect(preprocessStudyMarkdown("Máme \\(a_1, a_2, \\dots\\)."))
      .toBe("Máme $a_1, a_2, \\dots$.");
    expect(preprocessStudyMarkdown("[ s_1 = a_1,\\quad s_2 = a_1 + a_2,\\ \dots ]"))
      .toBe("$$s_1 = a_1,\\quad s_2 = a_1 + a_2,\\ \dots$$");
    expect(preprocessStudyMarkdown("\\[x^2 + y^2 = z^2\\]"))
      .toBe("$$x^2 + y^2 = z^2$$");
    expect(preprocessStudyMarkdown("\\[\nx^2 + y^2 = z^2\n\\]"))
      .toBe("$$x^2 + y^2 = z^2$$");
  });

  it("leaves code and ordinary brackets unchanged", () => {
    const input = "`\\(x\\)` and [ordinary words]\n```ts\nconst x = '[1]';\n```";
    expect(preprocessStudyMarkdown(input)).toBe(input);
  });

  it("creates source and page citation links", () => {
    expect(preprocessStudyMarkdown("Text [2] and [1, p. 7] and [3, slide 4]."))
      .toBe("Text [**2**](#cite-2) and [**1, page 7**](#cite-1-page-7) and [**3, slide 4**](#cite-3-slide-4).");
  });
});

describe("parseCitationHref", () => {
  it("parses source and navigable citations", () => {
    expect(parseCitationHref("#cite-2")).toEqual({ index: 2, label: undefined, page: undefined });
    expect(parseCitationHref("#cite-1-slide-8")).toEqual({ index: 1, label: "slide", page: 8 });
    expect(parseCitationHref("https://example.com")).toBeNull();
  });
});
