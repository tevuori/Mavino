// ===== AI Study Hub routes =====
// Purpose-built AI study workflows on top of the existing Athena LLM infra.
// Reuses getUserConfig/buildModel (per-user or server-wide fallback LLM).

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { studyFunctionMiddleware } from "../middleware/study-functions";
import { getUserConfig, buildModel, isLlmConfiguredFor, acquireLlmModel, LlmError } from "../services/athena/llm";
import { resolveSource, resolveAndCache, type SourceDescriptor, type ResolvedSource } from "../services/study/source";
import { generateJson, generateText } from "../services/study/llm-json";
import {
  syllabusTasksPrompt,
  syllabusTasksSchemaHint,
  type StudyLanguage,
  quizGradePrompt,
  quizGradeSchemaHint,
  flashcardsFromGraphPrompt,
  flashcardsCitedSchemaHint,
  summarizeFromGraphPrompt,
  explainFromGraphPrompt,
  studyGuideFromGraph,
  quizFromGraphPrompt,
  quizGenerateSchemaHint,
  notetakingPrompt,
  type NoteStyle,
  type NoteDetail,
  type QuizQuestionSpec,
  type SyllabusTaskSpec,
  type CitedFlashcardSpec,
} from "../services/study/prompts";
import { createQuiz, getQuiz, deleteQuiz, type StoredQuizQuestion } from "../services/study/quiz-store";
import { logSessionSafe } from "../services/study/logSession";
import { getOrBuildGraph, getGraphById, type ConceptGraphData } from "../services/study/graph";
import type { LlmModel } from "multi-llm-ts";

const study = new Hono();
study.use("*", authMiddleware);

const sourceSchema = z.object({
  kind: z.enum(["note", "file", "paste", "url"]),
  id: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
});

const languageSchema = z.enum(["en", "cs"]).optional().default("en");

/** Resolve either a single `source` or an array of `sources` into a list of
 *  ResolvedSource (with 1-based index for cited prompts). */
async function resolveSources(
  userId: string,
  body: { source?: SourceDescriptor; sources?: SourceDescriptor[] }
): Promise<ResolvedSource[]> {
  const list = body.sources && body.sources.length > 0
    ? body.sources
    : body.source
      ? [body.source]
      : [];
  if (list.length === 0) throw new Error("No source provided");
  const resolved = await Promise.all(list.map((s) => resolveSource(userId, s)));
  return resolved.map((r, i) => ({ ...r, index: i + 1 }));
}

/**
 * Resolve a request's `graphId` (reuse an existing concept graph directly) or
 * `source`/`sources` (resolve + cache as StudySources, then get-or-build the
 * graph for that source-set) into a ConceptGraphData. Flashcards, Quiz,
 * Summarize, Explain, and Study Guide all derive their output from this
 * shared, persisted structure instead of re-analyzing raw source text.
 */
async function resolveGraphForRequest(
  userId: string,
  model: LlmModel,
  body: { source?: SourceDescriptor; sources?: SourceDescriptor[]; graphId?: string },
  lang?: StudyLanguage
): Promise<{ graph: ConceptGraphData; graphId: string; name: string; truncated: boolean }> {
  if (body.graphId) {
    const g = await getGraphById(userId, body.graphId);
    if (!g) throw new Error("Knowledge graph not found");
    return { graph: g.data, graphId: g.id, name: g.name, truncated: false };
  }
  const list = body.sources && body.sources.length > 0
    ? body.sources
    : body.source
      ? [body.source]
      : [];
  if (list.length === 0) throw new Error("No source provided");
  const cachedSources = await Promise.all(list.map((s) => resolveAndCache(userId, s)));
  const truncated = cachedSources.some((s) => s.truncated);
  const built = await getOrBuildGraph(userId, model, cachedSources, { lang });
  return { graph: built.data, graphId: built.id, name: built.name, truncated };
}

/** Resolve the user's LLM or return a 400 if unconfigured. */
async function loadModel(c: any, userId: string) {
  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return {
      error: c.json(
        { error: "No AI provider configured. Add an API key in Settings → AI." },
        400
      ),
    } as const;
  }
  try {
    const { model } = await acquireLlmModel(userId);
    return { model } as const;
  } catch (e) {
    if (e instanceof LlmError) {
      return {
        error: c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500),
      } as const;
    }
    return {
      error: c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500),
    } as const;
  }
}

// ===== Generate Flashcards =====
// Derived from the source-set's persisted concept graph (built once, then
// reused by every feature) rather than the raw source text.
const flashcardsSchema = z.object({
  source: sourceSchema.optional(),
  sources: z.array(sourceSchema).max(20).optional(),
  graphId: z.string().optional(),
  deckName: z.string().optional(),
  deckColor: z.string().optional(),
  count: z.number().int().min(1).max(40).optional().default(10),
  mode: z.enum(["concept", "factual", "mixed", "cloze"]).optional().default("mixed"),
  /** If true, create the deck + cards in DB. If false, just return the cards. */
  create: z.boolean().optional().default(true),
  language: languageSchema,
});

study.post("/flashcards", studyFunctionMiddleware("flashcards"), zValidator("json", flashcardsSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  let resolved: { graph: ConceptGraphData; graphId: string; name: string; truncated: boolean };
  try {
    resolved = await resolveGraphForRequest(userId, loaded.model, body, body.language as StudyLanguage);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Source error" }, 400);
  }

  let result;
  try {
    result = await generateJson<{ cards: CitedFlashcardSpec[] }>(
      loaded.model,
      flashcardsFromGraphPrompt(resolved.graph, body.count, body.mode, body.language as StudyLanguage),
      flashcardsCitedSchemaHint()
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Generation failed" }, 502);
  }

  const cards = (result.cards ?? []).filter(
    (card) => card.front?.trim() && card.back?.trim()
  );
  if (cards.length === 0) {
    return c.json({ error: "The AI did not generate any valid flashcards." }, 502);
  }

  const primaryName = resolved.name;
  const deckName = body.deckName?.trim() || `Flashcards: ${primaryName}`;
  let deckId: string | null = null;
  if (body.create) {
    const deck = await prisma.flashcardDeck.create({
      data: {
        name: deckName.slice(0, 100),
        color: body.deckColor ?? "#6366f1",
        userId,
      },
    });
    deckId = deck.id;
    await prisma.flashcard.createMany({
      data: cards.map((card) => ({
        front: String(card.front).slice(0, 2000),
        back: String(card.back).slice(0, 2000),
        sourceRef: (card.source != null ? resolved.graph.sources.find((s) => s.index === card.source)?.name ?? primaryName : primaryName).slice(0, 200),
        deckId: deck.id,
      })),
    });
  }

  const sessionId = await logSessionSafe(userId, "flashcards", deckName, resolved.graph.sources[0]?.refId ?? "", {
    deckId,
    cardCount: cards.length,
    create: body.create,
    graphId: resolved.graphId,
  });

  return c.json({
    deckId,
    deckName,
    cards: cards.map((card) => ({ front: card.front, back: card.back })),
    sessionId,
    truncated: resolved.truncated,
  });
});

// ===== Summarize =====
// Derived from the source-set's persisted concept graph.
const summarizeSchema = z.object({
  source: sourceSchema.optional(),
  sources: z.array(sourceSchema).max(20).optional(),
  graphId: z.string().optional(),
  mode: z.enum(["tldr", "outline", "keypoints"]).optional().default("keypoints"),
  saveAsNote: z.boolean().optional().default(true),
  noteTitle: z.string().optional(),
  language: languageSchema,
});

study.post("/summarize", studyFunctionMiddleware("summarize"), zValidator("json", summarizeSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  let resolved: { graph: ConceptGraphData; graphId: string; name: string; truncated: boolean };
  try {
    resolved = await resolveGraphForRequest(userId, loaded.model, body, body.language as StudyLanguage);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Source error" }, 400);
  }

  const combinedName = resolved.name;

  let summary: string;
  try {
    summary = await generateText(
      loaded.model,
      summarizeFromGraphPrompt(resolved.graph, body.mode, body.language as StudyLanguage),
      "You are a study assistant. Summarize accurately in clear Markdown. Do not invent information."
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Generation failed" }, 502);
  }

  let noteId: string | null = null;
  if (body.saveAsNote && summary.trim()) {
    const title = body.noteTitle?.trim() || `Summary: ${combinedName}`;
    const note = await prisma.note.create({
      data: {
        userId,
        title: title.slice(0, 200),
        content: summary,
        tags: "summary,ai",
      },
    });
    noteId = note.id;
  }

  const sessionId = await logSessionSafe(userId, "summary", `Summary: ${combinedName}`, resolved.graph.sources[0]?.refId ?? "", {
    mode: body.mode,
    noteId,
    graphId: resolved.graphId,
  });

  return c.json({ summary, noteId, sessionId, truncated: resolved.truncated });
});

// ===== Explain =====
// Derived from the source-set's persisted concept graph.
const explainSchema = z.object({
  source: sourceSchema.optional(),
  sources: z.array(sourceSchema).max(20).optional(),
  graphId: z.string().optional(),
  depth: z.enum(["eli5", "standard", "expert"]).optional().default("standard"),
  saveAsNote: z.boolean().optional().default(true),
  noteTitle: z.string().optional(),
  language: languageSchema,
});

study.post("/explain", studyFunctionMiddleware("explain"), zValidator("json", explainSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  let resolved: { graph: ConceptGraphData; graphId: string; name: string; truncated: boolean };
  try {
    resolved = await resolveGraphForRequest(userId, loaded.model, body, body.language as StudyLanguage);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Source error" }, 400);
  }

  const combinedName = resolved.name;

  let explanation: string;
  try {
    explanation = await generateText(
      loaded.model,
      explainFromGraphPrompt(resolved.graph, body.depth, body.language as StudyLanguage),
      "You are a study assistant. Explain clearly and accurately in Markdown with examples. Do not invent information."
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Generation failed" }, 502);
  }

  let noteId: string | null = null;
  if (body.saveAsNote && explanation.trim()) {
    const title = body.noteTitle?.trim() || `Explanation: ${combinedName}`;
    const note = await prisma.note.create({
      data: {
        userId,
        title: title.slice(0, 200),
        content: explanation,
        tags: "explain,ai",
      },
    });
    noteId = note.id;
  }

  const sessionId = await logSessionSafe(userId, "explain", `Explain: ${combinedName}`, resolved.graph.sources[0]?.refId ?? "", {
    depth: body.depth,
    noteId,
    graphId: resolved.graphId,
  });

  return c.json({ explanation, noteId, sessionId, truncated: resolved.truncated });
});

// ===== Study Guide (multiple notes / sources) =====
// Rendered directly from the persisted concept graph — no extra LLM call is
// needed once the graph exists, since the graph is already organized by
// concept with citations.
const studyGuideSchema = z.object({
  noteIds: z.array(z.string()).max(10).optional(),
  sources: z.array(sourceSchema).max(10).optional(),
  graphId: z.string().optional(),
  saveAsNote: z.boolean().optional().default(true),
  noteTitle: z.string().optional(),
  language: languageSchema,
});

study.post("/study-guide", studyFunctionMiddleware("study_guide"), zValidator("json", studyGuideSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  // noteIds are just another kind of source descriptor for graph purposes.
  const sources: SourceDescriptor[] = [
    ...(body.noteIds ?? []).map((id): SourceDescriptor => ({ kind: "note", id })),
    ...(body.sources ?? []) as SourceDescriptor[],
  ];

  let resolved: { graph: ConceptGraphData; graphId: string; name: string; truncated: boolean };
  try {
    resolved = await resolveGraphForRequest(
      userId,
      loaded.model,
      { sources, graphId: body.graphId },
      body.language as StudyLanguage
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "No notes or sources found" }, 404);
  }

  const guide = studyGuideFromGraph(resolved.graph);

  let noteId: string | null = null;
  if (body.saveAsNote && guide.trim()) {
    const title = body.noteTitle?.trim() || "Study Guide";
    const note = await prisma.note.create({
      data: {
        userId,
        title: title.slice(0, 200),
        content: guide,
        tags: "study-guide,ai",
      },
    });
    noteId = note.id;
  }

  const sourceRefs = resolved.graph.sources.map((s) => s.refId).join(",");

  const sessionId = await logSessionSafe(
    userId,
    "study_guide",
    "Study Guide",
    sourceRefs,
    { noteId, sourceCount: resolved.graph.sources.length, graphId: resolved.graphId }
  );

  return c.json({ guide, noteId, sessionId });
});

// ===== Syllabus → Tasks =====
const syllabusSchema = z.object({
  source: sourceSchema.optional(),
  sources: z.array(sourceSchema).max(20).optional(),
  create: z.boolean().optional().default(true),
  language: languageSchema,
});

study.post("/syllabus-tasks", studyFunctionMiddleware("syllabus"), zValidator("json", syllabusSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  let resolved: ResolvedSource[];
  try {
    resolved = await resolveSources(userId, body);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Source error" }, 400);
  }

  const combinedText = resolved.map((r) => r.text).join("\n\n");

  let result;
  try {
    result = await generateJson<{ tasks: SyllabusTaskSpec[] }>(
      loaded.model,
      syllabusTasksPrompt(combinedText, body.language as StudyLanguage),
      syllabusTasksSchemaHint()
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Generation failed" }, 502);
  }

  const tasks = (result.tasks ?? []).filter((t) => t.title?.trim());
  if (tasks.length === 0) {
    return c.json({ error: "The AI did not extract any tasks." }, 502);
  }

  let createdCount = 0;
  if (body.create) {
    let ws = await prisma.taskWorkspace.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
    if (!ws) ws = await prisma.taskWorkspace.create({ data: { name: "Default", userId } });
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
        data: {
          userId,
          title: String(t.title).slice(0, 200),
          priority,
          dueDate,
          workspaceId: ws.id,
        },
      });
      createdCount++;
    }
  }

  const sessionId = await logSessionSafe(userId, "syllabus", "Syllabus → Tasks", resolved[0].ref, {
    created: createdCount,
    taskCount: tasks.length,
  });

  return c.json({
    tasks: tasks.map((t) => ({
      title: t.title,
      dueDate: t.dueDate ?? null,
      priority: t.priority ?? "MEDIUM",
    })),
    created: createdCount,
    sessionId,
    truncated: resolved.some((r) => r.truncated),
  });
});

// ===== Quiz Me: start =====
// Derived from the source-set's persisted concept graph.
const quizStartSchema = z.object({
  source: sourceSchema.optional(),
  sources: z.array(sourceSchema).max(20).optional(),
  graphId: z.string().optional(),
  questionCount: z.number().int().min(1).max(20).optional().default(5),
  types: z.array(z.enum(["mcq", "short"])).optional().default(["mcq", "short"]),
  language: languageSchema,
});

study.post("/quiz/start", studyFunctionMiddleware("quiz"), zValidator("json", quizStartSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  let resolved: { graph: ConceptGraphData; graphId: string; name: string; truncated: boolean };
  try {
    resolved = await resolveGraphForRequest(userId, loaded.model, body, body.language as StudyLanguage);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Source error" }, 400);
  }

  const combinedName = resolved.name;

  let result;
  try {
    result = await generateJson<{ questions: QuizQuestionSpec[] }>(
      loaded.model,
      quizFromGraphPrompt(resolved.graph, body.questionCount, body.types, body.language as StudyLanguage),
      quizGenerateSchemaHint()
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Generation failed" }, 502);
  }

  const questions = (result.questions ?? []).filter((q) => q.prompt?.trim());
  if (questions.length === 0) {
    return c.json({ error: "The AI did not generate any quiz questions." }, 502);
  }

  const stored: StoredQuizQuestion[] = questions.map((q) => ({
    id: Number(q.id) || 0,
    type: q.type === "mcq" ? "mcq" : "short",
    prompt: String(q.prompt),
    options: Array.isArray(q.options) ? q.options.map(String) : undefined,
    answer: String(q.answer),
  }));

  // Grading (quiz/:id/answer) uses sourceText as grounding context — the
  // rendered graph (concepts + facts) serves that role just as well as raw text.
  const quiz = createQuiz(userId, combinedName, resolved.graph.sources[0]?.refId ?? "", studyGuideFromGraph(resolved.graph), stored);

  // Return questions WITHOUT answers (so the client can't peek).
  return c.json({
    quizId: quiz.id,
    sourceName: combinedName,
    truncated: resolved.truncated,
    questions: stored.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
    })),
  });
});

// ===== Quiz Me: fetch a pre-generated quiz (without answers) =====
// Used by the QuizMe component when Athena's start_quiz tool pre-generates
// a quiz on the server and passes the quizId via a client_action payload.
study.get("/quiz/:id", studyFunctionMiddleware("quiz"), async (c) => {
  const { userId } = c.get("auth");
  const quizId = c.req.param("id");
  if (!quizId) return c.json({ error: "Quiz id is required" }, 400);
  const quiz = getQuiz(quizId, userId);
  if (!quiz) return c.json({ error: "Quiz not found or expired. Please restart." }, 404);
  return c.json({
    quizId: quiz.id,
    sourceName: quiz.sourceName,
    questions: quiz.questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
    })),
  });
});

// ===== Quiz Me: answer =====
const quizAnswerSchema = z.object({
  questionId: z.number().int(),
  answer: z.string(),
  language: languageSchema,
});

study.post("/quiz/:id/answer", studyFunctionMiddleware("quiz"), zValidator("json", quizAnswerSchema), async (c) => {
  const { userId } = c.get("auth");
  const quizId = c.req.param("id");
  const body = c.req.valid("json");

  const quiz = getQuiz(quizId, userId);
  if (!quiz) return c.json({ error: "Quiz not found or expired. Please restart." }, 404);

  const question = quiz.questions.find((q) => q.id === body.questionId);
  if (!question) return c.json({ error: "Question not found" }, 404);

  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  let result;
  try {
    result = await generateJson<{ correct: boolean; explanation: string; modelAnswer: string }>(
      loaded.model,
      quizGradePrompt(quiz.sourceText, question, body.answer, body.language as StudyLanguage),
      quizGradeSchemaHint()
    );
  } catch (e) {
    // Fallback: simple exact-match grading if the LLM fails.
    const correct = body.answer.trim().toLowerCase() === question.answer.trim().toLowerCase();
    return c.json({
      correct,
      explanation: correct ? "Correct." : `The correct answer is: ${question.answer}`,
      modelAnswer: question.answer,
      fallback: true,
    });
  }

  return c.json({
    correct: Boolean(result.correct),
    explanation: String(result.explanation ?? ""),
    modelAnswer: String(result.modelAnswer ?? question.answer),
  });
});

// ===== Quiz Me: finish =====
const quizFinishSchema = z.object({
  score: z.number().int().min(0).max(100),
  correct: z.number().int().min(0),
  total: z.number().int().min(0),
  saveAsNote: z.boolean().optional().default(false),
});

study.post("/quiz/:id/finish", studyFunctionMiddleware("quiz"), zValidator("json", quizFinishSchema), async (c) => {
  const { userId } = c.get("auth");
  const quizId = c.req.param("id");
  const body = c.req.valid("json");

  const quiz = getQuiz(quizId, userId);
  if (!quiz) return c.json({ error: "Quiz not found or expired" }, 404);

  let noteId: string | null = null;
  if (body.saveAsNote) {
    const content = `# Quiz Results: ${quiz.sourceName}\n\n- Score: **${body.score}%** (${body.correct}/${body.total} correct)\n\n_Generated by Mavino Study Hub._`;
    const note = await prisma.note.create({
      data: {
        userId,
        title: `Quiz: ${quiz.sourceName}`.slice(0, 200),
        content,
        tags: "quiz,ai",
      },
    });
    noteId = note.id;
  }

  const sessionId = await logSessionSafe(userId, "quiz", `Quiz: ${quiz.sourceName}`, quiz.sourceRef, {
    score: body.score,
    correct: body.correct,
    total: body.total,
    noteId,
  });

  deleteQuiz(quizId);
  return c.json({ sessionId, noteId });
});

// ===== Notes from source (PDF / pasted text) =====
// Used by the Notes app's "Notes from PDF" feature: resolves a source
// (typically a PDF file or pasted text), generates structured notes with the
// user's chosen detail level + style + optional custom structure description,
// saves them as a new Note, and returns the noteId.
const notesFromSourceSchema = z.object({
  source: sourceSchema,
  style: z.enum(["cornell", "outline", "summary", "bullets"]).optional().default("outline"),
  detail: z.enum(["brief", "standard", "detailed"]).optional().default("standard"),
  customStructure: z.string().max(2000).optional(),
  title: z.string().max(200).optional(),
  tags: z.string().max(200).optional(),
  folderId: z.string().nullable().optional(),
  language: languageSchema,
});

study.post("/notes-from-source", studyFunctionMiddleware("notes_from_source"), zValidator("json", notesFromSourceSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  let resolved: ResolvedSource;
  try {
    resolved = await resolveSource(userId, body.source);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Source error" }, 400);
  }

  let notes: string;
  try {
    notes = await generateText(
      loaded.model,
      notetakingPrompt(resolved.text, body.style as NoteStyle, resolved.name, {
        detail: body.detail as NoteDetail,
        customStructure: body.customStructure,
      }),
      "You are a study assistant. Take accurate, well-organized notes in Markdown. Do not invent information not present in the source."
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Note generation failed" }, 502);
  }

  if (!notes.trim()) {
    return c.json({ error: "The AI did not generate any notes." }, 502);
  }

  const defaultTags = resolved.kind === "file" ? "notes,ai,pdf" : resolved.kind === "paste" ? "notes,ai,paste" : "notes,ai";
  const title = (body.title?.trim() || `Notes: ${resolved.name}`).slice(0, 200);
  const tags = body.tags?.trim() ?? defaultTags;
  const note = await prisma.note.create({
    data: {
      userId,
      title,
      content: notes,
      tags,
      folderId: body.folderId ?? null,
    },
  });

  const sessionId = await logSessionSafe(userId, "notes", title, resolved.ref, {
    noteId: note.id,
    style: body.style,
    detail: body.detail,
    sourceKind: resolved.kind,
    sourceName: resolved.name,
    truncated: resolved.truncated,
    customStructure: body.customStructure?.trim() || undefined,
  });

  return c.json({
    noteId: note.id,
    title: note.title,
    content: notes,
    sessionId,
    truncated: resolved.truncated,
  }, 201);
});

// ===== Recent sessions =====
study.get("/sessions", async (c) => {
  const { userId } = c.get("auth");
  const sessions = await prisma.studySession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      sourceRef: s.sourceRef,
      meta: s.meta ? safeParse(s.meta) : {},
      createdAt: s.createdAt.toISOString(),
    })),
  });
});

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export default study;
