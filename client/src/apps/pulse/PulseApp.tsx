// ===== Pulse app (Pro-tier predictive forgetting-curve & mastery forecast) =====
// A predictive analytics engine that models each flashcard's forgetting curve
// from review history (FSRS-style), then forecasts your mastery level on each
// exam date (from Crunch). Surfaces "at-risk" concepts (predicted mastery <
// threshold on exam day) and an overall readiness score per exam.
//
// The forecast is deterministic (no LLM) — it fits a power forgetting curve
// per card from the SM-2 interval + ease factor + review quality history,
// projects retention forward to each exam date, and aggregates per-concept
// and per-exam readiness.
//
// The build is fire-and-forget + polling (same pattern as Atlas/Crunch):
// POST /build returns immediately with status "building", the client polls
// GET / until status flips to "ready"/"error".
//
// UI: per-exam readiness gauges, a forecast curve charting projected mastery
// over time vs. exam date markers, an at-risk concept feed with one-click
// "review now" / "add to Crunch" actions, and a per-concept "days until
// forgotten" list.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Activity, RefreshCw, Loader2, AlertCircle, Trash2, TrendingDown,
  Brain, Clock, Sparkles, Target, Zap, CalendarClock, ChevronRight,
} from "lucide-react";
import {
  pulseApi,
  type PulseState, type PulseData, type PulseConcept, type PulseExam,
  type PulseForecastPoint,
} from "../../services/pulse";
import { useWindows } from "../../store/windows";
import type { WindowInstance } from "../../store/windows";

// ----- helpers -----

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function readinessColor(pct: number): string {
  if (pct < 0) return "text-ink-muted";
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 60) return "text-amber-400";
  return "text-red-400";
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
  if (m < 0) return "—";
  return `${Math.round(m * 100)}%`;
}

// ----- readiness gauge (circular) -----

function ReadinessGauge({ pct, size = 100 }: { pct: number; size?: number }) {
  const r = 42;
  const cx = 50;
  const cy = 50;
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
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          transform={`rotate(-90 ${cx} ${cy})`}
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

// ----- forecast curve chart (pure SVG) -----

function ForecastCurve({ points, exams }: { points: PulseForecastPoint[]; exams: PulseExam[] }) {
  const W = 100;
  const H = 100;
  const maxDay = Math.max(1, ...points.map((p) => p.day));
  const examDayMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of exams) {
      const day = points.find((p) => p.date === e.date)?.day;
      if (day !== undefined) m.set(day, e.name);
    }
    return m;
  }, [points, exams]);

  const pts = points.map((p) => ({
    x: (p.day / maxDay) * W,
    y: H - p.mastery * H,
    ...p,
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 140 }}>
      <defs>
        <linearGradient id="pulse-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.28} />
          <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* At-risk threshold line (70%) */}
      <line
        x1={0}
        y1={H - 0.7 * H}
        x2={W}
        y2={H - 0.7 * H}
        stroke="#f87171"
        strokeWidth={0.5}
        strokeDasharray="2 2"
        opacity={0.4}
        vectorEffect="non-scaling-stroke"
      />
      {/* Area + line */}
      <path d={area} fill="url(#pulse-fill)" />
      <path d={line} fill="none" stroke="rgb(var(--accent))" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      {/* Exam date markers (vertical lines) */}
      {[...examDayMap.entries()].map(([day, name]) => {
        const x = (day / maxDay) * W;
        return (
          <line
            key={day}
            x1={x}
            y1={0}
            x2={x}
            y2={H}
            stroke="#fbbf24"
            strokeWidth={0.6}
            strokeDasharray="1 1"
            opacity={0.6}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`Exam: ${name}`}</title>
          </line>
        );
      })}
    </svg>
  );
}

// ----- exam card -----

function ExamCard({ exam }: { exam: PulseExam }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-edge bg-surface-2 p-3">
      <ReadinessGauge pct={exam.readiness} size={90} />
      <div className="text-center">
        <div className="flex items-center justify-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: exam.color }} />
          <span className="truncate text-xs font-semibold text-ink">{exam.name}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-ink-muted">
          {fmtDate(exam.date)} · {exam.daysUntil}d away
        </div>
        {exam.atRiskCount > 0 && (
          <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-red-400">
            <TrendingDown size={10} /> {exam.atRiskCount} at-risk
          </div>
        )}
      </div>
    </div>
  );
}

// ----- at-risk concept row -----

function AtRiskRow({
  concept,
  onReview,
  onAddToCrunch,
}: {
  concept: PulseConcept;
  onReview: (deckId: string) => void;
  onAddToCrunch: (concept: PulseConcept) => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-edge bg-surface-2 p-2.5 transition hover:border-red-500/30">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
        <TrendingDown size={15} className="text-red-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-ink">{concept.label}</div>
        <div className="flex items-center gap-2 text-[10px] text-ink-muted">
          <span className={masteryColor(concept.currentMastery)}>
            now {masteryPct(concept.currentMastery)}
          </span>
          <span className="text-ink-muted">→</span>
          <span className={masteryColor(concept.predictedMastery)}>
            exam {masteryPct(concept.predictedMastery)}
          </span>
          <span className="flex items-center gap-0.5">
            <Clock size={9} /> {concept.daysUntilForgotten}d left
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={() => concept.deckIds[0] && onReview(concept.deckIds[0])}
          className="flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent transition hover:bg-accent/20"
        >
          <Brain size={11} /> Review
        </button>
        <button
          onClick={() => onAddToCrunch(concept)}
          className="flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-[10px] font-medium text-ink-muted transition hover:text-ink"
        >
          <CalendarClock size={11} /> Crunch
        </button>
      </div>
    </div>
  );
}

// ----- main component -----

export default function PulseApp({ win: _win }: { win: WindowInstance }) {
  const [state, setState] = useState<PulseState | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { open } = useWindows();

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await pulseApi.get();
      setState(s);
      if (s.status === "building") {
        setBuilding(true);
        startPolling();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Pulse forecast");
    } finally {
      setLoading(false);
    }
  }, []);

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

  useEffect(() => { void load(); }, [load]);

  // Check for a focus signal from the Athena open_pulse client action.
  useEffect(() => {
    if (!state?.data || !_win?.id) return;
    const focus = sessionStorage.getItem(`pulse:focus:${_win.id}`);
    if (focus) {
      sessionStorage.removeItem(`pulse:focus:${_win.id}`);
    }
  }, [state?.data, _win?.id]);

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

  const reviewDeck = (deckId: string) => {
    open({ appId: "flashcards", title: "Flashcards", icon: "Brain", payload: { deckId } });
  };

  const addToCrunch = (_concept: PulseConcept) => {
    // Open Crunch so the user can re-insert the at-risk concept into their plan.
    open({ appId: "crunch", title: "Crunch", icon: "CalendarClock" });
  };

  const data = state?.data ?? null;
  const stale = state?.stale ?? false;
  const atRiskConcepts = useMemo(() =>
    data ? data.concepts.filter((c) => c.atRisk).sort((a, b) => a.daysUntilForgotten - b.daysUntilForgotten) : [],
    [data],
  );

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-accent" />
          <span className="text-sm font-semibold text-ink">Pulse</span>
          {data && (
            <span className="text-[11px] text-ink-muted">
              {data.stats.cardCount} cards · {data.stats.conceptCount} concepts · {data.stats.atRiskCount} at-risk
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {data && (
            <>
              {stale && !building && (
                <button
                  onClick={rebuild}
                  className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-500/20"
                >
                  <RefreshCw size={12} /> Stale — rebuild
                </button>
              )}
              <button
                onClick={rebuild}
                disabled={building}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-50"
              >
                <RefreshCw size={13} /> Refresh
              </button>
              <button
                onClick={deleteForecast}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Building progress */}
      {building && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-edge bg-surface-2 p-3 text-xs text-ink-muted">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-accent" />
              Fitting forgetting curves + forecasting mastery…
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-1/3 animate-progress-slide rounded-full bg-accent" />
          </div>
          <span>Reading your flashcard review history, fitting FSRS-style curves per card, and projecting retention to your exam dates…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle size={14} /> {error}
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
            <Activity size={32} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Know what you'll have forgotten by exam day</p>
            <p className="mt-1 max-w-sm text-xs text-ink-muted">
              Pulse fits a forgetting curve to each of your flashcards from review history, then forecasts your mastery on each exam date. Find at-risk concepts before you forget them.
            </p>
          </div>
          <button
            onClick={build}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90"
          >
            <Sparkles size={15} /> Build my forecast
          </button>
          <p className="text-[10px] text-ink-muted">
            No AI provider needed — the forecast is deterministic. Exam dates come from your Crunch plan.
          </p>
        </div>
      )}

      {/* Forecast data */}
      {data && !building && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {/* Exam readiness gauges */}
          {data.exams.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <Target size={12} /> Exam readiness
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {data.exams.map((exam) => (
                  <ExamCard key={exam.id} exam={exam} />
                ))}
              </div>
            </div>
          )}

          {/* No exams notice */}
          {data.exams.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <CalendarClock size={14} />
              <span>No upcoming exams in your Crunch plan. Set up Crunch with exam dates to get per-exam readiness forecasts.</span>
            </div>
          )}

          {/* Forecast curve */}
          {data.forecast.length > 1 && (
            <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface-2 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  <Activity size={12} /> Mastery forecast
                </div>
                <div className="flex items-center gap-3 text-[10px] text-ink-muted">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-3 rounded-sm" style={{ background: "rgb(var(--accent))", opacity: 0.5 }} /> Projected mastery
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-3 rounded-sm" style={{ background: "#fbbf24" }} /> Exam
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-3 rounded-sm" style={{ background: "#f87171" }} /> At-risk (70%)
                  </span>
                </div>
              </div>
              <ForecastCurve points={data.forecast} exams={data.exams} />
              <div className="flex items-center justify-between text-[10px] text-ink-muted">
                <span>Today</span>
                <span>Avg half-life: {data.stats.avgHalfLife}d</span>
                <span>+{data.forecast[data.forecast.length - 1]?.day ?? 0}d</span>
              </div>
            </div>
          )}

          {/* At-risk feed */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <TrendingDown size={12} className="text-red-400" /> At-risk concepts
                {atRiskConcepts.length > 0 && (
                  <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-red-400">
                    {atRiskConcepts.length}
                  </span>
                )}
              </div>
            </div>
            {atRiskConcepts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                  <Brain size={18} className="text-emerald-400" />
                </div>
                <p className="text-xs font-medium text-emerald-300">No at-risk concepts</p>
                <p className="max-w-xs text-[10px] text-ink-muted">
                  All your tracked concepts are predicted to stay above the mastery threshold until your nearest exam. Keep reviewing to maintain this.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {atRiskConcepts.slice(0, 20).map((concept) => (
                  <AtRiskRow
                    key={concept.id}
                    concept={concept}
                    onReview={reviewDeck}
                    onAddToCrunch={addToCrunch}
                  />
                ))}
                {atRiskConcepts.length > 20 && (
                  <p className="py-1 text-center text-[10px] text-ink-muted">
                    + {atRiskConcepts.length - 20} more at-risk concepts
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Days until forgotten (all concepts) */}
          {data.concepts.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <Clock size={12} /> Days until forgotten
              </div>
              <div className="flex flex-col gap-1">
                {[...data.concepts]
                  .sort((a, b) => a.daysUntilForgotten - b.daysUntilForgotten)
                  .slice(0, 10)
                  .map((concept) => (
                    <button
                      key={concept.id}
                      onClick={() => concept.deckIds[0] && reviewDeck(concept.deckIds[0])}
                      className="group flex items-center gap-2 rounded-lg border border-edge bg-surface-2 p-2 text-left transition hover:border-accent/30"
                    >
                      <span className={`flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                        concept.daysUntilForgotten <= 3 ? "bg-red-500/15 text-red-400" :
                        concept.daysUntilForgotten <= 7 ? "bg-amber-500/15 text-amber-400" :
                        "bg-surface-3 text-ink-muted"
                      }`}>
                        {concept.daysUntilForgotten}d
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{concept.label}</span>
                      <span className={`text-[10px] ${masteryColor(concept.currentMastery)}`}>
                        {masteryPct(concept.currentMastery)}
                      </span>
                      <ChevronRight size={13} className="shrink-0 text-ink-muted transition group-hover:text-accent" />
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
