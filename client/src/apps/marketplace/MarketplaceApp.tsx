// ===== Marketplace app =====
// Browse the plugin catalog, install/uninstall plugins, and manage installed
// plugins. Available to paid/pro users only (free users never see this app —
// it's filtered out by the tier system and the server returns 402).

import { useState, useEffect, useCallback, useMemo } from "react";
import * as Lucide from "lucide-react";
import {
  Store, Search, Download, Trash2, Check, Loader2, Star, Puzzle,
  Wrench, ShieldAlert, Lock, RefreshCw, Filter, CircleCheck, Code2,
} from "lucide-react";
import type { WindowInstance } from "../../store/windows";
import { pluginsApi, type PluginCatalogEntry } from "../../services/plugins";
import { usePlugins } from "../../store/plugins";
import { useFeatures } from "../../store/features";
import { SectionHeader, Card, MsgBox } from "../settings/ui";
import DeveloperGuide from "./DeveloperGuide";

type Tab = "browse" | "installed" | "develop";

export default function MarketplaceApp({ win: _win }: { win: WindowInstance }) {
  const [tab, setTab] = useState<Tab>("browse");
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refreshPlugins = usePlugins((s) => s.refresh);
  const subscriptionTier = useFeatures((s) => s.subscriptionTier);

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
    const q = query.toLowerCase();
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

  const featured = filtered.filter((p) => p.featured);
  const rest = filtered.filter((p) => !p.featured);

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

  const installedList = catalog.filter((p) => p.installed);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="shrink-0 border-b border-edge px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Store size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">Plugin Marketplace</h2>
              <p className="text-xs text-ink-muted">
                Extend Mavino with community-built apps & LLM tools
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent">
              <CircleCheck size={12} />
              {subscriptionTier === "pro" ? "Pro" : "Paid"}
            </span>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
              title="Refresh"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex items-center gap-1">
          <TabButton active={tab === "browse"} onClick={() => setTab("browse")} icon={<Store size={14} />} label="Browse" />
          <TabButton
            active={tab === "installed"}
            onClick={() => setTab("installed")}
            icon={<Puzzle size={14} />}
            label={`Installed (${installedList.length})`}
          />
          <TabButton
            active={tab === "develop"}
            onClick={() => setTab("develop")}
            icon={<Code2 size={14} />}
            label="Develop"
          />
        </div>
      </div>

      {/* Content */}
      {tab === "develop" ? (
        <DeveloperGuide />
      ) : (
      <div className="flex-1 overflow-y-auto p-5">
        {tab === "browse" ? (
          <>
            {/* Search + filter */}
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-lg border border-edge bg-surface-2 px-3 py-2">
                <Search size={15} className="text-ink-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search plugins..."
                  className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
                />
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface-2 px-2.5 py-2">
                <Filter size={14} className="text-ink-muted" />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="bg-transparent text-sm text-ink outline-none"
                >
                  {categories.map((c) => (
                    <option key={c} value={c} className="bg-surface-2">
                      {c === "all" ? "All categories" : c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-ink-muted">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon={<Store size={32} />} title="No plugins found" description="Try a different search or category filter." />
            ) : (
              <>
                {featured.length > 0 && (
                  <>
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      <Star size={12} className="text-amber-500" /> Featured
                    </h3>
                    <div className="mb-5 grid grid-cols-1 gap-3 @lg:grid-cols-2 @2xl:grid-cols-3">
                      {featured.map((p) => (
                        <PluginCard key={p.pluginKey} plugin={p} busy={busyKey === p.pluginKey} onInstall={install} onUninstall={uninstall} />
                      ))}
                    </div>
                  </>
                )}
                {rest.length > 0 && (
                  <>
                    {featured.length > 0 && (
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        All plugins
                      </h3>
                    )}
                    <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @2xl:grid-cols-3">
                      {rest.map((p) => (
                        <PluginCard key={p.pluginKey} plugin={p} busy={busyKey === p.pluginKey} onInstall={install} onUninstall={uninstall} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {installedList.length === 0 ? (
              <EmptyState
                icon={<Puzzle size={32} />}
                title="No plugins installed"
                description="Browse the marketplace to install community-built apps and LLM tools."
                action={
                  <button
                    onClick={() => setTab("browse")}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
                  >
                    Browse marketplace
                  </button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @2xl:grid-cols-3">
                {installedList.map((p) => (
                  <PluginCard key={p.pluginKey} plugin={p} busy={busyKey === p.pluginKey} onInstall={install} onUninstall={uninstall} />
                ))}
              </div>
            )}
          </>
        )}
        <MsgBox msg={err} error />
      </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-accent/15 text-accent" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function PluginCard({
  plugin,
  busy,
  onInstall,
  onUninstall,
}: {
  plugin: PluginCatalogEntry;
  busy: boolean;
  onInstall: (key: string) => void;
  onUninstall: (key: string) => void;
}) {
  const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[plugin.icon] ?? Puzzle;
  const tierLocked = plugin.minTier === "pro"; // pro-only plugins show a badge for paid users

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Icon size={22} />
        </div>
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

      <p className="line-clamp-2 text-xs text-ink-muted">{plugin.description || "No description provided."}</p>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1.5">
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
          <span className="flex items-center gap-0.5 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-ink-muted" title={plugin.permissions.join(", ")}>
            <ShieldAlert size={9} /> {plugin.permissions.length} perm{plugin.permissions.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Action button */}
      <div className="mt-auto">
        {plugin.installed ? (
          <button
            onClick={() => onUninstall(plugin.pluginKey)}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-medium text-red-500 transition hover:bg-red-500/25 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            Uninstall
          </button>
        ) : (
          <button
            onClick={() => onInstall(plugin.pluginKey)}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Install
          </button>
        )}
      </div>
    </Card>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-3 text-ink-muted">{icon}</div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-xs text-ink-muted">{description}</p>
      {action}
    </div>
  );
}
