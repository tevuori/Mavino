// ===== useCodemirrorShowControl =====
// Shared hook that wires a CodeMirror 6 editor (via @uiw/react-codemirror) to
// the show-control store so the Interactive Teacher can scroll to and highlight
// passages in the Notes and Editor apps.
//
// Usage in an app:
//   const { extensions, onCreateEditor } = useCodemirrorShowControl(win.id);
//   <CodeMirror ... extensions={[...extensions]} onCreateEditor={onCreateEditor} />
//
// The hook:
//   - captures the EditorView ref via onCreateEditor
//   - exposes a `StateField` extension that renders transient highlight
//     decorations (mark for text ranges, line for line ranges)
//   - subscribes to show-control commands for this window and dispatches
//     scroll/highlight/clear actions against the captured view

import { useEffect, useMemo, useRef, useCallback } from "react";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, EditorSelection, type Extension } from "@codemirror/state";
import { useShowControl, type ShowCommand } from "../../store/showControl";
import { findHighlightRange } from "../study/highlightRange";

// StateEffect + StateField for transient highlight decorations.
// The Teacher issues a highlight command → we dispatch this effect with the
// resolved document range → the field adds a Decoration.mark / Decoration.line.
export const setHighlightEffect = StateEffect.define<{
  from: number;
  to: number;
  lineRange?: boolean;
} | null>();

const highlightField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(deco, tr) {
    // Clear highlights on any document change (the user edited the text).
    if (tr.docChanged) return Decoration.none;
    for (const e of tr.effects) {
      if (e.is(setHighlightEffect)) {
        if (e.value === null) return Decoration.none;
        const { from, to, lineRange } = e.value;
        if (lineRange) {
          return Decoration.set([
            Decoration.line({ class: "cm-teacher-highlight-line" }).range(from),
          ]);
        }
        // Defensive: an empty mark range would throw "Mark decorations may
        // not be empty" — clear instead of crashing.
        if (to <= from) return Decoration.none;
        return Decoration.set([
          Decoration.mark({ class: "cm-teacher-highlight" }).range(from, to),
        ]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Resolve a ShowCommand's target to a document {from, to} range.
 *  Returns null if the target can't be resolved (e.g. text not found). */
function resolveRange(
  view: EditorView,
  cmd: ShowCommand
): { from: number; to: number; lineRange?: boolean } | null {
  const doc = view.state.doc;
  // Explicit character offsets (preferred — exact, no guessing).
  if (typeof cmd.posStart === "number" && typeof cmd.posEnd === "number") {
    const from = Math.max(0, Math.min(cmd.posStart, doc.length));
    const to = Math.max(from, Math.min(cmd.posEnd, doc.length));
    // Empty range (e.g. stale offsets clamped to doc.length) would crash
    // CodeMirror with "Mark decorations may not be empty" — treat as no match.
    if (to <= from) return null;
    return { from, to };
  }
  if (typeof cmd.pos === "number") {
    const p = Math.max(0, Math.min(cmd.pos, doc.length));
    if (p >= doc.length) return null;
    return { from: p, to: Math.min(p + 1, doc.length) };
  }
  // Line range (1-based, inclusive).
  if (typeof cmd.lineStart === "number" && typeof cmd.lineEnd === "number") {
    const fromLine = Math.max(1, cmd.lineStart);
    const toLine = Math.min(doc.lines, cmd.lineEnd);
    if (toLine < fromLine) return null;
    const from = doc.line(fromLine).from;
    const to = doc.line(toLine).to;
    return { from, to, lineRange: true };
  }
  // Single line.
  if (typeof cmd.line === "number") {
    const n = Math.max(1, Math.min(cmd.line, doc.lines));
    const line = doc.line(n);
    return { from: line.from, to: line.to, lineRange: true };
  }
  // Text search: exact (first occurrence, case-insensitive), then fuzzy
  // token-overlap so a paraphrased phrase still lands on the right passage.
  if (cmd.text) {
    const full = doc.toString();
    const r = findHighlightRange(full, { text: cmd.text });
    if (r) return { from: r.from, to: r.to };
    return null;
  }
  return null;
}

/** Scroll a range into view (centered) with a small margin. */
function scrollRangeIntoView(view: EditorView, from: number, to: number) {
  view.dispatch({
    effects: EditorView.scrollIntoView(
      EditorSelection.range(from, to),
      { y: "center", yMargin: 80 }
    ),
  });
}

export interface UseCodemirrorShowControl {
  extensions: Extension[];
  /** Pass to <CodeMirror onCreateEditor={...} /> to capture the view. */
  onCreateEditor: (view: EditorView) => void;
}

export function useCodemirrorShowControl(
  winId: string | undefined
): UseCodemirrorShowControl {
  const viewRef = useRef<EditorView | null>(null);
  const lastSeq = useRef(0);
  const commands = useShowControl((s) => s.commands);
  const reportResult = useShowControl((s) => s.reportResult);

  const onCreateEditor = useCallback((view: EditorView) => {
    viewRef.current = view;
  }, []);

  const extensions = useMemo(() => [highlightField], []);

  // Consume show-control commands targeted at this window.
  useEffect(() => {
    if (!winId) return;
    const cmd = commands[winId];
    if (!cmd || cmd.seq === lastSeq.current) return;
    lastSeq.current = cmd.seq;
    const view = viewRef.current;
    if (!view) {
      reportResult(winId, cmd.seq, cmd.kind, false, "not-loaded");
      return;
    }

    switch (cmd.kind) {
      case "scroll_to": {
        const range = resolveRange(view, cmd);
        if (range) {
          scrollRangeIntoView(view, range.from, range.to);
        }
        reportResult(winId, cmd.seq, cmd.kind, Boolean(range), range ? undefined : "no-match");
        break;
      }
      case "highlight": {
        const range = resolveRange(view, cmd);
        if (range) {
          view.dispatch({
            effects: setHighlightEffect.of(range),
          });
          scrollRangeIntoView(view, range.from, range.to);
        }
        reportResult(winId, cmd.seq, cmd.kind, Boolean(range), range ? undefined : "no-match");
        break;
      }
      case "clear_highlight": {
        view.dispatch({ effects: setHighlightEffect.of(null) });
        reportResult(winId, cmd.seq, cmd.kind, true);
        break;
      }
      default:
        // focus / close handled by the window store, not here.
        break;
    }
  }, [winId, commands, reportResult]);

  return { extensions, onCreateEditor };
}
