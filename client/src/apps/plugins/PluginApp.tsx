// ===== Plugin runtime =====
// Loads a plugin's remote ES module (via dynamic import) and renders its
// default-exported React component inside an error boundary. The plugin
// receives a `win` prop (the WindowInstance) plus a `plugin` context with the
// pluginKey and permissions.
//
// Security note: plugins are admin-curated (published via the marketplace
// admin panel). The entry module is loaded via dynamic import, which means it
// executes in the same origin. Only publish plugins from trusted sources.
//
// The plugin module format:
//   export default function MyPlugin({ win, plugin }) {
//     return <div>Hello from {plugin.name}!</div>;
//   }

import { Suspense, lazy, Component, type ComponentType, type ReactNode } from "react";
import type { WindowInstance } from "../../store/windows";
import type { InstalledPlugin } from "../../services/plugins";

/** Context passed to every plugin component. */
export interface PluginContext {
  pluginKey: string;
  name: string;
  version: string;
  permissions: string[];
}

interface PluginAppProps {
  win: WindowInstance;
  plugin: InstalledPlugin;
}

/** Cache of lazy-loaded plugin modules, keyed by entryUrl. */
const moduleCache = new Map<string, React.LazyExoticComponent<ComponentType<{ win: WindowInstance; plugin: PluginContext }>>>();

/** Load a plugin's entry module as a lazy React component (cached by URL). */
function loadPluginModule(entryUrl: string): React.LazyExoticComponent<ComponentType<{ win: WindowInstance; plugin: PluginContext }>> {
  const cached = moduleCache.get(entryUrl);
  if (cached) return cached;
  const Comp = lazy(async () => {
    const mod = await import(/* @vite-ignore */ entryUrl);
    if (!mod?.default) throw new Error("Plugin module has no default export");
    return { default: mod.default as ComponentType<{ win: WindowInstance; plugin: PluginContext }> };
  });
  moduleCache.set(entryUrl, Comp);
  return Comp;
}

/** Error boundary — catches render/import errors from the plugin. */
class PluginErrorBoundary extends Component<
  { children: ReactNode; pluginName: string; onRetry: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(`[plugin:${this.props.pluginName}] render error:`, error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-500">
            <span className="text-xl">!</span>
          </div>
          <h3 className="text-sm font-semibold text-ink">Plugin failed to load</h3>
          <p className="max-w-sm text-xs text-ink-muted">
            {this.props.pluginName} encountered an error: {this.state.error.message}
          </p>
          <button
            onClick={() => {
              this.setState({ error: null });
              this.props.onRetry();
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PluginLoader() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-900/50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
    </div>
  );
}

/** Renders a plugin app. The pluginKey is extracted from the window's appId. */
export default function PluginApp({ win, plugin }: PluginAppProps) {
  const entryUrl = plugin.entryUrl;
  const Comp = loadPluginModule(entryUrl);
  const ctx: PluginContext = {
    pluginKey: plugin.pluginKey,
    name: plugin.name,
    version: plugin.version,
    permissions: plugin.permissions,
  };
  return (
    <PluginErrorBoundary pluginName={plugin.name} onRetry={() => moduleCache.delete(entryUrl)}>
      <Suspense fallback={<PluginLoader />}>
        <Comp win={win} plugin={ctx} />
      </Suspense>
    </PluginErrorBoundary>
  );
}
