// ===== Performance monitor hook =====
// Collects real browser performance metrics at a fixed interval and exposes
// them as a rolling log. Used by the admin-only Performance Analysis settings
// section to assess app stability.
//
// Metrics collected:
//  - FPS: measured via requestAnimationFrame frame timestamps
//  - Memory: performance.memory (Chromium-only) — JS heap size
//  - Long tasks: PerformanceObserver for tasks > 50ms (jank indicator)
//  - Event loop lag: time between setTimeout(0) schedule and fire
//  - DOM nodes: document.querySelectorAll("*").length
//  - Network: pending fetch count (via monkey-patched fetch)
//
// All metrics are gathered passively — no synthetic workloads are injected.

import { useEffect, useRef, useState, useCallback } from "react";

export interface PerfSample {
  ts: number;
  fps: number;
  jsHeapMB: number | null;
  jsHeapLimitMB: number | null;
  longTaskCount: number; // tasks >50ms since last sample
  longestTaskMs: number; // duration of the longest task since last sample
  eventLoopLagMs: number;
  domNodes: number;
  pendingFetches: number;
}

export interface PerfSummary {
  avgFps: number;
  minFps: number;
  maxFps: number;
  avgLagMs: number;
  maxLagMs: number;
  totalLongTasks: number;
  longestTaskMs: number;
  avgHeapMB: number | null;
  maxHeapMB: number | null;
  avgDomNodes: number;
  samples: number;
  /** Overall stability verdict based on thresholds. */
  stable: boolean;
  /** Human-readable list of issues found. */
  issues: string[];
}

const SAMPLE_INTERVAL_MS = 2000;
const MAX_SAMPLES = 60; // 2 minutes of history at 2s interval

export function usePerformanceMonitor(enabled: boolean) {
  const [samples, setSamples] = useState<PerfSample[]>([]);
  const [running, setRunning] = useState(false);
  const fpsFramesRef = useRef<number[]>([]);
  const longTasksRef = useRef<{ count: number; longest: number }>({ count: 0, longest: 0 });
  const pendingFetchesRef = useRef(0);
  const rafRef = useRef<number | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const observerRef = useRef<PerformanceObserver | null>(null);

  // FPS measurement: collect rAF timestamps, compute FPS per interval.
  useEffect(() => {
    if (!enabled) return;

    let lastFrame = performance.now();
    const onFrame = (now: number) => {
      const delta = now - lastFrame;
      if (delta > 0) {
        fpsFramesRef.current.push(1000 / delta);
        // Keep only last 60 frames to bound memory.
        if (fpsFramesRef.current.length > 60) fpsFramesRef.current.shift();
      }
      lastFrame = now;
      rafRef.current = requestAnimationFrame(onFrame);
    };
    rafRef.current = requestAnimationFrame(onFrame);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fpsFramesRef.current = [];
    };
  }, [enabled]);

  // Long task observer: counts tasks > 50ms (visible jank).
  useEffect(() => {
    if (!enabled) return;
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasksRef.current.count++;
          if (entry.duration > longTasksRef.current.longest) {
            longTasksRef.current.longest = entry.duration;
          }
        }
      });
      obs.observe({ entryTypes: ["longtask"] });
      observerRef.current = obs;
    } catch {
      // longtask not supported (Firefox/Safari) — silently skip.
    }
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [enabled]);

  // Monkey-patch fetch to track pending requests.
  useEffect(() => {
    if (!enabled) return;
    const origFetch = window.fetch;
    window.fetch = function patchedFetch(...args: Parameters<typeof fetch>) {
      pendingFetchesRef.current++;
      return origFetch.apply(this, args).finally(() => {
        pendingFetchesRef.current = Math.max(0, pendingFetchesRef.current - 1);
      });
    };
    return () => {
      window.fetch = origFetch;
      pendingFetchesRef.current = 0;
    };
  }, [enabled]);

  // Sampling interval: every 2s, gather a PerfSample.
  useEffect(() => {
    if (!enabled) {
      setRunning(false);
      setSamples([]);
      return;
    }
    setRunning(true);

    const takeSample = () => {
      const frames = fpsFramesRef.current;
      const fps = frames.length > 0
        ? Math.round(frames.reduce((a, b) => a + b, 0) / frames.length)
        : 0;
      fpsFramesRef.current = [];

      // Event loop lag: schedule a setTimeout(0) and measure delay.
      const lagStart = performance.now();
      setTimeout(() => {
        const lag = performance.now() - lagStart;

        // Memory (Chromium-only).
        const mem = (performance as any).memory;
        const jsHeapMB = mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
        const jsHeapLimitMB = mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null;

        // DOM node count.
        const domNodes = document.querySelectorAll("*").length;

        // Long tasks since last sample.
        const lt = longTasksRef.current;
        longTasksRef.current = { count: 0, longest: 0 };

        const sample: PerfSample = {
          ts: Date.now(),
          fps,
          jsHeapMB,
          jsHeapLimitMB,
          longTaskCount: lt.count,
          longestTaskMs: Math.round(lt.longest),
          eventLoopLagMs: Math.round(lag),
          domNodes,
          pendingFetches: pendingFetchesRef.current,
        };

        setSamples((prev) => {
          const next = [...prev, sample];
          if (next.length > MAX_SAMPLES) next.shift();
          return next;
        });
      }, 0);
    };

    intervalRef.current = setInterval(takeSample, SAMPLE_INTERVAL_MS);
    // Take an immediate first sample.
    takeSample();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setRunning(false);
    };
  }, [enabled]);

  const clear = useCallback(() => setSamples([]), []);

  const summary: PerfSummary = computeSummary(samples);

  return { samples, summary, running, clear };
}

function computeSummary(samples: PerfSample[]): PerfSummary {
  if (samples.length === 0) {
    return {
      avgFps: 0, minFps: 0, maxFps: 0,
      avgLagMs: 0, maxLagMs: 0,
      totalLongTasks: 0, longestTaskMs: 0,
      avgHeapMB: null, maxHeapMB: null,
      avgDomNodes: 0, samples: 0,
      stable: true, issues: [],
    };
  }

  const fpsValues = samples.map((s) => s.fps).filter((f) => f > 0);
  const lagValues = samples.map((s) => s.eventLoopLagMs);
  const heapValues = samples.map((s) => s.jsHeapMB).filter((v): v is number => v !== null);
  const domValues = samples.map((s) => s.domNodes);
  const totalLongTasks = samples.reduce((a, s) => a + s.longTaskCount, 0);
  const longestTaskMs = samples.reduce((a, s) => Math.max(a, s.longestTaskMs), 0);

  const avgFps = fpsValues.length > 0 ? Math.round(fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length) : 0;
  const minFps = fpsValues.length > 0 ? Math.min(...fpsValues) : 0;
  const maxFps = fpsValues.length > 0 ? Math.max(...fpsValues) : 0;
  const avgLagMs = Math.round(lagValues.reduce((a, b) => a + b, 0) / lagValues.length);
  const maxLagMs = Math.max(...lagValues);
  const avgHeapMB = heapValues.length > 0 ? Math.round(heapValues.reduce((a, b) => a + b, 0) / heapValues.length) : null;
  const maxHeapMB = heapValues.length > 0 ? Math.max(...heapValues) : null;
  const avgDomNodes = Math.round(domValues.reduce((a, b) => a + b, 0) / domValues.length);

  // Stability assessment.
  const issues: string[] = [];

  if (avgFps > 0 && avgFps < 50) issues.push(`Low average FPS (${avgFps}) — UI may feel sluggish`);
  if (minFps > 0 && minFps < 30) issues.push(`FPS dropped to ${minFps} — visible jank detected`);
  if (maxLagMs > 100) issues.push(`Event loop lag peaked at ${maxLagMs}ms — main thread blocked`);
  if (avgLagMs > 50) issues.push(`Average event loop lag ${avgLagMs}ms — responsive but not smooth`);
  if (totalLongTasks > 5) issues.push(`${totalLongTasks} long tasks (>50ms) — rendering or computation blocking the main thread`);
  if (longestTaskMs > 200) issues.push(`Longest task was ${longestTaskMs}ms — severe main thread blockage`);
  if (maxHeapMB !== null && maxHeapMB > 200) issues.push(`JS heap peaked at ${maxHeapMB}MB — potential memory pressure`);
  if (avgDomNodes > 5000) issues.push(`${avgDomNodes} DOM nodes on average — large DOM may slow layout/paint`);

  const stable = issues.length === 0;

  return {
    avgFps, minFps, maxFps,
    avgLagMs, maxLagMs,
    totalLongTasks, longestTaskMs,
    avgHeapMB, maxHeapMB,
    avgDomNodes, samples: samples.length,
    stable, issues,
  };
}
