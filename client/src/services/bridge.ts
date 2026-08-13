// ===== Concept Bridge API client (Pro-tier interdisciplinary connections) =====

import { api } from "./api";

export interface ConceptBridge {
  id: string;
  conceptAId: string;
  conceptALabel: string;
  conceptBId: string;
  conceptBLabel: string;
  relation: string;
  explanation: string;
  sourceA: string;
  sourceB: string;
  seen: boolean;
  createdAt: string;
}

export interface BridgeStats {
  totalBridges: number;
  unseenBridges: number;
  byRelation: Record<string, number>;
}

export const bridgeApi = {
  list: (onlyUnseen = false) =>
    api.get<{ bridges: ConceptBridge[] }>(`/api/bridge${onlyUnseen ? "?unseen=true" : ""}`),

  getStats: () => api.get<BridgeStats>("/api/bridge/stats"),

  discover: () => api.post<{ created: number; total: number }>("/api/bridge/discover"),

  get: (id: string) => api.get<{ bridge: ConceptBridge }>(`/api/bridge/${id}`),

  markSeen: (id: string) => api.post<{ ok: boolean }>(`/api/bridge/${id}/seen`),

  markAllSeen: () => api.post<{ ok: boolean }>("/api/bridge/seen-all"),

  delete: (id: string) => api.delete<{ ok: boolean }>(`/api/bridge/${id}`),

  forConcept: (conceptId: string) =>
    api.get<{ bridges: ConceptBridge[] }>(`/api/bridge/concept/${conceptId}`),

  forLabel: (label: string) =>
    api.post<{ bridges: ConceptBridge[] }>("/api/bridge/label", { label }),
};
