// ===== Crunch: AI exam planner service (Pro tier) =====
// An adaptive exam-prep scheduler. The user inputs exam dates + syllabi;
// Crunch reads current mastery from flashcard review history + grades, then
// generates a day-by-day spaced-repetition study plan that auto-adjusts as
// the user logs progress. Sends proactive ntfy alerts when falling behind.
//
// Build pipeline:
//   1. Load user's exams (from input) + courses + flashcard decks + reviews
//      + grades + study sessions.
//   2. Parse each exam's syllabus into topics (LLM extraction if syllabus is
//      free text; or use course assignments as topics if no syllabus).
//   3. Compute mastery per topic from linked flashcard reviews + course grades.
//   4. Generate spaced-repetition schedule: distribute topic sessions across
//      days from today to each exam date, with more time on weak topics and
//      spaced review intervals (1, 3, 7, 14 days). Last days = mock exams.
//   5. Compute "behind" status by comparing planned vs completed sessions.
//
// The build is fire-and-forget + polling, mirroring AtlasGraph.

import type { LlmModel } from "multi-llm-ts";
import prisma from "../db/client";
import { generateJson } from "./study/llm-json";
import { decryptNtfyConfig } from "./ntfy/config";
import { publish } from "./ntfy/client";

// ----- Plan data shape (stored as JSON in CrunchPlan.data) -----

export interface CrunchExamInput {
  id?: string;
  name: string;
  date: string; // ISO date (YYYY-MM-DD or full ISO)
  courseId?: string;
  syllabus: string;
  color?: string;
}

export interface CrunchExam {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  courseId?: string;
  syllabus: string;
  color: string;
}

export interface CrunchTopic {
  id: string;
  examId: string;
  label: string;
  mastery: number; // 0..1; -1 = no data
  priority: number; // 1..5
  estimatedHours: number;
  deckIds: string[];
}

export type CrunchTaskType = "new" | "review" | "practice" | "mock";

export interface CrunchDayTask {
  id: string;
  topicId: string;
  examId: string;
  type: CrunchTaskType;
  duration: number; // minutes
  done: boolean;
  completedAt: string | null;
}

export interface CrunchDay {
  date: string; // YYYY-MM-DD
  tasks: CrunchDayTask[];
  totalMinutes: number;
  completedMinutes: number;
}

export interface CrunchStats {
  examCount: number;
  topicCount: number;
  dayCount: number;
  totalMinutes: number;
  completedMinutes: number;
  behindPct: number;
  nextExamDays: number | null;
  nextExamName: string | null;
}

export interface CrunchPlanData {
  exams: CrunchExam[];
  topics: CrunchTopic[];
  days: CrunchDay[];
  dailyMinutes: number;
  generatedAt: string;
  stats: CrunchStats;
}

export interface CrunchStatus {
  id: string;
  status: "building" | "ready" | "error";
  error: string;
  data: CrunchPlanData | null;
  updatedAt: string;
  lastAlertAt: string | null;
}

// ----- helpers -----

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string): Date {
  // Accept YYYY-MM-DD or full ISO.
  if (s.length === 10) return new Date(s + "T00:00:00Z");
  return new Date(s);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// Spaced repetition intervals (days between sessions for a topic).
const SR_INTERVALS = [1, 3, 7, 14];

// ----- status / fetch -----

export async function getCrunchStatus(userId: string): Promise<CrunchStatus | null> {
  const row = await prisma.crunchPlan.findUnique({ where: { userId } });
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
}): CrunchStatus {
  let data: CrunchPlanData | null = null;
  if (row.status === "ready") {
    try {
      data = JSON.parse(row.data) as CrunchPlanData;
    } catch {
      data = null;
    }
  }
  return {
    id: row.id,
    status: row.status as CrunchStatus["status"],
    error: row.error,
    data,
    updatedAt: row.updatedAt.toISOString(),
    lastAlertAt: row.lastAlertAt ? row.lastAlertAt.toISOString() : null,
  };
}

// ----- build (fire-and-forget + polling) -----

export interface CrunchGenerateInput {
  exams: CrunchExamInput[];
  dailyMinutes?: number;
}

export async function startGenerateCrunch(
  userId: string,
  model: LlmModel,
  input: CrunchGenerateInput
): Promise<{ id: string; status: "ready" | "building"; data: CrunchPlanData | null }> {
  const existing = await prisma.crunchPlan.findUnique({ where: { userId } });
  const reservation = {
    data: "{}",
    status: "building" as const,
    error: "",
    lastAlertAt: existing?.lastAlertAt ?? null,
  };
  const row = existing
    ? await prisma.crunchPlan.update({ where: { id: existing.id }, data: reservation })
    : await prisma.crunchPlan.create({ data: { userId, ...reservation } });

  // Fire-and-forget.
  void generateCrunchPlan(userId, model, input)
    .then((data) =>
      prisma.crunchPlan.update({
        where: { id: row.id },
        data: { data: JSON.stringify(data), status: "ready", error: "" },
      })
    )
    .catch((e) =>
      prisma.crunchPlan
        .update({
          where: { id: row.id },
          data: {
            status: "error",
            error: e instanceof Error ? e.message : "Crunch plan generation failed",
          },
        })
        .catch(() => {})
    );

  return { id: row.id, status: "building", data: null };
}

// ----- core generation logic -----

/** Generate the full CrunchPlanData for a user. */
export async function generateCrunchPlan(
  userId: string,
  model: LlmModel,
  input: CrunchGenerateInput
): Promise<CrunchPlanData> {
  const dailyMinutes = Math.max(15, Math.min(600, input.dailyMinutes ?? 120));
  const now = new Date();
  const todayStr = toDateStr(now);

  // 1. Normalize exams: parse dates, filter past exams, assign ids + colors.
  const colors = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444"];
  const exams: CrunchExam[] = input.exams
    .map((e, i) => ({
      id: e.id || uid("exam"),
      name: e.name.trim() || `Exam ${i + 1}`,
      date: toDateStr(parseDate(e.date)),
      courseId: e.courseId,
      syllabus: e.syllabus.trim(),
      color: e.color || colors[i % colors.length],
    }))
    .filter((e) => parseDate(e.date).getTime() > now.getTime() - 86400000); // include today

  if (exams.length === 0) {
    throw new Error("No upcoming exams. Add at least one exam with a future date.");
  }

  // 2. Load user data for mastery + topic linking.
  const [courses, decks, reviews, assignments, studySessions] = await Promise.all([
    prisma.course.findMany({
      where: { userId },
      select: { id: true, name: true, code: true, color: true },
    }),
    prisma.flashcardDeck.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        cards: { select: { id: true, front: true, back: true, deckId: true } },
      },
    }),
    prisma.flashcardReview.findMany({
      where: { userId },
      select: { cardId: true, quality: true },
    }),
    prisma.assignment.findMany({
      where: { course: { userId } },
      select: { id: true, courseId: true, name: true, score: true, maxScore: true, weight: true, category: true },
    }),
    prisma.studySession.findMany({
      where: { userId },
      select: { type: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // 3. Compute deck mastery from reviews.
  const reviewsByCard = new Map<string, number[]>();
  for (const r of reviews) {
    const arr = reviewsByCard.get(r.cardId);
    if (arr) arr.push(r.quality);
    else reviewsByCard.set(r.cardId, [r.quality]);
  }
  const deckMastery = new Map<string, number>();
  for (const d of decks) {
    const qualities: number[] = [];
    for (const card of d.cards) {
      const qs = reviewsByCard.get(card.id);
      if (qs) qualities.push(...qs);
    }
    if (qualities.length > 0) {
      deckMastery.set(d.id, qualities.reduce((a, b) => a + b, 0) / qualities.length / 5);
    }
  }

  // 4. Compute course grade percentages.
  const courseGrade = new Map<string, number>();
  const assignmentsByCourse = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const arr = assignmentsByCourse.get(a.courseId);
    if (arr) arr.push(a);
    else assignmentsByCourse.set(a.courseId, [a]);
  }
  for (const [courseId, asgs] of assignmentsByCourse) {
    let totalWeight = 0;
    let weightedScore = 0;
    for (const a of asgs) {
      const w = a.weight || 1;
      const pct = a.maxScore > 0 ? (a.score / a.maxScore) * 100 : 0;
      totalWeight += w;
      weightedScore += pct * w;
    }
    if (totalWeight > 0) courseGrade.set(courseId, weightedScore / totalWeight);
  }

  // 5. Parse syllabi into topics via LLM (or use course assignments as fallback).
  const topics: CrunchTopic[] = [];
  for (const exam of exams) {
    const examTopics = await parseSyllabus(model, exam, decks, courses);
    for (const t of examTopics) {
      // Compute mastery from linked decks + course grade.
      let mastery = -1;
      const masteryValues: number[] = [];
      for (const deckId of t.deckIds) {
        const m = deckMastery.get(deckId);
        if (m !== undefined) masteryValues.push(m);
      }
      if (exam.courseId) {
        const g = courseGrade.get(exam.courseId);
        if (g !== undefined) masteryValues.push(g / 100);
      }
      if (masteryValues.length > 0) {
        mastery = masteryValues.reduce((a, b) => a + b, 0) / masteryValues.length;
      }
      topics.push({
        id: uid("topic"),
        ...t,
        examId: exam.id,
        mastery,
      });
    }
  }

  if (topics.length === 0) {
    throw new Error("No topics could be extracted from the syllabi. Add more detail to your exam syllabi.");
  }

  // 6. Generate spaced-repetition schedule.
  const days = generateSchedule(exams, topics, dailyMinutes, now);

  // 7. Compute stats.
  const stats = computeStats(exams, topics, days, now);

  return {
    exams,
    topics,
    days,
    dailyMinutes,
    generatedAt: now.toISOString(),
    stats,
  };
}

// ----- syllabus parsing (LLM) -----

interface ParsedTopic {
  label: string;
  priority: number;
  estimatedHours: number;
  deckIds: string[];
}

/** Parse a syllabus into topics. Uses LLM for free-text syllabi; falls back
 *  to course assignments if the exam has a courseId but no syllabus. */
async function parseSyllabus(
  model: LlmModel,
  exam: CrunchExam,
  decks: { id: string; name: string; cards: { id: string; front: string; back: string }[] }[],
  courses: { id: string; name: string; code: string }[]
): Promise<ParsedTopic[]> {
  // If no syllabus but has a course, use course assignments as topics.
  if (!exam.syllabus && exam.courseId) {
    // Fallback: create one topic per course name.
    const course = courses.find((c) => c.id === exam.courseId);
    return [{
      label: course?.name ?? exam.name,
      priority: 3,
      estimatedHours: 10,
      deckIds: matchDecks(decks, course?.name ?? exam.name),
    }];
  }

  if (!exam.syllabus) {
    return [{
      label: exam.name,
      priority: 3,
      estimatedHours: 8,
      deckIds: matchDecks(decks, exam.name),
    }];
  }

  // LLM extraction.
  const deckNames = decks.map((d) => d.name).filter(Boolean).slice(0, 20);
  const prompt = `You are an exam planner. Break down the following exam syllabus into study topics. For each topic, estimate its priority (1-5, 5 = most important/hardest) and estimated study hours (1-20).\n\nExam: ${exam.name}\nExam date: ${exam.date}\nSyllabus:\n${exam.syllabus}\n\n${deckNames.length > 0 ? `The user has these flashcard decks (match topics to decks by name if relevant): ${deckNames.join(", ")}` : ""}\n\nReturn JSON: { "topics": [{ "label": string, "priority": number, "estimatedHours": number, "deckName": string|null }] }. Aim for 3-12 topics. Keep labels short (1-5 words).`;
  const schemaHint = `Respond with { "topics": [{ "label": string, "priority": number, "estimatedHours": number, "deckName": string|null }] }.`;
  try {
    const raw = await generateJson<{ topics: any[] }>(model, prompt, schemaHint);
    const out: ParsedTopic[] = [];
    for (const t of raw.topics ?? []) {
      const label = String(t?.label ?? "").trim();
      if (!label) continue;
      const priority = Math.max(1, Math.min(5, Math.round(Number(t?.priority ?? 3))));
      const estimatedHours = Math.max(1, Math.min(40, Math.round(Number(t?.estimatedHours ?? 5))));
      const deckName = String(t?.deckName ?? "").trim();
      const deckIds = deckName ? matchDecks(decks, deckName) : matchDecks(decks, label);
      out.push({ label, priority, estimatedHours, deckIds });
    }
    if (out.length > 0) return out;
  } catch {
    // LLM failure — fall back to simple splitting.
  }

  // Fallback: split syllabus by lines or commas.
  const parts = exam.syllabus
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && s.length < 100);
  return parts.slice(0, 12).map((label) => ({
    label,
    priority: 3,
    estimatedHours: 5,
    deckIds: matchDecks(decks, label),
  }));
}

/** Match flashcard decks to a topic label by name similarity. */
function matchDecks(
  decks: { id: string; name: string; cards: { id: string; front: string; back: string }[] }[],
  label: string
): string[] {
  if (!label) return [];
  const lower = label.toLowerCase();
  return decks
    .filter((d) => {
      const name = d.name.toLowerCase();
      return name.includes(lower) || lower.includes(name);
    })
    .map((d) => d.id);
}

// ----- schedule generation (deterministic spaced repetition) -----

/** Generate a day-by-day schedule from today to the latest exam date. */
function generateSchedule(
  exams: CrunchExam[],
  topics: CrunchTopic[],
  dailyMinutes: number,
  now: Date
): CrunchDay[] {
  // Find the date range: today → latest exam date + 1 day buffer.
  const latestExam = exams.reduce((a, b) => (parseDate(b.date) > parseDate(a.date) ? b : a));
  const endDate = addDays(parseDate(latestExam.date), 0);
  const totalDays = Math.max(1, daysBetween(now, endDate) + 1);

  // Build a map of date → exam (for mock-exam scheduling on exam day).
  const examByDate = new Map<string, CrunchExam>();
  for (const e of exams) examByDate.set(e.date, e);

  // For each topic, compute the sessions needed.
  // Sessions = "new" (learn) + "review" (spaced repetition) + "practice" + "mock".
  interface PlannedSession {
    topicId: string;
    examId: string;
    type: CrunchTaskType;
    duration: number;
    // Preferred day offset (0 = today). For spaced reviews, this is the
    // interval from the first "new" session.
    dayOffset: number;
  }
  const sessions: PlannedSession[] = [];

  for (const topic of topics) {
    const exam = exams.find((e) => e.id === topic.examId);
    if (!exam) continue;
    const examDate = parseDate(exam.date);
    const daysUntilExam = Math.max(1, daysBetween(now, examDate));

    // Mastery-based session count:
    //   mastery < 0 (no data) → treat as 0.3
    //   Low mastery → more "new" sessions + frequent reviews
    //   High mastery → fewer reviews
    const m = topic.mastery < 0 ? 0.3 : topic.mastery;
    const newSessions = Math.max(1, Math.round(topic.estimatedHours * (1 - m) / 1.5));
    const reviewCount = Math.max(1, Math.round((1 - m) * SR_INTERVALS.length + 1));

    // Duration per session: ~30-60 min depending on topic size.
    const sessionDur = Math.max(20, Math.min(60, Math.round((topic.estimatedHours * 60) / (newSessions + reviewCount))));

    // Distribute "new" sessions in the first 60% of days until exam.
    const newPhaseEnd = Math.max(1, Math.floor(daysUntilExam * 0.6));
    for (let i = 0; i < newSessions; i++) {
      const offset = Math.min(newPhaseEnd - 1, Math.floor((i / Math.max(1, newSessions)) * newPhaseEnd));
      sessions.push({
        topicId: topic.id,
        examId: topic.examId,
        type: "new",
        duration: sessionDur,
        dayOffset: offset,
      });
    }

    // Spaced reviews: after the last "new" session, at SR_INTERVALS.
    const lastNewOffset = Math.min(newPhaseEnd - 1, Math.floor(((newSessions - 1) / Math.max(1, newSessions)) * newPhaseEnd));
    for (let r = 0; r < reviewCount; r++) {
      const interval = SR_INTERVALS[Math.min(r, SR_INTERVALS.length - 1)];
      const offset = Math.min(daysUntilExam - 2, lastNewOffset + interval + r * 2);
      if (offset >= 0 && offset < daysUntilExam) {
        sessions.push({
          topicId: topic.id,
          examId: topic.examId,
          type: "review",
          duration: Math.round(sessionDur * 0.6),
          dayOffset: offset,
        });
      }
    }

    // Practice sessions in the last 30% of days.
    const practiceStart = Math.floor(daysUntilExam * 0.7);
    if (practiceStart < daysUntilExam - 1) {
      const practiceSessions = Math.max(1, Math.round(topic.priority / 2));
      for (let p = 0; p < practiceSessions; p++) {
        const offset = Math.min(daysUntilExam - 2, practiceStart + Math.floor((p / Math.max(1, practiceSessions)) * (daysUntilExam - 1 - practiceStart)));
        sessions.push({
          topicId: topic.id,
          examId: topic.examId,
          type: "practice",
          duration: Math.round(sessionDur * 0.8),
          dayOffset: offset,
        });
      }
    }

    // Mock exam: 1-2 days before the exam, weighted by priority.
    if (topic.priority >= 3) {
      const mockOffset = Math.max(0, daysUntilExam - 2);
      sessions.push({
        topicId: topic.id,
        examId: topic.examId,
        type: "mock",
        duration: Math.min(90, sessionDur * 2),
        dayOffset: mockOffset,
      });
    }
  }

  // Sort sessions by day offset, then by priority (higher priority first
  // within a day). Distribute across days respecting dailyMinutes cap.
  const topicsById = new Map(topics.map((t) => [t.id, t]));
  sessions.sort((a, b) => {
    if (a.dayOffset !== b.dayOffset) return a.dayOffset - b.dayOffset;
    const pa = topicsById.get(a.topicId)?.priority ?? 3;
    const pb = topicsById.get(b.topicId)?.priority ?? 3;
    return pb - pa;
  });

  const days: CrunchDay[] = [];
  for (let d = 0; d < totalDays; d++) {
    const dateStr = toDateStr(addDays(now, d));
    const dayTasks: CrunchDayTask[] = [];
    let dayMinutes = 0;

    // Add sessions scheduled for this day, respecting dailyMinutes.
    for (const s of sessions) {
      if (s.dayOffset !== d) continue;
      if (dayMinutes + s.duration > dailyMinutes * 1.5) continue; // soft cap
      dayTasks.push({
        id: uid("task"),
        topicId: s.topicId,
        examId: s.examId,
        type: s.type,
        duration: s.duration,
        done: false,
        completedAt: null,
      });
      dayMinutes += s.duration;
    }

    // If exam is on this day, add a mock exam task for the whole exam.
    const examToday = examByDate.get(dateStr);
    if (examToday) {
      dayTasks.push({
        id: uid("task"),
        topicId: "exam-day",
        examId: examToday.id,
        type: "mock",
        duration: Math.min(180, dailyMinutes),
        done: false,
        completedAt: null,
      });
      dayMinutes += Math.min(180, dailyMinutes);
    }

    days.push({
      date: dateStr,
      tasks: dayTasks,
      totalMinutes: dayTasks.reduce((a, t) => a + t.duration, 0),
      completedMinutes: 0,
    });
  }

  return days;
}

// ----- stats -----

function computeStats(
  exams: CrunchExam[],
  topics: CrunchTopic[],
  days: CrunchDay[],
  now: Date
): CrunchStats {
  const totalMinutes = days.reduce((a, d) => a + d.totalMinutes, 0);
  const completedMinutes = days.reduce((a, d) => a + d.completedMinutes, 0);

  // Behind %: compare completed vs expected up to today.
  const todayStr = toDateStr(now);
  const pastDays = days.filter((d) => d.date < todayStr);
  const expectedPast = pastDays.reduce((a, d) => a + d.totalMinutes, 0);
  const completedPast = pastDays.reduce((a, d) => a + d.completedMinutes, 0);
  let behindPct = 0;
  if (expectedPast > 0) {
    behindPct = Math.max(0, Math.round(((expectedPast - completedPast) / expectedPast) * 100));
  }

  // Next exam info.
  const upcomingExams = exams
    .filter((e) => parseDate(e.date).getTime() >= now.getTime() - 86400000)
    .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
  const nextExam = upcomingExams[0] ?? null;
  const nextExamDays = nextExam ? Math.max(0, daysBetween(now, parseDate(nextExam.date))) : null;

  return {
    examCount: exams.length,
    topicCount: topics.length,
    dayCount: days.length,
    totalMinutes,
    completedMinutes,
    behindPct,
    nextExamDays,
    nextExamName: nextExam?.name ?? null,
  };
}

// ----- progress logging -----

export interface LogProgressInput {
  taskId: string;
  done: boolean;
  duration?: number; // actual minutes spent (optional override)
}

/** Log progress on a task: mark it done/not-done and update completedMinutes.
 *  Returns the updated plan data. */
export async function logProgress(
  userId: string,
  input: LogProgressInput
): Promise<CrunchPlanData | null> {
  const row = await prisma.crunchPlan.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return null;
  let data: CrunchPlanData;
  try {
    data = JSON.parse(row.data) as CrunchPlanData;
  } catch {
    return null;
  }

  let updated = false;
  for (const day of data.days) {
    for (const task of day.tasks) {
      if (task.id === input.taskId) {
        const wasDone = task.done;
        task.done = input.done;
        task.completedAt = input.done ? new Date().toISOString() : null;
        if (input.duration !== undefined && input.duration > 0) {
          task.duration = input.duration;
        }
        updated = true;
        // Recompute day completed minutes.
        day.completedMinutes = day.tasks.filter((t) => t.done).reduce((a, t) => a + t.duration, 0);
        // Adjust totalMinutes if duration changed.
        day.totalMinutes = day.tasks.reduce((a, t) => a + t.duration, 0);
        if (!updated) break;
        // Recompute stats.
        data.stats = computeStats(data.exams, data.topics, data.days, new Date());
        break;
      }
    }
    if (updated) break;
  }

  if (!updated) return null;

  await prisma.crunchPlan.update({
    where: { userId },
    data: { data: JSON.stringify(data) },
  });

  return data;
}

/** Mark all tasks on a given date as done (bulk complete a day). */
export async function logDayComplete(
  userId: string,
  dateStr: string
): Promise<CrunchPlanData | null> {
  const row = await prisma.crunchPlan.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return null;
  let data: CrunchPlanData;
  try {
    data = JSON.parse(row.data) as CrunchPlanData;
  } catch {
    return null;
  }

  const day = data.days.find((d) => d.date === dateStr);
  if (!day) return null;

  const now = new Date().toISOString();
  for (const task of day.tasks) {
    if (!task.done) {
      task.done = true;
      task.completedAt = now;
    }
  }
  day.completedMinutes = day.tasks.reduce((a, t) => a + t.duration, 0);
  data.stats = computeStats(data.exams, data.topics, data.days, new Date());

  await prisma.crunchPlan.update({
    where: { userId },
    data: { data: JSON.stringify(data) },
  });

  return data;
}

// ----- behind-alert check (called by scheduler or on fetch) -----

/** Check if the user is falling behind and send an ntfy alert if so (throttled
 *  to once per day). Returns true if an alert was sent. */
export async function checkBehindAlert(userId: string): Promise<boolean> {
  const row = await prisma.crunchPlan.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return false;

  let data: CrunchPlanData;
  try {
    data = JSON.parse(row.data) as CrunchPlanData;
  } catch {
    return false;
  }

  // Recompute stats (in case days have passed since generation).
  data.stats = computeStats(data.exams, data.topics, data.days, new Date());

  // Only alert if behind by >20% and there are past days with incomplete work.
  if (data.stats.behindPct < 20) return false;

  // Throttle: max one alert per day.
  const now = new Date();
  if (row.lastAlertAt) {
    const hoursSince = (now.getTime() - row.lastAlertAt.getTime()) / 3600000;
    if (hoursSince < 24) return false;
  }

  // Send ntfy alert.
  const ntfyCfg = await decryptNtfyConfig(userId);
  if (!ntfyCfg) return false; // ntfy not configured — can't alert.

  const nextExam = data.stats.nextExamName
    ? `${data.stats.nextExamName} in ${data.stats.nextExamDays} day${data.stats.nextExamDays === 1 ? "" : "s"}`
    : "your next exam";
  const body = `You're ${data.stats.behindPct}% behind on your study plan. ${nextExam}. Open Crunch to catch up — you've completed ${Math.round(data.stats.completedMinutes / 60)}h of ${Math.round(data.stats.totalMinutes / 60)}h planned.`;

  try {
    await publish(ntfyCfg, {
      topic: ntfyCfg.notifyTopic,
      title: "Crunch — falling behind",
      body,
      priority: 4,
      tags: "warning,books",
    });
  } catch {
    return false; // ntfy publish failed — don't update lastAlertAt.
  }

  await prisma.crunchPlan.update({
    where: { userId },
    data: { lastAlertAt: now },
  });

  return true;
}

// ----- delete plan -----

export async function deleteCrunchPlan(userId: string): Promise<void> {
  await prisma.crunchPlan.deleteMany({ where: { userId } });
}
