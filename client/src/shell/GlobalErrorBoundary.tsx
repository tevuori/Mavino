/**
 * Global error boundary — catches React render crashes anywhere in the app
 * and reports them to the server. Shows a fallback UI with a reload button
 * instead of a blank white screen.
 *
 * As a safety net, it also detects stale-chunk errors ("Failed to fetch
 * dynamically imported module") that escape the lazyImport wrapper and
 * auto-reloads with a cache-busting query param to pick up the new
 * index.html.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { reportError } from "../services/errorReporter";
import { isStaleChunkError, reloadWithCacheBust } from "../services/stale-chunk";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[athena] React render crash:", error, info.componentStack);

    // Stale chunk after a deploy — the lazyImport wrapper in registry.tsx
    // and the unhandledrejection handler in errorReporter.ts are supposed
    // to catch this first, but in some browsers/edge cases the error
    // reaches this boundary. Auto-reload with a cache-busting query param
    // so the browser fetches a fresh index.html with the new chunk hashes.
    if (isStaleChunkError(error)) {
      reloadWithCacheBust();
      return; // don't report — this is expected after a deploy
    }

    reportError({
      message: error.message,
      stack: error.stack,
      source: "react-error-boundary",
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Show a loading spinner instead of the error screen while the
    // stale-chunk auto-reload is in progress.
    if (error && isStaleChunkError(error)) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-slate-950">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        </div>
      );
    }

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-slate-950 p-8 text-center">
        <AlertTriangle size={32} className="text-amber-400" />
        <div>
          <p className="text-base font-semibold text-slate-200">Something went wrong</p>
          <p className="mt-1 max-w-md text-sm text-slate-400">{error.message}</p>
        </div>
        <button
          onClick={() => {
            this.setState({ error: null });
            location.reload();
          }}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <RotateCcw size={14} /> Reload
        </button>
      </div>
    );
  }
}
