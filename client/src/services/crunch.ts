// ===== Crunch API client (Pro-tier AI exam planner) =====
// Fetches + generates the user's adaptive exam-prep plan — a day-by-day
// spaced-repetition schedule built from exam dates + syllabi, mastery from
// flashcard reviews + grades, with behind-alerts. Generation is
// fire-and-forget + polling (same pattern as Atlas).

import { api } from "./api";

export interface CrunchExamInput {
  id?: string;
  name: string;
  date: string; // YYYY-MM-DD
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

export type CrunchStatus = "building" | "ready" | "error" | "empty";

export interface CrunchState {
  id?: string;
  status: CrunchStatus;
  error?: string;
  data: CrunchPlanData | null;
  updatedAt?: string;
  lastAlertAt?: string | null;
}

export const crunchApi = {
  get: () => api.get<CrunchState>("/api/crunch"),

  generate: (exams: CrunchExamInput[], dailyMinutes?: number) =>
    api.post<{ id: string; status: string; data: CrunchPlanData | null }>("/api/crunch/generate", { exams, dailyMinutes }),

  logProgress: (taskId: string, done: boolean, duration?: number) =>
    api.post<{ data: CrunchPlanData }>("/api/crunch/progress", { taskId, done, duration }),

  completeDay: (date: string) =>
    api.post<{ data: CrunchPlanData }>("/api/crunch/day-complete", { date }),

  delete: () => api.delete<{ ok: boolean }>("/api/crunch"),
};
