import { useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Web/PWA update prompt.
 *
 * When a new production build is deployed, vite-plugin-pwa installs the new
 * service worker in the background and sets `needRefresh`. The user can then
 * reload on their own schedule instead of needing a hard refresh (Ctrl+Shift+R).
 *
 * The component is a no-op in dev mode and on Capacitor native builds, which
 * use a separate APK update flow (see `UpdateDialog`).
 */
function PwaReloadPrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
  });

  const handleUpdate = useCallback(() => {
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-16 right-4 z-[10001] w-full max-w-sm transition-all duration-300 ease-out">
      <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface-2/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <RefreshCw size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Update available</p>
          <p className="text-xs text-ink-muted">
            A new version of Mavino is ready.
          </p>
        </div>
        <button
          onClick={handleUpdate}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white shadow hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export default function ReloadPrompt() {
  if (import.meta.env.DEV) return null;
  if (Capacitor.isNativePlatform()) return null;
  return <PwaReloadPrompt />;
}
