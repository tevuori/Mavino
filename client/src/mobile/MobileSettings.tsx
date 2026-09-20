import { useState, useCallback, useEffect } from "react";
import {
  Bell, Calendar, Languages, Loader2, Lock, LogOut, Map as MapIcon,
  Monitor, Moon, Music, Palette, Plug, Sun, Trash2, User,
} from "lucide-react";
import { useAuth } from "../store/auth";
import { useSettings, type WallpaperId, type AnimatedBgId } from "../store/settings";
import { useFormFactor } from "../store/formfactor";
import { useLanguage } from "../store/language";
import { useMobileDialog } from "../store/mobileDialog";
import { authApi } from "../services/auth";
import type { AuthDevice } from "../services/auth";
import { spotifyApi, type SpotifyCredentialStatus } from "../services/spotify";
import { microsoftApi, type MicrosoftCredentialStatus } from "../services/microsoft";
import { ntfyApi } from "../services/ntfy";
import { mapyApi } from "../services/maps";
import { MobileContainer, MobileHeader, MobileInput, MobileSelect } from "./MobileUi";

const WALLPAPERS: WallpaperId[] = ["aurora", "sunset", "ocean", "forest", "mesh", "mono"];
const ANIMATED: AnimatedBgId[] = [
  "none", "starfield", "particles", "matrix", "aurora-waves", "bubbles", "geometric",
  "fireflies", "rain", "plasma", "constellation", "neon-grid", "bokeh", "snow", "waves",
];

export default function MobileSettings({ onClose }: { onClose?: () => void }) {
  const user = useAuth((s) => s.user);
  const updateProfile = useAuth((s) => s.updateProfile);
  const changePassword = useAuth((s) => s.changePassword);
  const logout = useAuth((s) => s.logout);
  const settings = useSettings();
  const formFactor = useFormFactor();
  const languageSettings = useLanguage();

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [devices, setDevices] = useState<AuthDevice[]>([]);

  const onDisplayName = async () => {
    if (displayName.trim()) await updateProfile({ displayName: displayName.trim() });
  };

  const onPassword = async () => {
    if (current && next) {
      await changePassword(current, next);
      setCurrent(""); setNext("");
    }
  };

  const onDevices = async () => {
    const res = await authApi.listDevices().catch(() => []);
    setDevices(res);
  };

  const revoke = async (id: string) => {
    await authApi.revokeDevice(id).catch(() => {});
    setDevices((d) => d.filter((x) => x.id !== id));
  };

  return (
    <MobileContainer>
      <MobileHeader title="Settings" subtitle="Account & preferences" onClose={onClose} />

      <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="mb-3 flex items-center gap-2">
          <User size={18} className="text-accent" />
          <p className="text-sm font-semibold text-ink">Account</p>
        </div>
        <p className="mb-2 text-xs text-ink-muted">{user?.username} · {user?.role}</p>
        <MobileInput
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={() => void onDisplayName()}
          placeholder="Display name"
          className="mb-3"
        />
        <div className="grid grid-cols-2 gap-2">
          <MobileInput value={current} onChange={(e) => setCurrent(e.target.value)} type="password" placeholder="Current" />
          <MobileInput value={next} onChange={(e) => setNext(e.target.value)} type="password" placeholder="New" />
        </div>
        <button
          type="button"
          onClick={() => void onPassword()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-surface-2 py-2.5 text-sm text-ink-muted"
        >
          <Lock size={16} /> Change password
        </button>
      </section>

      <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Palette size={18} className="text-accent" />
          <p className="text-sm font-semibold text-ink">Appearance</p>
        </div>
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => settings.setTheme("light")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm ${
              settings.theme === "light" ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
            }`}
          >
            <Sun size={16} /> Light
          </button>
          <button
            type="button"
            onClick={() => settings.setTheme("dark")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2 text-sm ${
              settings.theme === "dark" ? "bg-accent text-ink" : "bg-surface-2 text-ink-muted"
            }`}
          >
            <Moon size={16} /> Dark
          </button>
        </div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">Accent color</label>
        <input
          type="color"
          value={settings.accent}
          onChange={(e) => settings.setAccent(e.target.value)}
          className="mb-3 h-11 w-full rounded-2xl border border-edge bg-surface-2"
        />
        <label className="mb-1 block text-xs font-medium text-ink-muted">Wallpaper</label>
        <MobileSelect value={settings.wallpaper} onChange={(e) => settings.setWallpaper(e.target.value as WallpaperId)} className="mb-3">
          {WALLPAPERS.map((w) => <option key={w} value={w}>{w}</option>)}
        </MobileSelect>
        <label className="mb-1 block text-xs font-medium text-ink-muted">Animated background</label>
        <MobileSelect value={settings.animatedBg} onChange={(e) => settings.setAnimatedBg(e.target.value as AnimatedBgId)}>
          {ANIMATED.map((a) => <option key={a} value={a}>{a}</option>)}
        </MobileSelect>
      </section>

      <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Languages size={18} className="text-accent" />
          <p className="text-sm font-semibold text-ink">Language & Region</p>
        </div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">Application language</label>
        <MobileSelect value={languageSettings.language} onChange={(event) => void languageSettings.setLanguage(event.target.value as "en" | "cs")}>
          <option value="en">English</option>
          <option value="cs">Čeština</option>
        </MobileSelect>
        <button type="button" onClick={languageSettings.resetOverrides} className="mt-3 w-full rounded-xl bg-surface-3 py-2.5 text-sm text-ink-muted">
          Reset app overrides
        </button>
      </section>

      <IntegrationsSection />

      <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Monitor size={18} className="text-accent" />
          <p className="text-sm font-semibold text-ink">Mobile</p>
        </div>
        <p className="mb-2 text-xs text-ink-muted">Current mode: <span className="text-ink">{formFactor.mode}</span></p>
        <button
          type="button"
          onClick={() => formFactor.refresh()}
          className="w-full rounded-xl bg-surface-2 py-2.5 text-sm text-ink-muted"
        >
          Refresh form factor
        </button>
      </section>

      <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Monitor size={18} className="text-accent" />
          <p className="text-sm font-semibold text-ink">Sessions</p>
        </div>
        <button
          type="button"
          onClick={() => void onDevices()}
          className="mb-2 w-full rounded-xl bg-surface-2 py-2.5 text-sm text-ink-muted"
        >
          Load devices
        </button>
        <div className="space-y-2">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
              <span className="text-xs text-ink-muted">{d.deviceLabel}</span>
              <button type="button" onClick={() => void revoke(d.id)} className="rounded-lg p-1 text-ink-muted active:text-rose-400">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => void logout()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500/15 py-3 text-sm font-semibold text-rose-300"
      >
        <LogOut size={18} /> Log out
      </button>
    </MobileContainer>
  );
}

// ===== Integrations section =====

function IntegrationsSection() {
  return (
    <section className="mb-5 rounded-2xl border border-edge bg-surface-2 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Plug size={18} className="text-accent" />
        <p className="text-sm font-semibold text-ink">Integrations</p>
      </div>
      <p className="mb-4 text-xs text-ink-muted">
        Connect external services. Each user configures these independently. Credentials are encrypted (AES-256-GCM).
      </p>
      <div className="space-y-4">
        <SpotifyIntegration />
        <MicrosoftIntegration />
        <NtfyIntegration />
        <MapyIntegration />
      </div>
    </section>
  );
}

function IntegrationStatus({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${on ? "bg-emerald-500/15 text-emerald-400" : "bg-surface-3 text-ink-muted"}`}>
      {label}
    </span>
  );
}

function IntegrationMsg({ msg, err }: { msg: string | null; err: boolean }) {
  if (!msg) return null;
  return <p className={`mt-2 text-xs ${err ? "text-red-400" : "text-emerald-400"}`}>{msg}</p>;
}

function SpotifyIntegration() {
  const { confirm } = useMobileDialog();
  const [status, setStatus] = useState<SpotifyCredentialStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await spotifyApi.getCredentials());
    } catch {
      setStatus({ hasCredentials: false, configured: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = async () => {
    if (!clientId.trim() || !clientSecret.trim() || !refreshToken.trim()) return;
    setBusy(true); setErr(false); setMsg(null);
    try {
      await spotifyApi.setCredentials(clientId.trim(), clientSecret.trim(), refreshToken.trim());
      setClientId(""); setClientSecret(""); setRefreshToken("");
      await refresh();
      setMsg("Spotify credentials saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save credentials");
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!(await confirm("Remove your stored Spotify credentials?"))) return;
    setBusy(true); setErr(false); setMsg(null);
    try {
      await spotifyApi.deleteCredentials();
      await refresh();
      setMsg("Spotify credentials removed.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const hasCreds = status?.hasCredentials ?? false;
  const configured = status?.configured ?? false;

  return (
    <div className="rounded-xl border border-edge bg-surface p-3">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Music size={16} className="text-ink-muted" />
          <span className="text-sm font-medium text-ink">Spotify</span>
        </div>
        <IntegrationStatus on={configured} label={configured ? "Connected" : "Not configured"} />
      </button>
      {expanded && (
        <div className="mt-3">
          {hasCreds ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void disconnect()} disabled={busy} className="flex items-center gap-1.5 rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-400 active:bg-rose-500/25 disabled:opacity-50">
                <LogOut size={14} /> Disconnect
              </button>
              {busy && <Loader2 size={14} className="animate-spin text-ink-muted" />}
            </div>
          ) : (
            <div className="space-y-2">
              <MobileInput value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" />
              <MobileInput type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client Secret" />
              <MobileInput type="password" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} placeholder="Refresh Token" />
              <button type="button" onClick={() => void connect()} disabled={busy || !clientId.trim() || !clientSecret.trim() || !refreshToken.trim()} className="brand-gradient flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/30 active:scale-[.98] disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
              </button>
              <p className="text-[11px] text-ink-muted">
                Create a Spotify app at developer.spotify.com, use the Authorization Code flow with offline_access scope.
              </p>
            </div>
          )}
          <IntegrationMsg msg={msg} err={err} />
        </div>
      )}
    </div>
  );
}

function MicrosoftIntegration() {
  const { confirm } = useMobileDialog();
  const [status, setStatus] = useState<MicrosoftCredentialStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("common");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await microsoftApi.getCredentials());
    } catch {
      setStatus({ hasCredentials: false, configured: false, usingEnvFallback: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Detect OAuth redirect hash
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.startsWith("#ms_oauth=")) return;
    const params = new URLSearchParams(hash.slice(1));
    const result = params.get("ms_oauth");
    const detail = params.get("detail");
    if (result === "success") {
      setErr(false);
      setMsg("Microsoft account connected.");
      void refresh();
    } else {
      setErr(true);
      setMsg(`Microsoft sign-in failed${detail ? `: ${detail}` : ""}`);
    }
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [refresh]);

  const signIn = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(true); setErr(false); setMsg(null);
    try {
      const { authorizeUrl } = await microsoftApi.startOAuth(clientId.trim(), clientSecret.trim(), tenantId.trim() || "common");
      window.location.href = authorizeUrl;
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to start OAuth flow");
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!(await confirm("Remove your stored Microsoft credentials?"))) return;
    setBusy(true); setErr(false); setMsg(null);
    try {
      await microsoftApi.deleteCredentials();
      await refresh();
      setMsg("Microsoft credentials removed.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const sync = async () => {
    setBusy(true); setErr(false); setMsg(null);
    try {
      const r = await microsoftApi.sync();
      setMsg(`Synced ${r.synced} event(s), removed ${r.deleted}.`);
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Sync failed");
    } finally { setBusy(false); }
  };

  const hasCreds = status?.hasCredentials ?? false;
  const configured = status?.configured ?? false;

  return (
    <div className="rounded-xl border border-edge bg-surface p-3">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-ink-muted" />
          <span className="text-sm font-medium text-ink">Microsoft Calendar</span>
        </div>
        <IntegrationStatus on={configured} label={configured ? "Connected" : "Not configured"} />
      </button>
      {expanded && (
        <div className="mt-3">
          {hasCreds ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void sync()} disabled={busy} className="flex items-center gap-1.5 rounded-xl border border-edge px-3 py-2 text-sm text-ink active:bg-surface-3 disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : "Sync now"}
              </button>
              <button type="button" onClick={() => void disconnect()} disabled={busy} className="flex items-center gap-1.5 rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-400 active:bg-rose-500/25 disabled:opacity-50">
                <LogOut size={14} /> Disconnect
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <MobileInput value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client (App) ID" />
              <MobileInput type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client Secret" />
              <MobileInput value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Tenant ID (common)" />
              <button type="button" onClick={() => void signIn()} disabled={busy || !clientId.trim() || !clientSecret.trim()} className="brand-gradient flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/30 active:scale-[.98] disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : "Sign in with Microsoft"}
              </button>
              <p className="text-[11px] text-ink-muted">
                Register an app in Azure Portal with Calendars.ReadWrite + offline_access permissions.
              </p>
            </div>
          )}
          <IntegrationMsg msg={msg} err={err} />
        </div>
      )}
    </div>
  );
}

function NtfyIntegration() {
  const [status, setStatus] = useState<{ configured: boolean; enabled: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await ntfyApi.getStatus();
      setStatus({ configured: s.configured, enabled: s.enabled });
    } catch {
      setStatus({ configured: false, enabled: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const configured = status?.configured ?? false;
  const enabled = status?.enabled ?? false;

  return (
    <div className="rounded-xl border border-edge bg-surface p-3">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-ink-muted" />
          <span className="text-sm font-medium text-ink">Ntfy</span>
        </div>
        <IntegrationStatus on={configured} label={configured ? (enabled ? "Connected" : "Disabled") : "Not configured"} />
      </button>
      {expanded && (
        <div className="mt-3">
          <p className="text-xs text-ink-muted">
            Ntfy provides bidirectional push notifications. Configure it in the Ntfy app (More tab) to set up server URL, topics, and cron jobs.
          </p>
        </div>
      )}
    </div>
  );
}

function MapyIntegration() {
  const { confirm } = useMobileDialog();
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { configured: c } = await mapyApi.credentialsStatus();
      setConfigured(c);
    } catch {
      setConfigured(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = async () => {
    if (!apiKey.trim()) return;
    setBusy(true); setErr(false); setMsg(null);
    try {
      await mapyApi.setApiKey(apiKey.trim());
      setApiKey("");
      await refresh();
      setMsg("Mapy.cz API key saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save API key");
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!(await confirm("Remove your stored Mapy.cz API key?"))) return;
    setBusy(true); setErr(false); setMsg(null);
    try {
      await mapyApi.deleteApiKey();
      await refresh();
      setMsg("Mapy.cz API key removed.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-edge bg-surface p-3">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapIcon size={16} className="text-ink-muted" />
          <span className="text-sm font-medium text-ink">Mapy.cz</span>
        </div>
        <IntegrationStatus on={configured} label={configured ? "Connected" : "Not configured"} />
      </button>
      {expanded && (
        <div className="mt-3">
          {configured ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void disconnect()} disabled={busy} className="flex items-center gap-1.5 rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-400 active:bg-rose-500/25 disabled:opacity-50">
                <LogOut size={14} /> Disconnect
              </button>
              {busy && <Loader2 size={14} className="animate-spin text-ink-muted" />}
            </div>
          ) : (
            <div className="space-y-2">
              <MobileInput type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Mapy.com developer API key" />
              <button type="button" onClick={() => void connect()} disabled={busy || !apiKey.trim()} className="brand-gradient flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/30 active:scale-[.98] disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
              </button>
              <p className="text-[11px] text-ink-muted">
                Get a free API key at developer.mapy.com. Powers the Maps app (routing, geocoding, POI search, elevation).
              </p>
            </div>
          )}
          <IntegrationMsg msg={msg} err={err} />
        </div>
      )}
    </div>
  );
}
