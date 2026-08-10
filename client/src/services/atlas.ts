// ===== Atlas API client (Pro-tier global knowledge graph) =====
// Fetches + builds the user's global knowledge map — a stitched graph of all
// their Study Hub concept graphs + notes + flashcards + tasks + courses,
// with mastery/weak-spot signals. Build is fire-and-forget + polling (same
// pattern as the Study Hub graph API).

import { api } from "./api";

export interface AtlasLinkedItems {
  notes: { id: string; title: string }[];
  flashcardDecks: { id: string; name: string }[];
  tasks: { id: string; title: string; status: string; dueDate: string | null }[];
  courses: { id: string; name: string; code: string }[];
}

export interface AtlasConcept {
  id: string;
  label: string;
  type: string;
  definition: string;
  importance: number;
  sourceGraphIds: string[];
  items: AtlasLinkedItems;
  mastery: number; // 0..1; -1 = no data
  gradePct: number | null; // 0..100; null = no data
  weak: boolean;
}

export interface AtlasLink {
  from: string;
  to: string;
  relation: string;
  sourceGraphId: string;
}

export interface AtlasCluster {
  id: string;
  label: string;
  kind: "studyGraph" | "course";
  conceptIds: string[];
  color?: string;
}

export interface AtlasStats {
  conceptCount: number;
  linkCount: number;
  clusterCount: number;
  weakCount: number;
  sourceGraphCount: number;
  linkedNoteCount: number;
  linkedFlashcardDeckCount: number;
  linkedTaskCount: number;
  linkedCourseCount: number;
}

export interface AtlasData {
  concepts: AtlasConcept[];
  links: AtlasLink[];
  clusters: AtlasCluster[];
  stats: AtlasStats;
  builtAt: string;
}

export type AtlasStatus = "building" | "ready" | "error" | "empty";

export interface AtlasState {
  id?: string;
  status: AtlasStatus;
  error?: string;
  data: AtlasData | null;
  updatedAt?: string;
  stale?: boolean;
}

export interface AtlasConceptDetail extends AtlasConcept {
  relatedConcepts: { id: string; label: string; relation: string }[];
}

export const atlasApi = {
  get: () => api.get<AtlasState>("/api/atlas"),

  build: () => api.post<{ id: string; status: string; data: AtlasData | null }>("/api/atlas/build"),

  getConcept: (id: string) => api.get<AtlasConceptDetail>(`/api/atlas/concept/${id}`),

  getWeak: () => api.get<{ concepts: AtlasConcept[] }>("/api/atlas/weak"),
};
