// ===== Mobile Marketplace =====
// Browse the plugin catalog, install/uninstall plugins, and toggle installed
// plugins on/off. Installed plugin *apps* still only render inside the
// desktop window system (PluginAppWrapper) — mobile just manages them.

import { useState, useEffect, useCallback, useMemo } from "react";
import * as Lucide from "lucide-react";
import {
  Download, Trash2, Loader2, Star, Puzzle,
  Wrench, ShieldAlert, Lock, RefreshCw, AlertCircle,
} from "lucide-react";
import { pluginsApi, type PluginCatalogEntry } from "../services/plugins";
import { usePlugins } from "../store/plugins";
import type { MobileTool } from "./MobileLauncher";
import {
  MobileContainer, MobileHeader, MobileEmpty, MobileLoading, MobileCard,
  MobileChip, MobileIconChip, MobileInput, MobileButton, MobileToggle, MobileDesktopNote,
} from "./MobileUi";

type Tab = "browse" | "installed";

export default function MobileMarketplace({
  onClose,
  onOpenTool: _onOpenTool,
}: {
  onClose: () => void;
  onOpenTool: (tool: MobileTool) => void;
}) {
  const [tab, setTab] = useState<Tab>("browse");
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refreshPlugins = usePlugins((s) => s.refresh);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await pluginsApi.getCatalog();
      setCatalog(data.plugins ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load marketplace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categories = useMemo(() => {
    const set = new Set(catalog.map((p) => p.category));
    return ["all", ...Array.from(set).sort()];
  }, [catalog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q)
      );
    });
  }, [catalog, query, category]);

  const installedList = catalog.filter((p) => p.installed);

  const install = async (pluginKey: string) => {
    setBusyKey(pluginKey);
    setErr(null);
    try {
      await pluginsApi.install(pluginKey);
      setCatalog((prev) => prev.map((p) => (p.pluginKey === pluginKey ? { ...p, installed: true } : p)));
      await refreshPlugins();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Install failed");
    } finally {
      setBusyKey(null);
    }
  };

  const uninstall = async (pluginKey: string) => {
    setBusyKey(pluginKey);
    setErr(null);
    try {
      await pluginsApi.uninstall(pluginKey);
      setCatalog((prev) => prev.map((p) => (p.pluginKey === pluginKey ? { ...p, installed: false } : p)));
      await refreshPlugins();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Uninstall failed");
    } finally {
      setBusyKey(null);
    }
  };

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});

  // Installed plugins default to enabled unless we've toggled them locally.
  const isEnabled = (pluginKey: string) => enabledMap[pluginKey] ?? true;

  const setEnabled = async (pluginKey: string, enabled: boolean) => {
    setBusyKey(pluginKey);
    setErr(null);
    setEnabledMap((prev) => ({ ...prev, [pluginKey]: enabled }));
    try {
      await pluginsApi.setEnabled(pluginKey, enabled);
      await refreshPlugins();
    } catch (e) {
      // Revert on failure.
      setEnabledMap((prev) => ({ ...prev, [pluginKey]: !enabled }));
      setErr(e instanceof Error ? e.message : "Failed to update plugin");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <MobileContainer>
      <MobileHeader
        title="Marketplace"
        subtitle="Plugins"
        onClose={onClose}
        right={
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink-muted active:bg-surface-3 disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
        }
      />

      <MobileDesktopNote text="Installed plugin apps currently open on desktop — manage them here on mobile." />

      <div className="mb-4">
        <MobileToggle
          value={tab}
          onChange={setTab}
          options={[
            { value: "browse", label: "Browse" },
            { value: "installed", label: `My plugins (${installedList.length})` },
          ]}
        />
      </div>

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0" /> {err}
        </div>
      )}

      {tab === "browse" ? (
        <>
          <div className="mb-3">
            <MobileInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plugins..."
            />
          </div>
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {categories.map((c) => (
              <MobileChip key={c} active={category === c} onClick={() => setCategory(c)}>
                {c === "all" ? "All" : c}
              </MobileChip>
            ))}
          </div>

          {loading ? (
            <MobileLoading />
          ) : filtered.length === 0 ? (
            <MobileEmpty text="No plugins found. Try a different search or category filter." />
          ) : (
            <div className="space-y-3">
              {filtered.map((p) => (
                <PluginCard
                  key={p.pluginKey}
                  plugin={p}
                  busy={busyKey === p.pluginKey}
                  onInstall={install}
                  onUninstall={uninstall}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {installedList.length === 0 ? (
            <MobileEmpty text="No plugins installed. Switch to Browse to find community-built apps and Athena tools." />
          ) : (
            <div className="space-y-3">
              {installedList.map((p) => (
                <PluginCard
                  key={p.pluginKey}
                  plugin={p}
                  busy={busyKey === p.pluginKey}
                  onInstall={install}
                  onUninstall={uninstall}
                  enabled={isEnabled(p.pluginKey)}
                  onSetEnabled={setEnabled}
                  showEnableToggle
                />
              ))}
            </div>
          )}
        </>
      )}
    </MobileContainer>
  );
}

function PluginCard({
  plugin,
  busy,
  onInstall,
  onUninstall,
  enabled,
  onSetEnabled,
  showEnableToggle = false,
}: {
  plugin: PluginCatalogEntry;
  busy: boolean;
  onInstall: (key: string) => void;
  onUninstall: (key: string) => void;
  enabled?: boolean;
  onSetEnabled?: (key: string, enabled: boolean) => void;
  showEnableToggle?: boolean;
}) {
  const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[plugin.icon] ?? Puzzle;
  const tierLocked = plugin.minTier === "pro";

  return (
    <MobileCard>
      <div className="flex items-start gap-3">
        <MobileIconChip icon={<Icon size={22} />} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h4 className="truncate text-sm font-semibold text-ink">{plugin.name}</h4>
            {plugin.featured && <Star size={12} className="shrink-0 text-amber-500" />}
          </div>
          <p className="text-xs text-ink-muted">
            by {plugin.author || "unknown"} · v{plugin.version}
          </p>
        </div>
      </div>

      <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink-muted">
        {plugin.description || "No description provided."}
      </p>

      {/* Badges */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-ink-muted">
          {plugin.category}
        </span>
        <span className="flex items-center gap-0.5 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-ink-muted">
          <Download size={9} /> {plugin.installCount}
        </span>
        {plugin.hasTools && (
          <span className="flex items-center gap-0.5 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-400">
            <Wrench size={9} /> Athena tools
          </span>
        )}
        {tierLocked && (
          <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
            <Lock size={9} /> Pro
          </span>
        )}
        {plugin.permissions.length > 0 && (
          <span
            className="flex items-center gap-0.5 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-ink-muted"
            title={plugin.permissions.join(", ")}
          >
            <ShieldAlert size={9} /> {plugin.permissions.length} perm{plugin.permissions.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Enable/disable (installed tab only) */}
      {showEnableToggle && onSetEnabled && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-surface-3 px-3 py-2">
          <span className="text-xs font-medium text-ink-muted">{enabled ? "Enabled" : "Disabled"}</span>
          <button
            type="button"
            onClick={() => onSetEnabled(plugin.pluginKey, !enabled)}
            disabled={busy}
            aria-label={enabled ? "Disable plugin" : "Enable plugin"}
            className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
              enabled ? "bg-accent" : "bg-surface"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                enabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      )}

      {/* Action button */}
      <div className="mt-3">
        {plugin.installed ? (
          <MobileButton
            variant="danger"
            onClick={() => onUninstall(plugin.pluginKey)}
            disabled={busy}
            className="w-full"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Uninstall
          </MobileButton>
        ) : (
          <MobileButton
            variant="primary"
            onClick={() => onInstall(plugin.pluginKey)}
            disabled={busy}
            className="w-full"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Install
          </MobileButton>
        )}
      </div>
    </MobileCard>
  );
}
