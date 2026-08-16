// ===== AI Study Hub API client =====

import { api } from "./api";

export type SourceKind = "note" | "file" | "paste" | "url";

export type StudyLanguage = "en" | "cs";

export interface SourceDescriptor {
  kind: SourceKind;
  id?: string;
  text?: string;
  url?: string;
  name?: string;
}

export interface GeneratedCard {
  front: string;
  back: string;
}

export interface FlashcardsResult {
  deckId: string | null;
  deckName: string;
  cards: GeneratedCard[];
  sessionId: string;
  truncated: boolean;
}

export interface SummarizeResult {
  summary: string;
  noteId: string | null;
  sessionId: string;
  truncated: boolean;
}

export interface ExplainResult {
  explanation: string;
  noteId: string | null;
  sessionId: string;
  truncated: boolean;
}

export interface StudyGuideResult {
  guide: string;
  noteId: string | null;
  sessionId: string;
}

export type NoteStyle = "cornell" | "outline" | "summary" | "bullets";
export type NoteDetail = "brief" | "standard" | "detailed";

export interface NotesFromSourceResult {
  noteId: string;
  title: string;
  content: string;
  sessionId: string;
  truncated: boolean;
}

export interface SyllabusTask {
  title: string;
  dueDate: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
}

export interface SyllabusResult {
  tasks: SyllabusTask[];
  created: number;
  sessionId: string;
  truncated: boolean;
}

export interface QuizQuestion {
  id: number;
  type: "mcq" | "short";
  prompt: string;
  options?: string[];
}

export interface QuizStartResult {
  quizId: string;
  sourceName: string;
  truncated: boolean;
  questions: QuizQuestion[];
}

export interface QuizGradeResult {
  correct: boolean;
  explanation: string;
  modelAnswer: string;
  fallback?: boolean;
}

export interface StudySession {
  id: string;
  type: string;
  title: string;
  sourceRef: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export const studyApi = {
  flashcards: (data: {
    source?: SourceDescriptor;
    sources?: SourceDescriptor[];
    graphId?: string;
    deckName?: string;
    deckColor?: string;
    count?: number;
    mode?: "concept" | "factual" | "mixed" | "cloze";
    create?: boolean;
    language?: StudyLanguage;
  }) => api.post<FlashcardsResult>("/api/study/flashcards", data),

  summarize: (data: {
    source?: SourceDescriptor;
    sources?: SourceDescriptor[];
    graphId?: string;
    mode?: "tldr" | "outline" | "keypoints";
    saveAsNote?: boolean;
    noteTitle?: string;
    language?: StudyLanguage;
  }) => api.post<SummarizeResult>("/api/study/summarize", data),

  explain: (data: {
    source?: SourceDescriptor;
    sources?: SourceDescriptor[];
    graphId?: string;
    depth?: "eli5" | "standard" | "expert";
    saveAsNote?: boolean;
    noteTitle?: string;
    language?: StudyLanguage;
  }) => api.post<ExplainResult>("/api/study/explain", data),

  studyGuide: (data: {
    noteIds?: string[];
    sources?: SourceDescriptor[];
    graphId?: string;
    saveAsNote?: boolean;
    noteTitle?: string;
    language?: StudyLanguage;
  }) => api.post<StudyGuideResult>("/api/study/study-guide", data),

  notesFromSource: (data: {
    source: SourceDescriptor;
    style?: NoteStyle;
    detail?: NoteDetail;
    customStructure?: string;
    title?: string;
    tags?: string;
    folderId?: string | null;
    language?: StudyLanguage;
  }) => api.post<NotesFromSourceResult>("/api/study/notes-from-source", data),

  syllabusTasks: (data: { source?: SourceDescriptor; sources?: SourceDescriptor[]; create?: boolean; language?: StudyLanguage }) =>
    api.post<SyllabusResult>("/api/study/syllabus-tasks", data),

  quizStart: (data: {
    source?: SourceDescriptor;
    sources?: SourceDescriptor[];
    graphId?: string;
    questionCount?: number;
    types?: ("mcq" | "short")[];
    language?: StudyLanguage;
  }) => api.post<QuizStartResult>("/api/study/quiz/start", data),

  quizGet: (quizId: string) =>
    api.get<QuizStartResult>(`/api/study/quiz/${quizId}`),

  quizAnswer: (quizId: string, data: { questionId: number; answer: string; language?: StudyLanguage }) =>
    api.post<QuizGradeResult>(`/api/study/quiz/${quizId}/answer`, data),

  quizFinish: (
    quizId: string,
    data: { score: number; correct: number; total: number; saveAsNote?: boolean }
  ) => api.post<{ sessionId: string; noteId: string | null }>(`/api/study/quiz/${quizId}/finish`, data),

  sessions: () => api.get<{ sessions: StudySession[] }>("/api/study/sessions"),
};
