// ===== Study Hub: Knowledge Graph =====
// Build (or reuse the cached) concept graph for a set of sources and
// visualize it as an interactive node-link diagram. Concepts, facts, and
// relationships are all cited back to source material. Action buttons
// launch Flashcards/Quiz/Summarize/Explain/Study Guide seeded from this
// same graph instead of re-resolving and re-analyzing raw source text.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ForceGraph2D, { type NodeObject, type LinkObject, type ForceGraphMethods } from "react-force-graph-2d";
import {
  Network, RefreshCw, Trash2, Plus, Brain, HelpCircle, FileText,
  Lightbulb, BookOpen, History, X, Maximize2, Quote,
} from "lucide-react";
import { studyGraphApi, type ConceptGraphData, type ConceptGraphSummary, type ConceptNode } from "../../services/study-graph";
import { studySourceToDescriptor } from "./WorkspaceSourceSelector";
import { studySourcesApi } from "../../services/study-sources";
import type { SourceDescriptor, StudyLanguage } from "../../services/study";
import WorkspaceSourceSelector from "./WorkspaceSourceSelector";
import { ActionButton, ErrorBanner, Loading, PreselectedSource } from "./ui";

const TYPE_COLORS: Record<string, string> = {
  concept: "#818cf8",
  term: "#38bdf8",
  person: "#fbbf24",
  event: "#f472b6",
  formula: "#34d399",
  process: "#c084fc",
  date: "#a3e635",
  other: "#94a3b8",
};

const TYPE_LABELS: Record<string, string> = {
  concept: "Concept",
  term: "Term",
  person: "Person",
  event: "Event",
  formula: "Formula",
  process: "Process",
  date: "Date",
  other: "Other",
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.other;
}

/** Hex color -> "r, g, b" for building rgba() strings at arbitrary alpha. */
function hexToRgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return "148, 163, 184";
  return [1, 2, 3].map((i) => parseInt(m[i], 16)).join(", ");
}

/**
 * Track a container's size so the force graph canvas fills it responsively.
 * Uses a callback ref (not a plain ref + effect with `[]` deps) because the
 * container is conditionally rendered (only once the graph has loaded) — a
 * plain ref's mount effect would run once with `ref.current === null` and
 * never re-attach the observer once the element actually appears.
 */
function useContainerSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);
  const setRef = useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    observerRef.current = observer;
    // ResizeObserver doesn't fire synchronously — seed the initial size too.
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
  }, []);
  return { ref: setRef, size };
}

/** Ticking elapsed-seconds counter, active only while `running` is true. */
function useElapsedSeconds(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, [running]);
  return elapsed;
}

/**
 * Indeterminate progress feedback for the concept-graph extraction LLM call,
 * which can take anywhere from a few seconds to a couple of minutes
 * depending on source size and model speed. There's no real server-side
 * progress to report (it's a single LLM call), so this shows an animated
 * bar plus a ticking elapsed-time readout so it's clear work is happening.
 */
function BuildProgress({ elapsed, label }: { elapsed: number; label: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-edge bg-surface-2 p-3 text-xs text-ink-muted">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="tabular-nums">{elapsed}s</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full w-1/3 animate-progress-slide rounded-full bg-accent" />
      </div>
      {elapsed > 20 && (
        <span>Larger sources can take a minute or two — extracting concepts and relationships in a single pass.</span>
      )}
    </div>
  );
}

interface Props {
  initialGraphId?: string | null;
  language?: StudyLanguage;
  onOpenMode: (mode: string, opts?: { graphId?: string }) => void;
}

export default function KnowledgeGraph({ initialGraphId, language, onOpenMode }: Props) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [pinnedSource, setPinnedSource] = useState<SourceDescriptor | null>(null);
  const [recent, setRecent] = useState<ConceptGraphSummary[]>([]);
  const [graphId, setGraphId] = useState<string | null>(initialGraphId ?? null);
  const [name, setName] = useState<string>("");
  const [data, setData] = useState<ConceptGraphData | null>(null);
  const [selectedConcept, setSelectedConcept] = useState<ConceptNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showPicker, setShowPicker] = useState(!initialGraphId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { ref: canvasWrapRef, size } = useContainerSize<HTMLDivElement>();
  const buildElapsed = useElapsedSeconds(building || refreshing);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop polling on unmount so a background build doesn't keep ticking
  // against an unmounted component.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadRecent = useCallback(() => {
    studyGraphApi.list().then((r) => setRecent(r.graphs)).catch(() => {});
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  /**
   * Poll a graph's status every 2.5s until it's ready or errors. The
   * build/refresh POSTs return almost instantly ("building") — the actual
   * LLM extraction happens server-side in the background and can take up to
   * a couple of minutes, so we can't just await one long request (that's
   * exactly what triggered the Cloudflare 524 timeout).
   */
  const pollGraph = useCallback((id: string, onDone: () => void) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      studyGraphApi
        .get(id)
        .then((g) => {
          if (g.status === "building") return;
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          onDone();
          if (g.status === "ready" && g.data) {
            setGraphId(g.graphId);
            setName(g.name);
            setData(g.data);
            loadRecent();
          } else if (g.status === "error") {
            setError(g.error || "Failed to build knowledge graph");
          }
        })
        .catch((e) => {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          onDone();
          setError(e instanceof Error ? e.message : "Failed to check graph status");
        });
    }, 2500);
  }, [loadRecent]);

  const loadGraph = useCallback((id: string) => {
    setLoading(true);
    setError("");
    studyGraphApi
      .get(id)
      .then((g) => {
        setGraphId(g.graphId);
        setName(g.name);
        setSelectedConcept(null);
        setShowPicker(false);
        if (g.status === "ready" && g.data) {
          setData(g.data);
          setLoading(false);
        } else if (g.status === "error") {
          setError(g.error || "Failed to build knowledge graph");
          setLoading(false);
        } else {
          // Deep-linked to a graph that's still building — show progress and poll.
          setLoading(false);
          setBuilding(true);
          pollGraph(id, () => setBuilding(false));
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load graph");
        setLoading(false);
      });
  }, [pollGraph]);

  useEffect(() => {
    if (initialGraphId) loadGraph(initialGraphId);
  }, [initialGraphId, loadGraph]);

  const getSources = async (): Promise<SourceDescriptor[]> => {
    if (pinnedSource) return [pinnedSource];
    const { sources: lib } = await studySourcesApi.list();
    return [...selectedSourceIds]
      .map((id) => {
        const s = lib.find((x) => x.id === id);
        return s ? studySourceToDescriptor(s) : null;
      })
      .filter((x): x is SourceDescriptor => x !== null);
  };

  const hasSource = pinnedSource !== null || selectedSourceIds.size > 0;

  const build = async () => {
    if (!hasSource) return;
    setBuilding(true);
    setError("");
    try {
      const sources = await getSources();
      const res = await studyGraphApi.build({ sources, language });
      if (res.status === "ready" && res.data) {
        setGraphId(res.graphId);
        setName(res.name);
        setData(res.data);
        setSelectedConcept(null);
        setShowPicker(false);
        loadRecent();
        setBuilding(false);
      } else {
        // Still building on the server — keep the progress UI up and poll.
        setSelectedConcept(null);
        setShowPicker(false);
        pollGraph(res.graphId, () => setBuilding(false));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build knowledge graph");
      setBuilding(false);
    }
  };

  const refresh = async () => {
    if (!graphId) return;
    setRefreshing(true);
    setError("");
    try {
      const res = await studyGraphApi.refresh(graphId, language);
      if (res.status === "ready" && res.data) {
        setData(res.data);
        setName(res.name);
        setSelectedConcept(null);
        loadRecent();
        setRefreshing(false);
      } else {
        setSelectedConcept(null);
        pollGraph(res.graphId, () => setRefreshing(false));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh knowledge graph");
      setRefreshing(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await studyGraphApi.remove(id);
      setRecent((prev) => prev.filter((g) => g.id !== id));
      if (graphId === id) {
        setGraphId(null);
        setData(null);
        setName("");
        setShowPicker(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete graph");
    }
  };

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    return {
      nodes: data.concepts.map((c) => ({ id: c.id, label: c.label, type: c.type, importance: c.importance })),
      links: data.relationships.map((r) => ({ source: r.from, target: r.to, relation: r.relation })),
    };
  }, [data]);

  const conceptById = useMemo(() => {
    const map = new Map<string, ConceptNode>();
    data?.concepts.forEach((c) => map.set(c.id, c));
    return map;
  }, [data]);

  // Neighbor lookup for hover/select focus — dims unrelated nodes & links.
  const neighborsOf = useMemo(() => {
    const map = new Map<string, Set<string>>();
    data?.concepts.forEach((c) => map.set(c.id, new Set([c.id])));
    data?.relationships.forEach((r) => {
      map.get(r.from)?.add(r.to);
      map.get(r.to)?.add(r.from);
    });
    return map;
  }, [data]);

  const focusId = hoveredId ?? selectedConcept?.id ?? null;
  const focusSet = focusId ? neighborsOf.get(focusId) ?? null : null;

  // Nicely frame the whole graph once it (re)loads.
  useEffect(() => {
    if (!data) return;
    const id = setTimeout(() => fgRef.current?.zoomToFit(600, 48), 300);
    return () => clearTimeout(id);
  }, [data]);

  const presentTypes = useMemo(() => {
    const set = new Set<string>();
    data?.concepts.forEach((c) => set.add(c.type));
    return [...set];
  }, [data]);

  const actions: { mode: string; label: string; icon: typeof Brain }[] = [
    { mode: "flashcards", label: "Flashcards", icon: Brain },
    { mode: "quiz", label: "Quiz", icon: HelpCircle },
    { mode: "summarize", label: "Summarize", icon: FileText },
    { mode: "explain", label: "Explain", icon: Lightbulb },
    { mode: "study_guide", label: "Study Guide", icon: BookOpen },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-accent" />
          <span className="text-sm font-semibold text-ink">{name || "Knowledge Graph"}</span>
          {data && (
            <span className="text-[11px] text-ink-muted">
              {data.concepts.length} concepts · {data.relationships.length} relationships
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {data && (
            <ActionButton onClick={() => fgRef.current?.zoomToFit(500, 48)} variant="ghost">
              <Maximize2 size={13} /> Fit
            </ActionButton>
          )}
          <ActionButton onClick={() => setShowPicker((v) => !v)} variant="ghost">
            <Plus size={13} /> New / recent
          </ActionButton>
          {graphId && (
            <ActionButton onClick={refresh} loading={refreshing} variant="ghost">
              <RefreshCw size={13} /> Refresh
            </ActionButton>
          )}
        </div>
      </div>

      {showPicker && (
        <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface-2 p-3">
          {recent.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                <History size={10} className="mr-1 inline" /> Recent graphs
              </span>
              {recent.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-2 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-xs"
                >
                  <button onClick={() => loadGraph(g.id)} className="flex-1 truncate text-left text-ink hover:text-accent">
                    {g.name}
                  </button>
                  <span className="shrink-0 text-[10px] text-ink-muted">
                    {g.conceptCount} concepts
                  </span>
                  <button
                    onClick={() => void remove(g.id)}
                    className="shrink-0 rounded p-1 text-ink-muted hover:bg-red-500/10 hover:text-red-400"
                    title="Delete graph"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Build a new graph</span>
          {pinnedSource ? (
            <PreselectedSource source={pinnedSource} onDismiss={() => setPinnedSource(null)} />
          ) : (
            <WorkspaceSourceSelector selectedIds={selectedSourceIds} onToggle={toggleSource} disabled={building} />
          )}
          <div className="flex justify-end">
            <ActionButton onClick={build} disabled={!hasSource} loading={building}>
              <Network size={13} /> Build graph
            </ActionButton>
          </div>
        </div>
      )}

      {loading && !data && <Loading label="Loading graph…" />}
      {(building || refreshing) && (
        <BuildProgress elapsed={buildElapsed} label={building ? "Building knowledge graph…" : "Refreshing knowledge graph…"} />
      )}
      {error && <ErrorBanner message={error} />}

      {data && (
        <div className="flex min-h-0 flex-1 gap-3">
          <div
            ref={canvasWrapRef}
            className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-edge bg-surface-2"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 15%, rgb(var(--accent) / 0.10), transparent 45%), radial-gradient(circle at 85% 80%, rgb(var(--accent) / 0.06), transparent 40%), radial-gradient(rgb(var(--ink-muted) / 0.18) 1px, transparent 1px)",
              backgroundSize: "auto, auto, 22px 22px",
            }}
          >
            {size.width > 0 && (
              <ForceGraph2D
                ref={fgRef as any}
                graphData={graphData as any}
                width={size.width}
                height={size.height}
                nodeId="id"
                nodeRelSize={4}
                nodeLabel={() => ""}
                nodeVal={(n: NodeObject) => (n as any).importance}
                linkLabel={(l: LinkObject) => (l as any).relation}
                linkColor={(l: any) => {
                  const dim = focusSet && !(focusSet.has(l.source?.id ?? l.source) && focusSet.has(l.target?.id ?? l.target));
                  return dim ? "rgba(148, 163, 184, 0.12)" : "rgba(148, 163, 184, 0.55)";
                }}
                linkWidth={(l: any) => {
                  const active = focusSet && focusSet.has(l.source?.id ?? l.source) && focusSet.has(l.target?.id ?? l.target);
                  return active ? 1.6 : 0.8;
                }}
                linkDirectionalArrowLength={5}
                linkDirectionalArrowRelPos={1}
                linkDirectionalArrowColor={() => "rgba(148, 163, 184, 0.55)"}
                linkDirectionalParticles={(l: any) => {
                  const active = focusSet && focusSet.has(l.source?.id ?? l.source) && focusSet.has(l.target?.id ?? l.target);
                  return active ? 3 : 0;
                }}
                linkDirectionalParticleWidth={2.2}
                linkDirectionalParticleSpeed={0.006}
                linkDirectionalParticleColor={() => "rgb(var(--accent))"}
                linkCurvature={0.15}
                onNodeClick={(n: NodeObject) => {
                  setSelectedConcept(conceptById.get(String((n as any).id)) ?? null);
                  const x = (n as any).x, y = (n as any).y;
                  if (typeof x === "number" && typeof y === "number") fgRef.current?.centerAt(x, y, 500);
                }}
                onNodeHover={(n: NodeObject | null) => setHoveredId(n ? String((n as any).id) : null)}
                onBackgroundClick={() => setSelectedConcept(null)}
                cooldownTime={4000}
                backgroundColor="rgba(0,0,0,0)"
                nodeCanvasObject={(node: any, ctx, globalScale) => {
                  // Positions aren't assigned yet on the very first simulation
                  // ticks — bail out rather than pass NaN to canvas APIs.
                  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
                  const isFocused = focusId === node.id;
                  const isSelected = selectedConcept?.id === node.id;
                  const dimmed = focusSet ? !focusSet.has(node.id) : false;
                  const color = typeColor(node.type);
                  const rgb = hexToRgb(color);
                  const r = 4 + Math.sqrt(Math.max(1, node.importance ?? 3)) * 3.2;
                  const alpha = dimmed ? 0.28 : 1;

                  // Soft outer glow for a "constellation" feel.
                  if (!dimmed) {
                    const glow = ctx.createRadialGradient(node.x, node.y, r * 0.4, node.x, node.y, r * 3.2);
                    glow.addColorStop(0, `rgba(${rgb}, ${isFocused ? 0.55 : 0.3})`);
                    glow.addColorStop(1, `rgba(${rgb}, 0)`);
                    ctx.fillStyle = glow;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r * 3.2, 0, 2 * Math.PI);
                    ctx.fill();
                  }

                  // Node body.
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                  ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
                  ctx.fill();

                  // Selection / hover ring.
                  if (isSelected || (isFocused && !selectedConcept)) {
                    ctx.lineWidth = 1.6 / globalScale;
                    ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.95)" : `rgba(${rgb}, 0.9)`;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r + 2.5 / globalScale, 0, 2 * Math.PI);
                    ctx.stroke();
                  }

                  // Labels: always for important/focused/selected nodes, otherwise
                  // only once zoomed in enough to avoid clutter on dense graphs.
                  const showLabel = !dimmed && (isFocused || isSelected || node.importance >= 4 || globalScale > 2.2);
                  if (showLabel) {
                    const label = node.label as string;
                    const fontSize = Math.max(10, 12 / globalScale);
                    ctx.font = `${isFocused || isSelected ? "600" : "500"} ${fontSize}px "Inter", sans-serif`;
                    const textWidth = ctx.measureText(label).width;
                    const padX = 4 / globalScale;
                    const padY = 2 / globalScale;
                    const labelY = node.y + r + 4 / globalScale;
                    ctx.fillStyle = "rgba(15, 17, 24, 0.72)";
                    ctx.beginPath();
                    const rx = textWidth / 2 + padX;
                    const ry = fontSize / 2 + padY;
                    ctx.roundRect?.(node.x - rx, labelY, rx * 2, ry * 2, 4 / globalScale);
                    ctx.fill();
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.fillStyle = isFocused || isSelected ? "#ffffff" : "rgba(226, 232, 240, 0.92)";
                    ctx.fillText(label, node.x, labelY + padY);
                  }
                }}
                nodePointerAreaPaint={(node: any, color, ctx) => {
                  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
                  const r = 4 + Math.sqrt(Math.max(1, node.importance ?? 3)) * 3.2;
                  ctx.fillStyle = color;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
                  ctx.fill();
                }}
              />
            )}

            {/* Legend */}
            <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex flex-wrap gap-1.5">
              {presentTypes.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-full border border-edge/60 bg-surface/80 px-2 py-0.5 text-[10px] font-medium text-ink-muted backdrop-blur-sm"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: typeColor(t) }} />
                  {TYPE_LABELS[t] ?? t}
                </span>
              ))}
            </div>
          </div>

          <div className="flex w-72 shrink-0 flex-col gap-2.5 overflow-y-auto rounded-xl border border-edge bg-surface-2 p-3.5">
            {selectedConcept ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: typeColor(selectedConcept.type) }} />
                    <span className="text-[13px] font-semibold leading-tight text-ink">{selectedConcept.label}</span>
                  </div>
                  <button onClick={() => setSelectedConcept(null)} className="shrink-0 rounded p-0.5 text-ink-muted hover:bg-surface-3 hover:text-ink">
                    <X size={13} />
                  </button>
                </div>
                <span
                  className="w-fit rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `rgba(${hexToRgb(typeColor(selectedConcept.type))}, 0.16)`, color: typeColor(selectedConcept.type) }}
                >
                  {TYPE_LABELS[selectedConcept.type] ?? selectedConcept.type}
                </span>
                <p className="text-xs leading-relaxed text-ink-muted">{selectedConcept.definition}</p>
                {selectedConcept.facts.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Facts</span>
                    {selectedConcept.facts.map((f, i) => (
                      <div key={i} className="flex items-start gap-1.5 rounded-md bg-surface px-2 py-1.5">
                        <Quote size={10} className="mt-0.5 shrink-0 text-ink-muted opacity-50" />
                        <p className="text-[11px] leading-relaxed text-ink">
                          {f.text}{" "}
                          {f.sourceIndexes.map((idx) => (
                            <span key={idx} className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent/15 px-1 align-super text-[10px] font-semibold text-accent">
                              {idx}
                            </span>
                          ))}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {data.relationships.some((r) => r.from === selectedConcept.id || r.to === selectedConcept.id) && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Relationships</span>
                    {data.relationships
                      .filter((r) => r.from === selectedConcept.id || r.to === selectedConcept.id)
                      .map((r, i) => {
                        const other = r.from === selectedConcept.id ? conceptById.get(r.to) : conceptById.get(r.from);
                        return (
                          <button
                            key={i}
                            onClick={() => other && setSelectedConcept(other)}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-ink-muted transition hover:bg-surface hover:text-ink"
                          >
                            {r.from === selectedConcept.id ? (
                              <><span className="italic opacity-80">{r.relation}</span> <span className="opacity-50">→</span> <span className="font-medium text-ink">{other?.label ?? r.to}</span></>
                            ) : (
                              <><span className="font-medium text-ink">{other?.label ?? r.from}</span> <span className="opacity-50">→</span> <span className="italic opacity-80">{r.relation}</span></>
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Network size={14} className="text-accent" />
                  <span className="text-[13px] font-semibold text-ink">{name}</span>
                </div>
                <p className="text-xs leading-relaxed text-ink-muted">{data.summary}</p>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Sources</span>
                <div className="flex flex-col gap-1">
                  {data.sources.map((s) => (
                    <p key={s.index} className="flex items-baseline gap-1.5 text-[11px] text-ink-muted">
                      <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-accent/15 px-1 text-[10px] font-semibold text-accent">{s.index}</span>
                      <span className="truncate">{s.name}</span>
                    </p>
                  ))}
                </div>
                <p className="mt-1 text-[10px] italic text-ink-muted opacity-70">Click a node to see its definition, facts, and relationships.</p>
              </>
            )}

            <div className="mt-1 flex flex-col gap-1.5 border-t border-edge pt-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Derive from this graph</span>
              {actions.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.mode}
                    onClick={() => graphId && onOpenMode(a.mode, { graphId })}
                    className="group flex items-center gap-2 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-left text-xs text-ink transition hover:border-accent/50 hover:bg-accent/5 hover:text-accent"
                  >
                    <Icon size={13} className="shrink-0 opacity-70 transition group-hover:opacity-100" /> {a.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!loading && !building && !data && !showPicker && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <Network size={32} className="text-ink-muted opacity-40" />
          <p className="text-sm text-ink-muted">Build a knowledge graph to get started.</p>
        </div>
      )}
    </div>
  );
}
