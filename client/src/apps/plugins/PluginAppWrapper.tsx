// ===== PluginAppWrapper =====
// A single component used as the `component` for every dynamically-installed
// plugin app definition. It reads the pluginKey from `win.appId`, looks up the
// installed plugin in the plugin store, and renders PluginApp. If the plugin
// is no longer installed (uninstalled while a window was open), shows a
// friendly message instead of crashing.

import type { ComponentType } from "react";
import type { WindowInstance } from "../../store/windows";
import { usePlugins } from "../../store/plugins";
import { pluginKeyFromAppId } from "../registry";
import PluginApp from "./PluginApp";

const PluginAppWrapper: ComponentType<{ win: WindowInstance }> = ({ win }) => {
  const plugins = usePlugins((s) => s.plugins);
  const pluginKey = pluginKeyFromAppId(win.appId);
  const plugin = plugins.find((p) => p.pluginKey === pluginKey);

  if (!plugin) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-medium text-ink">Plugin no longer installed</p>
        <p className="text-xs text-ink-muted">
          This plugin was uninstalled. You can close this window.
        </p>
      </div>
    );
  }

  return <PluginApp win={win} plugin={plugin} />;
};

export default PluginAppWrapper;
