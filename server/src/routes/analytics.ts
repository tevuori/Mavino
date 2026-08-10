/**
 * Admin-only analytics overview.
 *
 * GET /api/analytics/overview returns aggregate, anonymous usage stats:
 *   - total + active user counts (active = distinct users with a refresh
 *     token used in the last 7/30 days)
 *   - per-feature usage totals over the last 30 days (from UsageStat),
 *     sorted descending, plus a per-day series for the top 5 features
 *   - feature adoption: how many users have each integration credential
 *   - content totals: aggregate counts of user-created items across apps
 *
 * No userIds, usernames, or any per-user data are ever returned — only
 * scalar counts. This is the single source for the admin Analytics view.
 */

import { Hono } from "hono";
import prisma from "../db/client";
import { adminGuard } from "../middleware/admin";
import { authMiddleware } from "../middleware/auth";
import { appTierGate } from "../middleware/app-tier";
import { flushAnalytics, dayBucket } from "../services/analytics";

const analytics = new Hono();

const DAYS_WINDOW = 30;
const TREND_TOP_N = 5;

/** GET /api/analytics/overview — aggregate anonymous usage stats (admin). */
analytics.get("/overview", ...adminGuard, async (c) => {
  // Flush the in-memory buffer first so the view reflects recent activity.
  await flushAnalytics();

  const now = new Date();
  const windowStart = new Date(now.getTime() - DAYS_WINDOW * 86_400_000);
  const active7d = new Date(now.getTime() - 7 * 86_400_000);
  const active30d = new Date(now.getTime() - 30 * 86_400_000);

  // Run independent queries in parallel.
  const [
    totalUsers,
    active7,
    active30,
    usageRows,
    adoption,
    contentTotals,
  ] = await Promise.all([
    prisma.user.count(),

    // Distinct users with a refresh token used in the last 7 days.
    prisma.refreshToken.findMany({
      where: { lastUsedAt: { gte: active7d } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.refreshToken.findMany({
      where: { lastUsedAt: { gte: active30d } },
      select: { userId: true },
      distinct: ["userId"],
    }),

    // Per-feature usage over the window.
    prisma.usageStat.findMany({
      where: { day: { gte: dayBucket(windowStart) } },
      select: { feature: true, day: true, count: true },
    }),

    // Feature adoption: # users with each integration configured.
    Promise.all([
      prisma.spotifyCredential.count(),
      prisma.microsoftCredential.count(),
      prisma.aiCredential.count(),
      prisma.vutCredentials.count(),
      prisma.ntfyConfig.count(),
      prisma.proactiveAlertConfig.count({ where: { enabled: true } }),
      prisma.ttsCredential.count(),
    ]),

    // Content totals (aggregate across all users).
    Promise.all([
      prisma.note.count(),
      prisma.task.count(),
      prisma.task.count({ where: { status: "DONE" } }),
      prisma.task.count({ where: { status: "IN_PROGRESS" } }),
      prisma.task.count({ where: { status: "TODO" } }),
      prisma.vFile.count(),
      prisma.flashcardDeck.count(),
      prisma.flashcard.count(),
      prisma.course.count(),
      prisma.assignment.count(),
      prisma.calendarEvent.count(),
      prisma.chatConversation.count(),
      prisma.studySession.count(),
      prisma.whiteboard.count(),
      prisma.habit.count(),
      prisma.studySource.count(),
      prisma.studyChat.count(),
      prisma.podcast.count(),
      prisma.teacherSession.count(),
      prisma.ntfyMessage.count(),
    ]),
  ]);

  // Aggregate usage rows: total per feature + per-day series.
  const totalsByFeature = new Map<string, number>();
  const daysByFeature = new Map<string, Map<string, number>>(); // feature -> YYYY-MM-DD -> count
  for (const row of usageRows) {
    const dayStr = row.day.toISOString().slice(0, 10);
    totalsByFeature.set(row.feature, (totalsByFeature.get(row.feature) ?? 0) + row.count);
    let days = daysByFeature.get(row.feature);
    if (!days) {
      days = new Map();
      daysByFeature.set(row.feature, days);
    }
    days.set(dayStr, (days.get(dayStr) ?? 0) + row.count);
  }

  const featureUsage = Array.from(totalsByFeature.entries())
    .map(([feature, total]) => ({ feature, total }))
    .sort((a, b) => b.total - a.total);

  // Per-day series for the top N features (last DAYS_WINDOW days, zero-filled).
  const topFeatures = featureUsage.slice(0, TREND_TOP_N).map((f) => f.feature);
  const trend: Record<string, { day: string; count: number }[]> = {};
  const allDays: string[] = [];
  for (let i = DAYS_WINDOW - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    allDays.push(d.toISOString().slice(0, 10));
  }
  for (const feature of topFeatures) {
    const days = daysByFeature.get(feature) ?? new Map();
    trend[feature] = allDays.map((dayStr) => ({ day: dayStr, count: days.get(dayStr) ?? 0 }));
  }

  const [
    spotifyUsers, msUsers, aiUsers, vutUsers, ntfyUsers, proactiveUsers, ttsUsers,
  ] = adoption;
  const [
    notes, tasks, tasksDone, tasksInProgress, tasksTodo, files, decks, cards,
    courses, assignments, calendarEvents, chats, studySessions, whiteboards,
    habits, studySources, studyChats, podcasts, teacherSessions, ntfyMessages,
  ] = contentTotals;

  return c.json({
    windowDays: DAYS_WINDOW,
    users: {
      total: totalUsers,
      active7d: active7.length,
      active30d: active30.length,
    },
    featureUsage,
    trend,
    adoption: {
      spotify: spotifyUsers,
      microsoft: msUsers,
      ai: aiUsers,
      vut: vutUsers,
      ntfy: ntfyUsers,
      proactiveAlerts: proactiveUsers,
      tts: ttsUsers,
    },
    content: {
      notes,
      tasks,
      tasksDone,
      tasksInProgress,
      tasksTodo,
      files,
      flashcardDecks: decks,
      flashcards: cards,
      courses,
      assignments,
      calendarEvents,
      chatConversations: chats,
      studySessions,
      whiteboards,
      habits,
      studySources,
      studyChats,
      podcasts,
      teacherSessions,
      ntfyMessages,
    },
  });
});

// =====================================================================
// User-scoped Gamification & Study Analytics dashboard
// =====================================================================
// GET /api/analytics/me — aggregates the signed-in user's own data across
// Habits, Pomodoro (FocusSession), Flashcards (FlashcardReview), Grades,
// Study Hub (StudySession), and Tasks into a single dashboard payload with
// per-day series (last 90 days) + all-time totals. Also derives XP/level
// from the dated event logs and resolves achievements (persisting newly
// unlocked ids to GamificationState so the client can toast them).
//
// XP weights: focus minute = 1, flashcard review = 2, habit log = 5,
// task done = 10, study session = 15. XP is fully derivable from the event
// logs, so no XP ledger is stored — only the unlocked-achievement set is.

const ME_WINDOW_DAYS = 90;

/** levelFromXp: smooth curve — level n requires ((n-1)*10)^2 XP. */
function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(xp) / 10) + 1;
}
function levelXpBounds(level: number): { start: number; end: number } {
  return { start: ((level - 1) * 10) ** 2, end: (level * 10) ** 2 };
}

interface AchievementDef {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide icon name (mirrored on the client)
  tier: "bronze" | "silver" | "gold" | "platinum";
  check: (m: AchievementMetrics) => boolean;
}
interface AchievementMetrics {
  focusSessions: number;
  focusMinutes: number;
  reviews: number;
  habitLogs: number;
  maxStreak: number;
  tasksDone: number;
  studySessions: number;
  assignments: number;
  level: number;
}

const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_focus", label: "First Focus", description: "Complete your first focus session", icon: "Timer", tier: "bronze", check: (m) => m.focusSessions >= 1 },
  { id: "focus_apprentice", label: "Focus Apprentice", description: "Complete 10 focus sessions", icon: "Timer", tier: "silver", check: (m) => m.focusSessions >= 10 },
  { id: "focus_master", label: "Focus Master", description: "Complete 100 focus sessions", icon: "Timer", tier: "gold", check: (m) => m.focusSessions >= 100 },
  { id: "time_keeper", label: "Time Keeper", description: "Log 500 focus minutes", icon: "Clock", tier: "silver", check: (m) => m.focusMinutes >= 500 },
  { id: "deep_diver", label: "Deep Diver", description: "Log 3,000 focus minutes", icon: "Clock", tier: "platinum", check: (m) => m.focusMinutes >= 3000 },
  { id: "first_review", label: "First Review", description: "Review your first flashcard", icon: "Brain", tier: "bronze", check: (m) => m.reviews >= 1 },
  { id: "reviewer_50", label: "50 Reviews", description: "Review 50 flashcards", icon: "Brain", tier: "silver", check: (m) => m.reviews >= 50 },
  { id: "reviewer_500", label: "500 Reviews", description: "Review 500 flashcards", icon: "Brain", tier: "gold", check: (m) => m.reviews >= 500 },
  { id: "habit_starter", label: "First Step", description: "Log a habit once", icon: "Flame", tier: "bronze", check: (m) => m.habitLogs >= 1 },
  { id: "habit_7", label: "7-Day Streak", description: "Keep a habit for 7 days", icon: "Flame", tier: "silver", check: (m) => m.maxStreak >= 7 },
  { id: "habit_30", label: "30-Day Streak", description: "Keep a habit for 30 days", icon: "Flame", tier: "gold", check: (m) => m.maxStreak >= 30 },
  { id: "habit_100", label: "100-Day Streak", description: "Keep a habit for 100 days", icon: "Flame", tier: "platinum", check: (m) => m.maxStreak >= 100 },
  { id: "taskmaster_25", label: "Taskmaster", description: "Complete 25 tasks", icon: "CheckSquare", tier: "silver", check: (m) => m.tasksDone >= 25 },
  { id: "taskmaster_100", label: "Centurion", description: "Complete 100 tasks", icon: "CheckSquare", tier: "gold", check: (m) => m.tasksDone >= 100 },
  { id: "scholar_10", label: "Scholar", description: "Run 10 Study Hub sessions", icon: "GraduationCap", tier: "silver", check: (m) => m.studySessions >= 10 },
  { id: "scholar_50", label: "Polymath", description: "Run 50 Study Hub sessions", icon: "GraduationCap", tier: "gold", check: (m) => m.studySessions >= 50 },
  { id: "grade_riser", label: "Grade Riser", description: "Record 10 assignments", icon: "TrendingUp", tier: "silver", check: (m) => m.assignments >= 10 },
  { id: "level_5", label: "Rising Star", description: "Reach level 5", icon: "Star", tier: "silver", check: (m) => m.level >= 5 },
  { id: "level_10", label: "Mavino's Chosen", description: "Reach level 10", icon: "Star", tier: "gold", check: (m) => m.level >= 10 },
  { id: "level_20", label: "Legend", description: "Reach level 20", icon: "Crown", tier: "platinum", check: (m) => m.level >= 20 },
];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** GET /api/analytics/me — the signed-in user's unified dashboard payload. */
analytics.get("/me", authMiddleware, appTierGate("analytics"), async (c) => {
  const { userId } = c.get("auth");
  const now = new Date();
  const windowStart = new Date(now.getTime() - (ME_WINDOW_DAYS - 1) * 86_400_000);
  const windowStartKey = dayKey(windowStart);

  // Build the per-day date index (oldest → today), zero-filled.
  const dayKeys: string[] = [];
  for (let i = ME_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    dayKeys.push(dayKey(d));
  }
  const idxOf = new Map(dayKeys.map((k, i) => [k, i]));

  // Run independent queries in parallel.
  const [
    focusRows,
    reviewRows,
    habitLogRows,
    habits,
    studyRows,
    taskRows,
    courses,
    focusCount,
    focusSum,
    reviewCount,
    habitLogCount,
    tasksDoneCount,
    studyCount,
    assignmentCount,
    cardCount,
    cardsForMaturity,
    gamificationRow,
  ] = await Promise.all([
    // 90-day series
    prisma.focusSession.findMany({ where: { userId, date: { gte: windowStartKey } }, select: { date: true, durationMinutes: true } }),
    prisma.flashcardReview.findMany({ where: { userId, date: { gte: windowStartKey } }, select: { date: true, quality: true } }),
    prisma.habitLog.findMany({ where: { userId, date: { gte: windowStartKey } }, select: { habitId: true, date: true } }),
    prisma.habit.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.studySession.findMany({ where: { userId, createdAt: { gte: windowStart } }, select: { type: true, createdAt: true } }),
    prisma.task.findMany({ where: { userId, status: "DONE", updatedAt: { gte: windowStart } }, select: { updatedAt: true } }),
    prisma.course.findMany({ where: { userId }, include: { assignments: true } }),
    // All-time totals (for XP + achievements)
    prisma.focusSession.count({ where: { userId } }),
    prisma.focusSession.aggregate({ where: { userId }, _sum: { durationMinutes: true } }),
    prisma.flashcardReview.count({ where: { userId } }),
    prisma.habitLog.count({ where: { userId } }),
    prisma.task.count({ where: { userId, status: "DONE" } }),
    prisma.studySession.count({ where: { userId } }),
    prisma.assignment.count({ where: { course: { userId } } }),
    prisma.flashcard.count({ where: { deck: { userId } } }),
    prisma.flashcard.findMany({ where: { deck: { userId } }, select: { repetitions: true, easeFactor: true } }),
    prisma.gamificationState.findUnique({ where: { userId } }),
  ]);

  // --- Focus: per-day minutes + sessions ---
  const focusMinutesPerDay = new Array(ME_WINDOW_DAYS).fill(0);
  const focusSessionsPerDay = new Array(ME_WINDOW_DAYS).fill(0);
  for (const r of focusRows) {
    const i = idxOf.get(r.date);
    if (i === undefined) continue;
    focusMinutesPerDay[i] += r.durationMinutes;
    focusSessionsPerDay[i] += 1;
  }

  // --- Flashcard reviews: per-day count + retention (quality>=3 rate) ---
  const reviewCountPerDay = new Array(ME_WINDOW_DAYS).fill(0);
  const reviewSuccessPerDay = new Array(ME_WINDOW_DAYS).fill(0); // successes
  for (const r of reviewRows) {
    const i = idxOf.get(r.date);
    if (i === undefined) continue;
    reviewCountPerDay[i] += 1;
    if (r.quality >= 3) reviewSuccessPerDay[i] += 1;
  }
  const reviewRetention = dayKeys.map((k, i) => ({
    day: k,
    rate: reviewCountPerDay[i] > 0 ? reviewSuccessPerDay[i] / reviewCountPerDay[i] : null,
    count: reviewCountPerDay[i],
  }));

  // --- Flashcard maturity distribution (by repetitions) ---
  const maturity = { fresh: 0, learning: 0, young: 0, mature: 0 };
  let easeSum = 0;
  for (const card of cardsForMaturity) {
    if (card.repetitions === 0) maturity.fresh += 1;
    else if (card.repetitions <= 2) maturity.learning += 1;
    else if (card.repetitions <= 5) maturity.young += 1;
    else maturity.mature += 1;
    easeSum += card.easeFactor;
  }
  const avgEase = cardsForMaturity.length > 0 ? easeSum / cardsForMaturity.length : 0;

  // --- Habit adherence: per-day fraction of habits logged ---
  const totalHabits = habits.length;
  const habitsLoggedPerDay: Set<string>[] = dayKeys.map(() => new Set());
  for (const r of habitLogRows) {
    const i = idxOf.get(r.date);
    if (i === undefined) continue;
    habitsLoggedPerDay[i].add(r.habitId);
  }
  const habitAdherence = dayKeys.map((k, i) => ({
    day: k,
    rate: totalHabits > 0 ? habitsLoggedPerDay[i].size / totalHabits : 0,
  }));

  // --- Per-habit streaks (current/longest) + last30 ---
  const todayKeyStr = dayKey(now);
  const thirtyAgoKey = dayKey(new Date(now.getTime() - 29 * 86_400_000));
  const allHabitLogs = await prisma.habitLog.findMany({
    where: { userId },
    select: { habitId: true, date: true },
    orderBy: { date: "asc" },
  });
  const logsByHabit = new Map<string, string[]>();
  for (const l of allHabitLogs) {
    let arr = logsByHabit.get(l.habitId);
    if (!arr) { arr = []; logsByHabit.set(l.habitId, arr); }
    arr.push(l.date);
  }
  let maxStreak = 0;
  const habitStats = habits.map((h) => {
    const dates = logsByHabit.get(h.id) ?? [];
    const dateSet = new Set(dates);
    // current streak (ending today or yesterday)
    let currentStreak = 0;
    const cursor = new Date(todayKeyStr);
    if (!dateSet.has(todayKeyStr)) cursor.setDate(cursor.getDate() - 1);
    while (dateSet.has(cursor.toISOString().slice(0, 10))) {
      currentStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    // longest streak
    let longest = 0, run = 0;
    let prev: Date | null = null;
    for (const d of dates) {
      const dt = new Date(d);
      if (prev) {
        const diff = Math.round((dt.getTime() - prev.getTime()) / 86_400_000);
        run = diff === 1 ? run + 1 : 1;
      } else {
        run = 1;
      }
      if (run > longest) longest = run;
      prev = dt;
    }
    if (longest > maxStreak) maxStreak = longest;
    const last30 = dates.filter((d) => d >= thirtyAgoKey && d <= todayKeyStr);
    return {
      habitId: h.id,
      name: h.name,
      color: h.color,
      icon: h.icon,
      currentStreak,
      longestStreak: longest,
      last30,
      totalLogs: dates.length,
    };
  });

  // --- Study sessions: per-day count + by-type totals ---
  const studyPerDay = new Array(ME_WINDOW_DAYS).fill(0);
  const studyByType: Record<string, number> = {};
  for (const s of studyRows) {
    const i = idxOf.get(dayKey(s.createdAt));
    if (i !== undefined) studyPerDay[i] += 1;
    studyByType[s.type] = (studyByType[s.type] ?? 0) + 1;
  }

  // --- Tasks completed: per-day ---
  const tasksDonePerDay = new Array(ME_WINDOW_DAYS).fill(0);
  for (const t of taskRows) {
    const i = idxOf.get(dayKey(t.updatedAt));
    if (i !== undefined) tasksDonePerDay[i] += 1;
  }

  // --- Grades: assignment trend + per-course % + GPA ---
  const gradeTrend: { date: string; pct: number; name: string; course: string }[] = [];
  for (const course of courses) {
    for (const a of course.assignments) {
      const pct = a.maxScore > 0 ? (a.score / a.maxScore) * 100 : 0;
      gradeTrend.push({ date: dayKey(a.createdAt), pct, name: a.name, course: course.name });
    }
  }
  gradeTrend.sort((a, b) => (a.date < b.date ? -1 : 1));

  // --- XP: per-day series (window) + total (all-time) ---
  const xpPerDay = new Array(ME_WINDOW_DAYS).fill(0);
  for (let i = 0; i < ME_WINDOW_DAYS; i++) {
    xpPerDay[i] +=
      focusMinutesPerDay[i] * 1 +
      reviewCountPerDay[i] * 2 +
      habitsLoggedPerDay[i].size * 5 +
      tasksDonePerDay[i] * 10 +
      studyPerDay[i] * 15;
  }
  const totalXp =
    (focusSum._sum.durationMinutes ?? 0) * 1 +
    reviewCount * 2 +
    habitLogCount * 5 +
    tasksDoneCount * 10 +
    studyCount * 15;
  const level = levelFromXp(totalXp);
  const bounds = levelXpBounds(level);
  const levelProgress = bounds.end > bounds.start ? (totalXp - bounds.start) / (bounds.end - bounds.start) : 0;

  // --- Achievements ---
  const metrics: AchievementMetrics = {
    focusSessions: focusCount,
    focusMinutes: focusSum._sum.durationMinutes ?? 0,
    reviews: reviewCount,
    habitLogs: habitLogCount,
    maxStreak,
    tasksDone: tasksDoneCount,
    studySessions: studyCount,
    assignments: assignmentCount,
    level,
  };
  const unlockedSet = new Set(ACHIEVEMENTS.filter((a) => a.check(metrics)).map((a) => a.id));
  const storedSet = new Set<string>(
    gamificationRow ? (JSON.parse(gamificationRow.unlockedAchievements || "[]") as string[]) : []
  );
  const newlyUnlocked = Array.from(unlockedSet).filter((id) => !storedSet.has(id));
  if (newlyUnlocked.length > 0) {
    await prisma.gamificationState.upsert({
      where: { userId },
      create: { userId, unlockedAchievements: JSON.stringify(Array.from(unlockedSet)) },
      update: { unlockedAchievements: JSON.stringify(Array.from(unlockedSet)) },
    });
  }
  const achievements = ACHIEVEMENTS.map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    icon: a.icon,
    tier: a.tier,
    unlocked: unlockedSet.has(a.id),
    isNew: newlyUnlocked.includes(a.id),
  }));

  return c.json({
    windowDays: ME_WINDOW_DAYS,
    days: dayKeys,
    focus: {
      perDay: dayKeys.map((k, i) => ({ day: k, minutes: focusMinutesPerDay[i], sessions: focusSessionsPerDay[i] })),
      totalSessions: focusCount,
      totalMinutes: focusSum._sum.durationMinutes ?? 0,
    },
    flashcards: {
      reviewRetention,
      totalReviews: reviewCount,
      totalCards: cardCount,
      maturity,
      avgEase,
    },
    grades: {
      trend: gradeTrend,
      courseCount: courses.length,
      assignmentCount: assignmentCount,
    },
    habits: {
      adherence: habitAdherence,
      totalHabits,
      perHabit: habitStats,
      maxStreak,
    },
    study: {
      perDay: dayKeys.map((k, i) => ({ day: k, count: studyPerDay[i] })),
      byType: studyByType,
      total: studyCount,
    },
    tasks: {
      perDay: dayKeys.map((k, i) => ({ day: k, count: tasksDonePerDay[i] })),
      totalDone: tasksDoneCount,
    },
    xp: {
      total: totalXp,
      level,
      levelProgress,
      nextLevelXp: bounds.end,
      perDay: dayKeys.map((k, i) => ({ day: k, xp: xpPerDay[i] })),
    },
    achievements,
    newlyUnlocked,
  });
});

export default analytics;
