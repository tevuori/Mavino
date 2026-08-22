// ===== Mobile Pulse (Pro-tier predictive forgetting-curve & mastery forecast) =====
// Mobile-optimized view: per-exam readiness gauges, a forecast curve, and an
// at-risk concept feed with "Review" (opens Flashcards) / "Crunch" (opens
// Crunch) shortcuts. Build is fire-and-forget + polling (same as desktop).

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Activity, RefreshCw, Loader2, AlertCircle, Trash2, TrendingDown,
  Brain, Clock, Sparkles, CalendarClock,
} from "lucide-react";
import {
  pulseApi,
  type PulseState, type PulseExam, type PulseForecastPoint,
} from "../services/pulse";
import type { MobileTool } from "./MobileLauncher";
import { MobileContainer, MobileHeader, MobileEmpty } from "./MobileUi";

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function readinessStroke(pct: number): string {
  if (pct < 0) return "rgb(var(--surface-3))";
  if (pct >= 80) return "#34d399";
  if (pct >= 60) return "#fbbf24";
  return "#f87171";
}

function masteryColor(m: number): string {
  if (m < 0) return "text-ink-muted";
  const pct = Math.round(m * 100);
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 60) return "text-amber-400";
  return "text-red-400";
}

function masteryPct(m: number): string {
  return m < 0 ? "—" : `${Math.round(m * 100)}%`;
}

function ReadinessGauge({ pct, size = 90 }: { pct: number; size?: number }) {
  const r = 42, cx = 50, cy = 50;
  const circ = 2 * Math.PI * r;
  const valid = pct >= 0;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * circ;
  const stroke = readinessStroke(pct);
  return (
    <svg viewBox="0 0 100 100" style={{ width: size, height: size }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(var(--surface-3))" strokeWidth={8} />
      {valid && (
        <circle
          cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`} transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="middle" className="fill-ink" style={{ fontSize: 18, fontWeight: 800 }}>
        {valid ? Math.round(pct) : "—"}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="middle" className="fill-ink-muted" style={{ fontSize: 6, fontWeight: 600 }}>
        {valid ? "READY" : "NO DATA"}
      </text>
    </svg>
  );
}

function ForecastCurve({ points, exams }: { points: PulseForecastPoint[]; exams: PulseExam[] }) {
  const W = 100, H = 100;
  const maxDay = Math.max(1, ...points.map((p) => p.day));
  const examDayMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of exams) {
      const day = points.find((p) => p.date === e.date)?.day;
      if (day !== undefined) m.set(day, e.name);
    }
    return m;
  }, [points, exams]);
  const pts = points.map((p) => ({ x: (p.day / maxDay) * W, y: H - p.mastery * H }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 130 }}>
      <defs>
        <linearGradient id="pulse-fill-mobile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.28} />
          <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={0} y1={H - 0.7 * H} x2={W} y2={H - 0.7 * H} stroke="#f87171" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.4} vectorEffect="non-scaling-stroke" />
      <path d={area} fill="url(#pulse-fill-mobile)" />
      <path d={line} fill="none" stroke="rgb(var(--accent))" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      {[...examDayMap.entries()].map(([day, name]) => {
        const x = (day / maxDay) * W;
        return (
          <line key={day} x1={x} y1={0} x2={x} y2={H} stroke="#fbbf24" strokeWidth={0.6} strokeDasharray="1 1" opacity={0.6} vectorEffect="non-scaling-stroke">
            <title>{`Exam: ${name}`}</title>
          </line>
        );
      })}
    </svg>
  );
}

export default function MobilePulse({ onClose, onOpenTool }: { onClose: () => void; onOpenTool: (tool: MobileTool) => void }) {
  const [state, setState] = useState<PulseState | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await pulseApi.get();
        setState(s);
        if (s.status === "ready" || s.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setBuilding(false);
          if (s.status === "error") setError(s.error || "Forecast failed");
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setBuilding(false);
        setError("Failed to check forecast status");
      }
    }, 2000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await pulseApi.get();
      setState(s);
      if (s.status === "building") { setBuilding(true); startPolling(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Pulse forecast");
    } finally {
      setLoading(false);
    }
  }, [startPolling]);

  useEffect(() => { void load(); }, [load]);

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      await pulseApi.build();
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start forecast");
      setBuilding(false);
    }
  };

  const rebuild = async () => {
    if (state?.data && !confirm("Rebuild your Pulse forecast? This re-fits all forgetting curves from your latest review history.")) return;
    await build();
  };

  const deleteForecast = async () => {
    if (!confirm("Delete your Pulse forecast? This cannot be undone.")) return;
    try {
      await pulseApi.delete();
      setState(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete forecast");
    }
  };

  const data = state?.data ?? null;
  const stale = state?.stale ?? false;
  const atRiskConcepts = useMemo(
    () => (data ? data.concepts.filter((c) => c.atRisk).sort((a, b) => a.daysUntilForgotten - b.daysUntilForgotten) : []),
    [data],
  );

  return (
    <MobileContainer>
      <MobileHeader
        title="Pulse"
        subtitle="Mastery forecast"
        onClose={onClose}
        right={
          data ? (
            <div className="flex items-center gap-1.5">
              <button onClick={rebuild} disabled={building} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink-muted disabled:opacity-50">
                {building ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              </button>
              <button onClick={deleteForecast} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-red-300">
                <Trash2 size={18} />
              </button>
            </div>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {stale && data && !building && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <RefreshCw size={15} /> Forecast is stale — new reviews since last build.
          <button onClick={rebuild} className="ml-auto shrink-0 rounded-lg bg-amber-500/20 px-2.5 py-1 text-xs font-semibold">Rebuild</button>
        </div>
      )}

      {building && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-indigo-500/30 bg-accent/10 px-4 py-3 text-sm text-accent">
          <Sparkles size={16} className="animate-pulse" /> Building your forecast…
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-ink-muted" />
        </div>
      ) : !data && !building ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/15">
            <Activity size={32} className="text-accent" />
          </div>
          <p className="max-w-xs text-sm leading-6 text-ink-muted">
            Pulse models each flashcard's forgetting curve and forecasts your mastery on each Crunch exam date — no AI needed.
          </p>
          <button onClick={build} className="flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-accent-fg active:scale-[.98]">
            <Sparkles size={16} /> Build my forecast
          </button>
        </div>
      ) : data ? (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
              <p className="text-2xl font-bold text-ink">{data.stats.cardCount}</p>
              <p className="text-[11px] text-ink-muted">Cards</p>
            </div>
            <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
              <p className="text-2xl font-bold text-ink">{data.stats.conceptCount}</p>
              <p className="text-[11px] text-ink-muted">Concepts</p>
            </div>
            <div className="rounded-2xl border border-edge bg-surface-2 p-3 text-center">
              <p className={`text-2xl font-bold ${data.stats.atRiskCount > 0 ? "text-red-400" : "text-ink"}`}>{data.stats.atRiskCount}</p>
              <p className="text-[11px] text-ink-muted">At-risk</p>
            </div>
          </div>

          {data.exams.length > 0 && (
            <>
              <h2 className="mb-2 text-sm font-semibold text-ink">Exam readiness</h2>
              <div className="mb-5 flex gap-3 overflow-x-auto pb-1">
                {data.exams.map((exam) => (
                  <div key={exam.id} className="flex shrink-0 flex-col items-center gap-2 rounded-2xl border border-edge bg-surface-2 p-3">
                    <ReadinessGauge pct={exam.readiness} />
                    <div className="max-w-[110px] text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: exam.color }} />
                        <span className="truncate text-xs font-semibold text-ink">{exam.name}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-ink-muted">{fmtDate(exam.date)} · {exam.daysUntil}d</p>
                      {exam.atRiskCount > 0 && (
                        <p className="mt-1 flex items-center justify-center gap-1 text-[10px] text-red-400">
                          <TrendingDown size={10} /> {exam.atRiskCount} at-risk
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.forecast.length > 0 && (
            <div className="mb-5 rounded-2xl border border-edge bg-surface-2 p-3">
              <p className="mb-2 text-xs font-semibold text-ink-muted">Projected mastery over time</p>
              <ForecastCurve points={data.forecast} exams={data.exams} />
            </div>
          )}

          <h2 className="mb-2 text-sm font-semibold text-ink">At risk</h2>
          {atRiskConcepts.length === 0 ? (
            <MobileEmpty text="Nothing at risk right now — keep reviewing to stay ahead." />
          ) : (
            <div className="space-y-2">
              {atRiskConcepts.map((c) => (
                <div key={c.id} className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                      <TrendingDown size={15} className="text-red-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{c.label}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                        <span className={masteryColor(c.currentMastery)}>now {masteryPct(c.currentMastery)}</span>
                        <span>→</span>
                        <span className={masteryColor(c.predictedMastery)}>exam {masteryPct(c.predictedMastery)}</span>
                        <span className="flex items-center gap-0.5"><Clock size={10} /> {c.daysUntilForgotten}d left</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => onOpenTool("flashcards")}
                      className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent active:bg-accent/25"
                    >
                      <Brain size={12} /> Review
                    </button>
                    <button
                      onClick={() => onOpenTool("crunch")}
                      className="flex items-center gap-1.5 rounded-lg bg-surface-3 px-3 py-1.5 text-xs font-medium text-ink-muted active:text-ink"
                    >
                      <CalendarClock size={12} /> Crunch
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </MobileContainer>
  );
}
