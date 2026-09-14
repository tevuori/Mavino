// ===== HighlightableMarkdown =====
// Reusable markdown renderer for the Study Hub that supports persistent,
// user-driven highlighting with color options + annotations. Subsumes both
// MarkdownView (plain) and CitationMarkdown (with [n] citation chips).
//
// How it works:
//   1. Renders markdown via ReactMarkdown (with remark-gfm + the citation-chip
//      `a` override from CitationMarkdown).
//   2. After render, a useLayoutEffect walks the container's text nodes, builds
//      a visible-text string + offset→textnode map, and wraps each loaded
//      highlight's range in a <mark class="athena-hl athena-hl-<color>">.
//      Highlights are re-anchored via text search + context disambiguation
//      (see highlightUtils.findRangeInText).
//   3. On text selection inside the container, a floating toolbar (or bottom
//      sheet on phone) appears with color swatches + an annotation field.
//   4. Clicking an existing <mark> opens an edit popover (change color, edit
//      annotation, delete).
//
// Highlights are persisted via the highlights store (Zustand) → study-highlights
// API. They are scoped to a contentKey (hash of the content) so they reappear
// when the same content is rendered again.

import {
  useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";
import { Highlighter, Trash2, X, MessageSquarePlus } from "lucide-react";
import { useHighlights } from "../../store/highlights";
import { useFormFactor } from "../../store/formfactor";
import {
  HIGHLIGHT_COLORS, COLOR_LABEL, contentKeyFor, extractContext, findRangeInText,
} from "./highlightUtils";
import type {
  HighlightColor, HighlightScope, StudyHighlight,
} from "../../services/study-highlights";
import type { CitationMeta } from "./CitationMarkdown";

/** Stable empty array so the `byKey[contentKey] ?? EMPTY` selector returns a
 *  consistent reference (avoids spurious re-renders when no highlights exist). */
const EMPTY_HIGHLIGHTS: StudyHighlight[] = [];

export interface Props {
  content: string;
  /** Scope + scopeId identify the containing entity (chatId, noteId, ...). */
  scope: HighlightScope;
  scopeId: string;
  /** Optional human label for the source content (shown in the Highlights list). */
  sourceName?: string;
  /** Citation support (subsumes CitationMarkdown). */
  citations?: CitationMeta[];
  onOpenCitation?: (index: number) => void;
  className?: string;
  /** Disable highlighting (e.g. while content is streaming). Default true. */
  enabled?: boolean;
}

interface TextNodeMap {
  text: string;
  nodes: { node: Text; start: number }[];
}

/** Walk all text nodes under `root` (excluding <mark> we may have inserted
 *  previously — but we clear marks before re-applying, so this is fine). */
function buildTextNodeMap(root: HTMLElement): TextNodeMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      // Skip script/style/code blocks (code is highlightable-text-ish but
      // splitting text inside <code> can break syntax highlighting; skip it).
      const tag = parent.tagName.toLowerCase();
      if (tag === "script" || tag === "style") return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    nodes.push({ node: n, start: text.length });
    text += n.nodeValue;
  }
  return { text, nodes };
}

/** Find the text node + local offset for a global char offset. */
function locateOffset(
  map: TextNodeMap,
  offset: number
): { node: Text; localOffset: number } | null {
  // Binary-ish linear search (text nodes are usually few per paragraph).
  for (let i = 0; i < map.nodes.length; i++) {
    const entry = map.nodes[i];
    const next = map.nodes[i + 1];
    const end = next ? next.start : map.text.length;
    if (offset >= entry.start && offset <= end) {
      return { node: entry.node, localOffset: offset - entry.start };
    }
  }
  return null;
}

/** Unwrap all <mark class="athena-hl"> elements under `root`, restoring the
 *  original text nodes. Called before re-applying highlights. */
function clearMarks(root: HTMLElement) {
  const marks = root.querySelectorAll("mark.athena-hl");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

/** Wrap a [start, end) range in the visible text with a <mark>. Handles ranges
 *  that span multiple text nodes by wrapping each text-node segment. */
function wrapRange(
  root: HTMLElement,
  map: TextNodeMap,
  start: number,
  end: number,
  highlight: StudyHighlight
): boolean {
  const startLoc = locateOffset(map, start);
  const endLoc = locateOffset(map, end);
  if (!startLoc || !endLoc) return false;

  // Split at the END boundary first. Doing end-before-start avoids offset
  // shifts when start and end live in the same text node.
  let endNode: Text = endLoc.node;
  const endOffset = endLoc.localOffset;
  if (endOffset < endNode.nodeValue!.length) {
    endNode.splitText(endOffset);
  }
  // Split at the START boundary.
  let startNode: Text = startLoc.node;
  let startOffset = startLoc.localOffset;
  if (startOffset > 0) {
    startNode = startLoc.node.splitText(startOffset);
    // If end was in the same original node, the split above moved the end
    // portion into startNode; correct the end reference.
    if (endLoc.node === startLoc.node) {
      endNode = startNode;
    }
  }

  // Collect all text nodes between startNode and endNode (inclusive).
  const toWrap: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let inRange = false;
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    if (n === startNode) inRange = true;
    if (inRange) toWrap.push(n);
    if (n === endNode) break;
  }
  for (const tn of toWrap) {
    if (!tn.nodeValue || !tn.parentNode) continue;
    const mark = document.createElement("mark");
    mark.className = `athena-hl athena-hl-${highlight.color}`;
    mark.setAttribute("data-highlight-id", highlight.id);
    mark.setAttribute("data-color", highlight.color);
    if (highlight.annotation) mark.title = highlight.annotation;
    tn.parentNode.replaceChild(mark, tn);
    mark.appendChild(tn);
  }
  return true;
}

export default function HighlightableMarkdown({
  content, scope, scopeId, sourceName, citations, onOpenCitation, className, enabled = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeMarkId, setActiveMarkId] = useState<string | null>(null);
  const [toolbar, setToolbar] = useState<{
    rect: DOMRect;
    text: string;
    contextBefore: string;
    contextAfter: string;
  } | null>(null);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotateText, setAnnotateText] = useState("");
  const [pendingColor, setPendingColor] = useState<HighlightColor>("yellow");

  const formFactor = useFormFactor((s) => s.mode);
  const isPhone = formFactor === "phone";

  const contentKey = useMemo(() => contentKeyFor(content), [content]);
  const loadFor = useHighlights((s) => s.loadFor);
  const highlights = useHighlights((s) => s.byKey[contentKey] ?? EMPTY_HIGHLIGHTS);
  const createHighlight = useHighlights((s) => s.create);
  const updateHighlight = useHighlights((s) => s.update);
  const removeHighlight = useHighlights((s) => s.remove);

  // Load highlights for this content key on mount / when content changes.
  useEffect(() => {
    if (enabled) void loadFor(contentKey);
  }, [contentKey, enabled, loadFor]);

  // Citation chip renderer (subsumes CitationMarkdown).
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

  // Inject [n] citation links (same transform as CitationMarkdown).
  const transformed = useMemo(() => {
    const lines = content.split("\n");
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
      out.push(line.replace(/\[(\d+)\](?!\()/g, (_m, n) => `[**${n}**](#cite-${n})`));
    }
    return out.join("\n");
  }, [content]);

  // Apply highlight marks after render (and whenever content/highlights change).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    clearMarks(container);
    if (highlights.length === 0) return;
    const map = buildTextNodeMap(container);
    if (!map.text) return;
    // Apply highlights sorted by start offset descending so that splitting
    // later ranges first doesn't invalidate earlier offsets in the map.
    const resolved = highlights
      .map((h) => {
        const range = findRangeInText(map.text, h.text, h.contextBefore, h.contextAfter);
        return range ? { h, range } : null;
      })
      .filter((x): x is { h: StudyHighlight; range: { start: number; end: number } } => x !== null)
      .sort((a, b) => b.range.start - a.range.start);
    for (const { h, range } of resolved) {
      wrapRange(container, map, range.start, range.end, h);
    }
  }, [transformed, highlights, enabled]);

  // ----- selection toolbar -----

  const dismissToolbar = useCallback(() => {
    setToolbar(null);
    setAnnotateMode(false);
    setAnnotateText("");
  }, []);

  const handleSelectionChange = useCallback(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      // Don't dismiss if the user is interacting with the toolbar/popover.
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const text = sel.toString().trim();
    if (text.length < 2) return;

    // Compute context from the visible text under the container.
    const map = buildTextNodeMap(container);
    // Compute the global offsets of the selection within map.text.
    let startOff = -1, endOff = -1;
    {
      const startNode = range.startContainer;
      const endNode = range.endContainer;
      for (const entry of map.nodes) {
        if (entry.node === startNode) {
          startOff = entry.start + range.startOffset;
        }
        if (entry.node === endNode) {
          endOff = entry.start + range.endOffset;
        }
      }
      // If start/end nodes were split by previous mark-wrapping they may not
      // be in the map; fall back to a text search of the selection string.
      if (startOff === -1 || endOff === -1) {
        const found = findRangeInText(map.text, text);
        if (found) {
          startOff = found.start;
          endOff = found.end;
        }
      }
    }
    let ctxBefore = "";
    let ctxAfter = "";
    if (startOff >= 0 && endOff >= 0) {
      const ctx = extractContext(map.text, startOff, endOff);
      ctxBefore = ctx.contextBefore;
      ctxAfter = ctx.contextAfter;
    }

    const rect = range.getBoundingClientRect();
    setToolbar({ rect, text, contextBefore: ctxBefore, contextAfter: ctxAfter });
    setAnnotateMode(false);
    setAnnotateText("");
    setPendingColor("yellow");
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [enabled, handleSelectionChange]);

  // ----- create / update / delete -----

  const doCreate = useCallback(
    async (color: HighlightColor, annotation?: string) => {
      if (!toolbar) return;
      await createHighlight({
        scope,
        scopeId,
        contentKey,
        text: toolbar.text.slice(0, 4000),
        contextBefore: toolbar.contextBefore,
        contextAfter: toolbar.contextAfter,
        color,
        annotation: annotation?.trim() || undefined,
        sourceName,
      });
      // Clear the browser selection so the toolbar closes.
      window.getSelection()?.removeAllRanges();
      dismissToolbar();
    },
    [toolbar, createHighlight, scope, scopeId, contentKey, sourceName, dismissToolbar]
  );

  const activeHighlight = activeMarkId
    ? highlights.find((h) => h.id === activeMarkId)
    : null;

  const handleMarkClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const mark = target.closest("mark.athena-hl") as HTMLElement | null;
    if (!mark) return;
    e.stopPropagation();
    const id = mark.getAttribute("data-highlight-id");
    if (id) setActiveMarkId(id);
  }, []);

  // Close popover on outside click.
  useEffect(() => {
    if (!activeMarkId) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-hl-popover]") || t.closest("mark.athena-hl")) return;
      setActiveMarkId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [activeMarkId]);

  return (
    <div className="relative" onClick={handleMarkClick}>
      <div
        ref={containerRef}
        className={`selectable markdown-body prose-sm max-w-none text-sm text-ink ${className ?? ""}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
          {transformed}
        </ReactMarkdown>
      </div>

      {/* Selection toolbar — floating (desktop) or bottom sheet (phone) */}
      {enabled && toolbar && (
        isPhone ? (
          <div className="fixed inset-0 z-50 flex items-end" onClick={dismissToolbar}>
            <div
              className="w-full rounded-t-xl border border-edge bg-surface p-3 shadow-window"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-edge" />
              <div className="mb-2 line-clamp-2 text-[11px] text-ink-muted">
                “{toolbar.text}”
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => void doCreate(c)}
                    className={`h-7 w-7 rounded-full border-2 transition ${pendingColor === c ? "border-accent" : "border-edge"}`}
                    style={{ background: COLOR_SWATCH_BG[c] }}
                    title={COLOR_LABEL[c]}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={annotateText}
                  onChange={(e) => setAnnotateText(e.target.value)}
                  placeholder="Annotation (optional)"
                  className="flex-1 rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                />
                <button
                  onClick={() => void doCreate(pendingColor, annotateText)}
                  className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg"
                >
                  <MessageSquarePlus size={13} /> Save
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="fixed z-50 flex flex-col gap-1.5 rounded-lg border border-edge bg-surface p-2 shadow-window"
            style={{
              left: Math.min(
                Math.max(toolbar.rect.left + toolbar.rect.width / 2 - 90, 8),
                window.innerWidth - 188
              ),
              top: Math.max(toolbar.rect.top - 56, 8),
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex items-center gap-1">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => void doCreate(c)}
                  className="h-6 w-6 rounded-full border-2 border-edge transition hover:scale-110"
                  style={{ background: COLOR_SWATCH_BG[c] }}
                  title={COLOR_LABEL[c]}
                />
              ))}
              <button
                onClick={() => setAnnotateMode((v) => !v)}
                className={`ml-1 flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition ${
                  annotateMode ? "border-accent text-accent" : "border-edge text-ink-muted hover:text-ink"
                }`}
                title="Add annotation"
              >
                <MessageSquarePlus size={11} /> Note
              </button>
            </div>
            {annotateMode && (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={annotateText}
                  onChange={(e) => setAnnotateText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doCreate(pendingColor, annotateText);
                    if (e.key === "Escape") dismissToolbar();
                  }}
                  placeholder="Annotation…"
                  className="w-44 rounded-md border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
                />
                <button
                  onClick={() => void doCreate(pendingColor, annotateText)}
                  className="rounded-md bg-accent px-2 py-1 text-[10px] font-medium text-accent-fg"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        )
      )}

      {/* Edit popover for an existing highlight */}
      {enabled && activeHighlight && (
        <HighlightEditPopover
          highlight={activeHighlight}
          onChangeColor={(c) => void updateHighlight(activeHighlight.id, { color: c })}
          onChangeAnnotation={(a) => void updateHighlight(activeHighlight.id, { annotation: a })}
          onDelete={() => {
            void removeHighlight(activeHighlight.id);
            setActiveMarkId(null);
          }}
          onClose={() => setActiveMarkId(null)}
        />
      )}
    </div>
  );
}

/** Inline edit popover anchored to the active <mark>. Renders near the mark. */
function HighlightEditPopover({
  highlight,
  onChangeColor,
  onChangeAnnotation,
  onDelete,
  onClose,
}: {
  highlight: StudyHighlight;
  onChangeColor: (c: HighlightColor) => void;
  onChangeAnnotation: (a: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [annotation, setAnnotation] = useState(highlight.annotation ?? "");
  const ref = useRef<HTMLDivElement>(null);

  // Position near the active mark element.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const mark = document.querySelector(
      `mark.athena-hl[data-highlight-id="${highlight.id}"]`
    ) as HTMLElement | null;
    if (!mark) return;
    const rect = mark.getBoundingClientRect();
    setPos({
      left: Math.min(Math.max(rect.left, 8), window.innerWidth - 240),
      top: Math.max(rect.bottom + 6, 8),
    });
  }, [highlight.id]);

  return (
    <div
      ref={ref}
      data-hl-popover
      className="fixed z-50 w-56 rounded-lg border border-edge bg-surface p-2.5 shadow-window"
      style={pos ? { left: pos.left, top: pos.top } : { display: "none" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          <Highlighter size={11} /> Highlight
        </span>
        <button onClick={onClose} className="rounded p-0.5 text-ink-muted hover:text-ink">
          <X size={12} />
        </button>
      </div>
      <div className="mb-2 flex items-center gap-1">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onChangeColor(c)}
            className={`h-5 w-5 rounded-full border-2 transition hover:scale-110 ${
              highlight.color === c ? "border-accent" : "border-edge"
            }`}
            style={{ background: COLOR_SWATCH_BG[c] }}
            title={COLOR_LABEL[c]}
          />
        ))}
      </div>
      <textarea
        value={annotation}
        onChange={(e) => setAnnotation(e.target.value)}
        onBlur={() => onChangeAnnotation(annotation)}
        placeholder="Add an annotation…"
        rows={2}
        className="w-full resize-none rounded-md border border-edge bg-surface-2 px-2 py-1 text-[11px] text-ink outline-none focus:border-accent"
      />
      <div className="mt-1.5 flex justify-end">
        <button
          onClick={onDelete}
          className="flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10"
        >
          <Trash2 size={11} /> Delete
        </button>
      </div>
    </div>
  );
}

/** Solid-ish background colors for the toolbar swatches (the <mark> classes use
 *  semi-transparent overlays which look weak on a button). */
const COLOR_SWATCH_BG: Record<HighlightColor, string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  purple: "#c084fc",
};
