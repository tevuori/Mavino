// ===== Athena study tools =====
// Lets the Athena chat assistant trigger AI Study Hub workflows and open the
// Study app. generate_flashcards runs the full generation pipeline and creates
// a deck, returning a client_action so the Flashcards app opens at the deck.

import type { ToolDef } from "./plugin";
import prisma from "../../../db/client";
import { resolveDefaultTaskWorkspace } from "./tasks";
import { getUserConfig, buildModel, acquireLlmModel } from "../llm";
import { resolveSource } from "../../study/source";
import { generateJson, generateText } from "../../study/llm-json";
import {
  flashcardsPrompt,
  flashcardsSchemaHint,
  summarizePrompt,
  explainPrompt,
  studyGuidePrompt,
  syllabusTasksPrompt,
  syllabusTasksSchemaHint,
  quizGeneratePrompt,
  quizGenerateSchemaHint,
  type FlashcardSpec,
  type SyllabusTaskSpec,
  type QuizQuestionSpec,
} from "../../study/prompts";
import { logSessionSafe } from "../../study/logSession";
import { createQuiz, type StoredQuizQuestion } from "../../study/quiz-store";

export const studyTools: ToolDef[] = [
  {
    name: "generate_flashcards",
    description:
      "Generate flashcards from a note, file, or pasted text and create a new flashcard deck. Returns the deck id and opens the Flashcards app on the user's desktop. Use list_notes / search_files first to get the source id.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "kind", type: "string", description: "Source kind", enum: ["note", "file", "paste"], required: true },
      { name: "id", type: "string", description: "Note id or file id (required for kind note/file)" },
      { name: "text", type: "string", description: "Pasted source text (required for kind paste)" },
      { name: "deckName", type: "string", description: "Optional deck name (defaults to 'Flashcards: <source>')" },
      { name: "count", type: "number", description: "Number of cards to generate (1-40, default 10)" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      let resolved;
      try {
        resolved = await resolveSource(userId, {
          kind: String(args.kind) as "note" | "file" | "paste",
          id: args.id ? String(args.id) : undefined,
          text: args.text ? String(args.text) : undefined,
        });
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Source error" };
      }

      const count = Math.max(1, Math.min(40, Number(args.count) || 10));
      let result;
      try {
        result = await generateJson<{ cards: FlashcardSpec[] }>(
          model,
          flashcardsPrompt(resolved.text, count, "mixed"),
          flashcardsSchemaHint()
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Generation failed" };
      }

      const cards = (result.cards ?? []).filter(
        (c) => c.front?.trim() && c.back?.trim()
      );
      if (cards.length === 0) return { error: "No valid flashcards generated." };

      const deckName = (String(args.deckName ?? "").trim() || `Flashcards: ${resolved.name}`).slice(0, 100);
      const deck = await prisma.flashcardDeck.create({
        data: { name: deckName, color: "#6366f1", userId },
      });
      await prisma.flashcard.createMany({
        data: cards.map((c) => ({
          front: String(c.front).slice(0, 2000),
          back: String(c.back).slice(0, 2000),
          deckId: deck.id,
        })),
      });

      await logSessionSafe(userId, "flashcards", deckName, resolved.ref, {
        deckId: deck.id,
        cardCount: cards.length,
      });

      // client_action payload: open the Flashcards app at this deck.
      return {
        action: "open_app",
        appId: "flashcards",
        title: deckName,
        deckId: deck.id,
        cardCount: cards.length,
      };
    },
  },
  {
    name: "summarize_note",
    description:
      "Summarize a note and save the summary as a new note, then open it in the Notes app. Use list_notes first to get the note id.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "noteId", type: "string", description: "Note id to summarize", required: true },
      { name: "mode", type: "string", description: "Summary style", enum: ["tldr", "outline", "keypoints"] },
      { name: "title", type: "string", description: "Optional title for the new summary note" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      let resolved;
      try {
        resolved = await resolveSource(userId, { kind: "note", id: String(args.noteId) });
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Source error" };
      }

      const mode = (String(args.mode ?? "keypoints")) as "tldr" | "outline" | "keypoints";
      let summary: string;
      try {
        summary = await generateText(
          model,
          summarizePrompt(resolved.text, mode),
          "You are a study assistant. Summarize accurately in clear Markdown. Do not invent information."
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Generation failed" };
      }

      const title = (String(args.title ?? "").trim() || `Summary: ${resolved.name}`).slice(0, 200);
      const note = await prisma.note.create({
        data: { userId, title, content: summary, tags: "summary,ai" },
      });
      await logSessionSafe(userId, "summary", title, resolved.ref, { mode, noteId: note.id });

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
  {
    name: "create_tasks_from_text",
    description:
      "Extract actionable tasks (with optional due dates and priorities) from a note, file, or pasted text, create them in the Tasks app, and open the Tasks app. Use list_notes / search_files first to get the source id.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "kind", type: "string", description: "Source kind", enum: ["note", "file", "paste"], required: true },
      { name: "id", type: "string", description: "Note id or file id (required for kind note/file)" },
      { name: "text", type: "string", description: "Pasted source text (required for kind paste)" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      let resolved;
      try {
        resolved = await resolveSource(userId, {
          kind: String(args.kind) as "note" | "file" | "paste",
          id: args.id ? String(args.id) : undefined,
          text: args.text ? String(args.text) : undefined,
        });
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Source error" };
      }

      let result;
      try {
        result = await generateJson<{ tasks: SyllabusTaskSpec[] }>(
          model,
          syllabusTasksPrompt(resolved.text),
          syllabusTasksSchemaHint()
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Generation failed" };
      }

      const tasks = (result.tasks ?? []).filter((t) => t.title?.trim());
      if (tasks.length === 0) return { error: "No tasks extracted." };

      let created = 0;
      const workspaceId = await resolveDefaultTaskWorkspace(userId);
      for (const t of tasks) {
        const priority = ["LOW", "MEDIUM", "HIGH"].includes(t.priority ?? "")
          ? (t.priority as "LOW" | "MEDIUM" | "HIGH")
          : "MEDIUM";
        let dueDate: Date | null = null;
        if (t.dueDate) {
          const parsed = new Date(t.dueDate);
          if (!isNaN(parsed.getTime())) dueDate = parsed;
        }
        await prisma.task.create({
          data: { userId, title: String(t.title).slice(0, 200), priority, dueDate, workspaceId },
        });
        created++;
      }

      await logSessionSafe(userId, "syllabus", "Syllabus → Tasks", resolved.ref, {
        created,
        taskCount: tasks.length,
      });

      return {
        action: "open_app",
        appId: "tasks",
        title: "Tasks",
        created,
        taskCount: tasks.length,
      };
    },
  },
  {
    name: "open_study_hub",
    description:
      "Open the AI Study Hub app on the user's desktop. Optionally preselect a mode (home, chat, teach, podcast, graph, flashcards, summarize, quiz, explain, study_guide, syllabus, recent) and a source. Can also deep-link to a specific chat, podcast, workspace, teacher session, or knowledge graph (from build_concept_graph) by id.",
    clientAction: true,
    parameters: [
      {
        name: "mode",
        type: "string",
        description: "Preselect a Study Hub mode",
        enum: ["home", "chat", "teach", "podcast", "graph", "flashcards", "summarize", "quiz", "explain", "study_guide", "syllabus", "recent"],
      },
      { name: "sourceKind", type: "string", description: "Preselect source kind", enum: ["note", "file", "paste", "url", "moodle"] },
      { name: "sourceId", type: "string", description: "Preselected note id or file id" },
      { name: "chatId", type: "string", description: "Deep-link to a specific Study Chat (from start_study_chat or list_study_chats)" },
      { name: "podcastId", type: "string", description: "Deep-link to a specific podcast (from generate_podcast or list_podcasts)" },
      { name: "workspaceId", type: "string", description: "Deep-link to a learning workspace (from list_learning_workspaces)" },
      { name: "sessionId", type: "string", description: "Deep-link to a Teach Me session (from start_teacher_session or list_teacher_sessions)" },
      { name: "graphId", type: "string", description: "Deep-link to a knowledge graph (from build_concept_graph) — opens graph mode, or seeds flashcards/summarize/quiz/explain/study_guide mode from it when combined with mode" },
    ],
    handler: async (args) => {
      const out: Record<string, any> = { action: "open_study_hub" };
      if (args.mode) out.mode = args.mode;
      if (args.sourceKind) out.sourceKind = args.sourceKind;
      if (args.sourceId) out.sourceId = args.sourceId;
      if (args.chatId) out.chatId = args.chatId;
      if (args.podcastId) out.podcastId = args.podcastId;
      if (args.workspaceId) out.workspaceId = args.workspaceId;
      if (args.sessionId) out.sessionId = args.sessionId;
      if (args.graphId) out.graphId = args.graphId;
      return out;
    },
  },
  {
    name: "explain_note",
    description:
      "Explain a note's content at a chosen depth, save the explanation as a new note, and open it in the Notes app. Use list_notes first to get the note id.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "noteId", type: "string", description: "Note id to explain", required: true },
      { name: "depth", type: "string", description: "Explanation depth", enum: ["eli5", "standard", "expert"] },
      { name: "title", type: "string", description: "Optional title for the new explanation note" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      let resolved;
      try {
        resolved = await resolveSource(userId, { kind: "note", id: String(args.noteId) });
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Source error" };
      }

      const depth = (String(args.depth ?? "standard")) as "eli5" | "standard" | "expert";
      let explanation: string;
      try {
        explanation = await generateText(
          model,
          explainPrompt(resolved.text, depth),
          "You are a study assistant. Explain clearly and accurately in Markdown with examples. Do not invent information."
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Generation failed" };
      }

      const title = (String(args.title ?? "").trim() || `Explanation: ${resolved.name}`).slice(0, 200);
      const note = await prisma.note.create({
        data: { userId, title, content: explanation, tags: "explain,ai" },
      });
      await logSessionSafe(userId, "explain", title, resolved.ref, { depth, noteId: note.id });

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
  {
    name: "generate_study_guide",
    description:
      "Consolidate multiple notes into a single study guide / cheat sheet, save it as a new note, and open it in the Notes app. Use list_notes first to get the note ids.",
    destructive: true,
    clientAction: true,
    parameters: [
      { name: "noteIds", type: "string", description: "Comma-separated note ids to consolidate", required: true },
      { name: "title", type: "string", description: "Optional title for the study guide note" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      const ids = String(args.noteIds ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) return { error: "No note ids provided." };

      const notes = await prisma.note.findMany({ where: { id: { in: ids }, userId } });
      if (notes.length === 0) return { error: "No notes found." };

      const combined = notes.map((n) => ({ title: n.title, content: n.content }));
      let guide: string;
      try {
        guide = await generateText(
          model,
          studyGuidePrompt(combined),
          "You are a study assistant. Create a clear, comprehensive study guide in Markdown. Do not invent information."
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Generation failed" };
      }

      const title = (String(args.title ?? "").trim() || "Study Guide").slice(0, 200);
      const note = await prisma.note.create({
        data: { userId, title, content: guide, tags: "study-guide,ai" },
      });
      await logSessionSafe(userId, "study_guide", title, notes.map((n) => n.id).join(","), {
        noteId: note.id,
        sourceCount: notes.length,
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
  {
    name: "start_quiz",
    description:
      "Generate quiz questions from a note, file, or pasted text and open the Study Hub in quiz mode. Use list_notes / search_files first to get the source id.",
    clientAction: true,
    parameters: [
      { name: "kind", type: "string", description: "Source kind", enum: ["note", "file", "paste"], required: true },
      { name: "id", type: "string", description: "Note id or file id (required for kind note/file)" },
      { name: "text", type: "string", description: "Pasted source text (required for kind paste)" },
      { name: "questionCount", type: "number", description: "Number of questions (1-20, default 5)" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      let resolved;
      try {
        resolved = await resolveSource(userId, {
          kind: String(args.kind) as "note" | "file" | "paste",
          id: args.id ? String(args.id) : undefined,
          text: args.text ? String(args.text) : undefined,
        });
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Source error" };
      }

      const count = Math.max(1, Math.min(20, Number(args.questionCount) || 5));
      let result;
      try {
        result = await generateJson<{ questions: QuizQuestionSpec[] }>(
          model,
          quizGeneratePrompt(resolved.text, count, ["mcq", "short"]),
          quizGenerateSchemaHint()
        );
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Generation failed" };
      }

      const questions = (result.questions ?? []).filter((q) => q.prompt?.trim());
      if (questions.length === 0) return { error: "No quiz questions generated." };

      const stored: StoredQuizQuestion[] = questions.map((q) => ({
        id: Number(q.id) || 0,
        type: q.type === "mcq" ? "mcq" : "short",
        prompt: String(q.prompt),
        options: Array.isArray(q.options) ? q.options.map(String) : undefined,
        answer: String(q.answer),
      }));

      const quiz = createQuiz(userId, resolved.name, resolved.ref, resolved.text, stored);

      // client_action: open Study Hub in quiz mode with the quiz id.
      return {
        action: "open_study_hub",
        mode: "quiz",
        sourceKind: args.kind,
        sourceId: args.id ?? null,
        quizId: quiz.id,
        questionCount: questions.length,
      };
    },
  },
];
