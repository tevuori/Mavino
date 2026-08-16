// ===== Study Hub: source library API client =====
// Persistent StudySource entities (note/file/pdf/paste/url with cached
// extracted text) used by grounded Q&A, podcasts, and cited study materials.

import { api } from "./api";
import type { SourceDescriptor } from "./study";

export interface StudySource {
  id: string;
  name: string;
  kind: "note" | "file" | "paste" | "url";
  refId: string;
  truncated: boolean;
  charCount: number;
  createdAt: string;
  updatedAt: string;
  /** Only present on the single-source GET. */
  textCache?: string;
}

export const studySourcesApi = {
  list: () => api.get<{ sources: StudySource[] }>("/api/study/sources"),

  create: (source: SourceDescriptor) =>
    api.post<{ source: StudySource }>("/api/study/sources", source),

  bulk: (sources: SourceDescriptor[]) =>
    api.post<{ sources: (StudySource | { error: string; kind: string; refId: string })[] }>(
      "/api/study/sources/bulk",
      { sources }
    ),

  get: (id: string) => api.get<StudySource>(`/api/study/sources/${id}`),

  remove: (id: string) => api.delete<{ ok: boolean }>(`/api/study/sources/${id}`),

  refresh: (id: string) =>
    api.post<{ source: StudySource }>(`/api/study/sources/${id}/refresh`, {}),
};
