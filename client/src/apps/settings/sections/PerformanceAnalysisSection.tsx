import { useState, useRef, useEffect } from "react";
import {
  Activity, Gauge, Cpu, MemoryStick, Clock, Network, Zap,
  AlertTriangle, CheckCircle, Trash2, CircleDot,
} from "lucide-react";
import { usePerformanceMonitor, type PerfSample } from "../usePerformanceMonitor";
import { SectionHeader, Card, ToggleRow } from "../ui";

export default function PerformanceAnalysisSection() {
  const [enabled, setEnabled] = useState(false);
  const { samples, summary, running, clear } = usePerformanceMonitor(enabled);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the log to the latest entry.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [samples.length]);

  return (
    <section id="performance" className="mb-8">
      <SectionHeader
        icon={<Activity size={18} />}
        title="Performance Analysis"
        description="Real-time browser metrics to assess app stability. Enable to start collecting FPS, memory, long tasks, event loop lag, and DOM size. Admin only."
      />

      <div className="mb-4">
        <ToggleRow
          label="Enable performance monitoring"
          description={running ? "Collecting metrics every 2 seconds…" : "Turn on to start gathering real-time performance data"}
          on={enabled}
          onClick={() => setEnabled((v) => !v)}
        />
      </div>

      {enabled && (
        <>
          {/* Stability verdict */}
          <Card className={`mb-4 ${summary.stable ? "border-emerald-500/30" : "border-amber-500/30"}`}>
            <div className="flex items-center gap-3">
              {summary.samples < 3 ? (
                <>
                  <CircleDot size={24} className="animate-pulse text-accent" />
                  <div>
                    <p className="text-sm font-semibold text-ink">Collecting data…</p>
                    <p className="text-xs text-ink-muted">
                      {summary.samples} sample{summary.samples === 1 ? "" : "s"} gathered — need at least 3 for assessment
                    </p>
                  </div>
                </>
              ) : summary.stable ? (
                <>
                  <CheckCircle size={24} className="text-emerald-500" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-400">App is stable</p>
                    <p className="text-xs text-ink-muted">
                      No performance issues detected across {summary.samples} samples
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle size={24} className="text-amber-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-amber-400">App is unstable</p>
                    <p className="text-xs text-ink-muted">
                      {summary.issues.length} issue{summary.issues.length === 1 ? "" : "s"} detected — see log below
                    </p>
                  </div>
                </>
              )}
              {samples.length > 0 && (
                <button
                  onClick={clear}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
                >
                  <Trash2 size={12} /> Clear log
                </button>
              )}
            </div>

            {/* Issues list */}
            {summary.issues.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-edge pt-3">
                {summary.issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-300">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Summary stats */}
          <div className="mb-4 grid grid-cols-2 gap-2 @lg:grid-cols-4">
            <StatCard
              icon={<Gauge size={16} />}
              label="Avg FPS"
              value={summary.avgFps > 0 ? String(summary.avgFps) : "—"}
              sub={summary.minFps > 0 ? `min ${summary.minFps} · max ${summary.maxFps}` : "measuring…"}
              status={summary.avgFps >= 55 ? "good" : summary.avgFps >= 40 ? "warn" : summary.avgFps > 0 ? "bad" : "neutral"}
            />
            <StatCard
              icon={<Clock size={16} />}
              label="Event Loop Lag"
              value={`${summary.avgLagMs}ms`}
              sub={`max ${summary.maxLagMs}ms`}
              status={summary.maxLagMs <= 50 ? "good" : summary.maxLagMs <= 100 ? "warn" : "bad"}
            />
            <StatCard
              icon={<Zap size={16} />}
              label="Long Tasks"
              value={String(summary.totalLongTasks)}
              sub={summary.longestTaskMs > 0 ? `longest ${summary.longestTaskMs}ms` : "none >50ms"}
              status={summary.totalLongTasks <= 2 ? "good" : summary.totalLongTasks <= 10 ? "warn" : "bad"}
            />
            <StatCard
              icon={<MemoryStick size={16} />}
              label="JS Heap"
              value={summary.avgHeapMB !== null ? `${summary.avgHeapMB}MB` : "N/A"}
              sub={summary.maxHeapMB !== null ? `max ${summary.maxHeapMB}MB` : "Chromium only"}
              status={
                summary.maxHeapMB === null ? "neutral"
                : summary.maxHeapMB <= 100 ? "good"
                : summary.maxHeapMB <= 200 ? "warn" : "bad"
              }
            />
          </div>

          {/* Live log */}
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-accent" />
                <span className="text-xs font-semibold text-ink">Performance Log</span>
                {running && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> LIVE
                  </span>
                )}
              </div>
              <span className="text-[10px] text-ink-muted">{samples.length} entries</span>
            </div>

            <div className="max-h-[400px] overflow-y-auto p-2 font-mono text-[11px]">
              {samples.length === 0 ? (
                <p className="py-4 text-center text-ink-muted">Waiting for first sample…</p>
              ) : (
                samples.map((s, i) => <LogEntry key={i} sample={s} index={i} />)
              )}
              <div ref={logEndRef} />
            </div>
          </Card>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-ink-muted">
            <span className="flex items-center gap-1"><Cpu size={11} /> FPS via requestAnimationFrame</span>
            <span className="flex items-center gap-1"><Clock size={11} /> Lag via setTimeout(0) delay</span>
            <span className="flex items-center gap-1"><Zap size={11} /> Long tasks via PerformanceObserver (&gt;50ms)</span>
            <span className="flex items-center gap-1"><MemoryStick size={11} /> Heap via performance.memory (Chromium)</span>
            <span className="flex items-center gap-1"><Network size={11} /> Pending fetches via patched fetch</span>
          </div>
        </>
      )}
    </section>
  );
}

function StatCard({
  icon, label, value, sub, status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  status: "good" | "warn" | "bad" | "neutral";
}) {
  const color =
    status === "good" ? "text-emerald-400"
    : status === "warn" ? "text-amber-400"
    : status === "bad" ? "text-red-400"
    : "text-ink";
  const border =
    status === "good" ? "border-emerald-500/20"
    : status === "warn" ? "border-amber-500/20"
    : status === "bad" ? "border-red-500/20"
    : "border-edge";
  return (
    <div className={`rounded-lg border ${border} bg-surface-2 p-3`}>
      <div className="flex items-center gap-1.5 text-ink-muted">
        {icon}
        <span className="text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-ink-muted">{sub}</p>
    </div>
  );
}

function LogEntry({ sample, index }: { sample: PerfSample; index: number }) {
  const time = new Date(sample.ts).toLocaleTimeString([], { hour12: false });
  const fpsStatus = sample.fps >= 55 ? "good" : sample.fps >= 40 ? "warn" : sample.fps > 0 ? "bad" : "neutral";
  const lagStatus = sample.eventLoopLagMs <= 50 ? "good" : sample.eventLoopLagMs <= 100 ? "warn" : "bad";
  const taskStatus = sample.longTaskCount === 0 ? "good" : sample.longTaskCount <= 2 ? "warn" : "bad";

  const colorClass = (s: string) =>
    s === "good" ? "text-emerald-400"
    : s === "warn" ? "text-amber-400"
    : s === "bad" ? "text-red-400"
    : "text-ink-muted";

  return (
    <div className="flex items-center gap-3 border-b border-edge/30 py-1 last:border-0">
      <span className="shrink-0 text-ink-muted/60">{String(index + 1).padStart(3, "0")}</span>
      <span className="shrink-0 text-ink-muted">{time}</span>
      <span className={`shrink-0 ${colorClass(fpsStatus)}`}>
        <Gauge size={10} className="mr-0.5 inline" />
        {sample.fps > 0 ? `${sample.fps}fps` : "—"}
      </span>
      <span className={`shrink-0 ${colorClass(lagStatus)}`}>
        <Clock size={10} className="mr-0.5 inline" />
        {sample.eventLoopLagMs}ms
      </span>
      <span className={`shrink-0 ${colorClass(taskStatus)}`}>
        <Zap size={10} className="mr-0.5 inline" />
        {sample.longTaskCount > 0 ? `${sample.longTaskCount}lt/${sample.longestTaskMs}ms` : "0lt"}
      </span>
      {sample.jsHeapMB !== null && (
        <span className="shrink-0 text-sky-400">
          <MemoryStick size={10} className="mr-0.5 inline" />
          {sample.jsHeapMB}MB
        </span>
      )}
      <span className="shrink-0 text-violet-400">
        <Cpu size={10} className="mr-0.5 inline" />
        {sample.domNodes}dom
      </span>
      {sample.pendingFetches > 0 && (
        <span className="shrink-0 text-amber-400">
          <Network size={10} className="mr-0.5 inline" />
          {sample.pendingFetches}req
        </span>
      )}
    </div>
  );
}
