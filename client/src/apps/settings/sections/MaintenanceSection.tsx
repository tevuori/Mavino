import { useCallback, useEffect, useState } from "react";
import { Clock3, Loader2, Play, Square, Wrench } from "lucide-react";
import { maintenanceApi, type MaintenanceStatus } from "../../../services/maintenance";
import { useMaintenance } from "../../../store/maintenance";
import { confirmDialog } from "../../../store/mobileDialog";
import { Card, Field, MsgBox, SectionHeader, StatusPill, inputClass } from "../ui";

function localInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function MaintenanceSection() {
  const setGlobalStatus = useMaintenance((s) => s.setStatus);
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [duration, setDuration] = useState("60");
  const [indefinite, setIndefinite] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [message, setMessage] = useState("Mavino is temporarily unavailable while maintenance is in progress.");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await maintenanceApi.adminStatus();
      setStatus(next);
      setGlobalStatus(next);
      setMessage(next.message);
      if (next.scheduled) {
        setStartsAt(localInput(next.startsAt));
        setEndsAt(localInput(next.endsAt));
      }
    } catch (e) {
      setError(true);
      setMsg(e instanceof Error ? e.message : "Failed to load maintenance status");
    }
  }, [setGlobalStatus]);

  useEffect(() => { void refresh(); }, [refresh]);

  const start = async () => {
    setError(false);
    setMsg(null);
    let startIso: string;
    let endIso: string | null;
    if (mode === "schedule") {
      if (!startsAt || !endsAt) {
        setError(true);
        setMsg("Choose both a start and end time.");
        return;
      }
      startIso = new Date(startsAt).toISOString();
      endIso = new Date(endsAt).toISOString();
      if (new Date(endIso) <= new Date(startIso)) {
        setError(true);
        setMsg("The end time must be after the start time.");
        return;
      }
    } else {
      const minutes = Number(duration);
      if (!indefinite && (!Number.isFinite(minutes) || minutes < 1)) {
        setError(true);
        setMsg("Duration must be at least one minute.");
        return;
      }
      const now = new Date();
      startIso = now.toISOString();
      endIso = indefinite ? null : new Date(now.getTime() + minutes * 60_000).toISOString();
    }
    const confirmed = await confirmDialog(
      mode === "schedule"
        ? "Schedule this maintenance window? Non-admin users will be blocked when it begins."
        : "Start maintenance mode? All non-admin users will be blocked immediately.",
      { danger: true, confirmLabel: mode === "schedule" ? "Schedule" : "Start" }
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const next = await maintenanceApi.save({ enabled: true, startsAt: startIso, endsAt: endIso, message });
      setStatus(next);
      setGlobalStatus(next);
      setMsg(next.scheduled ? "Maintenance window scheduled." : "Maintenance mode started.");
    } catch (e) {
      setError(true);
      setMsg(e instanceof Error ? e.message : "Failed to update maintenance mode");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!(await confirmDialog("Stop or cancel maintenance mode?", { confirmLabel: "Stop" }))) return;
    setBusy(true);
    setError(false);
    try {
      const next = await maintenanceApi.stop();
      setStatus(next);
      setGlobalStatus(next);
      setMsg("Maintenance mode is off.");
    } catch (e) {
      setError(true);
      setMsg(e instanceof Error ? e.message : "Failed to stop maintenance mode");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="maintenance" className="mb-8">
      <SectionHeader
        icon={<Wrench size={18} />}
        title="Maintenance Mode"
        description="Temporarily freeze Mavino for every role except administrators. API access is blocked immediately and active clients update within 15 seconds."
      />

      <Card className="mb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">Current status</p>
            {status?.scheduled && status.startsAt && (
              <p className="mt-1 text-xs text-ink-muted">Starts {new Date(status.startsAt).toLocaleString()}</p>
            )}
            {status?.active && status.endsAt && (
              <p className="mt-1 text-xs text-ink-muted">Ends {new Date(status.endsAt).toLocaleString()}</p>
            )}
          </div>
          {!status ? (
            <Loader2 size={16} className="animate-spin text-ink-muted" />
          ) : (
            <StatusPill
              on={status.active || status.scheduled}
              onLabel={status.active ? "Active" : "Scheduled"}
              offLabel="Off"
            />
          )}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex rounded-lg bg-surface p-1">
          <button
            onClick={() => setMode("now")}
            className={`flex-1 rounded-md px-3 py-2 text-sm ${mode === "now" ? "bg-surface-3 text-ink" : "text-ink-muted"}`}
          >
            Start now
          </button>
          <button
            onClick={() => setMode("schedule")}
            className={`flex-1 rounded-md px-3 py-2 text-sm ${mode === "schedule" ? "bg-surface-3 text-ink" : "text-ink-muted"}`}
          >
            Schedule window
          </button>
        </div>

        <div className="space-y-3">
          {mode === "now" ? (
            <>
              <Field label="Duration in minutes" hint="Choose indefinite to stop it manually instead.">
                <input
                  type="number"
                  min="1"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  disabled={indefinite}
                  className={inputClass}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={indefinite}
                  onChange={(e) => setIndefinite(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Run until manually stopped
              </label>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Starts">
                <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Ends">
                <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputClass} />
              </Field>
            </div>
          )}

          <Field label="Message shown to users">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 500))}
              rows={4}
              maxLength={500}
              className={`${inputClass} resize-y`}
            />
          </Field>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={start}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-warning px-3 py-2 text-sm font-medium text-white hover:brightness-95 disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : mode === "now" ? <Play size={14} /> : <Clock3 size={14} />}
              {mode === "now" ? "Start maintenance" : "Schedule maintenance"}
            </button>
            {(status?.active || status?.scheduled) && (
              <button
                onClick={stop}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:bg-surface-3 hover:text-ink disabled:opacity-40"
              >
                <Square size={14} /> Stop / cancel
              </button>
            )}
          </div>
          <MsgBox msg={msg} error={error} />
        </div>
      </Card>
    </section>
  );
}
