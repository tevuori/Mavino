import { Suspense } from "react";
import { useWindows } from "../store/windows";
import { APP_MAP, isPluginAppId } from "../apps/registry";
import Window from "./Window";
import LockedAppPreview from "../shell/LockedAppPreview";
import PluginAppWrapper from "../apps/plugins/PluginAppWrapper";

/** Loading fallback shown while a lazy-loaded app chunk is downloading. */
function AppLoader() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-900/50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
    </div>
  );
}

export default function WindowLayer() {
  const windows = useWindows((s) => s.windows);
  const activeWorkspaceId = useWindows((s) => s.activeWorkspaceId);
  const visible = windows.filter((w) => w.workspaceId === activeWorkspaceId);

  return (
    <>
      {visible.map((win) => {
        const isPreview = Boolean(win.payload?.preview);
        // Plugin apps: render via PluginAppWrapper (not in the static APP_MAP).
        if (isPluginAppId(win.appId)) {
          return (
            <Window key={win.id} win={win}>
              <Suspense fallback={<AppLoader />}>
                <PluginAppWrapper win={win} />
              </Suspense>
            </Window>
          );
        }
        const def = APP_MAP[win.appId];
        if (!def) return null;
        return (
          <Window key={win.id} win={win}>
            <Suspense fallback={<AppLoader />}>
              {isPreview ? (
                <LockedAppPreview win={win} />
              ) : (
                <def.component win={win} />
              )}
            </Suspense>
          </Window>
        );
      })}
    </>
  );
}
