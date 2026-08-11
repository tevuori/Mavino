// ===== Interactive Teacher client API =====
// Session CRUD + SSE streaming for the "Teach Me" mode. Mirrors the Athena
// SSE client (services/athena.ts) but hits /api/teacher/:id/stream and sends
// the session's source-history + state so the server can inject them into
// the teacher system prompt for reference resolution ("go back to the first
// file").

import { getToken, apiUrl, api } from "./api";
import type {
  AthenaToolEvent,
  AthenaClientAction,
  AthenaWindowState,
} from "./athena";

export interface TeacherSourceHistoryEntry {
  windowId: string;
  index: number;
  name: string;
  kind: string;
  refId: string;
  lastHighlight?: string;
  /** Character offsets of the last resolved highlight anchor (exact, no
   *  first-occurrence guessing) — used to re-anchor during speech playback. */
  lastPosStart?: number;
  lastPosEnd?: number;
}

export type TeachingStyle = "explain" | "socratic";
export type StudentLevel = "beginner" | "intermediate" | "advanced";
export type PaceFeedback = "too_easy" | "just_right" | "too_hard";

export interface TeacherComprehensionEntry {
  concept: string;
  passed: boolean;
  feedback?: string;
  misconception?: string;
  question?: string;
  answer?: string;
  at?: string;
}

export interface TeacherMasteryEntry {
  checksTotal: number;
  checksPassed: number;
  lastAskedAt?: string;
  misconception?: string;
}

export interface TeacherLessonPlan {
  title: string;
  objectives: string[];
  keyConcepts: string[];
  checks?: { concept: string; question: string }[];
  estimatedTurns?: number;
  suggestedSources?: number[];
}

export interface TeacherSourceIssue {
  name?: string;
  refId?: string;
  reason: string;
  at?: string;
}

export interface TeacherSessionState {
  studentLevel?: string;
  sourceHistory?: TeacherSourceHistoryEntry[];
  coveredConcepts?: string[];
  comprehensionLog?: TeacherComprehensionEntry[];
  lessonPlan?: TeacherLessonPlan;
  mastery?: Record<string, TeacherMasteryEntry>;
  teachingStyle?: TeachingStyle;
  inferredLevel?: string;
  followPlan?: boolean;
  sourceIssues?: TeacherSourceIssue[];
  paceFeedback?: string;
  lessonCompletedAt?: string;
}

export interface TeacherAssessment {
  passed: boolean;
  score: number;
  feedback: string;
  misconception?: string;
}

export interface TeacherMessage {
  role: "user" | "assistant";
  content: string;
  tools?: { id: string; name: string; state: string }[];
  timestamp?: string;
}

export interface TeacherSession {
  id: string;
  title: string;
  sourceIds: string[];
  messages?: TeacherMessage[];
  state: TeacherSessionState;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface TeacherStreamCallbacks {
  onContent?: (text: string, done: boolean) => void;
  onTool?: (ev: AthenaToolEvent) => void;
  onClientAction?: (action: AthenaClientAction) => void;
  onDataChange?: (tool: string) => void;
  onUsage?: (usage: unknown) => void;
  onError?: (message: string, status?: number) => void;
  onDone?: () => void;
}

export interface TeacherChatHandle {
  abort: () => void;
  done: Promise<void>;
}

export const teacherApi = {
  async create(input: {
    title?: string;
    sourceIds?: string[];
    studentLevel?: StudentLevel;
    teachingStyle?: TeachingStyle;
    sources?: { kind: string; id?: string; text?: string; url?: string; name?: string }[];
  }): Promise<{ session: TeacherSession }> {
    return api.post("/api/teacher", input);
  },
  async list(): Promise<{ sessions: TeacherSession[] }> {
    return api.get("/api/teacher");
  },
  async get(id: string): Promise<{ session: TeacherSession }> {
    return api.get(`/api/teacher/${id}`);
  },
  async patch(id: string, data: { title?: string; sourceIds?: string[]; state?: TeacherSessionState }): Promise<{ session: TeacherSession }> {
    return api.patch(`/api/teacher/${id}`, data);
  },
  async delete(id: string): Promise<{ ok: boolean }> {
    return api.delete(`/api/teacher/${id}`);
  },
  /** Generate (or regenerate) the lesson agenda. */
  async plan(id: string, input: { focus?: string; language?: "en" | "cs" } = {}): Promise<{
    plan: TeacherLessonPlan;
    session: TeacherSession;
  }> {
    return api.post(`/api/teacher/${id}/plan`, input);
  },
  /** Grade an answer to a comprehension check (server-side, real assessment). */
  async assess(
    id: string,
    input: { question: string; answer: string; expectedConcept?: string; language?: "en" | "cs" }
  ): Promise<{ assessment: TeacherAssessment; state: TeacherSessionState }> {
    return api.post(`/api/teacher/${id}/assess`, input);
  },
  /** Ask the model for a short topic title (after the first exchange). */
  async generateTitle(id: string): Promise<{ session: TeacherSession }> {
    return api.post(`/api/teacher/${id}/title`, {});
  },
  /** Turn the lesson into a note / flashcard deck / quiz / review tasks. */
  async export(
    id: string,
    input: { target: "note" | "flashcards" | "quiz" | "tasks"; language?: "en" | "cs"; count?: number }
  ): Promise<{
    target: string;
    noteId?: string;
    title?: string;
    deckId?: string;
    deckName?: string;
    quizId?: string;
    count?: number;
    concepts?: string[];
  }> {
    return api.post(`/api/teacher/${id}/export`, input);
  },
};

/** Stream one teacher turn. Resolves when the stream ends (done or error). */
export function streamTeacherTurn(
  sessionId: string,
  message: string,
  cb: TeacherStreamCallbacks,
  opts: {
    windows?: AthenaWindowState[];
    sourceHistory?: TeacherSourceHistoryEntry[];
    state?: TeacherSessionState;
    language?: "en" | "cs";
  } = {}
): TeacherChatHandle {
  const controller = new AbortController();
  const token = getToken();

  const done = (async () => {
    let res: Response;
    try {
      res = await fetch(apiUrl(`/api/teacher/${sessionId}/stream`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message,
          language: opts.language ?? "en",
          windows: opts.windows ?? [],
          sourceHistory: opts.sourceHistory ?? [],
          state: opts.state,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) return;
      cb.onError?.(e instanceof Error ? e.message : "Request failed");
      return;
    }

    if (!res.ok || !res.body) {
      let msg = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
      } catch { /* ignore */ }
      cb.onError?.(msg, res.status);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const dispatch = (event: string, data: string) => {
      if (!data) return;
      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      switch (event) {
        case "content": cb.onContent?.(parsed.text ?? "", Boolean(parsed.done)); break;
        case "tool": cb.onTool?.(parsed as AthenaToolEvent); break;
        case "client_action": cb.onClientAction?.(parsed as AthenaClientAction); break;
        case "data_change": cb.onDataChange?.(parsed.tool ?? ""); break;
        case "usage": cb.onUsage?.(parsed.usage); break;
        case "error": cb.onError?.(parsed.error ?? "Teacher error", parsed.status); break;
        case "done": cb.onDone?.(); break;
      }
    };

    try {
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = "message";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
          }
          dispatch(event, dataLines.join("\n"));
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        cb.onError?.(e instanceof Error ? e.message : "Stream interrupted");
      }
    }
  })();

  return { abort: () => controller.abort(), done };
}
