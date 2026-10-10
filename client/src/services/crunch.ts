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
  /** StudySource ids: study materials for this exam. */
  sourceIds?: string[];
  /** StudySource ids: past exams from previous years. */
  pastExamSourceIds?: string[];
  /** StudySource id whose text is appended to the syllabus before parsing. */
  syllabusSourceId?: string;
  workspaceId?: string;
  /** Preserved across regenerations (set when editing an existing exam). */
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
  mockSessionId?: string;
}

export interface ChapterProgress {
  status: "not_started" | "in_progress" | "completed";
  covered: number;
  total: number;
  /** 0..1 average pass rate; -1 = nothing checked. */
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
  teachSessionId?: string;
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

  /** Get or create the Teach Me session for a plan chapter. */
  teach: (topicId: string, language?: "en" | "cs") =>
    api.post<{ sessionId: string; created: boolean; title: string }>("/api/crunch/teach", { topicId, language }),

  /** Get or create the exam's mock-exam session (examiner mode). */
  mock: (examId: string) =>
    api.post<{ sessionId: string; created: boolean; title: string }>("/api/crunch/mock", { examId }),
};
