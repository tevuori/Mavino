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
import { generateLessonPlan } from "./study/teacher-lesson";
import { extractSessionImages } from "./study/teacher-images";
import { logSessionSafe } from "./study/logSession";
import type { GroundedSource } from "./study/prompts";
import type { TeacherSessionState } from "./study/teacher-prompt";

// ----- Plan data shape (stored as JSON in CrunchPlan.data) -----

export interface CrunchExamInput {
  id?: string;
  name: string;
  date: string; // ISO date (YYYY-MM-DD or full ISO)
  courseId?: string;
  syllabus: string;
  color?: string;
  /** StudySource ids: study materials for this exam (files, notes, urls). */
  sourceIds?: string[];
  /** StudySource ids: past exams from previous years. */
  pastExamSourceIds?: string[];
  /** StudySource id whose text is appended to the syllabus before parsing. */
  syllabusSourceId?: string;
  /** LearningWorkspace the sources were imported from (metadata only). */
  workspaceId?: string;
  /** Preserved across regenerations when editing an existing exam. */
  mockSessionId?: string;
}

export interface CrunchExam {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  courseId?: string;
  syllabus: string;
  color: string;
  sourceIds: string[];
  pastExamSourceIds: string[];
  syllabusSourceId?: string;
  workspaceId?: string;
  /** TeacherSession id for the exam's mock exam (created lazily). */
  mockSessionId?: string;
}

/** Read-time progress of a chapter's linked Teach Me session. */
export interface ChapterProgress {
  status: "not_started" | "in_progress" | "completed";
  covered: number;
  total: number;
  /** 0..1 average pass rate across checked concepts; -1 = nothing checked. */
  passRate: number;
}

export interface CrunchTopic {
  id: string;
  examId: string;
  label: string;
  mastery: number; // 0..1; -1 = no data
  priority: number; // 1..5
  estimatedHours: number;
  deckIds: string[];
  /** TeacherSession id for this chapter (created lazily via /teach). */
  teachSessionId?: string;
  /** Computed at read time from the linked session — not persisted. */
  chapterProgress?: ChapterProgress;
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
  const status = serializeStatus(row);
  if (status.data) await attachChapterProgress(status.data);
  return status;
}

/** Derive per-chapter progress from linked Teach Me sessions. Mutates
 *  `data.topics` in place (the value is read-time only, never persisted). */
async function attachChapterProgress(data: CrunchPlanData): Promise<void> {
  const sessionIds = data.topics.map((t) => t.teachSessionId).filter((s): s is string => Boolean(s));
  if (sessionIds.length === 0) return;
  const sessions = await prisma.teacherSession.findMany({
    where: { id: { in: sessionIds } },
    select: { id: true, state: true },
  });
  const stateById = new Map<string, TeacherSessionState>();
  for (const s of sessions) {
    try {
      const v = JSON.parse(s.state);
      stateById.set(s.id, v && typeof v === "object" ? v : {});
    } catch {
      stateById.set(s.id, {});
    }
  }
  for (const topic of data.topics) {
    if (!topic.teachSessionId) continue;
    const state = stateById.get(topic.teachSessionId);
    if (!state) continue;
    topic.chapterProgress = chapterProgressFromState(state);
  }
}

/** One-line per-chapter progress summary for an exam — injected into the
 *  teacher system prompt so the tutor knows where the student stands across
 *  the whole plan. Returns null when the exam can't be found. */
export async function examChapterSummary(userId: string, examId: string): Promise<string | null> {
  const row = await prisma.crunchPlan.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return null;
  let data: CrunchPlanData;
  try {
    data = JSON.parse(row.data) as CrunchPlanData;
  } catch {
    return null;
  }
  const exam = data.exams.find((e) => e.id === examId);
  if (!exam) return null;
  await attachChapterProgress(data);
  const chapters = data.topics.filter((t) => t.examId === examId);
  const done = chapters.filter((t) => t.chapterProgress?.status === "completed").length;
  const lines = chapters.map((t, i) => {
    const p = t.chapterProgress;
    const mark = p?.status === "completed" ? "done" : p?.status === "in_progress" ? `in progress (${p.covered}/${p.total} concepts)` : "not started";
    return `${i + 1}. ${t.label} — ${mark}`;
  });
  return `${done}/${chapters.length} chapters complete: ${lines.join("; ")}`;
}

export function chapterProgressFromState(state: TeacherSessionState): ChapterProgress {
  const keyConcepts = state.lessonPlan?.keyConcepts ?? [];
  const coveredSet = new Set((state.coveredConcepts ?? []).map((c) => c.toLowerCase()));
  const covered = keyConcepts.filter((c) => coveredSet.has(c.toLowerCase())).length;
  const total = keyConcepts.length;
  const masteryEntries = Object.values(state.mastery ?? {});
  const checked = masteryEntries.filter((m) => m.checksTotal > 0);
  const passRate =
    checked.length > 0
      ? checked.reduce((a, m) => a + m.checksPassed / m.checksTotal, 0) / checked.length
      : -1;
  const hasActivity =
    (state.coveredConcepts?.length ?? 0) > 0 || (state.comprehensionLog?.length ?? 0) > 0;
  const completed =
    Boolean(state.lessonCompletedAt) || (total > 0 && covered >= total);
  return {
    status: completed ? "completed" : hasActivity ? "in_progress" : "not_started",
    covered,
    total,
    passRate,
  };
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
      sourceIds: (e.sourceIds ?? []).slice(0, 50),
      pastExamSourceIds: (e.pastExamSourceIds ?? []).slice(0, 50),
      syllabusSourceId: e.syllabusSourceId,
      workspaceId: e.workspaceId,
      // Mock session survives regeneration (chapters get new ids and are
      // intentionally re-linked; the mock session stays bound to the exam).
      mockSessionId: e.mockSessionId,
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

  // 5. Parse syllabi into chapter topics via LLM (or use course assignments
  //    as fallback). Source material + past exams ground the outline when
  //    attached to the exam.
  const topics: CrunchTopic[] = [];
  for (const exam of exams) {
    const srcs = await loadExamSources(userId, exam);
    const examTopics = await parseSyllabus(model, exam, decks, courses, srcs);
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

interface ExamSources {
  materials: GroundedSource[];
  pastExams: GroundedSource[];
  syllabusText: string;
}

/** Load the StudySource texts attached to an exam (materials + past exams +
 *  an optional syllabus file). Only sources owned by the user are returned. */
export async function loadExamSources(userId: string, exam: CrunchExam): Promise<ExamSources> {
  // Legacy plans (pre-sources) may not have the arrays at all.
  const sourceIds = exam.sourceIds ?? [];
  const pastExamSourceIds = exam.pastExamSourceIds ?? [];
  const ids = [...new Set([...sourceIds, ...pastExamSourceIds, ...(exam.syllabusSourceId ? [exam.syllabusSourceId] : [])])];
  if (ids.length === 0) return { materials: [], pastExams: [], syllabusText: exam.syllabus };
  const rows = await prisma.studySource.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, name: true, kind: true, refId: true, textCache: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const toSource = (id: string, i: number): GroundedSource | null => {
    const r = byId.get(id);
    if (!r) return null;
    return { index: i + 1, name: r.name, kind: r.kind, refId: r.refId, text: r.textCache };
  };
  const materials = sourceIds.map((id, i) => toSource(id, i)).filter((s): s is GroundedSource => s !== null);
  const pastExams = pastExamSourceIds.map((id, i) => toSource(id, i)).filter((s): s is GroundedSource => s !== null);
  const syllabusSrc = exam.syllabusSourceId ? byId.get(exam.syllabusSourceId) : null;
  const syllabusText = [exam.syllabus, syllabusSrc?.textCache?.trim()]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join("\n\n")
    .slice(0, 20000);
  return { materials, pastExams, syllabusText };
}

function excerpt(text: string, max = 3000): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Parse a syllabus (+ attached sources) into chapter topics. Uses the LLM
 *  for free-text syllabi and source-grounded outlines; falls back to course
 *  assignments or line-splitting when the LLM fails. */
async function parseSyllabus(
  model: LlmModel,
  exam: CrunchExam,
  decks: { id: string; name: string; cards: { id: string; front: string; back: string }[] }[],
  courses: { id: string; name: string; code: string }[],
  srcs?: ExamSources
): Promise<ParsedTopic[]> {
  const syllabusText = srcs?.syllabusText ?? exam.syllabus;
  const materials = srcs?.materials ?? [];
  const pastExams = srcs?.pastExams ?? [];
  const hasSources = materials.length > 0 || pastExams.length > 0;

  // If no syllabus and no sources but has a course, use the course as topic.
  if (!syllabusText && !hasSources && exam.courseId) {
    const course = courses.find((c) => c.id === exam.courseId);
    return [{
      label: course?.name ?? exam.name,
      priority: 3,
      estimatedHours: 10,
      deckIds: matchDecks(decks, course?.name ?? exam.name),
    }];
  }

  if (!syllabusText && !hasSources) {
    return [{
      label: exam.name,
      priority: 3,
      estimatedHours: 8,
      deckIds: matchDecks(decks, exam.name),
    }];
  }

  // LLM extraction — grounded in the syllabus text plus short excerpts of the
  // attached materials and past exams (past exams raise the priority of
  // topics that keep reappearing).
  const deckNames = decks.map((d) => d.name).filter(Boolean).slice(0, 20);
  const materialBlock = materials.length
    ? `\nSTUDY MATERIALS (excerpts):\n${materials.map((s) => `--- ${s.name} ---\n${excerpt(s.text)}`).join("\n")}\n`
    : "";
  const pastExamBlock = pastExams.length
    ? `\nPAST EXAMS (excerpts — topics that keep reappearing here are high priority):\n${pastExams.map((s) => `--- ${s.name} ---\n${excerpt(s.text)}`).join("\n")}\n`
    : "";
  const prompt = `You are an exam planner. Build a study outline for the exam below: an ORDERED list of chapters (topics) the student must master, ordered so each builds on the previous one.\n\nExam: ${exam.name}\nExam date: ${exam.date}\n${syllabusText ? `Syllabus:\n${syllabusText}\n` : ""}${materialBlock}${pastExamBlock}\n${deckNames.length > 0 ? `The user has these flashcard decks (match topics to decks by name if relevant): ${deckNames.join(", ")}\n` : ""}\nRules:\n- For each chapter estimate priority (1-5, 5 = most important/hardest; raise it for topics that recur in past exams) and estimated study hours (1-20).\n- 3-12 chapters when the syllabus is text-only; up to 15 when source materials are attached. Keep labels short (1-5 words), using the sources' wording.\n\nReturn JSON: { "topics": [{ "label": string, "priority": number, "estimatedHours": number, "deckName": string|null }] }.`;
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

  // Fallback: split the typed syllabus by lines or commas (materials can't be
  // parsed without the LLM, so source-only exams get one chapter per file).
  const parts = exam.syllabus
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && s.length < 100);
  if (parts.length === 0) {
    return materials.slice(0, 8).map((s) => ({
      label: s.name.slice(0, 60),
      priority: 3,
      estimatedHours: 5,
      deckIds: matchDecks(decks, s.name),
    }));
  }
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

// ----- Teach Me integration: chapter + mock sessions -----

export interface TeachSessionResult {
  ok: boolean;
  sessionId?: string;
  created?: boolean;
  title?: string;
  error?: string;
}

/** Result of loading the plan row + parsed data for session linking. */
async function loadReadyPlan(
  userId: string
): Promise<{ rowId: string; data: CrunchPlanData } | null> {
  const row = await prisma.crunchPlan.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return null;
  try {
    const data = JSON.parse(row.data) as CrunchPlanData;
    return { rowId: row.id, data };
  } catch {
    return null;
  }
}

/** Ordered sourceIds a teach session should be grounded on. Chapter sessions
 *  lead with study materials; mock sessions lead with past exams. */
function sessionSourceIds(exam: CrunchExam, mock: boolean): string[] {
  const ids = mock
    ? [...(exam.pastExamSourceIds ?? []), ...(exam.sourceIds ?? [])]
    : [...(exam.sourceIds ?? []), ...(exam.pastExamSourceIds ?? [])];
  return [...new Set(ids)];
}

/** Load GroundedSources (with cached text) in the given id order. */
async function groundedSourcesFor(userId: string, sourceIds: string[]): Promise<GroundedSource[]> {
  if (sourceIds.length === 0) return [];
  const rows = await prisma.studySource.findMany({
    where: { id: { in: sourceIds }, userId },
    select: { id: true, name: true, kind: true, refId: true, textCache: true },
  });
  return sourceIds
    .map((id, i) => {
      const r = rows.find((x) => x.id === id);
      if (!r) return null;
      return { index: i + 1, name: r.name, kind: r.kind, refId: r.refId, text: r.textCache };
    })
    .filter((s): s is GroundedSource => s !== null);
}

async function sessionExists(userId: string, sessionId: string): Promise<boolean> {
  const row = await prisma.teacherSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  return row !== null;
}

/** Post-creation parity with /api/teacher: log the study session + kick off
 *  background PDF image extraction (persists into session state). */
async function afterSessionCreated(
  userId: string,
  sessionId: string,
  title: string,
  sourceIds: string[],
  sources: GroundedSource[],
  state: TeacherSessionState
): Promise<void> {
  await logSessionSafe(userId, "teach_session_started", title, sourceIds[0] ?? "", {
    sources: sourceIds.length,
    studentLevel: state.studentLevel,
    teachingStyle: state.teachingStyle,
  });
  if (state.imageAware !== false && sources.length > 0) {
    extractSessionImages(userId, sources)
      .then(async (images) => {
        if (images.length > 0) {
          const row = await prisma.teacherSession.findFirst({
            where: { id: sessionId },
            select: { state: true },
          });
          let current: TeacherSessionState = {};
          try {
            const v = JSON.parse(row?.state ?? "{}");
            current = v && typeof v === "object" ? v : {};
          } catch { /* keep {} */ }
          current.sourceImages = images;
          await prisma.teacherSession.update({
            where: { id: sessionId },
            data: { state: JSON.stringify(current) },
          });
        }
      })
      .catch((e) => console.error("[crunch] background image extraction failed:", e));
  }
}

/**
 * Get or create the Teach Me session for a plan chapter (topic). The session
 * is grounded on the exam's study materials + past exams and gets a lesson
 * plan focused on the chapter label. The session id is written back into the
 * plan JSON so progress can be derived on every GET.
 */
export async function ensureChapterSession(
  userId: string,
  model: LlmModel,
  topicId: string,
  language: "en" | "cs" = "en"
): Promise<TeachSessionResult> {
  const loaded = await loadReadyPlan(userId);
  if (!loaded) return { ok: false, error: "No ready Crunch plan." };
  const { rowId, data } = loaded;

  const topic = data.topics.find((t) => t.id === topicId);
  if (!topic) return { ok: false, error: "Chapter not found." };
  const exam = data.exams.find((e) => e.id === topic.examId);
  if (!exam) return { ok: false, error: "Exam not found." };

  if (topic.teachSessionId && (await sessionExists(userId, topic.teachSessionId))) {
    return { ok: true, sessionId: topic.teachSessionId, created: false, title: `${exam.name} — ${topic.label}` };
  }

  const sourceIds = sessionSourceIds(exam, false);
  const sources = await groundedSourcesFor(userId, sourceIds);
  if (sources.length === 0) {
    return { ok: false, error: "This exam has no study materials attached. Add sources in the exam setup first." };
  }

  const crunchRef = {
    examId: exam.id,
    examName: exam.name,
    examDate: exam.date,
    topicId: topic.id,
    topicLabel: topic.label,
  };
  const state: TeacherSessionState = {
    studentLevel: "intermediate",
    sourceHistory: [],
    coveredConcepts: [],
    comprehensionLog: [],
    mastery: {},
    teachingStyle: "explain",
    followPlan: true,
    imageAware: true,
    crunchRef,
  };

  const created = await prisma.teacherSession.create({
    data: {
      userId,
      title: `${exam.name} — ${topic.label}`.slice(0, 200),
      sourceIds: JSON.stringify(sourceIds),
      messages: "[]",
      state: JSON.stringify(state),
    },
  });
  await afterSessionCreated(userId, created.id, created.title, sourceIds, sources, state);

  // Generate the chapter lesson plan (non-fatal if it fails — the tutor can
  // still teach from the sources without an agenda).
  try {
    const plan = await generateLessonPlan(model, sources, {
      studentLevel: "intermediate",
      focus: `Chapter "${topic.label}" for the upcoming exam "${exam.name}". Cover only this chapter's material, building toward exam readiness.`,
      language,
    });
    if (plan) {
      const nextState: TeacherSessionState = { ...state, lessonPlan: plan, followPlan: true };
      await prisma.teacherSession.update({
        where: { id: created.id },
        data: { state: JSON.stringify(nextState) },
      });
    }
  } catch {
    // lesson plan unavailable — session still usable
  }

  // Persist the link back into the plan (keep any concurrent task edits).
  const current = await loadReadyPlan(userId);
  if (current) {
    const t = current.data.topics.find((x) => x.id === topicId);
    if (t) {
      t.teachSessionId = created.id;
      await prisma.crunchPlan.update({
        where: { id: rowId },
        data: { data: JSON.stringify(current.data) },
      });
    }
  }

  return { ok: true, sessionId: created.id, created: true, title: created.title };
}

/**
 * Get or create the exam's mock-exam Teach Me session: an examiner-style
 * session grounded primarily on the attached past exams. Stored on
 * `exam.mockSessionId` (one mock session per exam).
 */
export async function ensureMockSession(
  userId: string,
  _model: LlmModel,
  examId: string
): Promise<TeachSessionResult> {
  const loaded = await loadReadyPlan(userId);
  if (!loaded) return { ok: false, error: "No ready Crunch plan." };
  const { rowId, data } = loaded;

  const exam = data.exams.find((e) => e.id === examId);
  if (!exam) return { ok: false, error: "Exam not found." };

  if (exam.mockSessionId && (await sessionExists(userId, exam.mockSessionId))) {
    return { ok: true, sessionId: exam.mockSessionId, created: false, title: `${exam.name} — Mock exam` };
  }

  const sourceIds = sessionSourceIds(exam, true);
  const sources = await groundedSourcesFor(userId, sourceIds);
  if (sources.length === 0) {
    return { ok: false, error: "This exam has no sources attached. Add past exams or study materials first." };
  }
  if ((exam.pastExamSourceIds?.length ?? 0) === 0) {
    return { ok: false, error: "Add at least one past exam to run a mock exam." };
  }

  const state: TeacherSessionState = {
    studentLevel: "intermediate",
    sourceHistory: [],
    coveredConcepts: [],
    comprehensionLog: [],
    mastery: {},
    teachingStyle: "mock_exam",
    followPlan: false,
    imageAware: true,
    crunchRef: {
      examId: exam.id,
      examName: exam.name,
      examDate: exam.date,
      mock: true,
    },
  };

  const created = await prisma.teacherSession.create({
    data: {
      userId,
      title: `${exam.name} — Mock exam`.slice(0, 200),
      sourceIds: JSON.stringify(sourceIds),
      messages: "[]",
      state: JSON.stringify(state),
    },
  });
  await afterSessionCreated(userId, created.id, created.title, sourceIds, sources, state);

  const current = await loadReadyPlan(userId);
  if (current) {
    const e = current.data.exams.find((x) => x.id === examId);
    if (e) {
      e.mockSessionId = created.id;
      await prisma.crunchPlan.update({
        where: { id: rowId },
        data: { data: JSON.stringify(current.data) },
      });
    }
  }

  return { ok: true, sessionId: created.id, created: true, title: created.title };
}
