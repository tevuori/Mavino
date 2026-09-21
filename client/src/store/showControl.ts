// ===== Show-control: per-window command channel for the Interactive Teacher =====
// Mirrors the store/browser.ts pattern: a per-window command queue with a seq
// counter. The Teacher (via Athena tool calls → client_action dispatch) issues
// commands targeting a specific window id; the app that owns that window
// consumes the command via a useEffect on `seq` (same pattern BrowserApp uses
// for navRequests).
//
// This lets the Teacher drive the EXISTING Notes/Editor/Viewer/Browser apps
// with scroll/highlight/focus commands without re-implementing any rendering.
// Each app implements the commands against its own editor/viewer API.

import { create } from "zustand";

export type ShowCommandKind =
  | "scroll_to"
  | "highlight"
  | "clear_highlight"
  | "focus"
  | "close";

export interface ShowCommand {
  seq: number;
  kind: ShowCommandKind;
  /** scroll_to: a 1-based line number to scroll into view. */
  line?: number;
  /** scroll_to / highlight: a character offset in the document. */
  pos?: number;
  /** scroll_to: a 1-based page number to scroll to (PDF). */
  page?: number;
  /** scroll_to: a 1-based slide number to scroll to (PPTX). */
  slide?: number;
  /** scroll_to / highlight: text to search for in the document (first match). */
  text?: string;
  /** highlight: start line of a line-range highlight (1-based, inclusive). */
  lineStart?: number;
  /** highlight: end line of a line-range highlight (1-based, inclusive). */
  lineEnd?: number;
  /** highlight: start character offset of a range highlight. */
  posStart?: number;
  /** highlight: end character offset of a range highlight. */
  posEnd?: number;
  /** Optional CSS selector (used by the Browser app for DOM targeting). */
  selector?: string;
}

/** Why a show command could not be carried out. */
export type ShowFailureReason =
  | "no-match"
  | "not-loaded"
  | "blocked-by-cors"
  | "file-not-found"
  | "unsupported-type";

/** Outcome of the last show command for a window, reported by the owning app. */
export interface ShowResult {
  seq: number;
  windowId: string;
  kind: ShowCommandKind;
  ok: boolean;
  reason?: ShowFailureReason;
}

interface ShowControlState {
  /** Pending show command per window id (consumed by the owning app). */
  commands: Record<string, ShowCommand>;
  /** Last result per window id (reported by the owning app after it acted). */
  results: Record<string, ShowResult>;
  /**
   * Window the teacher's voice is currently anchored to. The window frame
   * renders a subtle glow so the student's eye follows the narration.
   */
  speakingWindowId: string | null;
  /** Issue a command targeting a specific window. */
  issueCommand: (windowId: string, kind: ShowCommandKind, payload?: Partial<Omit<ShowCommand, "seq" | "kind">>) => void;
  /** Report whether a command succeeded (called by the app that consumed it). */
  reportResult: (windowId: string, seq: number, kind: ShowCommandKind, ok: boolean, reason?: ShowFailureReason) => void;
  setSpeakingWindow: (windowId: string | null) => void;
  /** Remove state for a window (on close). */
  removeWindow: (windowId: string) => void;
}

let seqCounter = 0;

export const useShowControl = create<ShowControlState>((set) => ({
  commands: {},
  results: {},
  speakingWindowId: null,
  issueCommand: (windowId, kind, payload = {}) =>
    set((s) => ({
      commands: {
        ...s.commands,
        [windowId]: { seq: ++seqCounter, kind, ...payload },
      },
    })),
  reportResult: (windowId, seq, kind, ok, reason) =>
    set((s) => ({
      results: { ...s.results, [windowId]: { seq, windowId, kind, ok, reason } },
    })),
  setSpeakingWindow: (windowId) => set({ speakingWindowId: windowId }),
  removeWindow: (windowId) =>
    set((s) => {
      const commands = { ...s.commands };
      const results = { ...s.results };
      delete commands[windowId];
      delete results[windowId];
      return {
        commands,
        results,
        speakingWindowId: s.speakingWindowId === windowId ? null : s.speakingWindowId,
      };
    }),
}));
