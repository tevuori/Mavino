// ===== Mobile Atlas (Pro-tier global knowledge graph) =====
// List-based mobile view of the user's Atlas — the force-graph canvas is
// impractical on touch, so mobile shows concepts as a tappable list sorted
// by importance (weak ones pinned to top), with expand-to-reveal linked
// items and "Open in…" buttons that navigate to the respective mobile tool.

import { useState, useEffect, useCallback } from "react";
import {
  Network, RefreshCw, Loader2, AlertCircle,
  StickyNote, Brain, CheckSquare, GraduationCap,
  TrendingDown, TrendingUp, Minus, ChevronDown, Sparkles,
} from "lucide-react";
import { atlasApi, type AtlasState, type AtlasConcept } from "../services/atlas";
import type { MobileTool } from "./MobileLauncher";
import { MobileContainer, MobileHeader, MobileEmpty } from "./MobileUi";

function MasteryPct({ mastery }: { mastery: number }) {
  if (mastery < 0) return null;
  const pct = Math.round(mastery * 100);
  const Icon = pct >= 80 ? TrendingUp : pct >= 60 ? Minus : TrendingDown;
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  return <span className={`flex items-center gap-1 text-xs ${color}`}><Icon size={12} />{pct}%</span>;
}

export default function MobileAtlas({ onClose, onOpenTool }: { onClose: () => void; onOpenTool: (tool: MobileTool) => void }) {
  const [state, setState] = useState<AtlasState | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterWeak, setFilterWeak] = useState(false);

  const poll = useCallback(async () => {
    const id = setInterval(async () => {
      try {
        const s = await atlasApi.get();
        setState(s);
        if (s.status === "ready" || s.status === "error") {
          clearInterval(id);
          setBuilding(false);
          if (s.status === "error") setError(s.error || "Build failed");
        }
      } catch {
        clearInterval(id);
        setBuilding(false);
        setError("Failed to check build status");
      }
    }, 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await atlasApi.get();
      setState(s);
      if (s.status === "building") { setBuilding(true); void poll(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Atlas");
    } finally {
      setLoading(false);
    }
  }, [poll]);

  useEffect(() => { void load(); }, [load]);

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      await atlasApi.build();
      void poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start build");
      setBuilding(false);
    }
  };

  const data = state?.data ?? null;
  const concepts = data ? (filterWeak ? data.concepts.filter((c) => c.weak) : data.concepts) : [];
  const sortedConcepts = [...concepts].sort((a, b) => {
    // Weak first, then by importance.
    if (a.weak !== b.weak) return a.weak ? -1 : 1;
    return b.importance - a.importance;
  });

  return (
    <MobileContainer>
      <MobileHeader
        title="Atlas"
        subtitle="Knowledge map"
        onClose={onClose}
        right={
          <button
            onClick={build}
            disabled={building}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-ink disabled:opacity-50"
          >
            {building ? <Loader2 size={20} className="animate-spin" /> : <RefreshCw size={20} />}
          </button>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {building && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-indigo-500/30 bg-accent/10 px-4 py-3 text-sm text-accent">
          <Sparkles size={16} className="animate-pulse" />
          Building your knowledge graph…
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-ink-muted" />
        </div>
      )}

      {!loading && !data && !building && (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/15">
            <Network size={32} className="text-accent" />
          </div>
          <p className="max-w-xs text-sm leading-6 text-ink-muted">
            Atlas stitches together your Study Hub graphs, notes, flashcards, tasks, and courses into one map — with weak spots highlighted.
          </p>
          <button
            onClick={build}
            className="flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-ink active:scale-[.98]"
          >
            <Sparkles size={16} /> Build my Atlas
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Stats */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
              <p className="text-2xl font-bold text-ink">{data.stats.conceptCount}</p>
              <p className="text-[11px] text-ink-muted">Concepts</p>
            </div>
            <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
              <p className="text-2xl font-bold text-ink">{data.stats.clusterCount}</p>
              <p className="text-[11px] text-ink-muted">Clusters</p>
            </div>
            <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
              <p className={`text-2xl font-bold ${data.stats.weakCount > 0 ? "text-red-400" : "text-ink"}`}>{data.stats.weakCount}</p>
              <p className="text-[11px] text-ink-muted">Weak</p>
            </div>
          </div>

          {data.stats.weakCount > 0 && (
            <button
              onClick={() => setFilterWeak((v) => !v)}
              className={`mb-3 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                filterWeak ? "bg-red-500/20 text-red-300" : "bg-surface-2 text-ink-muted"
              }`}
            >
              <TrendingDown size={15} />
              {filterWeak ? "Showing weak only" : `Show weak only (${data.stats.weakCount})`}
            </button>
          )}

          {sortedConcepts.length === 0 ? (
            <MobileEmpty text={filterWeak ? "No weak concepts found." : "No concepts in your Atlas yet."} />
          ) : (
            <div className="space-y-2">
              {sortedConcepts.map((c) => (
                <ConceptCard
                  key={c.id}
                  concept={c}
                  expanded={expandedId === c.id}
                  onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  onOpenTool={onOpenTool}
                />
              ))}
            </div>
          )}
        </>
      )}
    </MobileContainer>
  );
}

function ConceptCard({
  concept,
  expanded,
  onToggle,
  onOpenTool,
}: {
  concept: AtlasConcept;
  expanded: boolean;
  onToggle: () => void;
  onOpenTool: (tool: MobileTool) => void;
}) {
  const totalLinks = concept.items.notes.length + concept.items.flashcardDecks.length + concept.items.tasks.length + concept.items.courses.length;
  return (
    <div className={`rounded-2xl border bg-surface-2 p-3.5 transition ${concept.weak ? "border-red-500/30" : "border-edge"}`}>
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="min-w-0 flex-1">
          <p className={`font-semibold text-ink ${concept.weak ? "text-red-300" : ""}`}>{concept.label}</p>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-[11px] capitalize text-ink-muted">{concept.type}</span>
            <MasteryPct mastery={concept.mastery} />
            {totalLinks > 0 && <span className="text-[11px] text-ink-muted">{totalLinks} linked</span>}
          </div>
        </div>
        <ChevronDown size={18} className={`shrink-0 text-ink-muted transition ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-edge pt-3">
          {concept.definition && (
            <p className="text-xs leading-5 text-ink-muted">{concept.definition}</p>
          )}
          {totalLinks === 0 ? (
            <p className="text-xs text-ink-muted">No linked items.</p>
          ) : (
            <>
              {concept.items.notes.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Notes</p>
                  {concept.items.notes.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => onOpenTool("notes")}
                      className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-left text-xs text-ink active:bg-surface-3"
                    >
                      <StickyNote size={13} className="shrink-0 text-ink-muted" /> {n.title}
                    </button>
                  ))}
                </div>
              )}
              {concept.items.flashcardDecks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Flashcards</p>
                  {concept.items.flashcardDecks.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onOpenTool("flashcards")}
                      className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-left text-xs text-ink active:bg-surface-3"
                    >
                      <Brain size={13} className="shrink-0 text-ink-muted" /> {d.name}
                    </button>
                  ))}
                </div>
              )}
              {concept.items.tasks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Tasks</p>
                  {concept.items.tasks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onOpenTool("notes")}
                      className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-left text-xs text-ink active:bg-surface-3"
                    >
                      <CheckSquare size={13} className="shrink-0 text-ink-muted" /> {t.title}
                    </button>
                  ))}
                </div>
              )}
              {concept.items.courses.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Courses</p>
                  {concept.items.courses.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => onOpenTool("grades")}
                      className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-left text-xs text-ink active:bg-surface-3"
                    >
                      <GraduationCap size={13} className="shrink-0 text-ink-muted" /> {c.code ? `${c.code} · ${c.name}` : c.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
