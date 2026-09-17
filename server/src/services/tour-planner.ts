// ===== Multi-day hiking tour planner =====
// Generates a multi-day hiking tour from a base point + number of days +
// difficulty. Two modes:
//   - "hub":     loop hikes from a single base (accommodation). Each day heads
//                in a different compass direction (spread evenly around the
//                circle) so loops don't overlap. Returns to base each evening.
//   - "through": point-to-point chain from base toward an end point. Each day
//                covers ~targetDistance; the nearest legal sleeping spot
//                (mountain hut / shelter / bivouac) to the day's endpoint
//                becomes the overnight stop. If none is found within 3km, the
//                day is flagged as a wild-camp.
//
// The deterministic routing uses services/mapy.ts (route + findNearbyPois).
// After the routes are computed, the LLM (Athena) narrates a day-by-day plan
// and writes a tour summary — this is the "highly integrated" LLM layer: the
// model sees the actual stats + POIs + overnight spots for each day and
// produces a coherent, encouraging, practical plan (with rest-day warnings,
// water-source callouts, and a packing list derived from the difficulty).

import {
  route,
  findNearbyPois,
  routeTypeFor,
  sampleRoutePoints,
  type RouteResult,
  type PoiResult,
} from "./mapy";
import { getUserConfig, buildModel, acquireLlmModel } from "./athena/llm";
import { generateText } from "./study/llm-json";
import { getUserLanguage, languageInstruction } from "./language";

// ===== Difficulty presets =====

export type Difficulty = "easy" | "medium" | "hard" | "expert";

interface DifficultyPreset {
  /** Target one-way distance for a loop day (hub) or a through-hike day, in km. */
  targetKm: number;
  /** Max ascent per day in meters. */
  maxAscentM: number;
  /** Approx walking speed km/h on flat ground (used for duration sanity). */
  flatKmh: number;
}

const DIFFICULTY: Record<Difficulty, DifficultyPreset> = {
  easy: { targetKm: 10, maxAscentM: 400, flatKmh: 3.5 },
  medium: { targetKm: 15, maxAscentM: 800, flatKmh: 3.5 },
  hard: { targetKm: 20, maxAscentM: 1200, flatKmh: 3.5 },
  expert: { targetKm: 28, maxAscentM: 1600, flatKmh: 3.5 },
};

export interface TourDay {
  dayNumber: number;
  name: string;
  distanceM: number;
  durationS: number;
  ascentM: number;
  descentM: number;
  geometry: [number, number][];
  waypoints: { name: string; lat: number; lon: number; type?: string }[];
  pois: { name: string; lat: number; lon: number; category: string; description?: string }[];
  /** Hub mode: same as base. Through mode: where the user sleeps that night. */
  overnight?: { name: string; lat: number; lon: number; description?: string };
  /** True if no legal sleeping spot was found near the day's endpoint. */
  wildCamp?: boolean;
  /** True if the day's ascent exceeds 150% of the difficulty target → suggest a rest day after. */
  hardDay?: boolean;
  /** Per-day LLM narration (filled in by narrateTour). */
  narration?: string;
}

export interface GeneratedTour {
  mode: "hub" | "through";
  baseLat: number;
  baseLon: number;
  baseName: string;
  endLat?: number;
  endLon?: number;
  endName?: string;
  numDays: number;
  difficulty: Difficulty;
  days: TourDay[];
  totalDistanceM: number;
  totalAscentM: number;
  totalDurationS: number;
  /** LLM-narrated full plan (overview + day-by-day + packing list). */
  summary: string;
}

export interface TourPlanInput {
  mode: "hub" | "through";
  baseLat: number;
  baseLon: number;
  baseName: string;
  endLat?: number;
  endLon?: number;
  endName?: string;
  numDays: number;
  difficulty: Difficulty;
  /** Optional user notes the LLM should factor into the plan (fitness, season, gear). */
  notes?: string;
}

// ===== Geo helpers =====

const EARTH_R = 6371000; // meters

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}
function toDeg(r: number): number {
  return (r * 180) / Math.PI;
}

/** Haversine distance in meters between two [lat, lon] points. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/**
 * Destination point given a start [lat, lon], bearing (degrees from north,
 * clockwise) and distance in meters. Used to pick a loop's far point in a
 * spread compass direction.
 */
export function destinationPoint(
  start: [number, number],
  bearingDeg: number,
  distM: number
): [number, number] {
  const lat1 = toRad(start[0]);
  const lon1 = toRad(start[1]);
  const brng = toRad(bearingDeg);
  const d = distM / EARTH_R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [toDeg(lat2), ((toDeg(lon2) + 540) % 360) - 180];
}

/** Bearing from a to b, degrees clockwise from north. */
export function bearing(a: [number, number], b: [number, number]): number {
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLon = toRad(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ===== POI enrichment (shared with plan_route) =====

/**
 * Sample points along a route geometry and find hiking-relevant POIs (water,
 * sleeping, landmarks) near each sample. Dedupes by name+coords. Capped to
 * conserve API credits.
 */
async function enrichRouteWithPois(
  userId: string,
  geometry: [number, number][],
  maxSamples = 6,
  radiusM = 2500
): Promise<PoiResult[]> {
  if (geometry.length < 2) return [];
  const samples = sampleRoutePoints(geometry, maxSamples);
  const seen = new Set<string>();
  const out: PoiResult[] = [];
  for (const [lat, lon] of samples) {
    try {
      const nearby = await findNearbyPois(userId, {
        lat,
        lon,
        radiusM,
        categories: "all",
        limit: 15,
      });
      for (const p of nearby) {
        const key = `${p.name}|${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
      }
    } catch {
      // a single sample failing shouldn't abort enrichment
    }
  }
  return out;
}

/** Find the nearest legal sleeping spot (mountain hut / shelter / bivouac) to a point. */
async function findNearestSleeping(
  userId: string,
  lat: number,
  lon: number,
  radiusM = 3000
): Promise<PoiResult | null> {
  try {
    const items = await findNearbyPois(userId, {
      lat,
      lon,
      radiusM,
      categories: "sleeping",
      limit: 10,
    });
    if (items.length === 0) return null;
    // Pick the closest by haversine.
    let best = items[0];
    let bestD = haversineM([lat, lon], [best.lat, best.lon]);
    for (const p of items.slice(1)) {
      const d = haversineM([lat, lon], [p.lat, p.lon]);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  } catch {
    return null;
  }
}

// ===== Day planning =====

/** Plan a single loop day: base → farPoint → base, with POI enrichment. */
async function planLoopDay(
  userId: string,
  base: [number, number],
  baseName: string,
  bearingDeg: number,
  targetKm: number,
  dayNumber: number,
  maxAscentM: number
): Promise<TourDay> {
  // The far point is at ~targetKm/2 in the chosen bearing (so the full
  // there-and-back loop is ~targetKm). The actual routed distance will differ;
  // we accept up to 20% over and re-plan once with a shrunk radius if needed.
  const tryRadius = (factor: number): [number, number] =>
    destinationPoint(base, bearingDeg, (targetKm * 1000 * factor) / 2);

  let farPoint = tryRadius(1);
  let result: RouteResult | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      result = await route(userId, {
        startLon: base[1],
        startLat: base[0],
        endLon: farPoint[1],
        endLat: farPoint[0],
        // via base as the final waypoint → forces a loop back to start.
        // mapy.com routing doesn't natively do loops, so we route base→far
        // and then far→base as two legs and stitch the geometry.
        routeType: routeTypeFor("hiking"),
      });
      // Second leg: far → base.
      const leg2 = await route(userId, {
        startLon: farPoint[1],
        startLat: farPoint[0],
        endLon: base[1],
        endLat: base[0],
        routeType: routeTypeFor("hiking"),
      });
      // Stitch: drop the duplicated far point at the join.
      const geom: [number, number][] = [
        ...result.geometry,
        ...leg2.geometry.slice(1),
      ];
      result = {
        distanceM: result.distanceM + leg2.distanceM,
        durationS: result.durationS + leg2.durationS,
        ascentM: result.ascentM + leg2.ascentM,
        descentM: result.descentM + leg2.descentM,
        geometry: geom,
        parts: [...(result.parts ?? []), ...(leg2.parts ?? [])],
      };
    } catch {
      result = null;
    }
    if (result && result.distanceM <= targetKm * 1000 * 1.3) break;
    // Too long (or failed) → shrink radius 30% and retry once.
    farPoint = tryRadius(0.7);
  }
  if (!result) {
    // Fallback: a trivial out-and-back to the far point (no routing).
    result = {
      distanceM: targetKm * 1000,
      durationS: Math.round((targetKm / DIFFICULTY.easy.flatKmh) * 3600),
      ascentM: 0,
      descentM: 0,
      geometry: [base, farPoint, base],
      parts: [],
    };
  }

  const pois = await enrichRouteWithPois(userId, result.geometry);
  const waypoints = [
    { name: baseName, lat: base[0], lon: base[1], type: "start" },
    { name: `Day ${dayNumber} turnaround`, lat: farPoint[0], lon: farPoint[1], type: "turnaround" },
    { name: baseName, lat: base[0], lon: base[1], type: "end" },
  ];
  const hardDay = result.ascentM > maxAscentM * 1.5;
  return {
    dayNumber,
    name: `Day ${dayNumber}: ${baseName} loop`,
    distanceM: result.distanceM,
    durationS: result.durationS,
    ascentM: result.ascentM,
    descentM: result.descentM,
    geometry: result.geometry,
    waypoints,
    pois: pois.map((p) => ({
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      category: p.category,
      ...(p.description ? { description: p.description } : {}),
    })),
    overnight: { name: baseName, lat: base[0], lon: base[1] },
    hardDay,
  };
}

/** Plan a single through-hike day: from → to, with overnight finder. */
async function planThroughDay(
  userId: string,
  from: [number, number],
  fromName: string,
  to: [number, number],
  toName: string,
  dayNumber: number,
  maxAscentM: number
): Promise<TourDay> {
  let result: RouteResult;
  try {
    result = await route(userId, {
      startLon: from[1],
      startLat: from[0],
      endLon: to[1],
      endLat: to[0],
      routeType: routeTypeFor("hiking"),
    });
  } catch {
    result = {
      distanceM: haversineM(from, to),
      durationS: Math.round((haversineM(from, to) / 1000 / DIFFICULTY.easy.flatKmh) * 3600),
      ascentM: 0,
      descentM: 0,
      geometry: [from, to],
      parts: [],
    };
  }
  const pois = await enrichRouteWithPois(userId, result.geometry);
  // Find the nearest sleeping spot to the day's endpoint.
  const sleep = await findNearestSleeping(userId, to[0], to[1]);
  const hardDay = result.ascentM > maxAscentM * 1.5;
  return {
    dayNumber,
    name: `Day ${dayNumber}: ${fromName} → ${toName}`,
    distanceM: result.distanceM,
    durationS: result.durationS,
    ascentM: result.ascentM,
    descentM: result.descentM,
    geometry: result.geometry,
    waypoints: [
      { name: fromName, lat: from[0], lon: from[1], type: "start" },
      { name: toName, lat: to[0], lon: to[1], type: "end" },
    ],
    pois: pois.map((p) => ({
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      category: p.category,
      ...(p.description ? { description: p.description } : {}),
    })),
    overnight: sleep
      ? { name: sleep.name, lat: sleep.lat, lon: sleep.lon, description: sleep.description }
      : { name: `Wild camp near ${toName}`, lat: to[0], lon: to[1] },
    wildCamp: !sleep,
    hardDay,
  };
}

// ===== Tour generation =====

/**
 * Generate a multi-day hiking tour. Does NOT persist — returns the full plan
 * (days + totals + LLM-narrated summary). The caller decides whether to save.
 */
export async function generateTour(
  userId: string,
  input: TourPlanInput
): Promise<GeneratedTour> {
  const preset = DIFFICULTY[input.difficulty] ?? DIFFICULTY.medium;
  const numDays = Math.max(1, Math.min(14, Math.floor(input.numDays)));
  const base: [number, number] = [input.baseLat, input.baseLon];

  const days: TourDay[] = [];

  if (input.mode === "hub") {
    // Spread days evenly around the compass. Day i heads at bearing
    // (360 / numDays) * i, starting at 0° (north). This keeps loop far-points
    // well separated so the routes don't overlap.
    const bearingStep = 360 / numDays;
    for (let i = 0; i < numDays; i++) {
      const brng = Math.round(bearingStep * i) % 360;
      const day = await planLoopDay(
        userId,
        base,
        input.baseName,
        brng,
        preset.targetKm,
        i + 1,
        preset.maxAscentM
      );
      days.push(day);
    }
  } else {
    // Through-hike: chain days from base toward end. Each day covers
    // ~targetKm along the straight line to the end. The last day lands on end.
    const end: [number, number] = input.endLat != null && input.endLon != null
      ? [input.endLat, input.endLon]
      : destinationPoint(base, 0, preset.targetKm * 1000 * numDays);
    const totalDist = haversineM(base, end);
    const perDay = totalDist / numDays;
    let cur: [number, number] = base;
    let curName = input.baseName;
    const overallBearing = bearing(base, end);
    for (let i = 0; i < numDays; i++) {
      let next: [number, number];
      let nextName: string;
      if (i === numDays - 1) {
        next = end;
        nextName = input.endName ?? `Day ${i + 1} end`;
      } else {
        next = destinationPoint(cur, overallBearing, perDay);
        nextName = `Overnight ${i + 1}`;
      }
      const day = await planThroughDay(
        userId,
        cur,
        curName,
        next,
        nextName,
        i + 1,
        preset.maxAscentM
      );
      days.push(day);
      // Next day starts where this one's overnight is (the sleeping spot,
      // which may be slightly off the straight-line point).
      cur = day.overnight ? [day.overnight.lat, day.overnight.lon] : next;
      curName = day.overnight?.name ?? nextName;
    }
  }

  const totalDistanceM = days.reduce((s, d) => s + d.distanceM, 0);
  const totalAscentM = days.reduce((s, d) => s + d.ascentM, 0);
  const totalDurationS = days.reduce((s, d) => s + d.durationS, 0);

  // ===== LLM narration =====
  // The model sees the actual per-day stats + POIs + overnight spots and
  // produces a coherent plan: overview, day-by-day, rest-day warnings, water
  // callouts, and a packing list calibrated to the difficulty.
  let summary = "";
  try {
    summary = await narrateTour(userId, {
      ...input,
      numDays,
      days,
      totalDistanceM,
      totalAscentM,
      totalDurationS,
    });
  } catch {
    // LLM unavailable / failed → fall back to a plain-text summary so the
    // tour is still usable without AI.
    summary = fallbackSummary(input, days, totalDistanceM, totalAscentM, totalDurationS);
  }

  return {
    mode: input.mode,
    baseLat: input.baseLat,
    baseLon: input.baseLon,
    baseName: input.baseName,
    endLat: input.endLat,
    endLon: input.endLon,
    endName: input.endName,
    numDays,
    difficulty: input.difficulty,
    days,
    totalDistanceM,
    totalAscentM,
    totalDurationS,
    summary,
  };
}

// ===== LLM narration =====

interface NarrateInput {
  mode: "hub" | "through";
  baseLat: number;
  baseLon: number;
  baseName: string;
  endLat?: number;
  endLon?: number;
  endName?: string;
  numDays: number;
  difficulty: Difficulty;
  days: TourDay[];
  totalDistanceM: number;
  totalAscentM: number;
  totalDurationS: number;
  notes?: string;
}

async function narrateTour(userId: string, tour: NarrateInput): Promise<string> {
  const cfg = await getUserConfig(userId);
  if (!cfg.apiKey) throw new Error("No AI provider configured");
  const { model } = await acquireLlmModel(userId);

  const dayLines = tour.days
    .map((d) => {
      const water = d.pois.filter((p) => p.category === "water").map((p) => p.name).slice(0, 4);
      const sights = d.pois.filter((p) => p.category === "landmarks").map((p) => p.name).slice(0, 3);
      const overnight = d.overnight
        ? d.wildCamp
          ? `${d.overnight.name} (WILD CAMP — no hut/shelter found within 3km)`
          : d.overnight.name
        : "—";
      return [
        `Day ${d.dayNumber}: ${d.name}`,
        `  Distance: ${(d.distanceM / 1000).toFixed(1)} km | Ascent: ${Math.round(d.ascentM)} m | Duration: ~${Math.round(d.durationS / 3600)}h${d.hardDay ? " | HARD DAY — consider a rest day after" : ""}`,
        `  Overnight: ${overnight}`,
        water.length ? `  Water sources: ${water.join(", ")}` : `  Water sources: none found nearby — carry enough`,
        sights.length ? `  Landmarks: ${sights.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const userPrompt = `Generate a hiking tour plan in Markdown for the following auto-generated multi-day hike. Be practical, encouraging, and specific — use the real stats and POIs below, don't invent places. ${languageInstruction(await getUserLanguage(userId))}

Tour: ${tour.baseName}${tour.mode === "through" && tour.endName ? ` → ${tour.endName}` : ""} (${tour.mode === "hub" ? "hub-and-spoke, returning to base each evening" : "point-to-point through-hike"})
Days: ${tour.numDays}
Difficulty: ${tour.difficulty}
Total: ${(tour.totalDistanceM / 1000).toFixed(1)} km, ${Math.round(tour.totalAscentM)} m ascent, ~${Math.round(tour.totalDurationS / 3600)} h walking

Per-day breakdown:
${dayLines}

${tour.notes ? `User notes (factor these in): ${tour.notes}` : ""}

Produce:
1. A 2-3 sentence **Overview** (what kind of tour this is, who it suits, the headline stats).
2. A **Day-by-day** section — one short paragraph per day: where it goes, the terrain/ascent, key water sources + landmarks to look for, and where you sleep. Call out hard days and suggest rest days where flagged.
3. A **Packing list** calibrated to the difficulty (${tour.difficulty}) and ${tour.mode === "through" ? "through-hike (carry overnight gear)" : "hub mode (day pack, sleep at base)"}.
4. A **Safety notes** section: water planning, weather, what to do if a hut is full.

Keep it tight — this is a plan, not a novel. Use Markdown headings (##) and bullet lists.`;

  return generateText(
    model,
    userPrompt,
    "You are Mavino, an experienced hiking guide and trip planner. Write clear, practical, encouraging plans in Markdown. Use the real data provided — do not invent place names, distances, or facilities. If a day is flagged WILD CAMP, say so plainly and give wild-camping guidance."
  );
}

function fallbackSummary(
  input: TourPlanInput,
  days: TourDay[],
  totalDistanceM: number,
  totalAscentM: number,
  totalDurationS: number
): string {
  const lines = [
    `## ${input.baseName}${input.mode === "through" && input.endName ? ` → ${input.endName}` : ""} — ${input.numDays}-day ${input.difficulty} hike`,
    "",
    `**Total:** ${(totalDistanceM / 1000).toFixed(1)} km, ${Math.round(totalAscentM)} m ascent, ~${Math.round(totalDurationS / 3600)} h walking`,
    "",
    "## Day by day",
    "",
  ];
  for (const d of days) {
    lines.push(
      `### Day ${d.dayNumber}: ${d.name}`,
      `- ${(d.distanceM / 1000).toFixed(1)} km, ${Math.round(d.ascentM)} m ascent, ~${Math.round(d.durationS / 3600)}h${d.hardDay ? " _(hard day — consider a rest day after)_" : ""}`,
      `- Overnight: ${d.overnight?.name ?? "—"}${d.wildCamp ? " _(wild camp — no hut/shelter found nearby)_" : ""}`,
      ""
    );
  }
  return lines.join("\n");
}

// ===== Single-day regeneration =====

/**
 * Regenerate one day of an existing tour, keeping the others. Used when the
 * user didn't like a particular day. For hub mode the bearing is reused; for
 * through mode the from/to are reused (so the chain stays consistent).
 */
export async function regenerateDay(
  userId: string,
  tour: GeneratedTour,
  dayNumber: number
): Promise<TourDay> {
  const preset = DIFFICULTY[tour.difficulty] ?? DIFFICULTY.medium;
  const base: [number, number] = [tour.baseLat, tour.baseLon];
  if (tour.mode === "hub") {
    const bearingStep = 360 / tour.numDays;
    const brng = Math.round(bearingStep * (dayNumber - 1)) % 360;
    return planLoopDay(userId, base, tour.baseName, brng, preset.targetKm, dayNumber, preset.maxAscentM);
  }
  // Through: re-plan from the previous day's overnight to the next day's start.
  const prev = tour.days[dayNumber - 2];
  const next = tour.days[dayNumber];
  const from: [number, number] = prev?.overnight
    ? [prev.overnight.lat, prev.overnight.lon]
    : base;
  const fromName = prev?.overnight?.name ?? tour.baseName;
  const to: [number, number] = next?.overnight
    ? [next.overnight.lat, next.overnight.lon]
    : [tour.endLat ?? base[0], tour.endLon ?? base[1]];
  const toName = next?.overnight?.name ?? tour.endName ?? `Day ${dayNumber} end`;
  return planThroughDay(userId, from, fromName, to, toName, dayNumber, preset.maxAscentM);
}
