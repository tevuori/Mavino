// ===== Performance monitor runner =====
// Rendered at the app level (DesktopEnvironment / MobileShell) so it never
// unmounts when the Settings window closes. Reads `enabled` from the
// performance store and drives the usePerformanceMonitor hook, writing
// results back to the store for the Settings section to display.

import { useEffect, useRef } from "react";
import { usePerformanceMonitor } from "../apps/settings/usePerformanceMonitor";
import { usePerformanceStore } from "../store/performance";

export default function PerformanceMonitorRunner() {
  const enabled = usePerformanceStore((s) => s.enabled);
  const setSamples = usePerformanceStore((s) => s.setSamples);
  const setSummary = usePerformanceStore((s) => s.setSummary);
  const setRunning = usePerformanceStore((s) => s.setRunning);

  const { samples, summary, running, clear } = usePerformanceMonitor(enabled);
  const clearRef = useRef(clear);
  clearRef.current = clear;

  // Sync hook results to the store whenever they change.
  useEffect(() => { setSamples(samples); }, [samples, setSamples]);
  useEffect(() => { setSummary(summary); }, [summary, setSummary]);
  useEffect(() => { setRunning(running); }, [running, setRunning]);

  // Wire the hook's clear function into the store so the Settings section
  // can call it via usePerformanceStore.getState().clear().
  useEffect(() => {
    usePerformanceStore.setState({ clear: () => clearRef.current() });
  }, []);

  return null;
}
