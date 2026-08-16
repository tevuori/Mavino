// ===== Forge API client (Pro-tier AI practice problem generator) =====
// CRUD for problem sets; LLM generation; LLM grading; variant generation;
// attempt history; stats.

import { api } from "./api";

// ----- types -----

export interface ForgeSource {
  kind: "note" | "file" | "atlas" | "text";
  refId?: string;
  name: string;
  text?: string;
}

export interface ForgeProblemOption {
  id: string;
  text: string;
}

export interface ForgeProblem {
  id: string;
  setId: string;
  type: "mcq" | "short_answer" | "step_by_step";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  options: ForgeProblemOption[];
  answer: string;
  solution: string;
  conceptIds: string[];
  hint: string;
  createdAt: string;
}

export interface ForgeProblemSetSummary {
  id: string;
  title: string;
  format: string;
  difficulty: string;
  count: number;
  source: ForgeSource;
  conceptIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ForgeProblemSet extends ForgeProblemSetSummary {
  problems: ForgeProblem[];
}

export interface ForgeFeedback {
  summary: string;
  steps?: { step: string; correct: boolean; explanation: string }[];
  misconception?: string;
  suggestion?: string;
}

export interface ForgeAttempt {
  id: string;
  problemId: string;
  setId: string;
  submitted: string;
  result: "correct" | "partial" | "incorrect";
  score: number;
  feedback: ForgeFeedback;
  variantGenerated: boolean;
  createdAt: string;
}

export interface ForgeStats {
  totalSets: number;
  totalProblems: number;
  totalAttempts: number;
  avgScore: number;
  conceptsTargeted: number;
}

// ----- API -----

export const forgeApi = {
  listSets: () => api.get<{ sets: ForgeProblemSetSummary[] }>("/api/forge/sets"),

  generateSet: (data: {
    title?: string;
    source: ForgeSource;
    format?: "mcq" | "short_answer" | "step_by_step" | "mixed";
    difficulty?: "easy" | "medium" | "hard" | "adaptive";
    count?: number;
    conceptIds?: string[];
  }) => api.post<{ id: string; title: string; count: number }>("/api/forge/sets/generate", data),

  getSet: (id: string) => api.get<{ set: ForgeProblemSet }>(`/api/forge/sets/${id}`),

  deleteSet: (id: string) => api.delete<{ ok: boolean }>(`/api/forge/sets/${id}`),

  grade: (problemId: string, submitted: string) =>
    api.post<{ attempt: ForgeAttempt }>("/api/forge/grade", { problemId, submitted }),

  generateVariant: (problemId: string) =>
    api.post<{ id: string; setId: string }>("/api/forge/variant", { problemId }),

  listAttempts: (setId?: string) =>
    api.get<{ attempts: ForgeAttempt[] }>(`/api/forge/attempts${setId ? `?setId=${setId}` : ""}`),

  getStats: () => api.get<ForgeStats>("/api/forge/stats"),
};
