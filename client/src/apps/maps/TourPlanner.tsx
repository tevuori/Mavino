// ===== Advanced multi-day hiking tour planner =====
// Sidebar panel for the Maps app. Lets the user pick a base point, number of
// days, difficulty, and mode (hub-and-spoke vs through-hike), then generates a
// multi-day tour via POST /api/mapy/tours/generate. Shows a day-by-day
// itinerary with per-day stats, overnight spots, hard-day warnings, and an
// LLM-narrated summary. The user can save the tour, export GPX, regenerate a
// single day, or schedule it to the Calendar.

import { useState } from "react";
import { confirmDialog, promptDialog } from "../../store/mobileDialog";
import {
  MapPin,
  Flag,
  CalendarDays,
  Gauge,
  Loader2,
  Save,
  Download,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Tent,
  Droplets,
  X,
  Plus,
} from "lucide-react";
import {
  tourApi,
  mapyApi,
  type TourMode,
  type TourDifficulty,
  type GeneratedTour,
  type TourSummary,
  type TourDay,
} from "../../services/maps";

interface Props {
  /** Resolve a place name to lat/lon (shared with the route planner). */
  resolvePlace: (name: string) => Promise<{ lat: number; lon: number; name: string } | null>;
  /** Draw the tour on the map — either a single day or all days overlaid.
   *  Passes full day data (pois, waypoints, overnight) so the map can render
   *  colorful category markers for water/sleep/sights/food/overnight. */
  onDrawTour: (days: {
    name: string;
    geometry: [number, number][];
    waypoints?: { name: string; lat: number; lon: number; type?: string }[];
    pois?: { name: string; lat: number; lon: number; category: string; description?: string }[];
    overnight?: { name: string; lat: number; lon: number; description?: string };
    wildCamp?: boolean;
  }[]) => void;
  /** Clear the map. */
  onClearMap: () => void;
}

const DIFFICULTY_LABELS: Record<TourDifficulty, string> = {
  easy: "Easy · ~10 km · ≤400 m",
  medium: "Medium · ~15 km · ≤800 m",
  hard: "Hard · ~20 km · ≤1200 m",
  expert: "Expert · ~28 km · ≤1600 m",
};

const DAY_COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
  "#06b6d4", "#a855f7", "#eab308", "#22c55e",
];

function fmtKm(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}
function fmtHours(s: number): string {
  const h = Math.round(s / 3600);
  return `${h}h`;
}

export default function TourPlanner({ resolvePlace, onDrawTour, onClearMap }: Props) {
  const [mode, setMode] = useState<TourMode>("hub");
  const [base, setBase] = useState("");
  const [end, setEnd] = useState("");
  const [numDays, setNumDays] = useState(3);
  const [difficulty, setDifficulty] = useState<TourDifficulty>("medium");
  const [notes, setNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tour, setTour] = useState<GeneratedTour | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null); // null = show all
  const [showSummary, setShowSummary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTours, setSavedTours] = useState<TourSummary[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [regeneratingDay, setRegeneratingDay] = useState<number | null>(null);

  const generate = async () => {
    if (!base.trim()) {
      setError("Enter a base location.");
      return;
    }
    if (mode === "through" && !end.trim()) {
      setError("Through-hike mode needs an end location.");
      return;
    }
    setGenerating(true);
    setError(null);
    setTour(null);
    setSelectedDay(null);
    try {
      const basePt = await resolvePlace(base);
      if (!basePt) {
        setError("Could not resolve the base location. Try a more specific name or lat,lon.");
        return;
      }
      let endLat: number | undefined;
      let endLon: number | undefined;
      let endName: string | undefined;
      if (mode === "through") {
        const endPt = await resolvePlace(end);
        if (!endPt) {
          setError("Could not resolve the end location.");
          return;
        }
        endLat = endPt.lat;
        endLon = endPt.lon;
        endName = endPt.name;
      }
      const { tour: generated } = await tourApi.generate({
        mode,
        baseLat: basePt.lat,
        baseLon: basePt.lon,
        baseName: basePt.name,
        endLat,
        endLon,
        endName,
        numDays,
        difficulty,
        notes: notes.trim() || undefined,
      });
      setTour(generated);
      setShowSummary(true);
      // Draw all days overlaid.
      onDrawTour(generated.days.map((d) => ({
        name: d.name,
        geometry: d.geometry,
        waypoints: d.waypoints,
        pois: d.pois,
        overnight: d.overnight,
        wildCamp: d.wildCamp,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tour generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!tour) return;
    const name = await promptDialog("Tour name:", `${tour.baseName} ${tour.numDays}-day ${tour.difficulty} hike`);
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      await tourApi.save({ ...tour, name });
      loadSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save tour");
    } finally {
      setSaving(false);
    }
  };

  const loadSaved = async () => {
    setLoadingSaved(true);
    try {
      const { tours } = await tourApi.list();
      setSavedTours(tours);
    } catch {
      /* ignore */
    } finally {
      setLoadingSaved(false);
    }
  };

  const openSaved = async (id: string) => {
    try {
      const detail = await tourApi.get(id);
      // Reconstruct a GeneratedTour from the saved tour for the UI.
      const reconstructed: GeneratedTour = {
        mode: detail.tour.mode,
        baseLat: detail.tour.baseLat,
        baseLon: detail.tour.baseLon,
        baseName: detail.tour.baseName,
        endLat: detail.tour.endLat ?? undefined,
        endLon: detail.tour.endLon ?? undefined,
        endName: detail.tour.endName ?? undefined,
        numDays: detail.tour.numDays,
        difficulty: detail.tour.difficulty,
        days: detail.days.map((d) => ({
          dayNumber: d.dayNumber ?? 0,
          name: d.name,
          distanceM: d.distanceM,
          durationS: d.durationS,
          ascentM: d.ascentM,
          descentM: d.descentM,
          geometry: d.geometry,
          waypoints: d.waypoints,
          pois: d.pois,
        })),
        totalDistanceM: detail.tour.totalDistanceM,
        totalAscentM: detail.tour.totalAscentM,
        totalDurationS: detail.tour.totalDurationS,
        summary: detail.tour.summary,
      };
      setTour(reconstructed);
      setSelectedDay(null);
      setShowSummary(true);
      onDrawTour(reconstructed.days.map((d) => ({
        name: d.name,
        geometry: d.geometry,
        waypoints: d.waypoints,
        pois: d.pois,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tour");
    }
  };

  const deleteSaved = async (id: string) => {
    if (!(await confirmDialog("Delete this tour and all its days?", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await tourApi.delete(id);
      setSavedTours((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete tour");
    }
  };

  const regenerateDay = async (dayNumber: number) => {
    // regenerateDay only works on saved tours — we need a tour id. For
    // unsaved tours, prompt to save first.
    if (!tour) return;
    // Find the saved tour id by matching against savedTours (the tour in state
    // doesn't carry an id until saved). Simplest: require save first.
    const saved = savedTours.find(
      (t) => t.name.toLowerCase() === `${tour.baseName} ${tour.numDays}-day ${tour.difficulty} hike`.toLowerCase()
    );
    if (!saved) {
      setError("Save the tour first, then you can regenerate individual days.");
      return;
    }
    setRegeneratingDay(dayNumber);
    try {
      const { day: newDay } = await tourApi.regenerateDay(saved.id, dayNumber);
      setTour((prev) => {
        if (!prev) return prev;
        const days = prev.days.map((d) => (d.dayNumber === dayNumber ? newDay : d));
        return {
          ...prev,
          days,
          totalDistanceM: days.reduce((s, d) => s + d.distanceM, 0),
          totalAscentM: days.reduce((s, d) => s + d.ascentM, 0),
          totalDurationS: days.reduce((s, d) => s + d.durationS, 0),
        };
      });
      // Redraw
      if (selectedDay === null) {
        onDrawTour(tour.days.map((d) => ({
          name: d.name,
          geometry: d.geometry,
          waypoints: d.waypoints,
          pois: d.pois,
          overnight: d.overnight,
          wildCamp: d.wildCamp,
        })));
      } else if (selectedDay === dayNumber) {
        onDrawTour([{
          name: newDay.name,
          geometry: newDay.geometry,
          waypoints: newDay.waypoints,
          pois: newDay.pois,
          overnight: newDay.overnight,
          wildCamp: newDay.wildCamp,
        }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate day");
    } finally {
      setRegeneratingDay(null);
    }
  };

  const selectDay = (dayNumber: number | null) => {
    setSelectedDay(dayNumber);
    if (!tour) return;
    if (dayNumber === null) {
      onDrawTour(tour.days.map((d) => ({
        name: d.name,
        geometry: d.geometry,
        waypoints: d.waypoints,
        pois: d.pois,
        overnight: d.overnight,
        wildCamp: d.wildCamp,
      })));
    } else {
      const day = tour.days.find((d) => d.dayNumber === dayNumber);
      if (day) onDrawTour([{
        name: day.name,
        geometry: day.geometry,
        waypoints: day.waypoints,
        pois: day.pois,
        overnight: day.overnight,
        wildCamp: day.wildCamp,
      }]);
    }
  };

  const downloadGpx = () => {
    if (!tour) return;
    const saved = savedTours[0]; // best-effort: needs a saved tour id for the URL
    if (!saved) {
      setError("Save the tour first to export GPX.");
      return;
    }
    window.open(tourApi.tourGpxUrl(saved.id), "_blank");
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-500">
          {error}
          <button onClick={() => setError(null)} className="ml-1 underline">dismiss</button>
        </div>
      )}

      {/* ===== Generator form ===== */}
      <section>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase text-ink-muted">
          <CalendarDays size={13} /> Multi-day tour
        </h3>
        <div className="space-y-1.5">
          {/* Mode toggle */}
          <div className="flex gap-1">
            {(["hub", "through"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded px-1.5 py-1 text-xs capitalize transition-colors ${
                  mode === m ? "bg-accent text-white" : "bg-surface text-ink-muted hover:bg-surface-3"
                }`}
              >
                {m === "hub" ? "Hub & spoke" : "Through-hike"}
              </button>
            ))}
          </div>
          {/* Base */}
          <div className="relative">
            <MapPin size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder="Base / accommodation (place or lat,lon)"
              className="w-full rounded-md border border-edge bg-surface py-1.5 pl-7 pr-2 text-xs text-ink outline-none focus:border-accent"
            />
          </div>
          {/* End (through only) */}
          {mode === "through" && (
            <div className="relative">
              <Flag size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                placeholder="End point (place or lat,lon)"
                className="w-full rounded-md border border-edge bg-surface py-1.5 pl-7 pr-2 text-xs text-ink outline-none focus:border-accent"
              />
            </div>
          )}
          {/* Days stepper */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">Days</span>
            <button
              onClick={() => setNumDays((n) => Math.max(1, n - 1))}
              className="rounded bg-surface px-2 py-0.5 text-xs text-ink hover:bg-surface-3"
            >
              −
            </button>
            <span className="w-6 text-center text-xs font-semibold text-ink">{numDays}</span>
            <button
              onClick={() => setNumDays((n) => Math.min(14, n + 1))}
              className="rounded bg-surface px-2 py-0.5 text-xs text-ink hover:bg-surface-3"
            >
              +
            </button>
          </div>
          {/* Difficulty */}
          <div className="relative">
            <Gauge size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as TourDifficulty)}
              className="w-full rounded-md border border-edge bg-surface py-1.5 pl-7 pr-2 text-xs text-ink outline-none focus:border-accent"
            >
              {(Object.keys(DIFFICULTY_LABELS) as TourDifficulty[]).map((d) => (
                <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>
              ))}
            </select>
          </div>
          {/* Notes */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes for Mavino (fitness, season, gear, constraints…)"
            rows={2}
            className="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
          />
          <button
            onClick={generate}
            disabled={generating}
            className="w-full rounded-md bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {generating ? (
              <span className="flex items-center justify-center gap-1.5">
                <Loader2 size={13} className="animate-spin" /> Generating… (can take 10-30s)
              </span>
            ) : (
              "Generate tour"
            )}
          </button>
        </div>
      </section>

      {/* ===== Generated tour ===== */}
      {tour && (
        <section className="space-y-2 rounded-md border border-edge bg-surface p-2">
          {/* Map legend */}
          <div className="flex flex-wrap gap-x-2.5 gap-y-1 rounded bg-surface-2 px-2 py-1.5 text-[10px] text-ink-muted">
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#0ea5e9" stroke="#fff" strokeWidth="2"/><path d="M12 2C12 2 6 10 6 14a6 6 0 0 0 12 0c0-4-6-12-6-12z" fill="#fff"/></svg>
              Water
            </span>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#8b5cf6" stroke="#fff" strokeWidth="2"/><path d="M3 7v10h2v-3h14v3h2V10c0-1.7-1.3-3-3-3H3zm2 2h12c.6 0 1 .4 1 1v2H5V9z" fill="#fff"/></svg>
              Sleep
            </span>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#f59e0b" stroke="#fff" strokeWidth="2"/><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6L12 2z" fill="#fff"/></svg>
              Sights
            </span>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#10b981" stroke="#fff" strokeWidth="2"/><path d="M6 2v7c0 1.1.9 2 2 2v9h2V2H8v7H6V2zm10 0c-1.7 0-3 2.2-3 5s1.3 5 3 5v8h2V2h-2z" fill="#fff"/></svg>
              Food
            </span>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#a855f7" stroke="#fff" strokeWidth="2"/><path d="M12 4L3 20h18L12 4zm0 4l5 9H7l5-9z" fill="#fff"/></svg>
              Overnight
            </span>
            <span className="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#dc2626" stroke="#fff" strokeWidth="2"/><path d="M12 2c0 3-2 4-2 7 0 2 1 3 2 3s2-1 2-3c0-3-2-4-2-7z" fill="none" stroke="#fff" strokeWidth="1.5"/></svg>
              Wild camp
            </span>
          </div>

          {/* Totals */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink">
            <span className="font-semibold">{tour.numDays} days</span>
            <span>· {fmtKm(tour.totalDistanceM)}</span>
            <span>· ↑{Math.round(tour.totalAscentM)} m</span>
            <span>· ~{fmtHours(tour.totalDurationS)}</span>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-1">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1 rounded bg-surface-3 px-2 py-1 text-xs text-ink hover:bg-surface disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
            </button>
            <button
              onClick={downloadGpx}
              className="flex items-center gap-1 rounded bg-surface-3 px-2 py-1 text-xs text-ink hover:bg-surface"
            >
              <Download size={12} /> GPX
            </button>
            <button
              onClick={() => setShowSummary((s) => !s)}
              className="flex items-center gap-1 rounded bg-surface-3 px-2 py-1 text-xs text-ink hover:bg-surface"
            >
              {showSummary ? "Hide plan" : "Show AI plan"}
            </button>
            <button
              onClick={() => { setTour(null); onClearMap(); }}
              className="flex items-center gap-1 rounded bg-surface-3 px-2 py-1 text-xs text-ink-muted hover:bg-surface"
            >
              <X size={12} />
            </button>
          </div>

          {/* AI-narrated summary */}
          {showSummary && tour.summary && (
            <div className="max-h-48 overflow-y-auto rounded bg-surface-2 p-2 text-xs text-ink-muted">
              <pre className="whitespace-pre-wrap font-sans leading-relaxed">{tour.summary}</pre>
            </div>
          )}

          {/* Day selector */}
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => selectDay(null)}
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                selectedDay === null ? "bg-accent text-white" : "bg-surface-3 text-ink hover:bg-surface"
              }`}
            >
              All days
            </button>
            {tour.days.map((d) => (
              <button
                key={d.dayNumber}
                onClick={() => selectDay(d.dayNumber)}
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  selectedDay === d.dayNumber ? "bg-accent text-white" : "bg-surface-3 text-ink hover:bg-surface"
                }`}
              >
                Day {d.dayNumber}
              </button>
            ))}
          </div>

          {/* Day list */}
          <div className="space-y-1.5">
            {tour.days.map((d) => (
              <DayCard
                key={d.dayNumber}
                day={d}
                color={DAY_COLORS[(d.dayNumber - 1) % DAY_COLORS.length]}
                expanded={selectedDay === d.dayNumber}
                onExpand={() => selectDay(selectedDay === d.dayNumber ? null : d.dayNumber)}
                onRegenerate={() => regenerateDay(d.dayNumber)}
                regenerating={regeneratingDay === d.dayNumber}
              />
            ))}
          </div>
        </section>
      )}

      {/* ===== Saved tours ===== */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-ink-muted">
            <Save size={13} /> Saved tours
          </h3>
          <button onClick={loadSaved} className="text-xs text-accent hover:underline">
            {loadingSaved ? <Loader2 size={12} className="animate-spin" /> : "Refresh"}
          </button>
        </div>
        {savedTours.length === 0 ? (
          <p className="text-xs text-ink-muted">No saved tours yet. Generate one and save it.</p>
        ) : (
          <ul className="space-y-1">
            {savedTours.map((t) => (
              <li key={t.id} className="flex items-center gap-1.5 rounded bg-surface px-2 py-1.5 text-xs">
                <button onClick={() => openSaved(t.id)} className="min-w-0 flex-1 text-left text-ink hover:underline">
                  <div className="truncate">{t.name}</div>
                  <div className="text-[10px] text-ink-muted">
                    {t.mode} · {t.numDays}d · {t.difficulty} · {fmtKm(t.totalDistanceM)} · ↑{Math.round(t.totalAscentM)} m
                  </div>
                </button>
                <button onClick={() => deleteSaved(t.id)} className="text-ink-muted hover:text-red-500">
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ===== Day card =====

function DayCard({
  day,
  color,
  expanded,
  onExpand,
  onRegenerate,
  regenerating,
}: {
  day: TourDay;
  color: string;
  expanded: boolean;
  onExpand: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const water = day.pois.filter((p) => p.category === "water");
  const sights = day.pois.filter((p) => p.category === "landmarks");
  return (
    <div className="rounded border border-edge bg-surface-2 p-1.5">
      <button onClick={onExpand} className="w-full text-left">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: color }}
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{day.name}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-ink-muted">
          <span>{fmtKm(day.distanceM)}</span>
          <span>↑{Math.round(day.ascentM)} m</span>
          <span>~{fmtHours(day.durationS)}</span>
          {day.hardDay && (
            <span className="flex items-center gap-0.5 text-amber-500">
              <AlertTriangle size={10} /> hard
            </span>
          )}
        </div>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 text-[11px] text-ink-muted">
          {/* Overnight */}
          <div className="flex items-start gap-1">
            <Tent size={11} className="mt-0.5 shrink-0 text-purple-500" />
            <span>
              Sleep: <span className="text-ink">{day.overnight?.name ?? "—"}</span>
              {day.wildCamp && (
                <span className="ml-1 text-amber-500">(wild camp — no hut found)</span>
              )}
            </span>
          </div>
          {/* Water */}
          <div className="flex items-start gap-1">
            <Droplets size={11} className="mt-0.5 shrink-0 text-sky-500" />
            <span>
              {water.length > 0 ? (
                <>Water: <span className="text-ink">{water.slice(0, 4).map((p) => p.name).join(", ")}</span></>
              ) : (
                <span className="text-amber-600">No water found nearby — carry enough</span>
              )}
            </span>
          </div>
          {/* Landmarks */}
          {sights.length > 0 && (
            <div className="flex items-start gap-1">
              <MapPin size={11} className="mt-0.5 shrink-0 text-amber-500" />
              <span>Sights: <span className="text-ink">{sights.slice(0, 3).map((p) => p.name).join(", ")}</span></span>
            </div>
          )}
          {/* Regenerate */}
          <button
            onClick={onRegenerate}
            disabled={regenerating}
            className="mt-1 flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink hover:bg-surface disabled:opacity-50"
          >
            {regenerating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />} Regenerate day
          </button>
        </div>
      )}
    </div>
  );
}
