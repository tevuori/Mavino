// ===== Cloudflare Turnstile widget =====
//
// Renders the Turnstile challenge widget and exposes the token via a callback.
// When Turnstile is not configured (no site key from the server), renders nothing.
//
// The Turnstile script is loaded lazily from challenges.cloudflare.com.

import { useEffect, useRef, useState, useCallback } from "react";

interface TurnstileConfig {
  enabled: boolean;
  siteKey: string | null;
}

let configCache: TurnstileConfig | null = null;
let configPromise: Promise<TurnstileConfig> | null = null;

async function loadTurnstileConfig(): Promise<TurnstileConfig> {
  if (configCache) return configCache;
  if (configPromise) return configPromise;
  configPromise = (async () => {
    try {
      const { api } = await import("../services/api");
      const config = await api.get<TurnstileConfig>("/api/auth/turnstile-config");
      configCache = config;
      return config;
    } catch {
      configCache = { enabled: false, siteKey: null };
      return configCache;
    }
  })();
  return configPromise;
}

let scriptLoaded = false;
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      scriptLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Turnstile script"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

interface TurnstileWidgetProps {
  onToken: (token: string) => void;
  className?: string;
}

export default function TurnstileWidget({ onToken, className }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load config on mount
  useEffect(() => {
    loadTurnstileConfig().then((config) => {
      setEnabled(config.enabled);
      setSiteKey(config.siteKey);
    });
  }, []);

  // Render widget when config is loaded and siteKey is available
  useEffect(() => {
    if (!enabled || !siteKey || !containerRef.current) return;

    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        // Clear any existing widget
        if (widgetIdRef.current) {
          try {
            (window as any).turnstile?.remove(widgetIdRef.current);
          } catch { /* ignore */ }
          widgetIdRef.current = null;
        }
        containerRef.current.innerHTML = "";
        widgetIdRef.current = (window as any).turnstile?.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onToken(token),
          "error-callback": () => setError("Verification failed. Please refresh."),
          "expired-callback": () => onToken(""),
          theme: "dark",
        });
      })
      .catch(() => setError("Failed to load bot protection."));

    return () => {
      cancelled = true;
      if (widgetIdRef.current) {
        try {
          (window as any).turnstile?.remove(widgetIdRef.current);
        } catch { /* ignore */ }
        widgetIdRef.current = null;
      }
    };
  }, [enabled, siteKey, onToken]);

  if (!enabled) return null;

  return (
    <div className={className}>
      <div ref={containerRef} />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** Reset the config cache (useful when the server URL changes on native). */
export function resetTurnstileCache(): void {
  configCache = null;
  configPromise = null;
}

/** Hook to check if Turnstile is enabled without rendering the widget. */
export function useTurnstileEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    loadTurnstileConfig().then((config) => setEnabled(config.enabled));
  }, []);
  return enabled;
}
