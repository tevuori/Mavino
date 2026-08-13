// ===== Scribe API client (Pro-tier thesis/essay writing coach) =====

import { api } from "./api";

export interface ScribeIssue {
  severity: "info" | "warning" | "critical";
  section: string;
  issue: string;
  suggestion: string;
}

export interface ScribeDocumentSummary {
  id: string;
  title: string;
  docType: string;
  thesisStatement: string;
  compassProjectId: string;
  contentLength: number;
  feedbackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScribeFeedback {
  id: string;
  documentId: string;
  feedbackType: string;
  content: string;
  issues: ScribeIssue[];
  status: "building" | "ready" | "error";
  error: string;
  score: number;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScribeDocument extends ScribeDocumentSummary {
  content: string;
  feedbacks: ScribeFeedback[];
}

export const scribeApi = {
  listDocuments: () => api.get<{ documents: ScribeDocumentSummary[] }>("/api/scribe/documents"),

  createDocument: (data: {
    title: string;
    content?: string;
    docType?: string;
    thesisStatement?: string;
    compassProjectId?: string;
  }) => api.post<{ document: { id: string; title: string } }>("/api/scribe/documents", data),

  getDocument: (id: string) => api.get<{ document: ScribeDocument }>(`/api/scribe/documents/${id}`),

  updateDocument: (id: string, data: {
    title?: string;
    content?: string;
    docType?: string;
    thesisStatement?: string;
    compassProjectId?: string;
  }) => api.patch<{ ok: boolean }>(`/api/scribe/documents/${id}`, data),

  deleteDocument: (id: string) => api.delete<{ ok: boolean }>(`/api/scribe/documents/${id}`),

  generateFeedback: (docId: string, feedbackType?: "outline" | "draft" | "citations" | "full") =>
    api.post<{ id: string; status: string }>(`/api/scribe/documents/${docId}/feedback`, { feedbackType }),

  getFeedback: (feedbackId: string) => api.get<{ feedback: ScribeFeedback }>(`/api/scribe/feedback/${feedbackId}`),

  deleteFeedback: (feedbackId: string) => api.delete<{ ok: boolean }>(`/api/scribe/feedback/${feedbackId}`),
};
