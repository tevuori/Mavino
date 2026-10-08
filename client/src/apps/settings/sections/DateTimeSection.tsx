import { useState, useEffect, useCallback, useMemo } from "react";
import { Clock, Globe, Loader2, Check } from "lucide-react";
import { settingsApi } from "../../../services/settings";
import { SectionHeader, Card, Field, SaveButton, MsgBox, inputClass } from "../ui";

/**
 * Curated fallback list of common IANA timezones, used when
 * Intl.supportedValuesOf("timeZone") is unavailable (older runtimes).
 * Grouped by region for readability.
 */
const FALLBACK_TIMEZONES: { group: string; zones: string[] }[] = [
  { group: "Europe", zones: ["Europe/Prague", "Europe/Berlin", "Europe/London", "Europe/Paris", "Europe/Madrid", "Europe/Rome", "Europe/Warsaw", "Europe/Vienna", "Europe/Amsterdam", "Europe/Brussels", "Europe/Stockholm", "Europe/Oslo", "Europe/Helsinki", "Europe/Athens", "Europe/Istanbul", "Europe/Moscow", "Europe/Dublin", "Europe/Lisbon", "Europe/Zurich", "Europe/Copenhagen"] },
  { group: "America", zones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Vancouver", "America/Mexico_City", "America/Sao_Paulo", "America/Buenos_Aires", "America/Bogota"] },
  { group: "Asia", zones: ["Asia/Tokyo", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore", "Asia/Seoul", "Asia/Kolkata", "Asia/Dubai", "Asia/Bangkok", "Asia/Jerusalem", "Asia/Tehran"] },
  { group: "Africa", zones: ["Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "Africa/Casablanca", "Africa/Nairobi"] },
  { group: "Oceania", zones: ["Australia/Sydney", "Australia/Melbourne", "Australia/Perth", "Pacific/Auckland", "Pacific/Honolulu"] },
  { group: "UTC", zones: ["UTC", "Etc/UTC", "Etc/GMT"] },
];

/** Detect the browser's current IANA timezone (best-effort). */
function detectBrowserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || null;
  } catch {
    return null;
  }
}

/** Get the full list of IANA timezones the runtime knows about. */
function getAllTimezones(): string[] {
  try {
    // Modern browsers + Bun expose the full IANA list.
    const supported = (Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    }).supportedValuesOf?.("timeZone");
    if (supported && supported.length) return supported;
  } catch {
    /* not supported */
  }
  // Fallback: flatten the curated list.
  return Array.from(new Set(FALLBACK_TIMEZONES.flatMap((g) => g.zones))).sort();
}

/** Group a flat zone list by region prefix for the <optgroup> layout. */
function groupZones(zones: string[]): { group: string; zones: string[] }[] {
  const map = new Map<string, string[]>();
  for (const z of zones) {
    const slash = z.indexOf("/");
    const group = slash > 0 ? z.slice(0, slash) : "Other";
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(z);
  }
  return Array.from(map.entries())
    .map(([group, zs]) => ({ group, zones: zs.sort() }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

export default function DateTimeSection() {
  const [timezone, setTimezone] = useState<string>("");
  const [serverTimezone, setServerTimezone] = useState<string>("");
  const [savedTimezone, setSavedTimezone] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const browserTz = useMemo(() => detectBrowserTimezone(), []);
  const grouped = useMemo(() => groupZones(getAllTimezones()), []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr(false);
    try {
      const info = await settingsApi.getTimezone();
      setTimezone(info.timezone);
      setServerTimezone(info.serverTimezone);
      setSavedTimezone(info.timezone);
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to load timezone");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dirty = timezone !== savedTimezone;

  const save = async () => {
    if (!timezone || !dirty) return;
    setSaving(true);
    setErr(false);
    setMsg(null);
    try {
      const info = await settingsApi.setTimezone(timezone);
      if ((info as { error?: string }).error) {
        setErr(true);
        setMsg((info as { error?: string }).error ?? "Failed to save");
        return;
      }
      setTimezone(info.timezone);
      setSavedTimezone(info.timezone);
      setMsg("Timezone saved. Scheduled notifications will now fire in your local time.");
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const useBrowserTz = () => {
    if (browserTz) setTimezone(browserTz);
  };

  // Live preview of "now" in the selected timezone.
  const nowPreview = useMemo(() => {
    if (!timezone) return "—";
    try {
      return new Date().toLocaleString(undefined, {
        timeZone: timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      return "—";
    }
  }, [timezone]);

  return (
    <section id="date-time" className="mb-8">
      <SectionHeader
        icon={<Clock size={18} />}
        title="Date & Time"
        description="Set your timezone so scheduled notifications (ntfy cron jobs, proactive alerts, reminders created by Mavino) fire at the correct local time. The server may run in a different timezone than you do."
      />

      <Card className="mb-4">
        {busy ? (
          <Loader2 size={16} className="animate-spin text-ink-muted" />
        ) : (
          <>
            <Field
              label="Your timezone"
              hint={
                browserTz
                  ? `Browser detected: ${browserTz}${browserTz === timezone ? " (in use)" : ""}`
                  : `Server timezone (fallback): ${serverTimezone}`
              }
            >
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={inputClass}
              >
                {grouped.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.zones.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>

            {browserTz && browserTz !== timezone && (
              <button
                onClick={useBrowserTz}
                className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
              >
                <Globe size={12} /> Use browser-detected timezone ({browserTz})
              </button>
            )}

            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-ink-muted">
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} /> Now in {timezone || "—"}:{" "}
                  <span className="text-ink">{nowPreview}</span>
                </span>
              </div>
              <SaveButton busy={saving} onClick={save} disabled={!dirty}>
                Save
              </SaveButton>
            </div>
            <MsgBox msg={msg} error={err} />
          </>
        )}
      </Card>

      <Card>
        <div className="flex items-start gap-3">
          <Check size={16} className="mt-0.5 text-success shrink-0" />
          <div className="text-xs text-ink-muted space-y-1.5">
            <p>
              This setting affects <b>ntfy cron jobs</b>, <b>proactive alerts</b>, and{" "}
              <b>reminders created by Mavino</b>. When you save, the next-fire times for your
              existing scheduled jobs are recomputed immediately so the change takes effect
              without waiting for the next tick.
            </p>
            <p>
              Reminders you create manually in the Reminders app already use your browser's
              timezone (the client converts to UTC before sending), so they are unaffected.
            </p>
            <p>
              If your server's system clock is in UTC (common for VPS deployments) and you
              don't set this, wall-clock cron fields like <code>0 8 * * *</code> will fire at
              08:00 server time — which may be hours off from your local 08:00.
            </p>
          </div>
        </div>
      </Card>
    </section>
  );
}
