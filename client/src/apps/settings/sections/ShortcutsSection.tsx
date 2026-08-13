import { useEffect, useRef, useState } from "react";
import { Keyboard, RotateCcw, AlertTriangle } from "lucide-react";
import { useSettings } from "../../../store/settings";
import {
  SHORTCUT_LABELS,
  formatShortcut,
  captureShortcut,
  matchesShortcut,
  type ShortcutAction,
  type Shortcut,
} from "../../../store/shortcuts";

const ACTION_ORDER: ShortcutAction[] = [
  "toggleDock",
  "toggleCommandPalette",
  "toggleWorkspaceOverview",
  "toggleAthenaQuickPanel",
  "toggleQuickCapture",
  "toggleFullscreen",
  "snapWindowLeft",
  "snapWindowRight",
  "snapWindowTopLeft",
  "snapWindowTopRight",
  "maximizeWindow",
  "toggleMaximize",
  "minimizeWindow",
  "restoreWindow",
  "closeWindow",
  "previousWorkspace",
  "nextWorkspace",
  "moveWindowPreviousWorkspace",
  "moveWindowNextWorkspace",
];

export default function ShortcutsSection() {
  const shortcuts = useSettings((s) => s.shortcuts);
  const setShortcut = useSettings((s) => s.setShortcut);
  const resetShortcuts = useSettings((s) => s.resetShortcuts);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [conflict, setConflict] = useState<ShortcutAction | null>(null);
  const rowRefs = useRef<Partial<Record<ShortcutAction, HTMLDivElement | null>>>({});

  const startRecording = (action: ShortcutAction) => {
    setRecording(action);
    setConflict(null);
    setTimeout(() => rowRefs.current[action]?.focus(), 0);
  };

  const cancelRecording = () => {
    setRecording(null);
    setConflict(null);
  };

  useEffect(() => {
    if (!recording) return;

    const onKey = (e: KeyboardEvent) => {
      // Allow Escape to cancel without capturing.
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRecording();
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const captured = captureShortcut(e);
      if (!captured) return;

      // Detect duplicate assignment.
      const existing = (Object.keys(shortcuts) as ShortcutAction[]).find(
        (a) => a !== recording && matchesShortcut(e, shortcuts[a])
      );
      if (existing) {
        setConflict(existing);
        return;
      }

      setShortcut(recording, captured);
      setRecording(null);
      setConflict(null);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, setShortcut, shortcuts]);

  const duplicateCheck = (action: ShortcutAction): ShortcutAction | null => {
    const s = shortcuts[action];
    return (Object.keys(shortcuts) as ShortcutAction[]).find(
      (a) => a !== action && matchesShortcutFor(s, shortcuts[a])
    ) ?? null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Keyboard size={18} className="text-accent" />
          <h2 className="text-lg font-semibold text-ink">Keyboard shortcuts</h2>
        </div>
        <button
          onClick={resetShortcuts}
          className="flex items-center gap-2 rounded-lg border border-edge bg-surface-2 px-3 py-1.5 text-sm text-ink transition hover:bg-surface-3"
        >
          <RotateCcw size={14} />
          Reset defaults
        </button>
      </div>

      <p className="text-sm text-ink-muted">
        Click a shortcut to record a new key combination. Press Escape to cancel.
      </p>

      {ACTION_ORDER.map((action) => {
        const dup = duplicateCheck(action);
        const isRecording = recording === action;
        return (
          <div
            key={action}
            ref={(el) => (rowRefs.current[action] = el)}
            tabIndex={isRecording ? 0 : -1}
            onClick={() => startRecording(action)}
            onBlur={(e) => {
              if (!rowRefs.current[action]?.contains(e.relatedTarget as Node)) {
                cancelRecording();
              }
            }}
            className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 transition ${
              isRecording
                ? "border-accent bg-accent/10"
                : "border-edge bg-surface-2 hover:bg-surface-3"
            }`}
          >
            <div>
              <div className="text-sm font-medium text-ink">{SHORTCUT_LABELS[action]}</div>
              {dup && (
                <div className="mt-1 flex items-center gap-1 text-xs text-amber-400">
                  <AlertTriangle size={12} />
                  Same shortcut as <span className="font-medium">{SHORTCUT_LABELS[dup]}</span>
                </div>
              )}
            </div>
            <div
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                isRecording ? "bg-accent text-white" : "bg-surface text-ink-muted"
              }`}
            >
              {isRecording ? "Recording..." : formatShortcut(shortcuts[action])}
            </div>
          </div>
        );
      })}

      {conflict && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle size={16} />
          That key is already assigned to {SHORTCUT_LABELS[conflict]}.
        </div>
      )}
    </div>
  );
}

function matchesShortcutFor(a: Shortcut | undefined, b: Shortcut | undefined): boolean {
  if (!a || !b) return false;
  // Normalize an unhandled key event with a synthetic KeyboardEvent.
  const e = new KeyboardEvent("keydown", {
    key: a.key,
    ctrlKey: !!a.ctrl || !!a.super,
    metaKey: !!a.meta || !!a.super,
    shiftKey: !!a.shift,
    altKey: !!a.alt,
  });
  return matchesShortcut(e, b);
}
