// ===== Pulse: predictive forgetting-curve & mastery forecast (Pro tier) =====
// A predictive analytics engine that models each flashcard's forgetting curve
// from FlashcardReview history (SM-2 quality scores logged per review), then
// forecasts the user's mastery level on each exam date (from Crunch) given
// their current review trajectory. Surfaces "at-risk" concepts (predicted
// mastery < threshold on exam day) and an overall readiness score per exam.
//
// The forecast is deterministic (no LLM needed):
//   1. Load all FlashcardReview rows for the user, grouped by card.
//   2. For each card with >= 1 review, fit an FSRS-style power forgetting
//      curve: R(t) = (1 + t/h)^(-b), where R is retention probability at
//      time t (days since last review), h is the half-life (days until
//      retention drops to 50%), and b is a decay exponent (~0.5 in FSRS).
//      Half-life is estimated from the SM-2 interval + ease factor stored
//      on the card (the SM-2 interval IS the scheduler's estimate of how
//      long the card will be retained, so it's a natural half-life proxy).
//   3. For each exam date (from CrunchPlan), project each card's retention
//      to that date. Aggregate per-deck, per-concept (via Atlas links if
//      available), and per-exam readiness = avg of linked card retentions.
//   4. Flag at-risk concepts: predicted mastery < AT_RISK_THRESHOLD on the
//      nearest exam date.
//   5. Build a forecast curve: projected overall mastery sampled at N
//      points from today to the farthest exam date, with exam date markers.
//
// The build is fire-and-forget + polling, mirroring AtlasGraph/CrunchPlan.

import prisma from "../db/client";
import { decryptNtfyConfig } from "./ntfy/config";
import { publish } from "./ntfy/client";

// ----- Pulse data shape (stored as JSON in PulseForecast.data) -----

/** A single flashcard's fitted forgetting curve + forecast. */
export interface PulseCard {
  cardId: string;
  deckId: string;
  deckName: string;
  front: string;
  /** Half-life in days (time until retention drops to 50%). */
  halfLife: number;
  /** Decay exponent (FSRS default ~0.5). */
  decay: number;
  /** Last review date (ISO). */
  lastReviewed: string | null;
  /** Review count. */
  reviewCount: number;
  /** Current retention (0..1) — R(0) at last review = 1, decays from there. */
  currentRetention: number;
  /** Predicted retention (0..1) on the nearest exam date. -1 = no exam. */
  predictedRetention: number;
  /** Days until retention drops below the at-risk threshold (0.7). */
  daysUntilForgotten: number;
}

/** A concept (from Atlas or derived from deck names) with forecast. */
export interface PulseConcept {
  id: string;
  label: string;
  /** Predicted mastery (0..1) on the nearest exam date. -1 = no data. */
  predictedMastery: number;
  /** Current mastery (0..1). -1 = no data. */
  currentMastery: number;
  /** Days until mastery drops below the at-risk threshold. */
  daysUntilForgotten: number;
  atRisk: boolean;
  /** Linked deck ids. */
  deckIds: string[];
  /** Linked card count. */
  cardCount: number;
}

/** Per-exam readiness forecast. */
export interface PulseExam {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  color: string;
  /** Days from today to exam. */
  daysUntil: number;
  /** Projected mastery (0..100) on exam day. -1 = no data. */
  readiness: number;
  /** At-risk concept count for this exam. */
  atRiskCount: number;
  /** Total concept count linked to this exam. */
  conceptCount: number;
}

/** A point on the forecast curve. */
export interface PulseForecastPoint {
  /** Days from today. */
  day: number;
  /** Date (YYYY-MM-DD). */
  date: string;
  /** Projected overall mastery (0..1). */
  mastery: number;
  /** True if this point is an exam date. */
  isExam: boolean;
  examName?: string;
}

export interface PulseStats {
  cardCount: number;
  conceptCount: number;
  examCount: number;
  atRiskCount: number;
  /** Overall readiness for the nearest exam (0..100). -1 = no data. */
  nearestReadiness: number;
  nearestExamName: string | null;
  nearestExamDays: number | null;
  /** Average half-life across all cards (days). */
  avgHalfLife: number;
}

export interface PulseData {
  cards: PulseCard[];
  concepts: PulseConcept[];
  exams: PulseExam[];
  forecast: PulseForecastPoint[];
  stats: PulseStats;
  generatedAt: string;
}

export interface PulseStatus {
  id: string;
  status: "building" | "ready" | "error";
  error: string;
  data: PulseData | null;
  updatedAt: string;
  lastAlertAt: string | null;
}

// ----- constants -----

/** FSRS-style decay exponent. FSRS uses ~0.5; we default to that. */
const DEFAULT_DECAY = 0.5;

/** Retention threshold below which a concept is "at risk". */
const AT_RISK_THRESHOLD = 0.7;

/** Minimum half-life (days) for a newly-learned card with no reviews. */
const MIN_HALF_LIFE = 0.5;

/** Default half-life (days) for a card with reviews but no SM-2 interval. */
const DEFAULT_HALF_LIFE = 3;

// ----- helpers -----

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string): Date {
  if (s.length === 10) return new Date(s + "T00:00:00Z");
  return new Date(s);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/**
 * FSRS-style power forgetting curve: R(t) = (1 + t/h)^(-b).
 * - t = days since last review
 * - h = half-life (days until R = 0.5)
 * - b = decay exponent
 * Returns retention probability (0..1).
 */
function retentionAt(daysSinceReview: number, halfLife: number, decay: number): number {
  if (daysSinceReview <= 0) return 1;
  const h = Math.max(MIN_HALF_LIFE, halfLife);
  return Math.pow(1 + daysSinceReview / h, -decay);
}

/**
 * Solve for t where R(t) = threshold: t = h * (threshold^(-1/b) - 1).
 * Returns days until retention drops to the threshold.
 */
function daysUntilThreshold(halfLife: number, decay: number, threshold: number): number {
  const h = Math.max(MIN_HALF_LIFE, halfLife);
  return h * (Math.pow(threshold, -1 / decay) - 1);
}

// ----- status / fetch -----

export async function getPulseStatus(userId: string): Promise<PulseStatus | null> {
  const row = await prisma.pulseForecast.findUnique({ where: { userId } });
  if (!row) return null;
  return serializeStatus(row);
}

function serializeStatus(row: {
  id: string;
  status: string;
  error: string;
  data: string;
  updatedAt: Date;
  lastAlertAt: Date | null;
}): PulseStatus {
  let data: PulseData | null = null;
  if (row.status === "ready") {
    try {
      data = JSON.parse(row.data) as PulseData;
    } catch {
      data = null;
    }
  }
  return {
    id: row.id,
    status: row.status as PulseStatus["status"],
    error: row.error,
    data,
    updatedAt: row.updatedAt.toISOString(),
    lastAlertAt: row.lastAlertAt ? row.lastAlertAt.toISOString() : null,
  };
}

// ----- staleness check -----

/** True if new flashcard reviews have been logged since the last forecast
 *  build, or if the Crunch plan (exam dates) changed. */
export async function isPulseStale(userId: string): Promise<boolean> {
  const row = await prisma.pulseForecast.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return true;
  // Check for reviews newer than the forecast's updatedAt.
  const newerReviews = await prisma.flashcardReview.count({
    where: { userId, createdAt: { gt: row.updatedAt } },
  });
  if (newerReviews > 0) return true;
  // Check if the Crunch plan was updated since the forecast.
  const crunchRow = await prisma.crunchPlan.findUnique({ where: { userId } });
  if (crunchRow && crunchRow.updatedAt > row.updatedAt) return true;
  return false;
}

// ----- build (fire-and-forget + polling) -----

export async function startBuildPulse(
  userId: string
): Promise<{ id: string; status: "ready" | "building"; data: PulseData | null }> {
  const existing = await prisma.pulseForecast.findUnique({ where: { userId } });
  const reservation = {
    data: "{}",
    status: "building" as const,
    error: "",
    lastAlertAt: existing?.lastAlertAt ?? null,
  };
  const row = existing
    ? await prisma.pulseForecast.update({ where: { id: existing.id }, data: reservation })
    : await prisma.pulseForecast.create({ data: { userId, ...reservation } });

  // Fire-and-forget: the HTTP response returns before this settles.
  void buildPulseData(userId)
    .then((data) =>
      prisma.pulseForecast.update({
        where: { id: row.id },
        data: { data: JSON.stringify(data), status: "ready", error: "" },
      })
    )
    .catch((e) =>
      prisma.pulseForecast
        .update({
          where: { id: row.id },
          data: {
            status: "error",
            error: e instanceof Error ? e.message : "Pulse forecast failed",
          },
        })
        .catch(() => {})
    );

  return { id: row.id, status: "building", data: null };
}

// ----- core forecast logic -----

/** Build the full PulseData forecast for a user. Deterministic — no LLM. */
export async function buildPulseData(userId: string): Promise<PulseData> {
  const now = new Date();
  const todayStr = toDateStr(now);

  // 1. Load flashcard decks + cards + reviews.
  const [decks, reviews] = await Promise.all([
    prisma.flashcardDeck.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        cards: {
          select: {
            id: true,
            front: true,
            deckId: true,
            easeFactor: true,
            interval: true,
            repetitions: true,
            lastReviewed: true,
          },
        },
      },
    }),
    prisma.flashcardReview.findMany({
      where: { userId },
      select: { cardId: true, quality: true, date: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Group reviews by card.
  const reviewsByCard = new Map<string, { quality: number; date: string; createdAt: Date }[]>();
  for (const r of reviews) {
    const arr = reviewsByCard.get(r.cardId);
    if (arr) arr.push({ quality: r.quality, date: r.date, createdAt: r.createdAt });
    else reviewsByCard.set(r.cardId, [{ quality: r.quality, date: r.date, createdAt: r.createdAt }]);
  }

  // 2. Load exam dates from Crunch plan (the forecast targets).
  const crunchRow = await prisma.crunchPlan.findUnique({ where: { userId } });
  let examDefs: { id: string; name: string; date: string; color: string }[] = [];
  if (crunchRow?.status === "ready") {
    try {
      const crunchData = JSON.parse(crunchRow.data) as {
        exams?: { id: string; name: string; date: string; color: string }[];
      };
      if (Array.isArray(crunchData.exams)) {
        examDefs = crunchData.exams
          .map((e) => ({
            id: e.id,
            name: e.name,
            date: typeof e.date === "string" ? toDateStr(parseDate(e.date)) : "",
            color: e.color || "#6366f1",
          }))
          .filter((e) => e.date && parseDate(e.date).getTime() >= now.getTime() - 86400000);
      }
    } catch {
      // malformed crunch data — no exams
    }
  }
  // Sort exams by date (nearest first).
  examDefs.sort((a, b) => a.date.localeCompare(b.date));

  // 3. Fit a forgetting curve per card.
  const cards: PulseCard[] = [];
  for (const deck of decks) {
    for (const card of deck.cards) {
      const cardReviews = reviewsByCard.get(card.id) ?? [];
      const reviewCount = cardReviews.length;

      // Estimate half-life from the SM-2 interval (days) + ease factor.
      // The SM-2 interval is the scheduler's estimate of how long the card
      // will be retained — a natural half-life proxy. Scale by ease factor
      // (higher ease → longer retention). If no interval yet, use a small
      // default that grows with repetitions.
      const ease = card.easeFactor > 0 ? card.easeFactor : 2.5;
      let halfLife: number;
      if (card.interval > 0) {
        halfLife = card.interval * (ease / 2.5);
      } else if (reviewCount > 0) {
        halfLife = MIN_HALF_LIFE * reviewCount;
      } else {
        halfLife = MIN_HALF_LIFE;
      }

      // Adjust half-life based on review quality history: if the user
      // consistently rates high (quality >= 4), retention is stronger →
      // lengthen half-life. If low (quality <= 2), shorten it.
      if (reviewCount > 0) {
        const avgQuality = cardReviews.reduce((a, r) => a + r.quality, 0) / reviewCount;
        const qualityFactor = 0.7 + (avgQuality / 5) * 0.6; // 0.7..1.3
        halfLife *= qualityFactor;
      }

      halfLife = Math.max(MIN_HALF_LIFE, halfLife);
      const decay = DEFAULT_DECAY;

      // Current retention: R(days since last review).
      const lastReviewed = card.lastReviewed ?? cardReviews[cardReviews.length - 1]?.createdAt ?? null;
      let currentRetention = 0;
      if (lastReviewed) {
        const daysSince = daysBetween(new Date(lastReviewed), now);
        currentRetention = retentionAt(daysSince, halfLife, decay);
      } else if (reviewCount === 0) {
        currentRetention = 0; // never reviewed → no retention signal
      }

      // Predicted retention on the nearest exam date.
      let predictedRetention = -1;
      const nearestExam = examDefs[0];
      if (nearestExam && lastReviewed) {
        const examDate = parseDate(nearestExam.date);
        const daysSince = daysBetween(new Date(lastReviewed), examDate);
        predictedRetention = retentionAt(daysSince, halfLife, decay);
      } else if (nearestExam && !lastReviewed) {
        // Never reviewed → predict low retention on exam day.
        predictedRetention = 0;
      }

      // Days until forgotten (retention drops below threshold).
      const daysUntilForgotten = lastReviewed
        ? Math.round(daysUntilThreshold(halfLife, decay, AT_RISK_THRESHOLD))
        : 0;

      cards.push({
        cardId: card.id,
        deckId: deck.id,
        deckName: deck.name,
        front: card.front.slice(0, 120),
        halfLife: Math.round(halfLife * 10) / 10,
        decay,
        lastReviewed: lastReviewed ? new Date(lastReviewed).toISOString() : null,
        reviewCount,
        currentRetention: Math.round(currentRetention * 1000) / 1000,
        predictedRetention: Math.round(predictedRetention * 1000) / 1000,
        daysUntilForgotten,
      });
    }
  }

  // 4. Build concepts from Atlas (if available) or fall back to decks.
  //    Atlas concepts link to flashcard decks by text matching. We map
  //    each concept to its linked decks' cards and aggregate mastery.
  const atlasRow = await prisma.atlasGraph.findUnique({ where: { userId } });
  let concepts: PulseConcept[] = [];

  if (atlasRow?.status === "ready") {
    try {
      const atlasData = JSON.parse(atlasRow.data) as {
        concepts?: {
          id: string;
          label: string;
          items?: { flashcardDecks?: { id: string; name: string }[] };
        }[];
      };
      const atlasConcepts = atlasData.concepts ?? [];
      for (const ac of atlasConcepts) {
        const deckIds = (ac.items?.flashcardDecks ?? []).map((d) => d.id);
        if (deckIds.length === 0) continue; // skip concepts with no flashcard link
        const linkedCards = cards.filter((c) => deckIds.includes(c.deckId));
        if (linkedCards.length === 0) continue;

        const currentMastery = avg(linkedCards.map((c) => c.currentRetention));
        const predictedMastery = avg(linkedCards.map((c) => c.predictedRetention));
        const daysUntilForgotten = Math.min(...linkedCards.map((c) => c.daysUntilForgotten));
        const atRisk = predictedMastery >= 0 && predictedMastery < AT_RISK_THRESHOLD;

        concepts.push({
          id: ac.id,
          label: ac.label,
          predictedMastery: Math.round(predictedMastery * 1000) / 1000,
          currentMastery: Math.round(currentMastery * 1000) / 1000,
          daysUntilForgotten,
          atRisk,
          deckIds,
          cardCount: linkedCards.length,
        });
      }
    } catch {
      // malformed atlas data — fall back to deck-based concepts
    }
  }

  // Fallback: if no Atlas concepts linked to decks, derive concepts from
  // decks (one "concept" per deck). This keeps Pulse useful standalone.
  if (concepts.length === 0) {
    const deckMap = new Map<string, PulseCard[]>();
    for (const card of cards) {
      const arr = deckMap.get(card.deckId);
      if (arr) arr.push(card);
      else deckMap.set(card.deckId, [card]);
    }
    for (const deck of decks) {
      const deckCards = deckMap.get(deck.id) ?? [];
      if (deckCards.length === 0) continue;
      const currentMastery = avg(deckCards.map((c) => c.currentRetention));
      const predictedMastery = avg(deckCards.map((c) => c.predictedRetention));
      const daysUntilForgotten = Math.min(...deckCards.map((c) => c.daysUntilForgotten));
      const atRisk = predictedMastery >= 0 && predictedMastery < AT_RISK_THRESHOLD;
      concepts.push({
        id: `deck:${deck.id}`,
        label: deck.name,
        predictedMastery: Math.round(predictedMastery * 1000) / 1000,
        currentMastery: Math.round(currentMastery * 1000) / 1000,
        daysUntilForgotten,
        atRisk,
        deckIds: [deck.id],
        cardCount: deckCards.length,
      });
    }
  }

  // 5. Per-exam readiness: aggregate concept mastery for each exam.
  //    If the Crunch plan has topics linked to decks, use those; otherwise
  //    use all concepts (overall readiness).
  const exams: PulseExam[] = examDefs.map((exam) => {
    const daysUntil = daysBetween(now, parseDate(exam.date));
    // For now, aggregate all concepts toward each exam (concepts aren't
    // exam-specific in the current data model). A future enhancement can
    // map Crunch topics → concepts via deck overlap.
    const examConcepts = concepts.filter((c) => c.predictedMastery >= 0);
    const readiness = examConcepts.length > 0
      ? Math.round(avg(examConcepts.map((c) => c.predictedMastery)) * 100)
      : -1;
    const atRiskCount = examConcepts.filter((c) => c.atRisk).length;
    return {
      id: exam.id,
      name: exam.name,
      date: exam.date,
      color: exam.color,
      daysUntil,
      readiness,
      atRiskCount,
      conceptCount: examConcepts.length,
    };
  });

  // 6. Forecast curve: sample overall mastery from today to the farthest
  //    exam date (or +30 days if no exams).
  const farthestExam = examDefs[examDefs.length - 1];
  const horizonDays = farthestExam
    ? Math.max(7, daysBetween(now, parseDate(farthestExam.date)))
    : 30;
  const sampleCount = Math.min(60, Math.max(7, horizonDays));
  const examDateSet = new Set(examDefs.map((e) => e.date));

  const forecast: PulseForecastPoint[] = [];
  for (let i = 0; i <= sampleCount; i++) {
    const day = Math.round((i / sampleCount) * horizonDays);
    const date = toDateStr(new Date(now.getTime() + day * 86400000));
    // Project each card's retention to this future date.
    const retentions: number[] = [];
    for (const card of cards) {
      if (!card.lastReviewed) {
        retentions.push(0);
        continue;
      }
      const daysSince = daysBetween(new Date(card.lastReviewed), new Date(now.getTime() + day * 86400000));
      retentions.push(retentionAt(daysSince, card.halfLife, card.decay));
    }
    const mastery = retentions.length > 0 ? avg(retentions) : 0;
    const isExam = examDateSet.has(date);
    const examName = isExam ? examDefs.find((e) => e.date === date)?.name : undefined;
    forecast.push({
      day,
      date,
      mastery: Math.round(mastery * 1000) / 1000,
      isExam,
      examName,
    });
  }

  // 7. Stats.
  const atRiskConcepts = concepts.filter((c) => c.atRisk);
  const nearestExam = exams[0];
  const avgHalfLife = cards.length > 0
    ? Math.round((cards.reduce((a, c) => a + c.halfLife, 0) / cards.length) * 10) / 10
    : 0;

  const stats: PulseStats = {
    cardCount: cards.length,
    conceptCount: concepts.length,
    examCount: exams.length,
    atRiskCount: atRiskConcepts.length,
    nearestReadiness: nearestExam?.readiness ?? -1,
    nearestExamName: nearestExam?.name ?? null,
    nearestExamDays: nearestExam?.daysUntil ?? null,
    avgHalfLife,
  };

  return {
    cards,
    concepts,
    exams,
    forecast,
    stats,
    generatedAt: now.toISOString(),
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ----- at-risk alert check (called on fetch, throttled 1/day) -----

/** Check if the user has at-risk concepts and send an ntfy alert if so
 *  (throttled to once per day). Returns true if an alert was sent. */
export async function checkAtRiskAlert(userId: string): Promise<boolean> {
  const row = await prisma.pulseForecast.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return false;

  let data: PulseData;
  try {
    data = JSON.parse(row.data) as PulseData;
  } catch {
    return false;
  }

  // Only alert if there are at-risk concepts AND a near exam (<= 14 days).
  if (data.stats.atRiskCount === 0) return false;
  if (data.stats.nearestExamDays === null || data.stats.nearestExamDays > 14) return false;

  // Throttle: max one alert per day.
  const now = new Date();
  if (row.lastAlertAt) {
    const hoursSince = (now.getTime() - row.lastAlertAt.getTime()) / 3600000;
    if (hoursSince < 24) return false;
  }

  // Send ntfy alert.
  const ntfyCfg = await decryptNtfyConfig(userId);
  if (!ntfyCfg) return false; // ntfy not configured — can't alert.

  const body = `${data.stats.atRiskCount} concept${data.stats.atRiskCount !== 1 ? "s are" : " is"} predicted to drop below mastery before ${data.stats.nearestExamName} (in ${data.stats.nearestExamDays} day${data.stats.nearestExamDays === 1 ? "" : "s"}). Open Pulse to review them now — your forecast readiness is ${data.stats.nearestReadiness}%.`;

  try {
    await publish(ntfyCfg, {
      topic: ntfyCfg.notifyTopic,
      title: "Pulse — at-risk concepts",
      body,
      priority: 4,
      tags: "warning,brain",
    });
  } catch {
    return false; // ntfy publish failed — don't update lastAlertAt.
  }

  await prisma.pulseForecast.update({
    where: { userId },
    data: { lastAlertAt: now },
  });

  return true;
}

// ----- delete -----

export async function deletePulseForecast(userId: string): Promise<void> {
  await prisma.pulseForecast.deleteMany({ where: { userId } });
}

// ----- at-risk concepts (for Athena + UI) -----

export async function getAtRiskConcepts(userId: string): Promise<PulseConcept[]> {
  const row = await prisma.pulseForecast.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return [];
  try {
    const data = JSON.parse(row.data) as PulseData;
    return data.concepts.filter((c) => c.atRisk);
  } catch {
    return [];
  }
}
