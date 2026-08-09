// ===== Study Hub: Knowledge Graph API client =====
// Persisted ConceptGraph entities — concepts (with definitions/facts) and
// typed relationships, all cited to source material. Built once per
// source-set and reused by Flashcards, Quiz, Summarize, Explain, and Study
// Guide instead of re-analyzing raw source text every time.

import { api } from "./api";
import type { SourceDescriptor, StudyLanguage } from "./study";

export interface GraphSourceRef {
  index: number;
  studySourceId: string;
  name: string;
  kind: string;
  refId: string;
}

export interface ConceptFact {
  text: string;
  sourceIndexes: number[];
}

export interface ConceptNode {
  id: string;
  label: string;
  type: string;
  definition: string;
  importance: number;
  facts: ConceptFact[];
  sourceIndexes: number[];
}

export interface ConceptEdge {
  from: string;
  to: string;
  relation: string;
  sourceIndexes: number[];
}

export interface ConceptGraphData {
  summary: string;
  sources: GraphSourceRef[];
  concepts: ConceptNode[];
  relationships: ConceptEdge[];
}

export interface ConceptGraphSummary {
  id: string;
  name: string;
  sourceCount: number;
  conceptCount: number;
  relationshipCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptGraphResult {
  graphId: string;
  name: string;
  data: ConceptGraphData;
  cached: boolean;
}

export const studyGraphApi = {
  build: (data: {
    source?: SourceDescriptor;
    sources?: SourceDescriptor[];
    forceRefresh?: boolean;
    language?: StudyLanguage;
  }) => api.post<ConceptGraphResult>("/api/study/graph", data),

  list: () => api.get<{ graphs: ConceptGraphSummary[] }>("/api/study/graph"),

  get: (id: string) =>
    api.get<{ graphId: string; name: string; data: ConceptGraphData; updatedAt: string }>(`/api/study/graph/${id}`),

  refresh: (id: string, language?: StudyLanguage) =>
    api.post<ConceptGraphResult>(`/api/study/graph/${id}/refresh`, { language }),

  remove: (id: string) => api.delete<{ ok: boolean }>(`/api/study/graph/${id}`),
};
