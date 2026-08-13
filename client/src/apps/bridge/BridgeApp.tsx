// ===== Concept Bridge app (Pro-tier interdisciplinary connection surfacer) =====
// Displays cross-course concept connections discovered by the LLM from the
// user's Atlas knowledge graph. Each bridge shows two concepts from different
// sources, their relationship type, and an explanation of the connection.
//
// UI: card-based feed of bridges, filterable by relation type and seen/unseen.
// A "Discover" button triggers LLM discovery of new connections.
// Unseen bridges are highlighted with a badge.

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Link2, RefreshCw, Loader2, AlertCircle, X, Sparkles,
  CheckCircle2, Eye, EyeOff, Trash2, Lightbulb, ArrowRight,
  Network, Filter,
} from "lucide-react";
import {
  bridgeApi,
  type ConceptBridge, type BridgeStats,
} from "../../services/bridge";
import type { WindowInstance } from "../../store/windows";

// ----- helpers -----

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

// ----- main component -----

export default function BridgeApp({ win }: { win: WindowInstance }) {
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
      const [res, statsRes] = await Promise.all([
        bridgeApi.list(),
        bridgeApi.getStats(),
      ]);
      setBridges(res.bridges);
      setStats(statsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bridges");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBridges();
  }, [loadBridges]);

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
      setBridges((prev) => prev.map((b) => b.id === id ? { ...b, seen: true } : b));
      setStats((prev) => prev ? { ...prev, unseenBridges: Math.max(0, prev.unseenBridges - 1) } : prev);
    } catch { /* ignore */ }
  };

  const handleMarkAllSeen = async () => {
    try {
      await bridgeApi.markAllSeen();
      setBridges((prev) => prev.map((b) => ({ ...b, seen: true })));
      setStats((prev) => prev ? { ...prev, unseenBridges: 0 } : prev);
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this connection?")) return;
    try {
      await bridgeApi.delete(id);
      setBridges((prev) => prev.filter((b) => b.id !== id));
    } catch { /* ignore */ }
  };

  const filteredBridges = useMemo(() => {
    if (filter === "all") return bridges;
    if (filter === "unseen") return bridges.filter((b) => !b.seen);
    return bridges.filter((b) => b.relation === filter);
  }, [bridges, filter]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="text-red-400" size={32} />
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={() => { setError(null); loadBridges(); }}
          className="rounded-lg bg-surface-3 px-3 py-1.5 text-xs hover:brightness-110"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-3 px-4 py-2">
        <div className="flex items-center gap-2">
          <Link2 className="text-purple-400" size={18} />
          <h2 className="text-sm font-semibold text-ink">Concept Bridge</h2>
          {stats && stats.unseenBridges > 0 && (
            <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300">
              {stats.unseenBridges} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {stats && stats.unseenBridges > 0 && (
            <button
              onClick={handleMarkAllSeen}
              className="flex items-center gap-1 rounded-lg bg-surface-3 px-2 py-1 text-xs hover:brightness-110"
              title="Mark all as seen"
            >
              <CheckCircle2 size={14} /> Mark all seen
            </button>
          )}
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="flex items-center gap-1 rounded-lg bg-purple-600 px-2 py-1 text-xs text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {discovering ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
            Discover
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {stats && stats.totalBridges > 0 && (
        <div className="flex items-center gap-2 border-b border-surface-3 bg-surface-2 px-4 py-2">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-full px-2 py-0.5 text-[10px] ${filter === "all" ? "bg-purple-600 text-white" : "bg-surface-3 text-ink-muted hover:brightness-110"}`}
          >
            All ({stats.totalBridges})
          </button>
          {stats.unseenBridges > 0 && (
            <button
              onClick={() => setFilter("unseen")}
              className={`rounded-full px-2 py-0.5 text-[10px] ${filter === "unseen" ? "bg-purple-600 text-white" : "bg-surface-3 text-ink-muted hover:brightness-110"}`}
            >
              Unseen ({stats.unseenBridges})
            </button>
          )}
          {Object.entries(stats.byRelation).map(([relation, count]) => {
            const meta = relationMeta(relation);
            return (
              <button
                key={relation}
                onClick={() => setFilter(relation)}
                className={`rounded-full px-2 py-0.5 text-[10px] ${filter === relation ? "bg-purple-600 text-white" : "bg-surface-3 text-ink-muted hover:brightness-110"}`}
              >
                {meta.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Bridge cards */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredBridges.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Link2 className="text-ink-muted" size={48} />
            <p className="text-sm text-ink-muted">
              {bridges.length === 0
                ? "No interdisciplinary connections discovered yet."
                : "No bridges match this filter."}
            </p>
            {bridges.length === 0 && (
              <>
                <p className="text-xs text-ink-muted">
                  Build your Atlas knowledge graph, then click Discover to find connections between concepts from different courses.
                </p>
                <button
                  onClick={handleDiscover}
                  disabled={discovering}
                  className="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  {discovering ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                  Discover Connections
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-3">
            {filteredBridges.map((bridge) => {
              const meta = relationMeta(bridge.relation);
              const RelationIcon = meta.icon;
              return (
                <div
                  key={bridge.id}
                  className={`group rounded-xl border bg-surface-2 p-4 transition ${
                    bridge.seen ? "border-surface-3" : "border-purple-500/30"
                  }`}
                >
                  {/* Relation badge */}
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] ${meta.color}`}>
                        <RelationIcon size={10} /> {meta.label}
                      </span>
                      {!bridge.seen && (
                        <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300">New</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(bridge.id)}
                      className="rounded p-1 text-ink-muted opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* Concept pair */}
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex-1 rounded-lg bg-surface-3 p-2 text-center">
                      <p className="text-sm font-medium text-ink">{bridge.conceptALabel}</p>
                      <p className="mt-0.5 text-[10px] text-ink-muted">{bridge.sourceA}</p>
                    </div>
                    <RelationIcon className={`shrink-0 ${meta.color}`} size={20} />
                    <div className="flex-1 rounded-lg bg-surface-3 p-2 text-center">
                      <p className="text-sm font-medium text-ink">{bridge.conceptBLabel}</p>
                      <p className="mt-0.5 text-[10px] text-ink-muted">{bridge.sourceB}</p>
                    </div>
                  </div>

                  {/* Explanation */}
                  <p className="text-sm text-ink-muted">{bridge.explanation}</p>

                  {/* Actions */}
                  {!bridge.seen && (
                    <button
                      onClick={() => handleMarkSeen(bridge.id)}
                      className="mt-3 flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
                    >
                      <Eye size={12} /> Mark as seen
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
