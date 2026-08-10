import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { LogIn, Loader2, Server, UserPlus, ShieldCheck, Mail, Sparkles } from "lucide-react";
import { useAuth } from "../store/auth";
import { Capacitor } from "@capacitor/core";
import { getBaseUrl, setBaseUrl } from "../services/api";
import { api } from "../services/api";
import AppLogo from "./AppLogo";

export default function LoginScreen() {
  const { login, loginWithTotp, register, tryDemo } = useAuth();
  const isNative = Capacitor.isNativePlatform();
  const [serverUrl, setServerUrl] = useState(getBaseUrl());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Demo state
  const [demoStatus, setDemoStatus] = useState<{ enabled: boolean; configured: boolean } | null>(null);
  const [demoStatusChecked, setDemoStatusChecked] = useState(false);

  // Registration form state
  const [mode, setMode] = useState<"login" | "register" | "totp" | "forgot">("login");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regDisplayName, setRegDisplayName] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationChecked, setRegistrationChecked] = useState(false);

  // TOTP challenge state
  const [totpCode, setTotpCode] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  // Forgot password state
  const [forgotInput, setForgotInput] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  // Check if self-registration is enabled on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ enabled: boolean; bootstrap: boolean }>("/api/auth/registration-status")
      .then((data) => {
        if (cancelled) return;
        setRegistrationOpen(data.enabled);
        // In bootstrap mode (zero users), default to the register form so the
        // first admin can set up their account without clicking through.
        if (data.bootstrap) setMode("register");
      })
      .catch(() => {
        /* server unreachable — stay on login */
      })
      .finally(() => {
        if (!cancelled) setRegistrationChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Check whether the demo flow is enabled and configured.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ enabled: boolean; configured: boolean }>("/api/auth/demo-status")
      .then((data) => {
        if (cancelled) return;
        setDemoStatus(data);
      })
      .catch(() => {
        /* server unreachable or demo unavailable */
      })
      .finally(() => {
        if (!cancelled) setDemoStatusChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // On native, persist the server URL before attempting login so the api
    // client picks it up. Validate it looks like a URL.
    if (isNative) {
      const trimmed = serverUrl.trim().replace(/\/+$/, "");
      if (!trimmed) {
        setError("Please enter the server address (e.g. http://192.168.1.100:3001).");
        return;
      }
      try {
        new URL(trimmed);
      } catch {
        setError("Server address doesn't look like a valid URL.");
        return;
      }
      setBaseUrl(trimmed);
    }

    setBusy(true);
    try {
      await login(username, password, rememberMe);
    } catch (err) {
      const e = err as Error & { totpChallenge?: string };
      if (e.totpChallenge) {
        // 2FA required — switch to TOTP input mode.
        setChallengeToken(e.totpChallenge);
        setMode("totp");
        setError(null);
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setBusy(true);
    try {
      await loginWithTotp(challengeToken, totpCode, rememberMe);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotInput.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/auth/forgot-password", { usernameOrEmail: forgotInput.trim() });
      setForgotSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(regUsername, regPassword, regDisplayName.trim() || undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitDemo = async () => {
    setError(null);
    setBusy(true);
    try {
      await tryDemo();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[15000] flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xl" />
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-edge bg-surface/95 p-8 shadow-window"
      >
        <div className="mb-6 text-center">
          <AppLogo size={56} className="mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-ink">Mavino</h1>
          <p className="text-sm text-ink-muted">
            {mode === "login"
              ? "Sign in to your Student OS"
              : mode === "register"
              ? "Create your Student OS account"
              : mode === "totp"
              ? "Enter your verification code"
              : "Reset your password"}
          </p>
          {mode === "login" && (
            <p className="mt-1 text-[11px] text-ink-muted/70">Made by students, for students</p>
          )}
        </div>

        {mode === "forgot" ? (
          <form onSubmit={submitForgot} className="space-y-3">
            {forgotSent ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center py-2">
                  <Mail size={28} className="text-accent" />
                </div>
                <p className="text-center text-sm text-ink">
                  If an account with that username or email exists, a reset link has been sent.
                </p>
                <p className="text-center text-xs text-ink-muted">
                  Check your inbox (and spam folder). The link expires in 1 hour.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setForgotSent(false);
                    setForgotInput("");
                    setError(null);
                  }}
                  className="w-full text-center text-[11px] text-ink-muted hover:underline"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                <p className="text-center text-xs text-ink-muted">
                  Enter your username or email to receive a reset link.
                </p>
                <input
                  value={forgotInput}
                  onChange={(e) => setForgotInput(e.target.value)}
                  placeholder="Username or email"
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                />
                {error && (
                  <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={busy || !forgotInput.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                  Send reset link
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                  className="w-full text-center text-[11px] text-ink-muted hover:underline"
                >
                  Back to sign in
                </button>
              </>
            )}
          </form>
        ) : mode === "totp" ? (
          <form onSubmit={submitTotp} className="space-y-3">
            <div className="flex items-center justify-center py-2">
              <ShieldCheck size={28} className="text-accent" />
            </div>
            <p className="text-center text-xs text-ink-muted">
              Enter the 6-digit code from your authenticator app.
            </p>
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              autoFocus
              inputMode="numeric"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-center text-lg tracking-[0.5em] text-ink outline-none focus:border-accent"
            />
            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy || totpCode.length !== 6}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              Verify
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setChallengeToken(null);
                setTotpCode("");
                setError(null);
              }}
              className="w-full text-center text-[11px] text-ink-muted hover:underline"
            >
              Back to sign in
            </button>
          </form>
        ) : mode === "login" ? (
          <form onSubmit={submit} className="space-y-3">
            {isNative && (
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-muted">
                  <Server size={11} /> Server address
                </label>
                <input
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.100:3001"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                />
                <p className="text-[11px] text-ink-muted">
                  The address of your Mavino server (including port).
                </p>
              </div>
            )}

            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoFocus={!isNative}
              className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />

            <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-ink-muted select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-edge accent-[var(--accent)]"
              />
              Remember this device (stay signed in for 90 days)
            </label>

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
              Sign in
            </button>

            {demoStatusChecked && demoStatus?.enabled && demoStatus?.configured && (
              <button
                type="button"
                onClick={submitDemo}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent bg-accent/10 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Try Demo
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setMode("forgot");
                setError(null);
                setForgotSent(false);
              }}
              className="w-full text-center text-[11px] text-ink-muted hover:underline"
            >
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={submitRegister} className="space-y-3">
            <input
              value={regUsername}
              onChange={(e) => setRegUsername(e.target.value)}
              placeholder="Username (2-32 characters)"
              autoFocus={!isNative}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
            <input
              type="password"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              placeholder="Password (min 4 characters)"
              className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />
            <input
              value={regDisplayName}
              onChange={(e) => setRegDisplayName(e.target.value)}
              placeholder="Display name (optional)"
              className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
            />

            {error && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy || !regUsername.trim() || !regPassword}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              Create account
            </button>
          </form>
        )}

        {/* Toggle between login and register */}
        {registrationChecked && registrationOpen && (
          <p className="mt-4 text-center text-[11px] text-ink-muted">
            {mode === "login" ? (
              <>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setError(null);
                  }}
                  className="font-medium text-accent hover:underline"
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                  className="font-medium text-accent hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        )}
        {registrationChecked && !registrationOpen && mode === "login" && (
          <p className="mt-4 text-center text-[11px] text-ink-muted">
            Don't have an account? Ask your administrator.
          </p>
        )}
      </motion.div>
    </div>
  );
}
