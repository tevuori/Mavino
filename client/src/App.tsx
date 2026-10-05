import { useEffect, useState } from "react";
import { useAuth } from "./store/auth";
import { useFeatures } from "./store/features";
import { usePlugins } from "./store/plugins";
import { startNotificationPolling, stopNotificationPolling } from "./store/notifications";
import { useFormFactor, initFormFactorListeners } from "./store/formfactor";
import { useLanguage } from "./store/language";
import { startMaintenancePolling, stopMaintenancePolling, useMaintenance } from "./store/maintenance";
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
import PerformanceMonitorRunner from "./shell/PerformanceMonitorRunner";
import GlobalErrorBoundary from "./shell/GlobalErrorBoundary";
import MaintenanceScreen from "./shell/MaintenanceScreen";
import { useI18n } from "./i18n";

type Phase = "boot" | "app";

export default function App() {
  const { status, user, refresh, logout } = useAuth();
  const maintenance = useMaintenance((s) => s.status);
  const maintenanceLoading = useMaintenance((s) => s.loading);
  const loadFeatures = useFeatures((s) => s.load);
  const loadPlugins = usePlugins((s) => s.load);
  const loadLanguage = useLanguage((s) => s.load);
  const mode = useFormFactor((s) => s.mode);
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("boot");
  const [adminSignIn, setAdminSignIn] = useState(false);

  // On mount, check existing token + set up form-factor listeners + global error handlers
  useEffect(() => {
    refresh();
    startMaintenancePolling();
    cleanupStaleServiceWorkersInDev();
    const cleanup = initFormFactorListeners();
    installGlobalErrorHandlers();
    // Initialize Capacitor native plugins if running inside a native shell.
    void import("./shell/mobile/capacitor").then((m) => m.initCapacitor());
    return () => {
      cleanup();
      stopMaintenancePolling();
    };
  }, [refresh]);

  // Load feature flags (subscription tier, disabled apps) once
  // authenticated so launch surfaces filter correctly. Also load installed
  // plugins so they appear in the taskbar / start menu / desktop.
  useEffect(() => {
    if (status === "authenticated") {
      void loadFeatures();
      void loadPlugins();
      void loadLanguage();
      startNotificationPolling();
    } else {
      stopNotificationPolling();
    }
  }, [status, loadFeatures, loadPlugins, loadLanguage]);

  if (phase === "boot") {
    return <BootScreen onDone={() => setPhase("app")} />;
  }

  if (status === "loading" || maintenanceLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-950 text-slate-400">
        {t("loading")}
      </div>
    );
  }

  if (
    maintenance?.active &&
    user?.role !== "ADMIN" &&
    !(status === "unauthenticated" && adminSignIn)
  ) {
    return (
      <MaintenanceScreen
        status={maintenance}
        authenticated={status === "authenticated"}
        onAdminSignIn={() => {
          if (status === "authenticated") void logout();
          setAdminSignIn(true);
        }}
      />
    );
  }

  // Password reset flow — when the URL has a `token` query param (from a
  // reset email), show the reset screen instead of the login screen.
  const resetToken = new URLSearchParams(window.location.search).get("token");
  if (resetToken && status !== "authenticated") {
    return <ResetPasswordScreen token={resetToken} />;
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
      {/* Performance monitor runner — rendered at the app level so it keeps
          running even when the Settings window is closed. Reads `enabled`
          from the performance store and writes samples back to it. */}
      <PerformanceMonitorRunner />
      {/* Rendered once at the top level. Reads from the useUpdater store and
          is a no-op on web/PWA builds (the store is never populated there). */}
      <UpdateDialog />
      {/* Web/PWA prompt when a new build is deployed. No-op in dev and on native. */}
      <ReloadPrompt />
    </GlobalErrorBoundary>
  );
}
