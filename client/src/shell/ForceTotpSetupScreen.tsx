import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../services/api";
import { useAuth } from "../store/auth";
import AppLogo from "./AppLogo";

/**
 * Force 2FA setup screen — shown to ADMIN and MANAGER accounts that do not
 * have TOTP 2FA enabled yet. The server enforces the same rule (every API
 * call returns 403 TOTP_SETUP_REQUIRED until setup completes), so this
 * screen is the only thing the user can do besides signing out.
 */
export default function ForceTotpSetupScreen() {
  const { user, logout, refresh } = useAuth();
  const [setupData, setSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    api
      .get<{ secret: string; uri: string }>("/api/auth/2fa/setup")
      .then((data) => {
        if (!cancelled) setSetupData(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to start 2FA setup");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/auth/2fa/verify", { code });
      // /auth/me now reports totpEnabled: true — refresh unlocks the app.
      await refresh();
    } catch (err) {
      setError((err as Error).message || "Invalid verification code");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[15000] flex items-center justify-center">
      <div className="absolute inset-0 bg-scrim/60 backdrop-blur-xl" />
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-edge bg-surface/95 p-8 shadow-window"
      >
        <div className="mb-6 text-center">
          <AppLogo size={56} className="mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-ink">Mavino</h1>
          <p className="text-sm text-ink-muted">Set up two-factor authentication to continue</p>
        </div>

        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning bg-warning-soft px-3 py-2.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-xs text-warning/90">
            Administrator and manager accounts are required to use two-factor
            authentication. Set up an authenticator app before you can use Mavino.
            {user && (
              <>
                <br />
                Signed in as <span className="font-medium">@{user.username}</span>.
              </>
            )}
          </p>
        </div>

        {!setupData ? (
          <div className="flex items-center justify-center py-8">
            {busy ? (
              <Loader2 size={20} className="animate-spin text-ink-muted" />
            ) : (
              <p className="text-xs text-danger">{error ?? "Failed to start 2FA setup."}</p>
            )}
          </div>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <p className="text-xs text-ink">
              1. Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password…):
            </p>
            <div className="flex justify-center rounded-lg bg-white p-4">
              <QRCodeSVG value={setupData.uri} size={180} />
            </div>
            <p className="text-xs text-ink">Or enter this secret manually:</p>
            <code className="block break-all rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-ink-muted">
              {setupData.secret}
            </code>
            <p className="text-xs text-ink">2. Enter the 6-digit code from your app:</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoFocus
              autoComplete="one-time-code"
              className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-center text-lg tracking-[0.5em] text-ink outline-none focus:border-focus"
            />
            {error && (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              Enable 2FA
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => void logout()}
          className="mt-4 w-full text-center text-[11px] text-ink-muted hover:underline"
        >
          Sign out
        </button>
      </motion.div>
    </div>
  );
}
