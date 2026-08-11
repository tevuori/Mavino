/**
 * No-op shim for `virtual:pwa-register/react` used in Capacitor (native)
 * builds, where vite-plugin-pwa is disabled (see vite.config.ts:
 * `!isCapacitorBuild && VitePWA(...)`). Without this shim, Rollup fails to
 * resolve the virtual module during the native build because the PWA plugin
 * never registers it.
 *
 * The real virtual module is only needed for web/PWA builds, where the
 * plugin is active and provides the actual implementation. In native builds
 * ReloadPrompt's runtime `Capacitor.isNativePlatform()` guard returns null
 * before `useRegisterSW` is ever called, so the no-op return value is never
 * observed.
 */
export function useRegisterSW(): {
  needRefresh: [boolean, (v: boolean) => void];
  offlineReady: [boolean, (v: boolean) => void];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  return {
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: () => Promise.resolve(),
  };
}
