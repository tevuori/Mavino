import { useState } from "react";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";
import { api } from "../services/api";
import AppLogo from "./AppLogo";

/**
 * Reset Password screen — shown when the URL contains a `token` query param
 * (from a password reset email). Lets the user set a new password.
 */
export default function ResetPasswordScreen({ token }: { token: string }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/auth/reset-password", { token, newPassword });
      setDone(true);
    } catch (err) {
      setError((err as Error).message || "Failed to reset password. The link may be expired.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface-1 p-6 shadow-xl">
          <div className="mb-6 text-center">
            <AppLogo size={56} className="mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-ink">Mavino</h1>
          </div>
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 size={40} className="text-success" />
            <p className="text-center text-sm text-ink">
              Your password has been reset successfully.
            </p>
            <p className="text-center text-xs text-ink-muted">
              You can now sign in with your new password.
            </p>
            <button
              onClick={() => {
                window.location.href = window.location.pathname;
              }}
              className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg hover:opacity-90"
            >
              Go to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface-1 p-6 shadow-xl">
        <div className="mb-6 text-center">
          <AppLogo size={56} className="mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-ink">Mavino</h1>
          <p className="text-sm text-ink-muted">Set a new password</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center justify-center py-1">
            <KeyRound size={24} className="text-accent" />
          </div>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            autoFocus
            autoComplete="new-password"
            className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-focus"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-focus"
          />
          {error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy || !newPassword || !confirmPassword}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            Reset password
          </button>
        </form>
      </div>
    </div>
  );
}
