// ===== Citation-aware Markdown renderer for Study Hub =====
// Renders markdown via ReactMarkdown but turns inline [n] citation markers
// into clickable superscript chips. Clicking a chip calls onOpenCitation with
// the citation index (the parent maps it to a source and opens it).
//
// Implementation: [n] is not a markdown link on its own, so we pre-transform
// [n] (outside fenced code blocks) into a markdown link [**n**](#cite-n), then
// override the `a` renderer to detect #cite-<n> hrefs and render them as chips.

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";

export interface CitationMeta {
  index: number;
  name: string;
  kind: string;
  refId: string;
}

interface Props {
  content: string;
  citations?: CitationMeta[];
  onOpenCitation?: (index: number) => void;
  className?: string;
}

/** Transform [n] markers (outside ``` fences) into markdown citation links. */
function injectCitationLinks(md: string): string {
  const lines = md.split("\n");
  let inFence = false;
  const out: string[] = [];
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    // Replace [n] (not followed by "(" so we don't touch real markdown links)
    // with a bold-numbered link to #cite-<n>.
    out.push(line.replace(/\[(\d+)\](?!\()/g, (_m, n) => `[**${n}**](#cite-${n})`));
  }
  return out.join("\n");
}

export default function CitationMarkdown({ content, citations, onOpenCitation, className }: Props) {
  const transformed = useMemo(() => injectCitationLinks(content), [content]);
  const citeMap = useMemo(() => {
    const m = new Map<number, CitationMeta>();
    for (const c of citations ?? []) m.set(c.index, c);
    return m;
  }, [citations]);

  const components: Components = useMemo(
    () => ({
      a({ href, children, ...rest }) {
        if (href && href.startsWith("#cite-")) {
          const n = Number(href.slice("#cite-".length));
          const meta = citeMap.get(n);
          return (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onOpenCitation?.(n);
              }}
              className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent/15 px-1 align-super text-[10px] font-semibold text-accent transition hover:bg-accent/30"
              title={meta ? `Source [${n}]: ${meta.name}` : `Source [${n}]`}
            >
              {children}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
            {children}
          </a>
        );
      },
    }),
    [citeMap, onOpenCitation]
  );

  return (
    <div className={`selectable markdown-body prose-sm max-w-none text-sm text-ink ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {transformed}
      </ReactMarkdown>
    </div>
  );
}
