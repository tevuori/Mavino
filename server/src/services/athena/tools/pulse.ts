// ===== Athena tools: Pulse (Pro-tier predictive forgetting-curve & mastery forecast) =====
// Lets Athena query the user's predictive mastery forecast — check status,
// list at-risk concepts (predicted to drop below mastery before an exam),
// get per-exam readiness, and open the Pulse app.

import type { ToolDef } from "./plugin";
import { getPulseStatus, getAtRiskConcepts, checkAtRiskAlert } from "../../pulse";

export const pulseTools: ToolDef[] = [
  {
    name: "pulse_status",
    description:
      "Check the status of the user's Pulse predictive mastery forecast — whether it's built, how many cards/concepts/exams it tracks, how many concepts are at-risk (predicted to drop below mastery before the nearest exam), the nearest exam readiness %, and the average card half-life. Returns null if Pulse hasn't been built yet. Use this before answering questions about exam readiness, forgetting, or what will be forgotten by exam day.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const status = await getPulseStatus(userId);
      if (!status || status.status !== "ready" || !status.data) {
        return { built: false, status: status?.status ?? "empty" };
      }
      const d = status.data;
      // Fire-and-forget at-risk alert check.
      void checkAtRiskAlert(userId).catch(() => {});
      return {
        built: true,
        status: status.status,
        updatedAt: status.updatedAt,
        stats: d.stats,
        exams: d.exams.map((e) => ({
          name: e.name,
          date: e.date,
          daysUntil: e.daysUntil,
          readiness: e.readiness,
          atRiskCount: e.atRiskCount,
        })),
      };
    },
  },
  {
    name: "pulse_at_risk",
    description:
      "List the user's at-risk concepts — ones predicted to drop below the mastery threshold (70%) before the nearest exam date, based on FSRS-style forgetting curves fit from their flashcard review history. Returns each at-risk concept with its current mastery, predicted mastery on exam day, and days until forgotten. Use this when the user asks 'what will I have forgotten by the exam?' or 'am I on track?'.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const atRisk = await getAtRiskConcepts(userId);
      if (atRisk.length === 0) {
        return {
          count: 0,
          concepts: [],
          note: "No at-risk concepts found. Either Pulse hasn't been built, or all tracked concepts are predicted to stay above the mastery threshold until the nearest exam.",
        };
      }
      return {
        count: atRisk.length,
        concepts: atRisk.map((c) => ({
          id: c.id,
          label: c.label,
          currentMastery: c.currentMastery,
          predictedMastery: c.predictedMastery,
          daysUntilForgotten: c.daysUntilForgotten,
          cardCount: c.cardCount,
        })),
      };
    },
  },
  {
    name: "pulse_forecast",
    description:
      "Get the user's per-exam readiness forecast — for each upcoming exam (from Crunch), the projected mastery percentage on exam day, the at-risk concept count, and days until the exam. Also returns the forecast curve (projected overall mastery sampled over time from today to the farthest exam). Use this when the user asks 'am I on track for my exam?' or 'will I be ready for the exam on DATE?'.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const status = await getPulseStatus(userId);
      if (!status || status.status !== "ready" || !status.data) {
        return { error: "Pulse forecast hasn't been built yet. Ask the user to open the Pulse app and build it." };
      }
      const d = status.data;
      return {
        stats: d.stats,
        exams: d.exams.map((e) => ({
          name: e.name,
          date: e.date,
          daysUntil: e.daysUntil,
          readiness: e.readiness,
          atRiskCount: e.atRiskCount,
          conceptCount: e.conceptCount,
        })),
        // Downsample the forecast curve to ~20 points for the LLM context.
        forecast: downsample(d.forecast, 20),
      };
    },
  },
  {
    name: "open_pulse",
    description:
      "Open the Pulse app on the user's desktop. Use after answering an exam-readiness or forgetting-curve question so the user can see their forecast visually (gauges, forecast curve, at-risk feed).",
    clientAction: true,
    proOnly: true,
    parameters: [],
    handler: async () => ({ action: "open_pulse" }),
  },
];

/** Downsample a forecast curve to at most N points (keeps first + last + evenly spaced). */
function downsample(points: { day: number; date: string; mastery: number; isExam: boolean; examName?: string }[], n: number) {
  if (points.length <= n) return points;
  const out: typeof points = [];
  const step = (points.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i * step);
    out.push(points[idx]);
  }
  // Always include exam-date points even if they'd be skipped.
  for (const p of points) {
    if (p.isExam && !out.includes(p)) out.push(p);
  }
  return out;
}
