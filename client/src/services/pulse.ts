// ===== Pulse API client (Pro-tier predictive forgetting-curve & mastery forecast) =====
// Fetches + builds the user's predictive mastery forecast — per-card
// forgetting curves fit from flashcard review history, projected forward
// to each Crunch exam date. Build is fire-and-forget + polling (same
// pattern as Atlas/Crunch). The forecast is deterministic (no LLM), so
// no AI provider configuration is required.

import { api } from "./api";

export interface PulseCard {
  cardId: string;
  deckId: string;
  deckName: string;
  front: string;
  halfLife: number;
  decay: number;
  lastReviewed: string | null;
  reviewCount: number;
  currentRetention: number;
  predictedRetention: number;
  daysUntilForgotten: number;
}

export interface PulseConcept {
  id: string;
  label: string;
  predictedMastery: number;
  currentMastery: number;
  daysUntilForgotten: number;
  atRisk: boolean;
  deckIds: string[];
  cardCount: number;
}

export interface PulseExam {
  id: string;
  name: string;
  date: string;
  color: string;
  daysUntil: number;
  readiness: number;
  atRiskCount: number;
  conceptCount: number;
}

export interface PulseForecastPoint {
  day: number;
  date: string;
  mastery: number;
  isExam: boolean;
  examName?: string;
}

export interface PulseStats {
  cardCount: number;
  conceptCount: number;
  examCount: number;
  atRiskCount: number;
  nearestReadiness: number;
  nearestExamName: string | null;
  nearestExamDays: number | null;
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

export type PulseStatus = "building" | "ready" | "error" | "empty";

export interface PulseState {
  id?: string;
  status: PulseStatus;
  error?: string;
  data: PulseData | null;
  updatedAt?: string;
  lastAlertAt?: string | null;
  stale?: boolean;
}

export const pulseApi = {
  get: () => api.get<PulseState>("/api/pulse"),

  build: () => api.post<{ id: string; status: string; data: PulseData | null }>("/api/pulse/build", {}),

  atRisk: () => api.get<{ concepts: PulseConcept[] }>("/api/pulse/at-risk"),

  delete: () => api.delete<{ ok: boolean }>("/api/pulse"),
};
