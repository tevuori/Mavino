import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle, Loader2, Trash2, Check, Filter, RefreshCw, Server, Monitor } from "lucide-react";
import { adminErrorsApi, type ErrorLogItem, type ErrorLogStats } from "../../../services/admin-errors";
import { SectionHeader, Card, StatusPill, MsgBox } from "../ui";
import { confirmDialog } from "../../../store/mobileDialog";

export default function ErrorLogSection() {
  const [items, setItems] = useState<ErrorLogItem[]>([]);
  const [stats, setStats] = useState<ErrorLogStats | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unresolved" | "client" | "server">("unresolved");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params: { source?: "client" | "server"; resolved?: boolean; limit?: number } = { limit: 200 };
      if (filter === "client") params.source = "client";
      else if (filter === "server") params.source = "server";
      else if (filter === "unresolved") params.resolved = false;

      const [list, s] = await Promise.all([
        adminErrorsApi.list(params),
        adminErrorsApi.stats(),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setStats(s);
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const resolve = async (id: string) => {
    try {
      await adminErrorsApi.resolve(id);
      await refresh();
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to resolve");
    }
  };

  const resolveAll = async () => {
    try {
      const r = await adminErrorsApi.resolveAll();
      setMsg(`Resolved ${r.count} errors.`);
      await refresh();
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  };

  const remove = async (id: string) => {
    if (!(await confirmDialog("Delete this error log entry?", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await adminErrorsApi.delete(id);
      await refresh();
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const deleteResolved = async () => {
    if (!(await confirmDialog("Delete all resolved error log entries? This cannot be undone.", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      const r = await adminErrorsApi.deleteResolved();
      setMsg(`Deleted ${r.count} resolved entries.`);
      await refresh();
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  };

  const fmtTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString();
  };

  return (
    <section id="error-logs" className="mb-8">
      <SectionHeader
        icon={<AlertTriangle size={18} />}
        title="Error Logs"
        description="Monitor client and server errors. Know about outages before users report them."
      />

      {/* Stats cards */}
      {stats && (
        <div className="mb-4 grid grid-cols-4 gap-2">
          <Card className="p-3">
            <p className="text-xs text-ink-muted">Total</p>
            <p className="text-xl font-bold text-ink">{stats.total}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-ink-muted">Unresolved</p>
            <p className={`text-xl font-bold ${stats.unresolved > 0 ? "text-red-500" : "text-emerald-500"}`}>
              {stats.unresolved}
            </p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-ink-muted">Last 24h</p>
            <p className={`text-xl font-bold ${stats.last24h > 0 ? "text-amber-500" : "text-ink"}`}>
              {stats.last24h}
            </p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-ink-muted">Client / Server</p>
            <p className="text-xl font-bold text-ink">{stats.client} / {stats.server}</p>
          </Card>
        </div>
      )}

      {/* Filter + actions */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter size={14} className="text-ink-muted" />
        {(["unresolved", "all", "client", "server"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              filter === f ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted hover:text-ink"
            }`}
          >
            {f === "unresolved" ? "Unresolved" : f === "all" ? "All" : f === "client" ? "Client" : "Server"}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
        >
          <RefreshCw size={12} /> Refresh
        </button>
        <button
          onClick={resolveAll}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
        >
          <Check size={12} /> Resolve all
        </button>
        <button
          onClick={deleteResolved}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 text-xs text-ink-muted hover:text-red-500"
        >
          <Trash2 size={12} /> Clear resolved
        </button>
      </div>

      <MsgBox msg={msg} error={err} />

      {/* Error list */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-ink-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card className="py-8 text-center">
          <CheckCircle size={32} className="mx-auto mb-2 text-emerald-500" />
          <p className="text-sm text-ink-muted">No errors to show. All clear!</p>
        </Card>
      ) : (
        <Card className="p-0">
          <p className="border-b border-edge px-3 py-2 text-xs text-ink-muted">
            Showing {items.length} of {total} errors
          </p>
          <div className="max-h-[500px] overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="border-b border-edge last:border-0">
                <div
                  className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-surface-2"
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                >
                  <div className="mt-0.5 shrink-0">
                    {item.source === "server" ? (
                      <Server size={14} className="text-red-500" />
                    ) : (
                      <Monitor size={14} className="text-amber-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${item.resolved ? "text-ink-muted line-through" : "text-ink"}`}>
                      {item.message}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                      <span>{fmtTime(item.timestamp)}</span>
                      {item.user && <span>· {item.user.username}</span>}
                      {item.url && <span className="truncate">· {item.url.slice(0, 60)}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.resolved ? (
                      <StatusPill on={true} onLabel="Resolved" offLabel="" />
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); void resolve(item.id); }}
                        className="rounded p-1 text-ink-muted hover:text-emerald-500"
                        title="Mark resolved"
                      >
                        <Check size={14} />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); void remove(item.id); }}
                      className="rounded p-1 text-ink-muted hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {expanded === item.id && item.stack && (
                  <div className="bg-surface-3 px-3 py-2">
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-ink-muted">
                      {item.stack}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}
