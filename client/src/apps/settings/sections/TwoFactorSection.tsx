import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, Loader2, KeyRound, X } from "lucide-react";
import { api } from "../../../services/api";
import { SectionHeader, Card, inputClass } from "../ui";

/**
 * 2FA (TOTP) settings section — lets the user enable or disable two-factor
 * authentication using an authenticator app (Google Authenticator, Authy, etc).
 */
export default function TwoFactorSection() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  // Setup state
  const [setupData, setSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Disable state
  const [disablePw, setDisablePw] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  const refreshStatus = async () => {
    try {
      const data = await api.get<{ enabled: boolean }>("/api/auth/2fa/status");
      setEnabled(data.enabled);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // One-time fetch of 2FA status on mount — standard data-fetching pattern.
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSetup = async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await api.get<{ secret: string; uri: string }>("/api/auth/2fa/setup");
      setSetupData(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start 2FA setup");
    } finally {
      setBusy(false);
    }
  };

  const verifySetup = async () => {
    if (verifyCode.length !== 6) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/auth/2fa/verify", { code: verifyCode });
      setEnabled(true);
      setSetupData(null);
      setVerifyCode("");
      setMsg("2FA enabled successfully. You'll need a verification code on every login.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = () => {
    setSetupData(null);
    setVerifyCode("");
    setErr(null);
  };

  const doDisable = async () => {
    if (!disablePw) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/auth/2fa/disable", {
        password: disablePw,
        ...(disableCode ? { code: disableCode } : {}),
      });
      setEnabled(false);
      setShowDisable(false);
      setDisablePw("");
      setDisableCode("");
      setMsg("2FA disabled. You can re-enable it at any time.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to disable 2FA");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center py-8">
        <Loader2 size={18} className="animate-spin text-ink-muted" />
      </Card>
    );
  }

  return (
    <>
      <SectionHeader
        icon={<ShieldCheck size={18} />}
        title="Two-Factor Authentication"
        description="Add an extra layer of security with an authenticator app."
      />

      {msg && (
        <div className="mb-3 rounded-lg bg-success-soft px-3 py-2 text-xs text-success">
          {msg}
        </div>
      )}
      {err && (
        <div className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{err}</div>
      )}

      {enabled ? (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success-soft text-success">
              <ShieldCheck size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">2FA is enabled</p>
              <p className="text-xs text-ink-muted">
                You'll need a verification code from your authenticator app on every login.
              </p>
            </div>
            <button
              onClick={() => {
                setShowDisable(true);
                setErr(null);
                setMsg(null);
              }}
              className="rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-3"
            >
              Disable
            </button>
          </div>
        </Card>
      ) : setupData ? (
        <Card className="p-4">
          <p className="mb-3 text-sm text-ink">
            1. Scan this QR code with your authenticator app:
          </p>
          <div className="mb-4 flex justify-center rounded-lg bg-white p-4">
            <QRCodeSVG value={setupData.uri} size={200} />
          </div>
          <p className="mb-2 text-sm text-ink">
            Or enter this secret manually:
          </p>
          <code className="mb-4 block rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted break-all">
            {setupData.secret}
          </code>
          <p className="mb-2 text-sm text-ink">
            2. Enter the 6-digit code from your app:
          </p>
          <div className="flex gap-2">
            <input
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              className={`${inputClass} text-center text-lg tracking-[0.5em]`}
            />
            <button
              onClick={verifySetup}
              disabled={busy || verifyCode.length !== 6}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Enable
            </button>
            <button
              onClick={cancelSetup}
              className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-surface-3"
            >
              <X size={14} /> Cancel
            </button>
          </div>
        </Card>
      ) : (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-3 text-ink-muted">
              <KeyRound size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">2FA is not enabled</p>
              <p className="text-xs text-ink-muted">
                Protect your account with an authenticator app (Google Authenticator, Authy, 1Password, etc).
              </p>
            </div>
            <button
              onClick={startSetup}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Set up
            </button>
          </div>
        </Card>
      )}

      {showDisable && (
        <Card className="mt-3 p-4">
          <p className="mb-3 text-sm font-medium text-ink">Disable 2FA</p>
          <div className="space-y-3">
            <input
              type="password"
              value={disablePw}
              onChange={(e) => setDisablePw(e.target.value)}
              placeholder="Your password"
              className={inputClass}
            />
            <input
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code (optional if lost)"
              inputMode="numeric"
              className={`${inputClass} text-center tracking-[0.3em]`}
            />
            <div className="flex gap-2">
              <button
                onClick={doDisable}
                disabled={busy || !disablePw}
                className="flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-sm text-white hover:bg-danger disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                Disable 2FA
              </button>
              <button
                onClick={() => setShowDisable(false)}
                className="rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-surface-3"
              >
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
