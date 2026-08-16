import { useEffect, useState } from "react";
import { useAuth } from "./store/auth";
import { useFeatures } from "./store/features";
import { usePlugins } from "./store/plugins";
import { startNotificationPolling, stopNotificationPolling } from "./store/notifications";
import { useFormFactor, initFormFactorListeners } from "./store/formfactor";
import { installGlobalErrorHandlers } from "./services/errorReporter";
import { cleanupStaleServiceWorkersInDev } from "./services/sw-cleanup";
import BootScreen from "./shell/BootScreen";
import LoginScreen from "./shell/LoginScreen";
import ResetPasswordScreen from "./shell/ResetPasswordScreen";
import ForceChangePasswordScreen from "./shell/ForceChangePasswordScreen";
import DesktopEnvironment from "./shell/DesktopEnvironment";
import MobileShell from "./shell/mobile/MobileShell";
import UpdateDialog from "./shell/UpdateDialog";
import ReloadPrompt from "./shell/ReloadPrompt";
import GlobalErrorBoundary from "./shell/GlobalErrorBoundary";

type Phase = "boot" | "app";

export default function App() {
  const { status, user, refresh } = useAuth();
  const loadFeatures = useFeatures((s) => s.load);
  const loadPlugins = usePlugins((s) => s.load);
  const mode = useFormFactor((s) => s.mode);
  const [phase, setPhase] = useState<Phase>("boot");

  // On mount, check existing token + set up form-factor listeners + global error handlers
  useEffect(() => {
    refresh();
    cleanupStaleServiceWorkersInDev();
    const cleanup = initFormFactorListeners();
    installGlobalErrorHandlers();
    // Initialize Capacitor native plugins if running inside a native shell.
    void import("./shell/mobile/capacitor").then((m) => m.initCapacitor());
    return cleanup;
  }, [refresh]);

  // Load feature flags (subscription tier, disabled apps) once
  // authenticated so launch surfaces filter correctly. Also load installed
  // plugins so they appear in the taskbar / start menu / desktop.
  useEffect(() => {
    if (status === "authenticated") {
      void loadFeatures();
      void loadPlugins();
      startNotificationPolling();
    } else {
      stopNotificationPolling();
    }
  }, [status, loadFeatures, loadPlugins]);

  if (phase === "boot") {
    return <BootScreen onDone={() => setPhase("app")} />;
  }

  // Password reset flow — when the URL has a `token` query param (from a
  // reset email), show the reset screen instead of the login screen.
  const resetToken = new URLSearchParams(window.location.search).get("token");
  if (resetToken && status !== "authenticated") {
    return <ResetPasswordScreen token={resetToken} />;
  }

  if (status === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-950 text-slate-400">
        Loading...
      </div>
    );
  }

  if (status !== "authenticated") {
    return <LoginScreen />;
  }

  // If the user's password must be changed (seed/temporary password), force
  // them to set a new one before they can access the desktop.
  if (user?.passwordMustChange) {
    return <ForceChangePasswordScreen />;
  }

  // Phone form factor → mobile shell; everything else → desktop shell.
  // (Tablets in portrait are currently routed to desktop; this can be
  // refined later to use the mobile shell on portrait tablets too.)
  return (
    <GlobalErrorBoundary>
      {mode === "phone" ? <MobileShell /> : <DesktopEnvironment />}
      {/* Rendered once at the top level. Reads from the useUpdater store and
          is a no-op on web/PWA builds (the store is never populated there). */}
      <UpdateDialog />
      {/* Web/PWA prompt when a new build is deployed. No-op in dev and on native. */}
      <ReloadPrompt />
    </GlobalErrorBoundary>
  );
}
