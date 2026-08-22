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

// Cache hexToRgb results — called per-node per-frame, so the regex must not run every time.
const _hexRgbCache = new Map<string, string>();
function hexToRgb(hex: string): string {
  const cached = _hexRgbCache.get(hex);
  if (cached) return cached;
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  const result = m ? [1, 2, 3].map((i) => parseInt(m[i], 16)).join(", ") : "148, 163, 184";
  _hexRgbCache.set(hex, result);
  return result;
}
// Pre-populate cache for the fixed type colors + weak color.
Object.values(TYPE_COLORS).forEach(hexToRgb);
hexToRgb("#ef4444");

// ----- level-of-detail: nodes reveal progressively as you zoom in -----
// Higher-importance concepts are always visible; lower-importance "detail"
// nodes fade in only as you zoom closer. Weak spots are always shown.
// Returns a 0..1 fade alpha.
function nodeReveal(node: { weak?: boolean; importance?: number }, globalScale: number): number {
  if (node.weak) return 1;
  const importance = node.importance ?? 3;
  // imp 5 → reveal at zoom 0,   imp 4 → 0.6,  imp 3 → 1.2,
  // imp 2 → 1.8,                imp 1 → 2.4
  const revealZoom = Math.max(0, (5 - importance) * 0.6);
  return Math.max(0, Math.min(1, (globalScale - revealZoom) / 0.4));
}

// Node radius in graph coordinates — importance-weighted so major concepts
// are visibly larger and dominate the overview, while minor concepts shrink
// into the background. Scales naturally with zoom.
function nodeRadius(node: { importance?: number }): number {
  return 3 + Math.sqrt(Math.max(1, node.importance ?? 3)) * 3.5;
}

// Cache for label text widths — measureText is expensive when called per-node per-frame.
const _labelWidthCache = new Map<string, number>();

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
  /** Omit for items that have no dedicated app to jump to (e.g. courses, now that Grades is discontinued). */
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`group flex items-center gap-2 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-left text-xs ${onClick ? "text-ink transition hover:border-accent/50 hover:bg-accent/5" : "text-ink-muted"}`}
    >
      <Icon size={13} className={`shrink-0 text-ink-muted ${onClick ? "transition group-hover:text-accent" : ""}`} />
      <span className="flex-1 truncate">{name}</span>
      {badge && <span className="shrink-0 text-[10px] text-ink-muted">{badge}</span>}
      {onClick && <ExternalLink size={11} className="shrink-0 text-ink-muted opacity-0 transition group-hover:opacity-100" />}
    </Tag>
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
  const zoomRef = useRef(1); // current globalScale, updated via onZoom for link/pointer callbacks
  const [zoomLevel, setZoomLevel] = useState(1); // for the zoom indicator badge
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

  // Refs mirror the focus state so the canvas callbacks (nodeCanvasObject, etc.)
  // can be stable useCallbacks with [] deps — avoiding callback recreation on
  // every React re-render (which itself triggers ForceGraph2D re-processing).
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;
  const focusSetRef = useRef(focusSet);
  focusSetRef.current = focusSet;
  const selectedConceptRef = useRef(selectedConcept);
  selectedConceptRef.current = selectedConcept;
  const conceptByIdRef = useRef(conceptById);
  conceptByIdRef.current = conceptById;

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
    fg.d3Force("collide", d3Collide().radius((n: any) => nodeRadius(n) + 3));
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

  const weakCount = data?.stats.weakCount ?? 0;

  // ===== Stable callbacks for ForceGraph2D =====
  // These use refs (focusIdRef, focusSetRef, etc.) instead of closure variables
  // so they can be useCallback with [] deps. This prevents ForceGraph2D from
  // re-processing its internal render pipeline on every React state change
  // (e.g. when zoomLevel updates via onZoom).

  const nodeLabelCallback = useCallback(() => "", []);
  const nodeValCallback = useCallback((n: NodeObject) => (n as any).importance, []);
  const linkLabelCallback = useCallback((l: LinkObject) => (l as any).relation, []);
  const linkArrowColorCallback = useCallback(() => "rgba(148, 163, 184, 0.45)", []);

  const linkColorCallback = useCallback((l: any) => {
    const s = l.source, t = l.target;
    const sid = s?.id ?? s, tid = t?.id ?? t;
    const fid = focusIdRef.current;
    const selId = selectedConceptRef.current?.id;
    const sVis = s?.weak || fid === sid || selId === sid ? 1 : nodeReveal(s, zoomRef.current);
    const tVis = t?.weak || fid === tid || selId === tid ? 1 : nodeReveal(t, zoomRef.current);
    const vis = Math.min(sVis, tVis);
    if (vis < 0.05) return "rgba(0,0,0,0)";
    const fs = focusSetRef.current;
    const dim = fs && !(fs.has(sid) && fs.has(tid));
    return dim
      ? `rgba(148, 163, 184, ${0.10 * vis})`
      : `rgba(148, 163, 184, ${0.45 * vis})`;
  }, []);

  const linkWidthCallback = useCallback((l: any) => {
    const s = l.source, t = l.target;
    const sid = s?.id ?? s, tid = t?.id ?? t;
    const fid = focusIdRef.current;
    const selId = selectedConceptRef.current?.id;
    const sVis = s?.weak || fid === sid || selId === sid ? 1 : nodeReveal(s, zoomRef.current);
    const tVis = t?.weak || fid === tid || selId === tid ? 1 : nodeReveal(t, zoomRef.current);
    const vis = Math.min(sVis, tVis);
    if (vis < 0.05) return 0;
    const fs = focusSetRef.current;
    const active = fs && fs.has(sid) && fs.has(tid);
    return active ? 1.4 : 0.7 * vis;
  }, []);

  const handleNodeClick = useCallback((n: NodeObject) => {
    const c = conceptByIdRef.current.get(String((n as any).id));
    if (c) setSelectedConcept(c);
    const x = (n as any).x, y = (n as any).y;
    if (typeof x === "number" && typeof y === "number") fgRef.current?.centerAt(x, y, 500);
  }, []);

  const handleNodeHover = useCallback((n: NodeObject | null) => {
    setHoveredId(n ? String((n as any).id) : null);
  }, []);

  const handleBackgroundClick = useCallback(() => setSelectedConcept(null), []);

  const handleZoom = useCallback((t: { k: number }) => {
    zoomRef.current = t.k;
    const rounded = Math.round(t.k * 10) / 10;
    setZoomLevel((prev) => (Math.abs(prev - rounded) < 0.05 ? prev : rounded));
  }, []);

  const nodeCanvasCallback = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    const fid = focusIdRef.current;
    const sel = selectedConceptRef.current;
    const fs = focusSetRef.current;
    const isFocused = fid === node.id;
    const isSelected = sel?.id === node.id;
    const reveal = isFocused || isSelected ? 1 : nodeReveal(node, globalScale);
    if (reveal <= 0.01) return;

    const dimmed = fs ? !fs.has(node.id) : false;
    const isWeak = node.weak;
    const baseColor = typeColor(node.type);
    const rgb = hexToRgb(isWeak ? "#ef4444" : baseColor);
    const r = nodeRadius(node);
    const alpha = reveal * (dimmed ? 0.25 : 1);

    // Glow — use a simple semi-transparent arc instead of createRadialGradient
    // (gradient creation is one of the most expensive canvas operations).
    if (!dimmed && reveal > 0.3) {
      ctx.fillStyle = `rgba(${rgb}, ${(isFocused ? 0.18 : 0.1 * reveal)})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 2.4, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Body
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
    ctx.fill();

    // Weak ring (red outline)
    if (isWeak && !dimmed) {
      ctx.lineWidth = 1.8 / globalScale;
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.8 * reveal})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Selection / hover ring
    if (isSelected || (isFocused && !sel)) {
      ctx.lineWidth = 1.6 / globalScale;
      ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.95)" : `rgba(${rgb}, 0.9)`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2.5 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Labels — graph-coordinate font size that GROWS as you zoom in.
    const graphFontSize = 4 + (node.importance ?? 3) * 0.7;
    const screenFont = graphFontSize * globalScale;
    const showLabel = reveal > 0.5 && (isFocused || isSelected || isWeak || screenFont > 10);
    if (showLabel) {
      const label = node.label as string;
      const fontSize = isFocused || isSelected
        ? Math.max(graphFontSize, 11 / globalScale)
        : graphFontSize;
      ctx.font = `${isFocused || isSelected ? "600" : "500"} ${fontSize}px "Inter", sans-serif`;
      // Cache text width — measureText is expensive per-frame.
      let textWidth = _labelWidthCache.get(label);
      if (textWidth === undefined) {
        textWidth = ctx.measureText(label).width;
        _labelWidthCache.set(label, textWidth);
      }
      const padX = 1.5;
      const padY = 0.8;
      const labelY = node.y + r + 2;
      ctx.fillStyle = `rgba(15, 17, 24, ${0.72 * reveal})`;
      const rx = textWidth / 2 + padX;
      const ry = fontSize / 2 + padY;
      ctx.beginPath();
      ctx.roundRect?.(node.x - rx, labelY, rx * 2, ry * 2, 2);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isFocused || isSelected
        ? "#ffffff"
        : isWeak
          ? `rgba(252, 165, 165, ${0.95 * reveal})`
          : `rgba(226, 232, 240, ${0.92 * reveal})`;
      ctx.fillText(label, node.x, labelY + padY);
    }
  }, []);

  const nodePointerAreaCallback = useCallback((node: any, color: string, ctx: CanvasRenderingContext2D) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    const fid = focusIdRef.current;
    const sel = selectedConceptRef.current;
    const isFocused = fid === node.id;
    const isSelected = sel?.id === node.id;
    const reveal = isFocused || isSelected ? 1 : nodeReveal(node, zoomRef.current);
    if (reveal <= 0.01) return;
    const r = nodeRadius(node);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

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
                nodeLabel={nodeLabelCallback}
                nodeVal={nodeValCallback}
                linkLabel={linkLabelCallback}
                linkColor={linkColorCallback}
                linkWidth={linkWidthCallback}
                linkDirectionalArrowLength={4}
                linkDirectionalArrowRelPos={1}
                linkDirectionalArrowColor={linkArrowColorCallback}
                linkCurvature={0.15}
                onNodeClick={handleNodeClick}
                onNodeHover={handleNodeHover}
                onBackgroundClick={handleBackgroundClick}
                cooldownTime={1500}
                backgroundColor="rgba(0,0,0,0)"
                onZoom={handleZoom}
                nodeCanvasObject={nodeCanvasCallback}
                nodePointerAreaPaint={nodePointerAreaCallback}
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

            {/* Zoom level indicator — shows current detail tier */}
            <div className="pointer-events-none absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-full border border-edge/60 bg-surface/80 px-2.5 py-1 text-[10px] font-medium tabular-nums text-ink-muted backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-accent/70" />
              {zoomLevel < 1 ? "Overview" : zoomLevel < 2.5 ? "Standard" : "Detail"}
              <span className="opacity-50">· {zoomLevel.toFixed(1)}×</span>
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
                            <LinkedItemRow key={c.id} icon={GraduationCap} name={c.code ? `${c.code} · ${c.name}` : c.name} />
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
