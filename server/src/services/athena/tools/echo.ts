// ===== Athena tools: Echo (Pro-tier live lecture companion) =====
// Lets Athena check if a live lecture session is active, see the current
// transcript + matched concepts, list past sessions, and open the Echo app.

import type { ToolDef } from "./plugin";
import { getActiveSession, listSessions, getSession } from "../../echo";

export const echoTools: ToolDef[] = [
  {
    name: "echo_active_session",
    description:
      "Check if the user has an active Echo live lecture session. Returns the current transcript length (word count + segment count), matched concepts (from their Atlas), and duration — or null if no session is active. Use this when the user asks about a lecture they're currently in or mentions Echo.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const session = await getActiveSession(userId);
      if (!session) {
        return { active: false, session: null };
      }
      const wordCount = session.transcript.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
      return {
        active: true,
        session: {
          id: session.id,
          title: session.title,
          language: session.language,
          durationSec: session.durationSec,
          wordCount,
          segmentCount: session.transcript.length,
          conceptCount: session.concepts.length,
          weakConceptsMentioned: session.concepts.filter((c) => c.weak).map((c) => c.label),
          topConcepts: session.concepts.slice(0, 10).map((c) => ({
            label: c.label,
            mastery: c.mastery,
            weak: c.weak,
            mentionCount: c.mentionCount,
          })),
        },
      };
    },
  },
  {
    name: "echo_session_history",
    description:
      "List the user's past Echo lecture sessions (completed). Returns each session with id, title, date, duration, word count, and concept/new-term counts. Use this when the user asks about past lectures they've captured with Echo.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const sessions = await listSessions(userId);
      if (sessions.length === 0) {
        return { count: 0, sessions: [], note: "No past Echo sessions found." };
      }
      return {
        count: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          startedAt: s.startedAt,
          durationSec: s.durationSec,
          wordCount: (s.meta.wordCount as number) ?? 0,
          conceptCount: s.concepts.length,
          newTermCount: s.newTerms.length,
          noteId: s.noteId,
        })),
      };
    },
  },
  {
    name: "echo_session_detail",
    description:
      "Get the full detail of a past Echo session by id (from echo_session_history): the complete transcript, matched concepts with mastery + mention counts, and new terms with suggested flashcards. Use this when the user asks about a specific past lecture.",
    proOnly: true,
    parameters: [
      { name: "sessionId", type: "string", description: "The session id from echo_session_history", required: true },
    ],
    handler: async (args, { userId }) => {
      const sessionId = String(args.sessionId ?? "").trim();
      if (!sessionId) return { error: "sessionId is required" };
      const session = await getSession(userId, sessionId);
      if (!session) return { error: "Session not found" };
      return {
        id: session.id,
        title: session.title,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSec: session.durationSec,
        transcript: session.transcript,
        concepts: session.concepts.map((c) => ({
          label: c.label,
          type: c.type,
          mastery: c.mastery,
          weak: c.weak,
          mentionCount: c.mentionCount,
          firstMentionedSec: c.firstMentionedSec,
        })),
        newTerms: session.newTerms,
        noteId: session.noteId,
      };
    },
  },
  {
    name: "open_echo",
    description:
      "Open the Echo app on the user's desktop (the live lecture companion). Use when the user wants to start a live lecture session or view past sessions.",
    clientAction: true,
    proOnly: true,
    parameters: [],
    handler: async () => ({ action: "open_echo" }),
  },
];
