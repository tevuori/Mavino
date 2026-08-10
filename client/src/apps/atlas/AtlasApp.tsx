// ===== Atlas app (Pro-tier global knowledge graph) =====
// A "graph of graphs": stitches together every Study Hub ConceptGraph the
// user has built, plus their notes, flashcards, tasks, and courses, into one
// living map of their knowledge. Concepts are merged across source-graphs,
// linked to the items that mention/test/cover them, and enriched with
// mastery (from flashcard reviews) and grade signals so weak spots are
// highlighted in red.
//
// The build is fire-and-forget + polling (same pattern as the Study Hub
// Knowledge Graph): POST /build returns immediately with status "building",
// the client polls GET / until status flips to "ready"/"error".
//
// The concept detail sidebar is the key differentiator from the Study Hub
// graph: it shows every note/flashcard deck/task/course linked to the
// selected concept, with "Open" buttons that jump straight into the
// respective app — making Atlas a navigation layer over the entire OS.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ForceGraph2D, { type NodeObject, type LinkObject, type ForceGraphMethods } from "react-force-graph-2d";
import { forceCollide as d3Collide } from "d3-force-3d";
import {
  Network, RefreshCw, Loader2, AlertCircle, X, Maximize2,
  StickyNote, Brain, CheckSquare, GraduationCap, ExternalLink,
  TrendingDown, TrendingUp, Minus, Sparkles, Layers,
} from "lucide-react";
import { atlasApi, type AtlasState, type AtlasData, type AtlasConcept, type AtlasConceptDetail } from "../../services/atlas";
import { useWindows } from "../../store/windows";
import type { WindowInstance } from "../../store/windows";

// ----- concept type colors (shared with Study Hub graph) -----
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

function hexToRgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return "148, 163, 184";
  return [1, 2, 3].map((i) => parseInt(m[i], 16)).join(", ");
}

// ----- container size hook (same pattern as Study Hub KnowledgeGraph) -----
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
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
  }, []);
  return { ref: setRef, size };
}

function useElapsedSeconds(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, [running]);
  return elapsed;
}

// ----- mastery badge -----
function MasteryBadge({ mastery }: { mastery: number }) {
  if (mastery < 0) return null;
  const pct = Math.round(mastery * 100);
  const Icon = pct >= 80 ? TrendingUp : pct >= 60 ? Minus : TrendingDown;
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium ${color}`}>
      <Icon size={10} /> {pct}% mastery
    </span>
  );
}

function GradeBadge({ gradePct }: { gradePct: number | null }) {
  if (gradePct === null) return null;
  const pct = Math.round(gradePct);
  const color = pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium ${color}`}>
      <GraduationCap size={10} /> {pct}% grade
    </span>
  );
}

// ----- linked item row with "Open in..." button -----
function LinkedItemRow({
  icon: Icon,
  name,
  badge,
  onClick,
}: {
  icon: typeof StickyNote;
  name: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-2 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-left text-xs text-ink transition hover:border-accent/50 hover:bg-accent/5"
    >
      <Icon size={13} className="shrink-0 text-ink-muted transition group-hover:text-accent" />
      <span className="flex-1 truncate">{name}</span>
      {badge && <span className="shrink-0 text-[10px] text-ink-muted">{badge}</span>}
      <ExternalLink size={11} className="shrink-0 text-ink-muted opacity-0 transition group-hover:opacity-100" />
    </button>
  );
}

// ----- main component -----
export default function AtlasApp({ win }: { win: WindowInstance }) {
  const [state, setState] = useState<AtlasState | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConcept, setSelectedConcept] = useState<AtlasConcept | null>(null);
  const [conceptDetail, setConceptDetail] = useState<AtlasConceptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [filterWeak, setFilterWeak] = useState(false);
  const { ref: canvasWrapRef, size } = useContainerSize<HTMLDivElement>();
  const buildElapsed = useElapsedSeconds(building);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { open } = useWindows();

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await atlasApi.get();
      setState(s);
      if (s.status === "building") {
        setBuilding(true);
        startPolling();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Atlas");
    } finally {
      setLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await atlasApi.get();
        setState(s);
        if (s.status === "ready" || s.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setBuilding(false);
          if (s.status === "error") setError(s.error || "Build failed");
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setBuilding(false);
        setError("Failed to check build status");
      }
    }, 2500);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Check for a focus concept passed by the Athena open_atlas client action.
  useEffect(() => {
    if (!state?.data || !win?.id) return;
    const focusId = sessionStorage.getItem(`atlas:focus:${win.id}`);
    if (focusId) {
      sessionStorage.removeItem(`atlas:focus:${win.id}`);
      const concept = state.data.concepts.find((c) => c.id === focusId);
      if (concept) setSelectedConcept(concept);
    }
  }, [state?.data, win?.id]);

  const build = async () => {
    setBuilding(true);
    setError(null);
    setSelectedConcept(null);
    try {
      await atlasApi.build();
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start build");
      setBuilding(false);
    }
  };

  // Fetch concept detail when a concept is selected.
  useEffect(() => {
    if (!selectedConcept) { setConceptDetail(null); return; }
    setDetailLoading(true);
    atlasApi
      .getConcept(selectedConcept.id)
      .then((d) => setConceptDetail(d))
      .catch(() => setConceptDetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedConcept]);

  const data = state?.data ?? null;
  const stale = state?.stale ?? false;

  // Build the force-graph data, optionally filtered to weak concepts only.
  // Links MUST be mapped to { source, target } — react-force-graph-2d looks
  // up nodes by the `source`/`target` fields (not `from`/`to`), and throws
  // "node not found: undefined" if they're absent.
  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    const visibleConcepts = filterWeak ? data.concepts.filter((c) => c.weak) : data.concepts;
    const visibleIds = new Set(visibleConcepts.map((c) => c.id));
    return {
      nodes: visibleConcepts.map((c) => ({
        id: c.id,
        label: c.label,
        type: c.type,
        importance: c.importance,
        weak: c.weak,
        mastery: c.mastery,
      })),
      links: data.links
        .filter((l) => visibleIds.has(l.from) && visibleIds.has(l.to))
        .map((l) => ({ source: l.from, target: l.to, relation: l.relation })),
    };
  }, [data, filterWeak]);

  const conceptById = useMemo(() => {
    const map = new Map<string, AtlasConcept>();
    data?.concepts.forEach((c) => map.set(c.id, c));
    return map;
  }, [data]);

  const neighborsOf = useMemo(() => {
    const map = new Map<string, Set<string>>();
    data?.concepts.forEach((c) => map.set(c.id, new Set([c.id])));
    data?.links.forEach((l) => {
      map.get(l.from)?.add(l.to);
      map.get(l.to)?.add(l.from);
    });
    return map;
  }, [data]);

  const focusId = hoveredId ?? selectedConcept?.id ?? null;
  const focusSet = focusId ? neighborsOf.get(focusId) ?? null : null;

  // Configure the d3-force simulation when data loads or filter changes.
  // Atlas has many disconnected concepts (from different source graphs with
  // no cross-graph links), which collapse to a single clump under the default
  // force settings. We strengthen repulsion (charge) and add collision
  // detection so disconnected nodes spread out into distinct constellations.
  useEffect(() => {
    if (!data) return;
    const fg = fgRef.current;
    if (!fg) return;
    // Strong negative charge → nodes repel each other more, spreading out.
    fg.d3Force("charge")?.strength(-120);
    // Shorter link distance → connected clusters stay tight, but the strong
    // charge pushes disconnected clusters apart.
    fg.d3Force("link")?.distance(50);
    // Collision detection prevents nodes from overlapping (which causes the
    // "hexagon hive" look when many nodes pile at the center).
    fg.d3Force("collide", d3Collide().radius((n: any) => 8 + Math.sqrt(Math.max(1, n.importance ?? 3)) * 3.2 + 3));
    // Re-heat the simulation so the new forces take effect.
    fg.d3ReheatSimulation();
    const id = setTimeout(() => fg.zoomToFit(600, 48), 300);
    return () => clearTimeout(id);
  }, [data, filterWeak]);

  const presentTypes = useMemo(() => {
    const set = new Set<string>();
    data?.concepts.forEach((c) => set.add(c.type));
    return [...set];
  }, [data]);

  const openNote = (id: string) => open({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId: id } });
  const openFlashcards = (id: string) => open({ appId: "flashcards", title: "Flashcards", icon: "Brain", payload: { deckId: id } });
  const openTasks = () => open({ appId: "tasks", title: "Tasks", icon: "CheckSquare" });
  const openCourse = (id: string) => open({ appId: "grades", title: "Grades", icon: "GraduationCap", payload: { courseId: id } });

  const weakCount = data?.stats.weakCount ?? 0;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-accent" />
          <span className="text-sm font-semibold text-ink">Atlas</span>
          {data && (
            <span className="text-[11px] text-ink-muted">
              {data.stats.conceptCount} concepts · {data.stats.linkCount} links · {data.stats.clusterCount} clusters
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {data && (
            <>
              <button
                onClick={() => fgRef.current?.zoomToFit(500, 48)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink"
              >
                <Maximize2 size={13} /> Fit
              </button>
              {weakCount > 0 && (
                <button
                  onClick={() => setFilterWeak((v) => !v)}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition ${
                    filterWeak ? "bg-red-500/15 text-red-400" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
                  }`}
                >
                  <TrendingDown size={13} /> Weak ({weakCount})
                </button>
              )}
            </>
          )}
          <button
            onClick={build}
            disabled={building}
            className="flex items-center gap-1 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            {building ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {data ? "Rebuild" : "Build"}
          </button>
        </div>
      </div>

      {/* Stale banner */}
      {data && stale && !building && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertCircle size={14} />
          <span>Your Study Hub graphs changed since this Atlas was built.</span>
          <button onClick={build} className="ml-auto font-medium underline">Rebuild now</button>
        </div>
      )}

      {/* Building progress */}
      {building && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-edge bg-surface-2 p-3 text-xs text-ink-muted">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-accent" />
              Building your global knowledge graph…
            </span>
            <span className="tabular-nums">{buildElapsed}s</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-1/3 animate-progress-slide rounded-full bg-accent" />
          </div>
          {buildElapsed > 15 && (
            <span>Stitching together your Study Hub graphs, notes, flashcards, and courses…</span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={20} className="animate-spin text-ink-muted" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !data && !building && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
            <Network size={32} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Your global knowledge map</p>
            <p className="mt-1 max-w-sm text-xs text-ink-muted">
              Atlas stitches together every Study Hub graph you've built, plus your notes, flashcards, tasks, and courses — into one living map. Weak spots are highlighted so you know exactly what to study next.
            </p>
          </div>
          <button
            onClick={build}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90"
          >
            <Sparkles size={15} /> Build my Atlas
          </button>
        </div>
      )}

      {/* Graph + sidebar */}
      {data && (
        <div className="flex min-h-0 flex-1 gap-3">
          {/* Force graph canvas */}
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
                  return dim ? "rgba(148, 163, 184, 0.10)" : "rgba(148, 163, 184, 0.45)";
                }}
                linkWidth={(l: any) => {
                  const active = focusSet && focusSet.has(l.source?.id ?? l.source) && focusSet.has(l.target?.id ?? l.target);
                  return active ? 1.4 : 0.7;
                }}
                linkDirectionalArrowLength={4}
                linkDirectionalArrowRelPos={1}
                linkDirectionalArrowColor={() => "rgba(148, 163, 184, 0.45)"}
                linkCurvature={0.15}
                onNodeClick={(n: NodeObject) => {
                  const c = conceptById.get(String((n as any).id));
                  if (c) setSelectedConcept(c);
                  const x = (n as any).x, y = (n as any).y;
                  if (typeof x === "number" && typeof y === "number") fgRef.current?.centerAt(x, y, 500);
                }}
                onNodeHover={(n: NodeObject | null) => setHoveredId(n ? String((n as any).id) : null)}
                onBackgroundClick={() => setSelectedConcept(null)}
                cooldownTime={4000}
                backgroundColor="rgba(0,0,0,0)"
                nodeCanvasObject={(node: any, ctx, globalScale) => {
                  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
                  const isFocused = focusId === node.id;
                  const isSelected = selectedConcept?.id === node.id;
                  const dimmed = focusSet ? !focusSet.has(node.id) : false;
                  const isWeak = node.weak;
                  const baseColor = typeColor(node.type);
                  const rgb = hexToRgb(isWeak ? "#ef4444" : baseColor);
                  const r = 4 + Math.sqrt(Math.max(1, node.importance ?? 3)) * 3.2;
                  const alpha = dimmed ? 0.25 : 1;

                  // Glow
                  if (!dimmed) {
                    const glow = ctx.createRadialGradient(node.x, node.y, r * 0.4, node.x, node.y, r * 3.2);
                    glow.addColorStop(0, `rgba(${rgb}, ${isFocused ? 0.55 : 0.3})`);
                    glow.addColorStop(1, `rgba(${rgb}, 0)`);
                    ctx.fillStyle = glow;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r * 3.2, 0, 2 * Math.PI);
                    ctx.fill();
                  }

                  // Body
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                  ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
                  ctx.fill();

                  // Weak ring (pulsing red outline)
                  if (isWeak && !dimmed) {
                    ctx.lineWidth = 1.8 / globalScale;
                    ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r + 2 / globalScale, 0, 2 * Math.PI);
                    ctx.stroke();
                  }

                  // Selection / hover ring
                  if (isSelected || (isFocused && !selectedConcept)) {
                    ctx.lineWidth = 1.6 / globalScale;
                    ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.95)" : `rgba(${rgb}, 0.9)`;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, r + 2.5 / globalScale, 0, 2 * Math.PI);
                    ctx.stroke();
                  }

                  // Labels
                  const showLabel = !dimmed && (isFocused || isSelected || node.importance >= 4 || isWeak || globalScale > 2.2);
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
                    ctx.fillStyle = isFocused || isSelected ? "#ffffff" : isWeak ? "rgba(252, 165, 165, 0.95)" : "rgba(226, 232, 240, 0.92)";
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
              {weakCount > 0 && (
                <span className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  Weak
                </span>
              )}
            </div>
          </div>

          {/* Concept detail sidebar */}
          <div className="flex w-80 shrink-0 flex-col gap-2.5 overflow-y-auto rounded-xl border border-edge bg-surface-2 p-3.5">
            {selectedConcept && conceptDetail ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: selectedConcept.weak ? "#ef4444" : typeColor(selectedConcept.type) }}
                    />
                    <span className="text-[13px] font-semibold leading-tight text-ink">{selectedConcept.label}</span>
                  </div>
                  <button onClick={() => setSelectedConcept(null)} className="shrink-0 rounded p-0.5 text-ink-muted hover:bg-surface-3 hover:text-ink">
                    <X size={13} />
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span
                    className="w-fit rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `rgba(${hexToRgb(typeColor(selectedConcept.type))}, 0.16)`,
                      color: typeColor(selectedConcept.type),
                    }}
                  >
                    {TYPE_LABELS[selectedConcept.type] ?? selectedConcept.type}
                  </span>
                  {selectedConcept.weak && (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400">
                      Weak spot
                    </span>
                  )}
                  <MasteryBadge mastery={selectedConcept.mastery} />
                  <GradeBadge gradePct={selectedConcept.gradePct} />
                </div>

                {selectedConcept.definition && (
                  <p className="text-xs leading-relaxed text-ink-muted">{selectedConcept.definition}</p>
                )}

                {/* Source graphs */}
                {selectedConcept.sourceGraphIds.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                    <Layers size={11} />
                    <span>In {selectedConcept.sourceGraphIds.length} Study Hub graph{selectedConcept.sourceGraphIds.length > 1 ? "s" : ""}</span>
                  </div>
                )}

                {/* Linked items — the key Atlas feature */}
                {(() => {
                  const items = conceptDetail.items;
                  const total = items.notes.length + items.flashcardDecks.length + items.tasks.length + items.courses.length;
                  if (total === 0) return null;
                  return (
                    <div className="flex flex-col gap-1.5 border-t border-edge pt-2.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                        Linked items ({total})
                      </span>
                      {items.notes.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {items.notes.map((n) => (
                            <LinkedItemRow key={n.id} icon={StickyNote} name={n.title} onClick={() => openNote(n.id)} />
                          ))}
                        </div>
                      )}
                      {items.flashcardDecks.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {items.flashcardDecks.map((d) => (
                            <LinkedItemRow key={d.id} icon={Brain} name={d.name} onClick={() => openFlashcards(d.id)} />
                          ))}
                        </div>
                      )}
                      {items.tasks.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {items.tasks.map((t) => (
                            <LinkedItemRow
                              key={t.id}
                              icon={CheckSquare}
                              name={t.title}
                              badge={t.status === "DONE" ? "done" : t.status === "IN_PROGRESS" ? "active" : t.dueDate ? "due" : undefined}
                              onClick={openTasks}
                            />
                          ))}
                        </div>
                      )}
                      {items.courses.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {items.courses.map((c) => (
                            <LinkedItemRow key={c.id} icon={GraduationCap} name={c.code ? `${c.code} · ${c.name}` : c.name} onClick={() => openCourse(c.id)} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Related concepts */}
                {conceptDetail.relatedConcepts.length > 0 && (
                  <div className="flex flex-col gap-1 border-t border-edge pt-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Related concepts</span>
                    {conceptDetail.relatedConcepts.map((r) => {
                      const rc = conceptById.get(r.id);
                      return (
                        <button
                          key={r.id}
                          onClick={() => rc && setSelectedConcept(rc)}
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-ink-muted transition hover:bg-surface hover:text-ink"
                        >
                          <span className="italic opacity-80">{r.relation}</span>
                          <span className="opacity-50">→</span>
                          <span className="font-medium text-ink">{r.label}</span>
                          {rc?.weak && <TrendingDown size={10} className="text-red-400" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : selectedConcept && detailLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={16} className="animate-spin text-ink-muted" />
              </div>
            ) : data ? (
              <>
                <div className="flex items-center gap-1.5">
                  <Network size={14} className="text-accent" />
                  <span className="text-[13px] font-semibold text-ink">Atlas overview</span>
                </div>
                <p className="text-xs leading-relaxed text-ink-muted">
                  Your entire knowledge base stitched into one map. {data.stats.conceptCount} concepts across {data.stats.sourceGraphCount} Study Hub graph{data.stats.sourceGraphCount !== 1 ? "s" : ""}, linked to {data.stats.linkedNoteCount} note{data.stats.linkedNoteCount !== 1 ? "s" : ""}, {data.stats.linkedFlashcardDeckCount} flashcard deck{data.stats.linkedFlashcardDeckCount !== 1 ? "s" : ""}, {data.stats.linkedTaskCount} task{data.stats.linkedTaskCount !== 1 ? "s" : ""}, and {data.stats.linkedCourseCount} course{data.stats.linkedCourseCount !== 1 ? "s" : ""}.
                </p>

                {weakCount > 0 && (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-400">
                      <TrendingDown size={12} /> {weakCount} weak concept{weakCount > 1 ? "s" : ""}
                    </div>
                    <p className="text-[10px] text-ink-muted">
                      Red nodes have low flashcard mastery or low grades. Click them to see what to study, or filter to weak only.
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-1.5 border-t border-edge pt-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Clusters</span>
                  {data.clusters.slice(0, 12).map((cl) => (
                    <div key={cl.id} className="flex items-center justify-between rounded-md bg-surface px-2 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5 truncate">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: cl.kind === "course" ? cl.color ?? "#6366f1" : "#818cf8" }}
                        />
                        <span className="truncate text-ink">{cl.label}</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-muted">{cl.conceptIds.length}</span>
                    </div>
                  ))}
                  {data.clusters.length > 12 && (
                    <p className="text-[10px] text-ink-muted">+ {data.clusters.length - 12} more</p>
                  )}
                </div>

                <p className="mt-1 text-[10px] italic text-ink-muted opacity-70">Click a node to see its linked notes, flashcards, tasks, and courses.</p>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
