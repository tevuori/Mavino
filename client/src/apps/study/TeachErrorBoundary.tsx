// ===== Error boundary for the Teach Me surface =====
// A crash while rendering a lesson (bad markdown, an unexpected tool payload)
// must not take the whole Study Hub down with it.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class TeachErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Teach Me crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle size={28} className="text-warning" />
        <p className="text-sm text-ink">Teach Me hit an unexpected error.</p>
        <p className="max-w-md text-xs text-ink-muted">{error.message}</p>
        <button
          onClick={() => this.setState({ error: null })}
          className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs text-ink hover:bg-surface-2"
        >
          <RotateCcw size={12} /> Reload the lesson
        </button>
      </div>
    );
  }
}
