// ===== Athena Study Hub tools =====
// Full Study Hub integration: sources, learning workspaces, grounded chat,
// podcasts, teacher mode, quiz answering, session history, and notes-from-source.
// These complement the existing studyTools (generate_flashcards, summarize_note,
// explain_note, generate_study_guide, start_quiz, create_tasks_from_text,
// open_study_hub) so Athena can access EVERY Study Hub function.

import type { ToolDef } from "./plugin";
import prisma from "../../../db/client";
import { acquireLlmModel, getUserConfig, isLlmConfiguredFor } from "../llm";
import { resolveSource, resolveAndCache, type SourceDescriptor, type SourceKind } from "../../study/source";
import { generateJson, generateText } from "../../study/llm-json";
import {
  podcastScriptPrompt,
  groundedQaSystemPrompt,
  quizGradePrompt,
  quizGradeSchemaHint,
  notetakingPrompt,
  type StudyLanguage,
  type GroundedSource,
  type NoteStyle,
  type NoteDetail,
} from "../../study/prompts";
import { getQuiz, deleteQuiz } from "../../study/quiz-store";
import { logSessionSafe } from "../../study/logSession";
import { Message } from "multi-llm-ts";
import { withStudyGate } from "./study-gate";

/** Helper: resolve an array of on-the-fly source descriptors into cached
 *  StudySource rows, returning their ids. Used by chat/podcast/teacher tools
 *  so Athena can pass sources inline without a separate create_study_source call. */
async function resolveSourceIds(
  userId: string,
  sources: any[]
): Promise<{ sourceIds: string[]; error?: string }> {
  if (!Array.isArray(sources) || sources.length === 0) {
    return { sourceIds: [] };
  }
  const ids: string[] = [];
  for (const src of sources) {
    try {
      const cached = await resolveAndCache(userId, src as SourceDescriptor);
      if (!ids.includes(cached.id)) ids.push(cached.id);
    } catch {
      // skip sources that fail to resolve
    }
  }
  return { sourceIds: ids };
}

/** Helper: load GroundedSource list (with cached text) for chat/podcast/teacher. */
async function loadSources(userId: string, sourceIds: string[]): Promise<GroundedSource[]> {
  if (sourceIds.length === 0) return [];
  const rows = await prisma.studySource.findMany({ where: { id: { in: sourceIds }, userId } });
  return sourceIds
    .map((id, i) => {
      const r = rows.find((x) => x.id === id);
      if (!r) return null;
      return {
        index: i + 1,
        name: r.name,
        kind: r.kind,
        refId: r.refId,
        text: r.textCache,
      } as GroundedSource;
    })
    .filter((x): x is GroundedSource => x !== null);
}

const rawStudyHubTools: ToolDef[] = [
  // ===== Study Sources library =====
  {
    name: "list_study_sources",
    description:
      "List the user's saved Study Sources (the source library used by Study Hub grounded chat, podcasts, teacher mode, and cited study materials). Returns id, name, kind, refId, charCount. Use to find source ids for start_study_chat, generate_podcast, start_teacher_session, etc.",
    parameters: [],
    handler: async (_args, { userId }) => {
      const rows = await prisma.studySource.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          name: true,
          kind: true,
          refId: true,
          truncated: true,
          charCount: true,
          updatedAt: true,
        },
      });
      return {
        count: rows.length,
        sources: rows.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          refId: s.refId,
          charCount: s.charCount,
          truncated: s.truncated,
        })),
      };
    },
  },
  {
    name: "create_study_source",
    description:
      "Add a source to the user's Study Source library by resolving a note, file, URL, or pasted text. The source's text is extracted and cached for use in grounded chat, podcasts, teacher mode, and cited study materials. Returns the source id.",
    destructive: true,
    parameters: [
      { name: "kind", type: "string", description: "Source kind", enum: ["note", "file", "paste", "url", "moodle"], required: true },
      { name: "id", type: "string", description: "Note id or file id (required for kind note/file)" },
      { name: "url", type: "string", description: "URL (required for kind url/moodle)" },
      { name: "text", type: "string", description: "Pasted text (required for kind paste)" },
      { name: "name", type: "string", description: "Optional display name" },
    ],
    handler: async (args, { userId }) => {
      const src: SourceDescriptor = {
        kind: String(args.kind) as SourceKind,
        id: args.id ? String(args.id) : undefined,
        url: args.url ? String(args.url) : undefined,
        text: args.text ? String(args.text) : undefined,
        name: args.name ? String(args.name) : undefined,
      };
      try {
        const cached = await resolveAndCache(userId, src);
        return { source: cached, created: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Source resolution failed" };
      }
    },
  },
  {
    name: "delete_study_source",
    description: "Delete a source from the user's Study Source library permanently.",
    destructive: true,
    parameters: [
      { name: "sourceId", type: "string", description: "Source id from list_study_sources", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.sourceId);
      const s = await prisma.studySource.findFirst({ where: { id, userId } });
      if (!s) return { error: "Source not found" };
      await prisma.studySource.delete({ where: { id } });
      return { deleted: true, sourceId: id, name: s.name };
    },
  },

  // ===== Learning Workspaces (study source groups) =====
  {
    name: "list_learning_workspaces",
    description:
      "List the user's learning workspaces — named groups of Study Sources used to start grounded chats, podcasts, or teacher sessions with a pre-selected source set. Returns id, name, description, color, sourceIds.",
    parameters: [],
    handler: async (_args, { userId }) => {
      const rows = await prisma.learningWorkspace.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      });
      return {
        count: rows.length,
        workspaces: rows.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          color: w.color,
          sourceIds: safeParseArray(w.sourceIds),
        })),
      };
    },
  },
  {
    name: "create_learning_workspace",
    description:
      "Create a learning workspace — a named group of Study Sources. Optionally include existing sourceIds and/or on-the-fly source descriptors (resolved + cached first). Use to save a source set the user reuses for grounded chats or podcasts.",
    destructive: true,
    parameters: [
      { name: "name", type: "string", description: "Workspace name", required: true },
      { name: "description", type: "string", description: "Optional description" },
      { name: "color", type: "string", description: "Optional hex color (e.g. '#ec4899')" },
      { name: "sourceIds", type: "string", description: "Comma-separated existing StudySource ids to include" },
      {
        name: "sources",
        type: "string",
        description: "JSON array of on-the-fly source descriptors to resolve + add (same format as create_study_source, but as a JSON string)",
      },
    ],
    handler: async (args, { userId }) => {
      const name = String(args.name ?? "").trim().slice(0, 200);
      if (!name) return { error: "Workspace name is required." };
      let sourceIds = (String(args.sourceIds ?? "").split(",").map((s) => s.trim()).filter(Boolean));
      if (args.sources) {
        try {
          const parsed = JSON.parse(String(args.sources));
          if (Array.isArray(parsed)) {
            const { sourceIds: resolved } = await resolveSourceIds(userId, parsed);
            sourceIds = [...sourceIds, ...resolved];
          }
        } catch {
          return { error: "sources must be a JSON array string." };
        }
      }
      const ws = await prisma.learningWorkspace.create({
        data: {
          userId,
          name,
          description: String(args.description ?? "").slice(0, 1000) || null,
          color: String(args.color ?? "").slice(0, 20) || null,
          sourceIds: JSON.stringify(sourceIds),
        },
      });
      return { workspace: { id: ws.id, name: ws.name, sourceIds }, created: true };
    },
  },
  {
    name: "delete_learning_workspace",
    description: "Delete a learning workspace permanently. The Study Sources themselves are NOT deleted — only the grouping.",
    destructive: true,
    parameters: [
      { name: "workspaceId", type: "string", description: "Workspace id from list_learning_workspaces", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.workspaceId);
      const ws = await prisma.learningWorkspace.findFirst({ where: { id, userId } });
      if (!ws) return { error: "Workspace not found" };
      await prisma.learningWorkspace.delete({ where: { id } });
      return { deleted: true, workspaceId: id, name: ws.name };
    },
  },

  // ===== Study Chat (grounded Q&A) =====
  {
    name: "start_study_chat",
    description:
      "Create a new source-grounded Study Chat (NotebookLM-style Q&A with inline [n] citations) and open it in the Study Hub. Pass existing sourceIds and/or on-the-fly sources (note/file/url/paste). Mavino's reply to the user should include the answer to the user's question — this tool creates the chat session; the user continues the conversation in the Study Hub UI. Returns chatId.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "sourceIds", type: "string", description: "Comma-separated existing StudySource ids" },
      {
        name: "sources",
        type: "string",
        description: "JSON array of on-the-fly source descriptors (e.g. [{\"kind\":\"note\",\"id\":\"abc\"}])",
      },
      { name: "title", type: "string", description: "Optional chat title" },
    ],
    handler: async (args, { userId }) => {
      let sourceIds = (String(args.sourceIds ?? "").split(",").map((s) => s.trim()).filter(Boolean));
      if (args.sources) {
        try {
          const parsed = JSON.parse(String(args.sources));
          if (Array.isArray(parsed)) {
            const { sourceIds: resolved } = await resolveSourceIds(userId, parsed);
            sourceIds = [...sourceIds, ...resolved];
          }
        } catch {
          return { error: "sources must be a JSON array string." };
        }
      }
      if (sourceIds.length === 0) return { error: "At least one source is required." };

      let title = String(args.title ?? "").trim();
      if (!title) {
        const first = await prisma.studySource.findFirst({
          where: { id: sourceIds[0], userId },
          select: { name: true },
        });
        title = first ? `Study chat: ${first.name}` : "New Study Chat";
      }

      const chat = await prisma.studyChat.create({
        data: {
          userId,
          title: title.slice(0, 200),
          sourceIds: JSON.stringify(sourceIds),
          messages: "[]",
        },
      });
      return {
        action: "open_study_hub",
        mode: "chat",
        chatId: chat.id,
        title: chat.title,
        sourceCount: sourceIds.length,
      };
    },
  },
  {
    name: "list_study_chats",
    description: "List the user's saved Study Chats (grounded Q&A conversations). Returns id, title, sourceIds, updatedAt.",
    parameters: [],
    handler: async (_args, { userId }) => {
      const rows = await prisma.studyChat.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
      return {
        count: rows.length,
        chats: rows.map((c) => ({
          id: c.id,
          title: c.title,
          sourceIds: safeParseArray(c.sourceIds),
          updatedAt: c.updatedAt.toISOString(),
        })),
      };
    },
  },
  {
    name: "ask_study_chat",
    description:
      "Send a question to an existing Study Chat and get a grounded, cited answer (inline [n] citations reference the chat's sources). The answer is persisted as a message in the chat. Use list_study_chats to find the chatId. Returns the answer text + citations.",
    destructive: true,
    parameters: [
      { name: "chatId", type: "string", description: "Chat id from list_study_chats", required: true },
      { name: "question", type: "string", description: "The question to ask", required: true },
    ],
    handler: async (args, { userId }) => {
      const chatId = String(args.chatId);
      const question = String(args.question ?? "").trim();
      if (!question) return { error: "Question is required." };
      const chat = await prisma.studyChat.findFirst({ where: { id: chatId, userId } });
      if (!chat) return { error: "Chat not found" };

      const configured = await isLlmConfiguredFor(userId);
      if (!configured) return { error: "No AI provider configured." };

      const sourceIds = safeParseArray(chat.sourceIds);
      const sources = await loadSources(userId, sourceIds);
      const messages = safeParseMessages(chat.messages);
      messages.push({ role: "user", content: question, timestamp: new Date().toISOString() });

      const { model } = await acquireLlmModel(userId);
      const sysPrompt = groundedQaSystemPrompt(sources, "en" as StudyLanguage);
      const thread: Message[] = [new Message("system", sysPrompt)];
      for (const m of messages) {
        // Strip the "## Sources" section from prior assistant turns to keep
        // the thread compact and avoid re-injecting stale citation lists.
        const content = m.role === "assistant" ? m.content.replace(/\n*##\s*Sources[\s\S]*$/i, "").trim() : m.content;
        thread.push(new Message(m.role, content));
      }

      let answer = "";
      try {
        for await (const chunk of model.generate(thread, { tools: false })) {
          if (chunk.type === "content" && chunk.text) answer += chunk.text;
        }
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Chat failed" };
      }
      if (!answer.trim()) return { error: "The AI returned an empty answer." };

      const citations = extractCitations(answer, sources);
      messages.push({ role: "assistant", content: answer, citations, timestamp: new Date().toISOString() });

      await prisma.studyChat.update({
        where: { id: chatId },
        data: {
          messages: JSON.stringify(messages),
          lastMessageAt: new Date(),
        },
      });

      await logSessionSafe(userId, "chat", chat.title, chatId, { chatId, question });

      return {
        answer,
        citations: citations.map((c) => ({ index: c.index, name: c.name, kind: c.kind })),
        chatId,
      };
    },
  },
  {
    name: "delete_study_chat",
    description: "Delete a Study Chat permanently.",
    destructive: true,
    parameters: [
      { name: "chatId", type: "string", description: "Chat id from list_study_chats", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.chatId);
      const c = await prisma.studyChat.findFirst({ where: { id, userId } });
      if (!c) return { error: "Chat not found" };
      await prisma.studyChat.delete({ where: { id } });
      return { deleted: true, chatId: id, title: c.title };
    },
  },

  // ===== Podcasts =====
  {
    name: "generate_podcast",
    description:
      "Generate a 2-host podcast dialogue script from one or more Study Sources, save the script as a Note, and open the podcast in the Study Hub for playback (browser Web Speech API). Pass existing sourceIds and/or on-the-fly sources. Returns podcastId + noteId.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "sourceIds", type: "string", description: "Comma-separated existing StudySource ids (at least 1)", required: true },
      { name: "title", type: "string", description: "Optional podcast title" },
      { name: "host1Label", type: "string", description: "Optional name for host 1 (default 'Host A')" },
      { name: "host2Label", type: "string", description: "Optional name for host 2 (default 'Host B')" },
    ],
    handler: async (args, { userId }) => {
      const sourceIds = String(args.sourceIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (sourceIds.length === 0) return { error: "At least one sourceId is required." };

      const configured = await isLlmConfiguredFor(userId);
      if (!configured) return { error: "No AI provider configured." };

      const sources = await loadSources(userId, sourceIds);
      if (sources.length === 0) return { error: "No sources found." };

      const host1Label = String(args.host1Label ?? "Host A").slice(0, 40) || "Host A";
      const host2Label = String(args.host2Label ?? "Host B").slice(0, 40) || "Host B";

      const { model } = await acquireLlmModel(userId);
      let script: string;
      try {
        script = await generateText(
          model,
          podcastScriptPrompt(sources, host1Label, host2Label, "en" as StudyLanguage),
          "You are a podcast scriptwriter. Output ONLY the dialogue lines in the exact 'Host: text' format requested. No preamble, no commentary, no markdown fences."
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Script generation failed" };
      }
      if (!script.trim()) return { error: "The AI did not produce a script." };

      const title = (String(args.title ?? "").trim() || `Podcast: ${sources.map((s) => s.name).join(", ")}`).slice(0, 200);
      const note = await prisma.note.create({
        data: { userId, title, content: script, tags: "podcast,ai" },
      });
      const podcast = await prisma.podcast.create({
        data: {
          userId,
          title,
          scriptNoteId: note.id,
          sourceIds: JSON.stringify(sourceIds),
          host1Label,
          host2Label,
          durationEstimate: Math.round((script.split(/\s+/).filter(Boolean).length / 150) * 60),
        },
      });
      await logSessionSafe(userId, "podcast", title, sourceIds.join(","), {
        podcastId: podcast.id,
        noteId: note.id,
        sourceCount: sources.length,
      });
      return {
        action: "open_study_hub",
        mode: "podcast",
        podcastId: podcast.id,
        title,
        noteId: note.id,
        durationEstimate: podcast.durationEstimate,
      };
    },
  },
  {
    name: "list_podcasts",
    description: "List the user's generated podcasts. Returns id, title, sourceIds, durationEstimate, createdAt.",
    parameters: [],
    handler: async (_args, { userId }) => {
      const rows = await prisma.podcast.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return {
        count: rows.length,
        podcasts: rows.map((p) => ({
          id: p.id,
          title: p.title,
          sourceIds: safeParseArray(p.sourceIds),
          host1Label: p.host1Label,
          host2Label: p.host2Label,
          durationEstimate: p.durationEstimate,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    },
  },
  {
    name: "delete_podcast",
    description: "Delete a podcast permanently. The script note is NOT deleted.",
    destructive: true,
    parameters: [
      { name: "podcastId", type: "string", description: "Podcast id from list_podcasts", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.podcastId);
      const p = await prisma.podcast.findFirst({ where: { id, userId } });
      if (!p) return { error: "Podcast not found" };
      await prisma.podcast.delete({ where: { id } });
      return { deleted: true, podcastId: id, title: p.title };
    },
  },

  // ===== Teacher Mode (Teach Me) =====
  {
    name: "start_teacher_session",
    description:
      "Start a Teach Me (interactive live tutoring) session grounded on one or more Study Sources, and open it in the Study Hub. The teacher walks the user through the material, asks comprehension questions, and shows sources. Pass existing sourceIds and/or on-the-fly sources. Returns sessionId.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "sourceIds", type: "string", description: "Comma-separated existing StudySource ids" },
      {
        name: "sources",
        type: "string",
        description: "JSON array of on-the-fly source descriptors (e.g. [{\"kind\":\"note\",\"id\":\"abc\"}])",
      },
      { name: "studentLevel", type: "string", description: "Student level", enum: ["beginner", "intermediate", "advanced"] },
      { name: "title", type: "string", description: "Optional session title" },
    ],
    handler: async (args, { userId }) => {
      let sourceIds = String(args.sourceIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (args.sources) {
        try {
          const parsed = JSON.parse(String(args.sources));
          if (Array.isArray(parsed)) {
            const { sourceIds: resolved } = await resolveSourceIds(userId, parsed);
            sourceIds = [...sourceIds, ...resolved];
          }
        } catch {
          return { error: "sources must be a JSON array string." };
        }
      }
      if (sourceIds.length === 0) return { error: "At least one source is required." };

      let title = String(args.title ?? "").trim();
      if (!title) {
        const first = await prisma.studySource.findFirst({
          where: { id: sourceIds[0], userId },
          select: { name: true },
        });
        title = first ? `Teach Me: ${first.name}` : "Teach Me session";
      }

      const state = {
        studentLevel: String(args.studentLevel ?? "intermediate"),
        sourceHistory: [],
        coveredConcepts: [],
        comprehensionLog: [],
      };

      const session = await prisma.teacherSession.create({
        data: {
          userId,
          title: title.slice(0, 200),
          sourceIds: JSON.stringify(sourceIds),
          messages: "[]",
          state: JSON.stringify(state),
        },
      });
      return {
        action: "open_study_hub",
        mode: "teach",
        sessionId: session.id,
        title: session.title,
        sourceCount: sourceIds.length,
      };
    },
  },
  {
    name: "list_teacher_sessions",
    description: "List the user's Teach Me sessions. Returns id, title, sourceIds, updatedAt.",
    parameters: [],
    handler: async (_args, { userId }) => {
      const rows = await prisma.teacherSession.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
      return {
        count: rows.length,
        sessions: rows.map((s) => ({
          id: s.id,
          title: s.title,
          sourceIds: safeParseArray(s.sourceIds),
          updatedAt: s.updatedAt.toISOString(),
        })),
      };
    },
  },
  {
    name: "delete_teacher_session",
    description: "Delete a Teach Me session permanently.",
    destructive: true,
    parameters: [
      { name: "sessionId", type: "string", description: "Session id from list_teacher_sessions", required: true },
    ],
    handler: async (args, { userId }) => {
      const id = String(args.sessionId);
      const s = await prisma.teacherSession.findFirst({ where: { id, userId } });
      if (!s) return { error: "Session not found" };
      await prisma.teacherSession.delete({ where: { id } });
      return { deleted: true, sessionId: id, title: s.title };
    },
  },

  // ===== Quiz answering =====
  {
    name: "answer_quiz_question",
    description:
      "Answer a single quiz question and get AI-graded feedback. Use after start_quiz (which returns a quizId + questions). Returns correct (bool), explanation, modelAnswer. The user still completes the quiz in the Study Hub UI — this tool lets Mavino answer questions programmatically (e.g. when the user asks 'what's the answer to question 3').",
    parameters: [
      { name: "quizId", type: "string", description: "Quiz id from start_quiz", required: true },
      { name: "questionId", type: "number", description: "Question id (number)", required: true },
      { name: "answer", type: "string", description: "The answer to grade", required: true },
    ],
    handler: async (args, { userId }) => {
      const quizId = String(args.quizId);
      const questionId = Number(args.questionId);
      const answer = String(args.answer ?? "");
      const quiz = getQuiz(quizId, userId);
      if (!quiz) return { error: "Quiz not found or expired. Use start_quiz to generate a new one." };
      const question = quiz.questions.find((q) => q.id === questionId);
      if (!question) return { error: "Question not found" };

      const configured = await isLlmConfiguredFor(userId);
      if (!configured) {
        // Fallback to exact match
        const correct = answer.trim().toLowerCase() === question.answer.trim().toLowerCase();
        return {
          correct,
          explanation: correct ? "Correct." : `The correct answer is: ${question.answer}`,
          modelAnswer: question.answer,
          fallback: true,
        };
      }
      try {
        const { model } = await acquireLlmModel(userId);
        const result = await generateJson<{ correct: boolean; explanation: string; modelAnswer: string }>(
          model,
          quizGradePrompt(quiz.sourceText, question, answer, "en" as StudyLanguage),
          quizGradeSchemaHint()
        );
        return {
          correct: Boolean(result.correct),
          explanation: String(result.explanation ?? ""),
          modelAnswer: String(result.modelAnswer ?? question.answer),
        };
      } catch {
        const correct = answer.trim().toLowerCase() === question.answer.trim().toLowerCase();
        return {
          correct,
          explanation: correct ? "Correct." : `The correct answer is: ${question.answer}`,
          modelAnswer: question.answer,
          fallback: true,
        };
      }
    },
  },

  // ===== Notes from source =====
  {
    name: "take_notes_from_source",
    description:
      "Generate structured notes from a source (note, file, URL, or pasted text) and save them as a new Note. Styles: cornell, outline, summary, bullets. Detail: brief, standard, detailed. Opens the Notes app with the new note.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "kind", type: "string", description: "Source kind", enum: ["note", "file", "paste", "url", "moodle"], required: true },
      { name: "id", type: "string", description: "Note id or file id (required for kind note/file)" },
      { name: "url", type: "string", description: "URL (required for kind url/moodle)" },
      { name: "text", type: "string", description: "Pasted text (required for kind paste)" },
      { name: "name", type: "string", description: "Optional source name" },
      { name: "style", type: "string", description: "Note style", enum: ["cornell", "outline", "summary", "bullets"] },
      { name: "detail", type: "string", description: "Detail level", enum: ["brief", "standard", "detailed"] },
      { name: "customStructure", type: "string", description: "Optional custom structure description (e.g. 'focus on dates and names')" },
      { name: "title", type: "string", description: "Optional note title" },
      { name: "tags", type: "string", description: "Optional comma-separated tags" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      const src: SourceDescriptor = {
        kind: String(args.kind) as SourceKind,
        id: args.id ? String(args.id) : undefined,
        url: args.url ? String(args.url) : undefined,
        text: args.text ? String(args.text) : undefined,
        name: args.name ? String(args.name) : undefined,
      };
      let resolved;
      try {
        resolved = await resolveSource(userId, src);
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Source error" };
      }

      const style = (String(args.style ?? "outline")) as NoteStyle;
      const detail = (String(args.detail ?? "standard")) as NoteDetail;
      let notes: string;
      try {
        notes = await generateText(
          model,
          notetakingPrompt(resolved.text, style, resolved.name, {
            detail,
            customStructure: args.customStructure ? String(args.customStructure) : undefined,
          }),
          "You are a study assistant. Take accurate, well-organized notes in Markdown. Do not invent information not present in the source."
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Note generation failed" };
      }
      if (!notes.trim()) return { error: "The AI did not generate any notes." };

      const defaultTags = resolved.kind === "file" ? "notes,ai,pdf" : resolved.kind === "paste" ? "notes,ai,paste" : "notes,ai";
      const title = (String(args.title ?? "").trim() || `Notes: ${resolved.name}`).slice(0, 200);
      const tags = String(args.tags ?? "").trim() || defaultTags;
      const note = await prisma.note.create({
        data: { userId, title, content: notes, tags },
      });
      await logSessionSafe(userId, "notes", title, resolved.ref, {
        noteId: note.id,
        style,
        detail,
        sourceKind: resolved.kind,
      });
      return {
        action: "open_app",
        appId: "notes",
        title,
        noteId: note.id,
        note: { id: note.id, title: note.title },
        created: true,
      };
    },
  },

  // ===== Study session history =====
  {
    name: "list_study_sessions",
    description:
      "List the user's recent Study Hub activity (study sessions). Returns id, type (flashcards/summary/quiz/explain/study_guide/syllabus/chat/podcast/teach/notes), title, sourceRef, meta, createdAt. Use to see what the user has been studying or to reference past study outputs.",
    parameters: [],
    handler: async (_args, { userId }) => {
      const rows = await prisma.studySession.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return {
        count: rows.length,
        sessions: rows.map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          sourceRef: s.sourceRef,
          meta: safeParse(s.meta),
          createdAt: s.createdAt.toISOString(),
        })),
      };
    },
  },
];

const STUDY_HUB_FUNCTION_GATE: Record<string, string> = {
  start_study_chat: "chat",
  ask_study_chat: "chat",
  delete_study_chat: "chat",
  generate_podcast: "podcast",
  delete_podcast: "podcast",
  start_teacher_session: "teach",
  delete_teacher_session: "teach",
  answer_quiz_question: "quiz",
  take_notes_from_source: "notes_from_source",
};

export const studyHubTools: ToolDef[] = rawStudyHubTools.map((t) =>
  STUDY_HUB_FUNCTION_GATE[t.name] ? withStudyGate(t, STUDY_HUB_FUNCTION_GATE[t.name]) : t
);

// ===== helpers =====
function safeParseArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function safeParseMessages(raw: string): { role: "user" | "assistant"; content: string; citations?: any[]; timestamp: string }[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function extractCitations(
  text: string,
  sources: GroundedSource[]
): { index: number; name: string; kind: string; refId: string }[] {
  const found = new Set<number>();
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(Number(m[1]));
  }
  const out: { index: number; name: string; kind: string; refId: string }[] = [];
  for (const idx of [...found].sort((a, b) => a - b)) {
    const s = sources.find((x) => x.index === idx);
    if (s) out.push({ index: s.index, name: s.name, kind: s.kind, refId: s.refId });
  }
  return out;
}
