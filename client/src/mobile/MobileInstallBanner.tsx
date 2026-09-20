import { useCallback, useEffect, useState } from "react";
import { Download, Share2, X } from "lucide-react";

const DISMISSED_KEY = "athena.install-banner-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as Record<string, unknown>).MSStream;
}

function isStandalone(): boolean {
  if ("standalone" in navigator && (navigator as unknown as Record<string, boolean>).standalone) return true;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return false;
}

export default function MobileInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISSED_KEY) === "1");

  useEffect(() => {
    if (isStandalone()) return;

    if (isIos()) {
      setShowIos(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setDeferredPrompt(null);
    setShowIos(false);
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
    setDeferredPrompt(null);
  }, [deferredPrompt, dismiss]);

  if (dismissed || isStandalone()) return null;

  // Android / Chrome install prompt
  if (deferredPrompt) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/[0.06] p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Download size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Install Mavino</p>
          <p className="text-xs text-ink-muted">Add to your home screen for a native app experience</p>
        </div>
        <button
          type="button"
          onClick={() => void install()}
          className="shrink-0 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white active:scale-95"
        >
          Install
        </button>
        <button type="button" onClick={dismiss} className="shrink-0 text-ink-muted" aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    );
  }

  // iOS instructions
  if (showIos) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/[0.06] p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Share2 size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Install Mavino</p>
          <p className="text-xs text-ink-muted">
            Tap <Share2 size={10} className="mx-0.5 inline text-accent" /> Share then "Add to Home Screen"
          </p>
        </div>
        <button type="button" onClick={dismiss} className="shrink-0 text-ink-muted" aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    );
  }

  return null;
}
