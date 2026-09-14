import { api, apiUrl, getToken } from "./api";

export type PodcastEngine = "standard" | "neural" | "generative" | "long-form";
export interface PollyVoice { id: string; name: string; gender: string; languageCode: string; supportedEngines: PodcastEngine[] }
export interface Podcast {
  id: string; title: string; scriptNoteId: string | null; sourceIds: string[];
  host1Label: string; host2Label: string; language: "en" | "cs";
  format: string; length: "short" | "medium" | "long"; tone: string;
  voice1: string; voice2: string; engine: PodcastEngine;
  status: "queued" | "processing" | "ready" | "failed" | "script_ready";
  stage: string; error: string; hasAudio: boolean; audioSize: number | null;
  durationEstimate: number; createdAt: string; updatedAt: string; script?: string;
}

export const studyPodcastsApi = {
  generate: (data: {
    sourceIds: string[]; title?: string; host1Label?: string; host2Label?: string;
    language?: "en" | "cs"; length: "short" | "medium" | "long";
    tone: "engaging" | "academic" | "relaxed" | "debate"; focus?: string;
    engine: PodcastEngine; voice1: string; voice2: string;
  }) => api.post<{ podcast: Podcast; noteId: string }>("/api/study/podcasts/generate", data),
  getConfig: () => api.get<{ configured: boolean; source: string; region: string }>("/api/study/podcasts/config"),
  getVoices: (language: "en" | "cs") => api.get<{ voices: PollyVoice[] }>(`/api/study/podcasts/voices?language=${language}`),
  list: () => api.get<{ podcasts: Podcast[] }>("/api/study/podcasts"),
  get: (id: string) => api.get<{ podcast: Podcast }>(`/api/study/podcasts/${id}`),
  regenerateAudio: (id: string) => api.post<{ ok: boolean }>(`/api/study/podcasts/${id}/regenerate-audio`, {}),
  remove: (id: string) => api.delete<{ ok: boolean }>(`/api/study/podcasts/${id}`),
  async getAudio(id: string): Promise<string> {
    const token = getToken();
    const response = await fetch(apiUrl(`/api/study/podcasts/${id}/audio`), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error("Podcast audio is unavailable");
    return URL.createObjectURL(await response.blob());
  },
};
