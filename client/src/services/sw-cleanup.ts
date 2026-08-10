/**
 * Dev-mode service-worker cleanup.
 *
 * The production PWA service worker can outlive `vite dev` sessions because
 * `vite-plugin-pwa` disables the SW in dev (`devOptions.enabled: false`) but
 * does **not** unregister a previously registered one. That stale SW intercepts
 * requests on `localhost:5173` and returns cached build artefacts, which makes
 * it look like code changes are ignored until a hard reload.
 *
 * This helper unregisters every SW controller at startup when running in Vite
 * dev mode. It is a no-op in production builds.
 */
export function cleanupStaleServiceWorkersInDev(): void {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  if (!import.meta.env.DEV) return;

  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister().then((success) => {
        if (success) {
          console.log("[sw-cleanup] unregistered stale service worker:", registration.scope);
        }
      });
    }
  });
}
