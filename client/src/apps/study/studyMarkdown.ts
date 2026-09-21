export interface CitationTarget {
  index: number;
  page?: number;
  label?: "page" | "slide";
}

function transformTextSegment(segment: string): string {
  let value = segment
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `$$${math.trim()}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => `$${math.trim()}$`);

  value = value.replace(/^\s*\[\s*((?=[^\]]*(?:\\[A-Za-z]+|[_^]\{?\w|\b(?:s|a|x|y|z|f|g)_\d))[^\]]*[=+\-*/^_\\][^\]]*)\s*\]\s*$/gm, (_match, math: string) => `$$${math.trim()}$$`);

  value = value.replace(
    /\[(\d+)\s*,\s*(?:(p(?:ages?)?\.?|str(?:ana|any)?\.?|slid(?:es?|u|y)?)\s*)?(\d+)(?:\s*[–—-]\s*\d+)?\](?!\()/gi,
    (_match, index: string, rawLabel: string | undefined, page: string) => {
      const label = rawLabel && /slid/i.test(rawLabel) ? "slide" : "page";
      return `[**${index}, ${label} ${page}**](#cite-${index}-${label}-${page})`;
    }
  );
  return value.replace(/\[(\d+)\](?!\()/g, (_match, index: string) => `[**${index}**](#cite-${index})`);
}

function transformOutsideInlineCode(line: string): string {
  return line.split(/(`+[^`]*`+)/g).map((part, index) => index % 2 === 1 ? part : transformTextSegment(part)).join("");
}

export function preprocessStudyMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let text: string[] = [];
  let inFence = false;
  const flush = () => {
    if (text.length > 0) result.push(transformOutsideInlineCode(text.join("\n")));
    text = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flush();
      result.push(line);
      inFence = !inFence;
    } else if (inFence) {
      result.push(line);
    } else {
      text.push(line);
    }
  }
  flush();
  return result.join("\n");
}

export function parseCitationHref(href?: string): CitationTarget | null {
  if (!href) return null;
  const match = href.match(/^#cite-(\d+)(?:-(page|slide)-(\d+))?$/);
  if (!match) return null;
  return {
    index: Number(match[1]),
    label: match[2] as CitationTarget["label"],
    page: match[3] ? Number(match[3]) : undefined,
  };
}
