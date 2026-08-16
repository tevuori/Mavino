import { useState, useEffect, useCallback } from "react";
import { Plug, Music, Calendar, Loader2, LogOut, RefreshCw, ExternalLink, Bell, Map as MapIcon } from "lucide-react";
import { spotifyApi, type SpotifyCredentialStatus } from "../../../services/spotify";
import { microsoftApi, type MicrosoftCredentialStatus } from "../../../services/microsoft";
import { ntfyApi } from "../../../services/ntfy";
import { mapyApi } from "../../../services/maps";
import { useWindows } from "../../../store/windows";
import { SectionHeader, Card, Field, StatusPill, SaveButton, MsgBox, inputClass } from "../ui";

export default function IntegrationsSection() {
  return (
    <section id="integrations" className="mb-8">
      <SectionHeader
        icon={<Plug size={18} />}
        title="Integrations"
        description="Connect external services with your own credentials. Each user configures these independently."
      />
      <SpotifyCard />
      <MicrosoftCard />
      <NtfyCard />
      <MapyCard />
    </section>
  );
}

function NtfyCard() {
  const [status, setStatus] = useState<{ configured: boolean; enabled: boolean } | null>(null);
  const openWindow = useWindows((s) => s.open);

  const refresh = useCallback(async () => {
    try {
      const s = await ntfyApi.getStatus();
      setStatus({ configured: s.configured, enabled: s.enabled });
    } catch {
      setStatus({ configured: false, enabled: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Card className="mt-3">
      <IntegrationRow
        icon={<Bell size={18} />}
        name="Ntfy"
        description="Bidirectional push channel — Mavino notifies your phone and you can message Mavino from anywhere. Manage cron jobs in the Ntfy app."
        pill={
          <StatusPill
            on={!!status?.configured}
            onLabel={status?.enabled ? "Connected" : "Disabled"}
            offLabel="Not configured"
          />
        }
        action={
          <button
            onClick={() => openWindow({ appId: "ntfy", title: "Ntfy", icon: "Bell" })}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-ink hover:bg-surface-3"
          >
            <ExternalLink size={12} /> Open Ntfy
          </button>
        }
      />
    </Card>
  );
}

function SpotifyCard() {
  const [status, setStatus] = useState<SpotifyCredentialStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await spotifyApi.getCredentials();
      setStatus(s);
    } catch {
      setStatus({ hasCredentials: false, configured: false, usingEnvFallback: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = async () => {
    if (!clientId.trim() || !clientSecret.trim() || !refreshToken.trim()) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await spotifyApi.setCredentials(clientId.trim(), clientSecret.trim(), refreshToken.trim());
      setClientId(""); setClientSecret(""); setRefreshToken("");
      await refresh();
      setMsg("Spotify credentials saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save credentials");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Remove your stored Spotify credentials?")) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await spotifyApi.deleteCredentials();
      await refresh();
      setMsg("Spotify credentials removed.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const hasCreds = status?.hasCredentials ?? false;
  const configured = status?.configured ?? false;

  return (
    <Card className="mb-3">
      <IntegrationRow
        icon={<Music size={18} />}
        name="Spotify"
        description="Powers the Music Widget & Chill mode. Connect your own Spotify account."
        pill={
          <StatusPill
            on={configured}
            onLabel={hasCreds ? "Connected" : status?.usingEnvFallback ? "Server fallback" : "Connected"}
            offLabel="Not configured"
          />
        }
      />
      {hasCreds ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={disconnect}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-red-500 hover:text-white disabled:opacity-40"
          >
            <LogOut size={14} /> Disconnect
          </button>
          {busy && <Loader2 size={14} className="animate-spin text-ink-muted" />}
          {status?.usingEnvFallback === false && hasCreds && (
            <span className="text-xs text-ink-muted">Using your credentials</span>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Client ID">
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Spotify app Client ID"
                className={inputClass}
              />
            </Field>
            <Field label="Client Secret">
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Spotify app Client Secret"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Refresh Token">
            <input
              type="password"
              value={refreshToken}
              onChange={(e) => setRefreshToken(e.target.value)}
              placeholder="Spotify OAuth refresh token"
              className={inputClass}
            />
          </Field>
          <div className="flex items-center gap-2">
            <SaveButton busy={busy} onClick={connect} disabled={!clientId.trim() || !clientSecret.trim() || !refreshToken.trim()}>
              Connect
            </SaveButton>
            {status?.usingEnvFallback && (
              <span className="text-xs text-ink-muted">Server fallback active — add your own to override</span>
            )}
          </div>
        </div>
      )}
      <MsgBox msg={msg} error={err} />
      <p className="mt-2 text-xs text-ink-muted">
        Create a Spotify app at <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className="underline">developer.spotify.com</a>,
        use the Authorization Code flow with <code className="text-ink">offline_access</code> scope to get a refresh token.
        Credentials are encrypted (AES-256-GCM) and stored only on the server.
      </p>
    </Card>
  );
}

function MicrosoftCard() {
  const [status, setStatus] = useState<MicrosoftCredentialStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("common");
  const [refreshToken, setRefreshToken] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await microsoftApi.getCredentials();
      setStatus(s);
    } catch {
      setStatus({ hasCredentials: false, configured: false, usingEnvFallback: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Detect the OAuth redirect hash (#ms_oauth=success|error&detail=...) that the
  // server's /auth/callback handler appends when redirecting back to the client.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.startsWith("#ms_oauth=")) return;
    const params = new URLSearchParams(hash.slice(1));
    const result = params.get("ms_oauth");
    const detail = params.get("detail");
    if (result === "success") {
      setErr(false);
      setMsg("Microsoft account connected. Click Sync now to pull your calendar.");
      void refresh();
    } else {
      setErr(true);
      setMsg(`Microsoft sign-in failed${detail ? `: ${detail}` : ""}`);
    }
    // Clear the hash so it doesn't persist across reloads.
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [refresh]);

  const signInWithMicrosoft = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      const { authorizeUrl } = await microsoftApi.startOAuth(
        clientId.trim(),
        clientSecret.trim(),
        tenantId.trim() || "common"
      );
      // Open Microsoft consent in a new tab. After consent, Microsoft redirects
      // to /auth/callback on the server, which exchanges the code and redirects
      // back here with #ms_oauth=success|error.
      window.location.href = authorizeUrl;
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to start OAuth flow");
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!clientId.trim() || !clientSecret.trim() || !refreshToken.trim()) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await microsoftApi.setCredentials(
        clientId.trim(),
        clientSecret.trim(),
        refreshToken.trim(),
        tenantId.trim() || "common"
      );
      setClientId(""); setClientSecret(""); setRefreshToken("");
      await refresh();
      setMsg("Microsoft credentials saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save credentials");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Remove your stored Microsoft credentials?")) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await microsoftApi.deleteCredentials();
      await refresh();
      setMsg("Microsoft credentials removed.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      const r = await microsoftApi.sync();
      setMsg(`Synced ${r.synced} event(s), removed ${r.deleted}.`);
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const hasCreds = status?.hasCredentials ?? false;
  const configured = status?.configured ?? false;

  return (
    <Card className="mb-3">
      <IntegrationRow
        icon={<Calendar size={18} />}
        name="Microsoft Calendar"
        description="Two-way sync with Outlook calendars via Graph API. Connect your own Microsoft account."
        pill={
          <StatusPill
            on={configured}
            onLabel={hasCreds ? "Connected" : status?.usingEnvFallback ? "Server fallback" : "Connected"}
            offLabel="Not configured"
          />
        }
      />
      {hasCreds ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={sync}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface-3 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now
          </button>
          <button
            onClick={disconnect}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-red-500 hover:text-white disabled:opacity-40"
          >
            <LogOut size={14} /> Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Client (App) ID">
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Azure AD App ID"
                className={inputClass}
              />
            </Field>
            <Field label="Client Secret">
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Azure AD client secret"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Tenant ID (optional)">
            <input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="common / consumers / <tenant GUID>"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-ink-muted">
              Use <code className="text-ink">common</code> for work/school accounts,
              <code className="text-ink"> consumers</code> for personal Microsoft accounts
              (Outlook.com / Live / Hotmail), or your Azure AD tenant GUID.
            </p>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={signInWithMicrosoft}
              disabled={busy || !clientId.trim() || !clientSecret.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />} Sign in with Microsoft
            </button>
            <button
              onClick={() => setShowManual((v) => !v)}
              className="text-xs text-ink-muted underline hover:text-ink"
            >
              {showManual ? "Hide manual refresh token" : "Already have a refresh token?"}
            </button>
            {status?.usingEnvFallback && (
              <span className="text-xs text-ink-muted">Server fallback active — add your own to override</span>
            )}
          </div>
          {showManual && (
            <div className="space-y-2 rounded-lg border border-edge bg-surface-2 p-2">
              <Field label="Refresh Token (manual)">
                <input
                  type="password"
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  placeholder="OAuth2 refresh token"
                  className={inputClass}
                />
              </Field>
              <SaveButton busy={busy} onClick={connect} disabled={!clientId.trim() || !clientSecret.trim() || !refreshToken.trim()}>
                Save manually
              </SaveButton>
            </div>
          )}
        </div>
      )}
      <MsgBox msg={msg} error={err} />
      <p className="mt-2 text-xs text-ink-muted">
        Register an app in <a href="https://portal.azure.com" target="_blank" rel="noreferrer" className="underline">Azure Portal</a> with
        <code className="text-ink"> Calendars.ReadWrite</code> + <code className="text-ink">offline_access</code> delegated permissions.
        Add <code className="text-ink">https://mavino.net/auth/callback</code> as a Web redirect URI.
        For personal Microsoft accounts (Outlook.com/Live/Hotmail), set "Supported account types"
        to "Personal Microsoft accounts only" and use <code className="text-ink">consumers</code> as the tenant.
        Credentials are encrypted (AES-256-GCM).
      </p>
    </Card>
  );
}

function IntegrationRow({
  icon,
  name,
  description,
  pill,
  action,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  pill: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-muted">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-ink">{name}</p>
          <p className="text-xs text-ink-muted">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {pill}
        {action}
      </div>
    </div>
  );
}

function MapyCard() {
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const openWindow = useWindows((s) => s.open);

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
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await mapyApi.setApiKey(apiKey.trim());
      setApiKey("");
      await refresh();
      setMsg("Mapy.cz API key saved.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save API key");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Remove your stored Mapy.cz API key?")) return;
    setBusy(true);
    setErr(false);
    setMsg(null);
    try {
      await mapyApi.deleteApiKey();
      await refresh();
      setMsg("Mapy.cz API key removed.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-3">
      <IntegrationRow
        icon={<MapIcon size={18} />}
        name="Mapy.cz"
        description="Powers the Maps app & trip planning — geocoding, hiking/bicycle/car routing, POI search (water sources, sleeping spots, landmarks), and elevation. Get a free API key at developer.mapy.com."
        pill={<StatusPill on={configured} onLabel="Connected" offLabel="Not configured" />}
        action={
          configured ? (
            <button
              onClick={() => openWindow({ appId: "maps", title: "Maps", icon: "Map" })}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs text-ink hover:bg-surface-3"
            >
              <ExternalLink size={12} /> Open Maps
            </button>
          ) : undefined
        }
      />
      {configured ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={disconnect}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-red-500 hover:text-white disabled:opacity-40"
          >
            <LogOut size={14} /> Disconnect
          </button>
          {busy && <Loader2 size={14} className="animate-spin text-ink-muted" />}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Field label="API key">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Your mapy.com developer API key"
              className={inputClass}
            />
          </Field>
          <div className="flex items-center gap-2">
            <SaveButton busy={busy} onClick={connect} disabled={!apiKey.trim()}>
              Connect
            </SaveButton>
          </div>
        </div>
      )}
      <MsgBox msg={msg} error={err} />
      <p className="mt-2 text-xs text-ink-muted">
        Create a project + API key at{" "}
        <a href="https://developer.mapy.com/" target="_blank" rel="noreferrer" className="underline">
          developer.mapy.com
        </a>
        . The key is encrypted (AES-256-GCM) and stored only on the server. Free credits are available; once
        exhausted, paid consumption applies (Seznam Wallet). For a personal deploy, enter your own developer key.
      </p>
    </Card>
  );
}
