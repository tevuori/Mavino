// ===== Compass API client (Pro-tier research & literature review assistant) =====
// CRUD for research projects + papers; LLM extraction (fire-and-forget +
// polling); related-work search; reading-gap analysis; literature review
// draft generation (fire-and-forget + polling, same pattern as Atlas).

import { api } from "./api";

// ----- types -----

export interface CompassProjectSummary {
  id: string;
  title: string;
  researchQuestion: string;
  notes: string;
  paperCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaperConcept {
  label: string;
  type: string;
  definition: string;
}

export interface CompassPaper {
  id: string;
  projectId: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  sourceType: "file" | "url" | "manual";
  fileId: string | null;
  abstract: string;
  fullText: string;
  status: "to_read" | "reading" | "read";
  annotations: string;
  keyConcepts: PaperConcept[];
  extracted: boolean;
  extractStatus: "idle" | "extracting" | "done" | "error";
  extractError: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompassCitation {
  id: string;
  sourcePaperId: string;
  targetPaperId: string | null;
  targetTitle: string;
  context: string;
}

export type ReviewStatus = "building" | "ready" | "error" | "empty";

export interface CompassReview {
  id: string;
  projectId: string;
  content: string;
  status: ReviewStatus;
  error: string;
  generatedAt: string | null;
  updatedAt: string;
}

export interface CompassProject {
  id: string;
  title: string;
  researchQuestion: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  papers: CompassPaper[];
  citations: CompassCitation[];
  review: CompassReview | null;
}

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  inCorpus: boolean;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  backend: string;
}

export interface ReadingGap {
  kind: "recency" | "coverage" | "citation_balance";
  description: string;
  severity: "info" | "warning";
}

export interface ReadingGaps {
  yearDistribution: { year: number; count: number }[];
  gaps: ReadingGap[];
  unreadCount: number;
  readCount: number;
  totalCount: number;
  unextractedCount: number;
}

// ----- API -----

export const compassApi = {
  // Projects
  listProjects: () => api.get<{ projects: CompassProjectSummary[] }>("/api/compass/projects"),

  createProject: (title: string, researchQuestion?: string) =>
    api.post<{ project: CompassProjectSummary }>("/api/compass/projects", { title, researchQuestion }),

  getProject: (id: string) => api.get<{ project: CompassProject }>(`/api/compass/projects/${id}`),

  updateProject: (id: string, data: { title?: string; researchQuestion?: string; notes?: string }) =>
    api.patch<{ project: CompassProjectSummary }>(`/api/compass/projects/${id}`, data),

  deleteProject: (id: string) => api.delete<{ ok: boolean }>(`/api/compass/projects/${id}`),

  // Papers
  addPaper: (projectId: string, data: {
    sourceType: "file" | "url" | "manual";
    fileId?: string;
    url?: string;
    title?: string;
    authors?: string[];
    year?: number;
    venue?: string;
    doi?: string;
  }) => api.post<{ paper: { id: string; title: string; abstract: string; fullText: string } }>(`/api/compass/projects/${projectId}/papers`, data),

  updatePaper: (projectId: string, paperId: string, data: {
    title?: string;
    authors?: string[];
    year?: number;
    venue?: string;
    doi?: string;
    url?: string;
    status?: string;
    annotations?: string;
  }) => api.patch<{ paper: CompassPaper }>(`/api/compass/projects/${projectId}/papers/${paperId}`, data),

  deletePaper: (projectId: string, paperId: string) =>
    api.delete<{ ok: boolean }>(`/api/compass/projects/${projectId}/papers/${paperId}`),

  // LLM extraction
  extractPaper: (projectId: string, paperId: string) =>
    api.post<{ id: string; extractStatus: string }>(`/api/compass/projects/${projectId}/papers/${paperId}/extract`),

  // Search
  search: (projectId: string, query: string) =>
    api.post<SearchResponse>(`/api/compass/projects/${projectId}/search`, { query }),

  // Reading gaps
  getGaps: (projectId: string) => api.get<ReadingGaps>(`/api/compass/projects/${projectId}/gaps`),

  // Review
  getReview: (projectId: string) => api.get<CompassReview | { status: "empty"; content: string; error: string }>(`/api/compass/projects/${projectId}/review`),

  generateReview: (projectId: string) =>
    api.post<{ id: string; status: string }>(`/api/compass/projects/${projectId}/review/generate`),

  updateReview: (projectId: string, content: string) =>
    api.patch<{ review: { id: string; content: string } }>(`/api/compass/projects/${projectId}/review`, { content }),
};
