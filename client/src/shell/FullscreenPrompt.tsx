// ===== FullscreenPrompt =====
// A small, dismissible desktop banner that asks the user to enter fullscreen.
// Used when the user has already completed onboarding and either dismissed the
// fullscreen step without choosing, or manually exited fullscreen earlier.

import { Maximize, X } from "lucide-react";
import { useSettings } from "../store/settings";
import { useFullscreen } from "./useFullscreen";

export default function FullscreenPrompt() {
  const { enterFullscreen } = useFullscreen();
  const { setPreferFullscreen, setFullscreenPromptDismissed } = useSettings();

  const enter = () => {
    setPreferFullscreen(true);
    void enterFullscreen();
  };

  const keepWindowed = () => {
    setPreferFullscreen(false);
    setFullscreenPromptDismissed(true);
  };

  const dismiss = () => {
    setFullscreenPromptDismissed(true);
  };

  return (
    <div className="fixed left-1/2 top-4 z-[12000] w-[420px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-edge bg-surface/95 p-3 shadow-window backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Maximize size={16} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-ink">Mavino works best in fullscreen</p>
          <p className="text-xs text-ink-muted">
            Enter fullscreen to hide the browser chrome and use the desktop-like workspace.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={enter}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:bg-accent-hover"
            >
              Enter fullscreen
            </button>
            <button
              type="button"
              onClick={keepWindowed}
              className="rounded-lg px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-3"
            >
              Keep windowed
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg p-1 text-ink-muted transition hover:bg-surface-3 hover:text-ink"
          title="Dismiss"
          aria-label="Dismiss fullscreen prompt"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
