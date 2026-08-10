import { useState, useEffect } from "react";
import { Info, RefreshCw, Loader2, Heart, Sparkles, DownloadCloud, CheckCircle2, Server, Save } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useSettings } from "../../../store/settings";
import { SectionHeader, Card, StatusPill } from "../ui";
import { isAutoUpdateAvailable, checkForUpdate, getInstalledVersion } from "../../../services/updater";
import { apiUrl, getBaseUrl, setBaseUrl } from "../../../services/api";
import { useUpdater } from "../../../store/updater";

interface HealthInfo {
  ok: boolean;
  service: string;
  version: string;
  spotifyEnvFallback: boolean;
}

export default function AboutSection() {
  const { setTheme, setAccent, setWallpaper, setAnimatedBg, setVolume, setNotificationsEnabled, setDoNotDisturb, setHasOnboarded } =
    useSettings();
  const promptUpdate = useUpdater((s) => s.promptUpdate);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>(__APP_VERSION__);
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [serverUrlInput, setServerUrlInput] = useState(getBaseUrl());
  const [serverMsg, setServerMsg] = useState<string | null>(null);

  const isNative = Capacitor.isNativePlatform();

  const saveServerUrl = () => {
    const trimmed = serverUrlInput.trim().replace(/\/+$/, "");
    if (!trimmed) {
      setServerMsg("Server address cannot be empty.");
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setServerMsg("That doesn't look like a valid URL.");
      return;
    }
    setBaseUrl(trimmed);
    setServerUrlInput(trimmed);
    setServerMsg("Server address saved. Reload the app for all changes to take effect.");
    setTimeout(() => setServerMsg(null), 4000);
  };

  useEffect(() => {
    fetch(apiUrl("/health"))
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
    // On native builds, read the real installed version from the OS.
    void getInstalledVersion().then(setAppVersion);
  }, []);

  const checkUpdates = async () => {
    setChecking(true);
    setUpdateMsg(null);
    try {
      // Pass includeSkipped so the manual button ignores the auto-skip flag.
      const info = await checkForUpdate({ includeSkipped: true });
      if (info) {
        promptUpdate(info);
        setUpdateMsg(null);
      } else {
        setUpdateMsg("You’re on the latest version.");
      }
    } catch {
      setUpdateMsg("Couldn’t check for updates. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  };

  const resetDefaults = () => {
    if (!confirm("Reset all appearance, wallpaper, and notification settings to defaults?")) return;
    setResetting(true);
    setTheme("dark");
    setAccent("#6366f1");
    setWallpaper("aurora");
    setAnimatedBg("none");
    setVolume(70);
    setNotificationsEnabled(true);
    setDoNotDisturb(false);
    setMsg("Settings reset to defaults.");
    setTimeout(() => setMsg(null), 2500);
    setResetting(false);
  };

  return (
    <section id="about" className="mb-8">
      <SectionHeader icon={<Info size={18} />} title="About" description="Version, server status, and reset options." />

      <Card className="mb-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">Mavino — Student OS</p>
            <p className="text-xs text-ink-muted">Client v{appVersion}</p>
            <p className="mt-1 text-xs text-ink-muted">Made by students, for students</p>
          </div>
          <Heart size={16} className="text-accent" />
        </div>
      </Card>

      {isNative && (
        <Card className="mb-3">
          <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Server size={14} /> Server address
          </h4>
          <p className="mb-3 text-xs text-ink-muted">
            The backend Mavino server to connect to (including port). Change this if your
            server moves. Reload the app after changing.
          </p>
          <div className="flex gap-2">
            <input
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
              placeholder="http://192.168.1.100:3001"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="flex-1 rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              onClick={saveServerUrl}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
            >
              <Save size={14} /> Save
            </button>
          </div>
          {serverMsg && <p className="mt-2 text-xs text-ink-muted">{serverMsg}</p>}
        </Card>
      )}

      {isAutoUpdateAvailable() && (
        <Card className="mb-3">
          <h4 className="mb-1 text-sm font-semibold text-ink">App updates</h4>
          <p className="mb-3 text-xs text-ink-muted">
            Check for a newer APK release on GitHub. If one is found, you can download and
            install it directly — Android will ask you to confirm.
          </p>
          <button
            onClick={checkUpdates}
            disabled={checking}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface-3 disabled:opacity-40"
          >
            {checking ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <DownloadCloud size={14} />
            )}{" "}
            Check for updates
          </button>
          {updateMsg && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
              <CheckCircle2 size={12} className="text-accent" /> {updateMsg}
            </p>
          )}
        </Card>
      )}

      <Card className="mb-3">
        <h4 className="mb-2 text-sm font-semibold text-ink">Server status</h4>
        {health ? (
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Service</span>
              <span className="text-ink">{health.service} v{health.version}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Health</span>
              <StatusPill on={health.ok} onLabel="Healthy" offLabel="Degraded" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Spotify (server fallback)</span>
              <StatusPill on={health.spotifyEnvFallback} onLabel="Available" offLabel="Not set" />
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Unable to reach /health.</p>
        )}
      </Card>

      <Card className="mb-3">
        <h4 className="mb-1 text-sm font-semibold text-ink">Onboarding tour</h4>
        <p className="mb-3 text-xs text-ink-muted">
          New to Mavino? Replay the guided tour to learn about all the apps and features.
        </p>
        <button
          onClick={() => setHasOnboarded(false)}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface-3"
        >
          <Sparkles size={14} /> Replay tour
        </button>
      </Card>

      <Card>
        <h4 className="mb-1 text-sm font-semibold text-ink">Reset to defaults</h4>
        <p className="mb-3 text-xs text-ink-muted">
          Restore the default theme, accent, wallpaper, animated background, volume, and notification
          settings. Does not affect your account or data.
        </p>
        <button
          onClick={resetDefaults}
          disabled={resetting}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface-3 disabled:opacity-40"
        >
          {resetting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Reset settings
        </button>
        {msg && <p className="mt-2 text-xs text-ink-muted">{msg}</p>}
      </Card>
    </section>
  );
}
