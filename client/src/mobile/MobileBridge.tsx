// ===== Mobile Concept Bridge (Pro-tier interdisciplinary connections) =====
// Mobile-optimized card feed of cross-course concept connections discovered
// from the user's Atlas. Filterable by relation type / unseen, with a
// "Discover" action that triggers LLM discovery of new connections.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Link2, Loader2, AlertCircle, Sparkles,
  Trash2, Lightbulb, ArrowRight, Network, Filter, CheckCircle2,
} from "lucide-react";
import { bridgeApi, type ConceptBridge, type BridgeStats } from "../services/bridge";
import { MobileContainer, MobileHeader, MobileEmpty, MobileChip } from "./MobileUi";

const RELATION_META: Record<string, { label: string; color: string; icon: typeof Link2 }> = {
  prerequisite: { label: "Prerequisite", color: "text-blue-400", icon: ArrowRight },
  shared_application: { label: "Shared Application", color: "text-emerald-400", icon: Link2 },
  analogy: { label: "Analogy", color: "text-amber-400", icon: Lightbulb },
  contrasts: { label: "Contrasts", color: "text-red-400", icon: Filter },
  generalizes: { label: "Generalizes", color: "text-purple-400", icon: Network },
};

function relationMeta(relation: string) {
  return RELATION_META[relation] ?? { label: relation, color: "text-ink-muted", icon: Link2 };
}

export default function MobileBridge({ onClose }: { onClose: () => void }) {
  const [bridges, setBridges] = useState<ConceptBridge[]>([]);
  const [stats, setStats] = useState<BridgeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [filter, setFilter] = useState<"all" | "unseen" | string>("all");

  const loadBridges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, statsRes] = await Promise.all([bridgeApi.list(), bridgeApi.getStats()]);
      setBridges(res.bridges);
      setStats(statsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bridges");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadBridges(); }, [loadBridges]);

  const handleDiscover = async () => {
    setDiscovering(true);
    setError(null);
    try {
      await bridgeApi.discover();
      await loadBridges();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  const handleMarkSeen = async (id: string) => {
    try {
      await bridgeApi.markSeen(id);
      setBridges((prev) => prev.map((b) => (b.id === id ? { ...b, seen: true } : b)));
      setStats((prev) => (prev ? { ...prev, unseenBridges: Math.max(0, prev.unseenBridges - 1) } : prev));
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this connection?")) return;
    try {
      await bridgeApi.delete(id);
      setBridges((prev) => prev.filter((b) => b.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const relations = useMemo(() => Object.keys(stats?.byRelation ?? {}), [stats]);
  const filtered = useMemo(() => {
    if (filter === "all") return bridges;
    if (filter === "unseen") return bridges.filter((b) => !b.seen);
    return bridges.filter((b) => b.relation === filter);
  }, [bridges, filter]);

  return (
    <MobileContainer>
      <MobileHeader
        title="Bridge"
        subtitle="Concept connections"
        onClose={onClose}
        right={
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-fg disabled:opacity-50"
          >
            {discovering ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {discovering && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-indigo-500/30 bg-accent/10 px-4 py-3 text-sm text-accent">
          <Sparkles size={16} className="animate-pulse" /> Discovering new connections…
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-ink-muted" />
        </div>
      ) : bridges.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/15">
            <Link2 size={32} className="text-accent" />
          </div>
          <p className="max-w-xs text-sm leading-6 text-ink-muted">
            Bridge finds surprising links between concepts across your different courses and sources — powered by your Atlas.
          </p>
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-fg active:scale-[.98]"
          >
            <Sparkles size={16} /> Discover connections
          </button>
        </div>
      ) : (
        <>
          {stats && (
            <div className="mb-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
                <p className="text-2xl font-bold text-ink">{stats.totalBridges}</p>
                <p className="text-[11px] text-ink-muted">Total</p>
              </div>
              <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
                <p className={`text-2xl font-bold ${stats.unseenBridges > 0 ? "text-accent" : "text-ink"}`}>{stats.unseenBridges}</p>
                <p className="text-[11px] text-ink-muted">Unseen</p>
              </div>
            </div>
          )}

          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            <MobileChip active={filter === "all"} onClick={() => setFilter("all")}>All</MobileChip>
            <MobileChip active={filter === "unseen"} onClick={() => setFilter("unseen")}>Unseen</MobileChip>
            {relations.map((r) => (
              <MobileChip key={r} active={filter === r} onClick={() => setFilter(r)}>{relationMeta(r).label}</MobileChip>
            ))}
          </div>

          {filtered.length === 0 ? (
            <MobileEmpty text="No connections match this filter." />
          ) : (
            <div className="space-y-2.5">
              {filtered.map((b) => {
                const meta = relationMeta(b.relation);
                const Icon = meta.icon;
                return (
                  <div
                    key={b.id}
                    className={`rounded-2xl border p-4 ${b.seen ? "border-edge bg-surface-2" : "border-accent/30 bg-accent/[0.06]"}`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${meta.color}`}>
                        <Icon size={13} /> {meta.label}
                      </span>
                      {!b.seen && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      <span>{b.conceptALabel}</span>
                      <ArrowRight size={14} className="text-ink-muted" />
                      <span>{b.conceptBLabel}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-ink-muted">{b.explanation}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
                      <span>{b.sourceA}</span>
                      <span>·</span>
                      <span>{b.sourceB}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      {!b.seen && (
                        <button
                          onClick={() => handleMarkSeen(b.id)}
                          className="flex items-center gap-1.5 rounded-xl bg-surface-3 px-3 py-2 text-xs font-medium text-ink active:bg-surface-2"
                        >
                          <CheckCircle2 size={13} /> Mark seen
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(b.id)}
                        className="ml-auto flex h-8 w-8 items-center justify-center rounded-xl text-ink-muted active:text-red-400"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </MobileContainer>
  );
}
