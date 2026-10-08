import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, KeyRound, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "../store/auth";
import AppLogo from "./AppLogo";

/**
 * Force Change Password screen — shown when the authenticated user has
 * `passwordMustChange: true` (set by the seed script for the initial admin).
 * The user cannot access the desktop until they set a new password.
 */
export default function ForceChangePasswordScreen() {
  const { user, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from your current password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      // The auth store clears passwordMustChange — App.tsx will render the desktop.
    } catch (err) {
      setError((err as Error).message || "Failed to change password.");
    } finally {
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
          <p className="text-sm text-ink-muted">Set a new password to continue</p>
        </div>

        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning bg-warning-soft px-3 py-2.5">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-xs text-warning/90">
            Your account is using a temporary or default password. You must set a new
            one before you can use Mavino.
            {user && (
              <>
                <br />
                Signed in as <span className="font-medium">@{user.username}</span>.
              </>
            )}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current (temporary) password"
            autoFocus
            autoComplete="current-password"
            className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-focus"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
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
            disabled={busy || !currentPassword || !newPassword || !confirmPassword}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Set new password
          </button>
        </form>

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
