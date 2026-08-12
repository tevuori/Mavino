// ===== Echo API client (Pro-tier live lecture companion) =====
// Starts a live lecture session, uploads audio chunks for real-time
// transcription + concept matching, stops + finalizes (generates note +
// new terms), and lists past sessions.

import { api } from "./api";

export interface EchoTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface EchoConceptMatch {
  id: string;
  label: string;
  type: string;
  definition: string;
  mastery: number; // 0..1; -1 = no data
  weak: boolean;
  firstMentionedSec: number;
  mentionCount: number;
}

export interface EchoNewTerm {
  term: string;
  context: string;
  suggestedFront: string;
  suggestedBack: string;
}

export interface EchoSessionStatus {
  id: string;
  title: string;
  status: "active" | "completed" | "failed";
  language: string;
  transcript: EchoTranscriptSegment[];
  concepts: EchoConceptMatch[];
  newTerms: EchoNewTerm[];
  noteId: string | null;
  durationSec: number;
  meta: Record<string, unknown>;
  error: string;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const echoApi = {
  /** Start a new live session (or reuse the active one). */
  start: (opts: { title?: string; language?: string }) =>
    api.post<EchoSessionStatus>("/api/echo/sessions", opts),

  /** Get the active session (or null). */
  getActive: () =>
    api.get<{ session: EchoSessionStatus | null }>("/api/echo/sessions/active"),

  /** Get a specific session by id. */
  get: (id: string) =>
    api.get<EchoSessionStatus>(`/api/echo/sessions/${id}`),

  /** List past (completed) sessions. */
  list: () =>
    api.get<{ sessions: EchoSessionStatus[] }>("/api/echo/sessions"),

  /** Upload an audio chunk for transcription. Uses `api.post` with a FormData
   *  body (the `api` wrapper passes FormData through unchanged and handles
   *  401 token-refresh automatically — important for long lectures where the
   *  15-minute access JWT can expire mid-session). The chunk offset (seconds
   *  from session start) + duration (seconds of audio in this chunk) are sent
   *  as form fields so the server can place the segment correctly in the
   *  timeline. */
  uploadChunk: async (
    sessionId: string,
    audio: Blob,
    mimeType: string,
    offsetSec: number,
    durationSec: number
  ) => {
    const formData = new FormData();
    formData.append("audio", audio, `chunk.${mimeType.includes("webm") ? "webm" : "ogg"}`);
    formData.append("offsetSec", String(offsetSec));
    formData.append("durationSec", String(durationSec));
    return api.post<EchoSessionStatus>(`/api/echo/sessions/${sessionId}/chunk`, formData);
  },

  /** Stop the session and finalize (generate note + new terms via LLM). */
  stop: (id: string) =>
    api.post<EchoSessionStatus>(`/api/echo/sessions/${id}/stop`),

  /** Delete a session. */
  delete: (id: string) =>
    api.delete<{ ok: boolean }>(`/api/echo/sessions/${id}`),
};
