// ===== Interactive Teacher ("Teach Me" mode) sessions =====
// Persisted, source-grounded live-tutoring sessions. The /:id/stream endpoint
// uses the teacher system prompt (with source-history + comprehension state)
// + the full Athena tool set (including the teacher show_source/highlight/
// scroll/comprehension tools) and streams content/tool/client_action SSE
// events — reusing the Athena chat streaming pattern.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { Message } from "multi-llm-ts";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { studyFunctionMiddleware } from "../middleware/study-functions";
import { acquireLlmModel, isLlmConfiguredFor, LlmError } from "../services/athena/llm";
import {
  AthenaToolsPlugin,
  toolsForUser,
  CLIENT_ACTION_TOOLS,
  DESTRUCTIVE_TOOLS,
  type ClientWindowInfo,
} from "../services/athena/tools";
import {
  teacherSystemPrompt,
  applyAssessmentToState,
  inferAdaptiveLevel,
  weakConceptsFallback,
  type SourceHistoryEntry,
  type TeacherSessionState,
} from "../services/study/teacher-prompt";
import {
  assessComprehension,
  generateLessonPlan,
  generateSessionTitle,
  lessonFlashcardsPrompt,
  lessonFlashcardsSchemaHint,
  lessonSummaryMarkdown,
  normalizeFlashcards,
  weakConcepts,
  type LessonExportContext,
} from "../services/study/teacher-lesson";
import { generateJson } from "../services/study/llm-json";
import { createQuiz, type StoredQuizQuestion } from "../services/study/quiz-store";
import { quizGeneratePrompt, quizGenerateSchemaHint, type QuizQuestionSpec } from "../services/study/prompts";
import type { GroundedSource, StudyLanguage } from "../services/study/prompts";
import { logSessionSafe } from "../services/study/logSession";

const teacher = new Hono();
teacher.use("*", authMiddleware, studyFunctionMiddleware("teach"));

// ---------- helpers ----------

interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  tools?: { id: string; name: string; state: string }[];
  timestamp: string;
}

function parseMessages(raw: string): StoredMessage[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseSourceIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseState(raw: string): TeacherSessionState {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Load the GroundedSource list (with cached text) for a session. */
async function loadSessionSources(userId: string, sourceIds: string[]): Promise<GroundedSource[]> {
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

/** Pick the source text most likely to cover a concept (for grading). */
function pickRelevantText(sources: GroundedSource[], concept: string, limit = 6000): string {
  if (sources.length === 0) return "";
  const needle = concept.trim().toLowerCase();
  if (needle) {
    const hit = sources.find((s) => s.text.toLowerCase().includes(needle));
    if (hit) return hit.text.slice(0, limit);
  }
  const per = Math.max(600, Math.floor(limit / sources.length));
  return sources.map((s) => s.text.slice(0, per)).join("\n\n").slice(0, limit);
}

/**
 * Merge the client's view of the session state with the row's persisted state.
 * The client owns the live UI state (source history, level, style, pace) while
 * the server owns everything it computes itself (assessments → mastery,
 * comprehension log, lesson plan), so neither side can clobber the other.
 */
function mergeState(persisted: TeacherSessionState, incoming?: TeacherSessionState): TeacherSessionState {
  if (!incoming || typeof incoming !== "object") return persisted;
  const merged: TeacherSessionState = { ...persisted, ...incoming };
  // Server-owned fields win when the client hasn't caught up yet.
  const persistedLog = persisted.comprehensionLog ?? [];
  const incomingLog = incoming.comprehensionLog ?? [];
  merged.comprehensionLog = incomingLog.length >= persistedLog.length ? incomingLog : persistedLog;
  merged.mastery = { ...(persisted.mastery ?? {}), ...(incoming.mastery ?? {}) };
  merged.lessonPlan = incoming.lessonPlan ?? persisted.lessonPlan;
  merged.coveredConcepts = [
    ...new Set([...(persisted.coveredConcepts ?? []), ...(incoming.coveredConcepts ?? [])]),
  ];
  merged.inferredLevel = inferAdaptiveLevel(merged);
  return merged;
}

function serialize(s: any) {
  return {
    id: s.id,
    title: s.title,
    sourceIds: parseSourceIds(s.sourceIds),
    messages: parseMessages(s.messages),
    state: parseState(s.state),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    lastMessageAt: s.lastMessageAt.toISOString(),
  };
}

// ---------- CRUD ----------

const createSchema = z.object({
  title: z.string().max(200).optional(),
  sourceIds: z.array(z.string()).max(10).default([]),
  studentLevel: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  teachingStyle: z.enum(["explain", "socratic"]).optional(),
  sources: z
    .array(
      z.object({
        kind: z.enum(["note", "file", "paste", "url"]),
        id: z.string().optional(),
        text: z.string().optional(),
        url: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .max(10)
    .optional(),
});

/** POST / — create a teacher session. Resolves + caches on-the-fly sources. */
teacher.post("/", zValidator("json", createSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  let sourceIds = [...body.sourceIds];
  if (body.sources && body.sources.length > 0) {
    const { resolveAndCache } = await import("../services/study/source");
    for (const src of body.sources) {
      try {
        const cached = await resolveAndCache(userId, src as any);
        if (!sourceIds.includes(cached.id)) sourceIds.push(cached.id);
      } catch {
        // skip sources that fail to resolve
      }
    }
  }

  let title = body.title?.trim();
  if (!title) {
    if (sourceIds.length > 0) {
      const first = await prisma.studySource.findFirst({
        where: { id: sourceIds[0], userId },
        select: { name: true },
      });
      title = first ? `Teach Me: ${first.name}` : "Teach Me session";
    } else {
      title = "Teach Me session";
    }
  }

  const state: TeacherSessionState = {
    studentLevel: body.studentLevel ?? "intermediate",
    sourceHistory: [],
    coveredConcepts: [],
    comprehensionLog: [],
    mastery: {},
    teachingStyle: body.teachingStyle ?? "explain",
    followPlan: true,
  };

  const created = await prisma.teacherSession.create({
    data: {
      userId,
      title: title.slice(0, 200),
      sourceIds: JSON.stringify(sourceIds),
      messages: "[]",
      state: JSON.stringify(state),
    },
  });

  await logSessionSafe(userId, "teach_session_started", created.title, sourceIds[0] ?? "", {
    sources: sourceIds.length,
    studentLevel: state.studentLevel,
    teachingStyle: state.teachingStyle,
  });

  return c.json({ session: serialize(created) }, 201);
});

/** GET / — list sessions (no messages). */
teacher.get("/", async (c) => {
  const { userId } = c.get("auth");
  const rows = await prisma.teacherSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return c.json({ sessions: rows.map((r) => ({ ...serialize(r), messages: undefined })) });
});

/** GET /:id — full session incl. messages + state. */
teacher.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const row = await prisma.teacherSession.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Session not found" }, 404);
  return c.json({ session: serialize(row) });
});

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  sourceIds: z.array(z.string()).max(10).optional(),
  state: z.any().optional(),
});

/** Validate that the given ids all belong to the user, preserving order. */
async function ownedSourceIds(userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.studySource.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true },
  });
  const owned = new Set(rows.map((r) => r.id));
  return ids.filter((id) => owned.has(id));
}

/** PATCH /:id — update title / sourceIds / state. */
teacher.patch("/:id", zValidator("json", patchSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const row = await prisma.teacherSession.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Session not found" }, 404);
  const data: any = {};
  if (body.title !== undefined) data.title = body.title.slice(0, 200);
  if (body.sourceIds !== undefined) {
    // Drop ids the user doesn't own so a session can never point at foreign
    // sources, and keep the client's order (it drives the [n] citation order).
    data.sourceIds = JSON.stringify(await ownedSourceIds(userId, body.sourceIds));
  }
  if (body.state !== undefined) {
    data.state = JSON.stringify(mergeState(parseState(row.state), body.state as TeacherSessionState));
  }
  const updated = await prisma.teacherSession.update({ where: { id: row.id }, data });
  return c.json({ session: serialize(updated) });
});

/** DELETE /:id */
teacher.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const row = await prisma.teacherSession.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Session not found" }, 404);
  await prisma.teacherSession.delete({ where: { id: row.id } });
  return c.json({ ok: true });
});

// ---------- Lesson plan ----------

const planSchema = z.object({
  focus: z.string().max(2000).optional(),
  language: z.enum(["en", "cs"]).optional().default("en"),
});

/** POST /:id/plan — generate (or regenerate) the lesson agenda for a session. */
teacher.post("/:id/plan", zValidator("json", planSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const row = await prisma.teacherSession.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Session not found" }, 404);

  const sources = await loadSessionSources(userId, parseSourceIds(row.sourceIds));
  if (sources.length === 0) return c.json({ error: "This session has no sources." }, 400);

  const state = parseState(row.state);
  let plan;
  try {
    const { model } = await acquireLlmModel(userId);
    plan = await generateLessonPlan(model, sources, {
      studentLevel: state.studentLevel ?? "intermediate",
      focus: body.focus,
      language: body.language as StudyLanguage,
    });
  } catch (e) {
    const status = e instanceof LlmError ? e.status : 502;
    return c.json({ error: e instanceof Error ? e.message : "Lesson planning failed" }, status as 400);
  }
  if (!plan) return c.json({ error: "The AI did not return a usable lesson plan." }, 502);

  const nextState: TeacherSessionState = { ...state, lessonPlan: plan, followPlan: true };
  const updated = await prisma.teacherSession.update({
    where: { id: row.id },
    data: {
      state: JSON.stringify(nextState),
      // Only replace a placeholder title, never one the student edited.
      title: /^Teach Me( session|:)/.test(row.title) ? plan.title.slice(0, 200) : row.title,
    },
  });
  return c.json({ plan, session: serialize(updated) });
});

// ---------- Comprehension assessment ----------

const assessSchema = z.object({
  question: z.string().min(1).max(2000),
  answer: z.string().max(4000),
  expectedConcept: z.string().max(200).optional(),
  language: z.enum(["en", "cs"]).optional().default("en"),
});

/** POST /:id/assess — grade a comprehension answer and update mastery state. */
teacher.post("/:id/assess", zValidator("json", assessSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const row = await prisma.teacherSession.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Session not found" }, 404);

  const state = parseState(row.state);
  const concept = (body.expectedConcept ?? "").trim();
  const sources = await loadSessionSources(userId, parseSourceIds(row.sourceIds));

  let result;
  try {
    const { model } = await acquireLlmModel(userId);
    result = await assessComprehension(model, {
      question: body.question,
      expectedConcept: concept || undefined,
      answer: body.answer,
      sourceText: pickRelevantText(sources, concept),
      teachingStyle: state.teachingStyle === "socratic" ? "socratic" : "explain",
      language: body.language as StudyLanguage,
    });
  } catch (e) {
    const status = e instanceof LlmError ? e.status : 502;
    return c.json({ error: e instanceof Error ? e.message : "Assessment failed" }, status as 400);
  }

  const nextState = applyAssessmentToState(state, {
    concept: concept || body.question.slice(0, 80),
    passed: result.passed,
    feedback: result.feedback,
    misconception: result.misconception,
    question: body.question,
    answer: body.answer,
  });
  const updated = await prisma.teacherSession.update({
    where: { id: row.id },
    data: { state: JSON.stringify(nextState) },
  });
  await logSessionSafe(
    userId,
    result.passed ? "teach_comprehension_passed" : "teach_comprehension_failed",
    row.title,
    row.id,
    { concept: concept || undefined, score: result.score }
  );
  return c.json({ assessment: result, state: parseState(updated.state) });
});

// ---------- Title generation ----------

const titleBodySchema = z.object({
  title: z.string().max(200).optional(),
}).optional().default({});

/** POST /:id/title — derive a short topic title from the first exchange. */
teacher.post("/:id/title", zValidator("json", titleBodySchema), async (c) => {
  const { userId } = c.get("auth");
  const row = await prisma.teacherSession.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Session not found" }, 404);
  const messages = parseMessages(row.messages);
  const firstUser = messages.find((m) => m.role === "user");
  const firstAssistant = messages.find((m) => m.role === "assistant");
  if (!firstUser || !firstAssistant) return c.json({ error: "Not enough conversation yet." }, 400);

  let title: string;
  try {
    const { model } = await acquireLlmModel(userId);
    title = await generateSessionTitle(model, {
      question: firstUser.content,
      answer: firstAssistant.content,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Title generation failed" }, 502);
  }
  if (!title) return c.json({ error: "The AI did not return a title." }, 502);
  const updated = await prisma.teacherSession.update({
    where: { id: row.id },
    data: { title: title.slice(0, 200) },
  });
  return c.json({ session: serialize(updated) });
});

// ---------- Export the lesson to study artifacts ----------

const exportSchema = z.object({
  target: z.enum(["note", "flashcards", "quiz", "tasks"]),
  language: z.enum(["en", "cs"]).optional().default("en"),
  /** Flashcards / quiz: how many items to generate. */
  count: z.number().int().min(1).max(20).optional(),
});

teacher.post("/:id/export", zValidator("json", exportSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const row = await prisma.teacherSession.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Session not found" }, 404);

  const state = parseState(row.state);
  const messages = parseMessages(row.messages).map((m) => ({ role: m.role, content: m.content }));
  if (messages.length === 0) return c.json({ error: "Nothing to export yet — teach something first." }, 400);
  const sources = await loadSessionSources(userId, parseSourceIds(row.sourceIds));
  const ctx: LessonExportContext = {
    title: row.title,
    state,
    messages,
    sources: sources.map((s) => ({ name: s.name, kind: s.kind })),
  };
  const weak = weakConcepts(state).length ? weakConcepts(state) : weakConceptsFallback(state);

  if (body.target === "note") {
    const note = await prisma.note.create({
      data: {
        userId,
        title: `Lesson: ${row.title}`.slice(0, 200),
        content: lessonSummaryMarkdown(ctx),
        tags: "teach-me,lesson",
      },
    });
    await logSessionSafe(userId, "teach_export_created", row.title, row.id, { target: "note" });
    return c.json({ target: "note", noteId: note.id, title: note.title });
  }

  if (body.target === "tasks") {
    if (weak.length === 0) {
      return c.json({ error: "No weak concepts to review — nothing to schedule." }, 400);
    }
    const due = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const created = await Promise.all(
      weak.slice(0, 8).map((concept) =>
        prisma.task.create({
          data: {
            userId,
            title: `Review: ${concept}`.slice(0, 200),
            description: `From the Teach Me lesson "${row.title}".${
              state.mastery?.[concept]?.misconception
                ? ` Watch out for: ${state.mastery[concept].misconception}`
                : ""
            }`,
            dueDate: due,
            priority: "HIGH",
          },
        })
      )
    );
    await logSessionSafe(userId, "teach_export_created", row.title, row.id, { target: "tasks", count: created.length });
    return c.json({ target: "tasks", count: created.length, concepts: weak.slice(0, 8) });
  }

  // flashcards / quiz both need a generation pass.
  let model;
  try {
    model = (await acquireLlmModel(userId)).model;
  } catch (e) {
    const status = e instanceof LlmError ? e.status : 502;
    return c.json({ error: e instanceof Error ? e.message : "AI unavailable" }, status as 400);
  }

  if (body.target === "flashcards") {
    let cards;
    try {
      const raw = await generateJson<unknown>(model, lessonFlashcardsPrompt(ctx), lessonFlashcardsSchemaHint());
      cards = normalizeFlashcards(raw);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Flashcard generation failed" }, 502);
    }
    if (cards.length === 0) return c.json({ error: "The AI did not generate any cards." }, 502);
    const deck = await prisma.flashcardDeck.create({
      data: {
        userId,
        name: row.title.slice(0, 120),
        description: `Generated from a Teach Me lesson${weak.length ? ` — focused on: ${weak.slice(0, 4).join(", ")}` : ""}`,
        cards: {
          create: cards.slice(0, body.count ?? 12).map((card) => ({
            front: card.front,
            back: card.back,
            sourceRef: `Teach Me: ${row.title}`.slice(0, 200),
          })),
        },
      },
      include: { cards: true },
    });
    await logSessionSafe(userId, "teach_export_created", row.title, row.id, {
      target: "flashcards",
      count: deck.cards.length,
    });
    return c.json({ target: "flashcards", deckId: deck.id, deckName: deck.name, count: deck.cards.length });
  }

  // quiz — build a source text from the lesson transcript + weak concepts so the
  // questions target what the student actually struggled with.
  const transcript = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .join("\n\n")
    .slice(-16000);
  const quizText = `${weak.length ? `Focus on these concepts: ${weak.join(", ")}\n\n` : ""}${transcript}`;
  let questions: QuizQuestionSpec[];
  try {
    const result = await generateJson<{ questions: QuizQuestionSpec[] }>(
      model,
      quizGeneratePrompt(quizText, body.count ?? 5, ["mcq", "short"], body.language as StudyLanguage),
      quizGenerateSchemaHint()
    );
    questions = (result.questions ?? []).filter((q) => q.prompt?.trim());
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Quiz generation failed" }, 502);
  }
  if (questions.length === 0) return c.json({ error: "The AI did not generate any questions." }, 502);
  const stored: StoredQuizQuestion[] = questions.map((q, i) => ({
    id: Number(q.id) || i + 1,
    type: q.type === "mcq" ? "mcq" : "short",
    prompt: String(q.prompt),
    options: Array.isArray(q.options) ? q.options.map(String) : undefined,
    answer: String(q.answer),
  }));
  const quiz = createQuiz(userId, row.title, row.id, quizText, stored);
  await logSessionSafe(userId, "teach_export_created", row.title, row.id, { target: "quiz", count: stored.length });
  return c.json({ target: "quiz", quizId: quiz.id, count: stored.length });
});

// ---------- Streaming teacher turn ----------

const streamSchema = z.object({
  message: z.string().min(1).max(20000),
  language: z.enum(["en", "cs"]).optional().default("en"),
  windows: z.array(z.any()).optional(),
  /** Updated source-history + state sent by the client after each turn. */
  sourceHistory: z.array(z.any()).optional(),
  state: z.any().optional(),
});

/** POST /:id/stream — stream a teacher turn with tools + client_action events.
 *  SSE events: content | tool | client_action | data_change | usage | done | error. */
teacher.post("/:id/stream", zValidator("json", streamSchema), async (c) => {
  const { userId } = c.get("auth");
  const sessionId = c.req.param("id");
  const body = c.req.valid("json");

  const row = await prisma.teacherSession.findFirst({ where: { id: sessionId, userId } });
  if (!row) return c.json({ error: "Session not found" }, 404);

  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  }

  const sourceIds = parseSourceIds(row.sourceIds);
  const sources = await loadSessionSources(userId, sourceIds);
  if (sources.length === 0) {
    return c.json({ error: "This session has no sources. Add at least one source first." }, 400);
  }

  // Use the client-sent source-history + state (kept in sync by the client
  // store) so Athena can resolve "go back to the first file" etc.
  const history: SourceHistoryEntry[] = Array.isArray(body.sourceHistory) ? body.sourceHistory : [];
  const state: TeacherSessionState = mergeState(parseState(row.state), body.state as TeacherSessionState);

  const { model } = await acquireLlmModel(userId);
  const systemPrompt = teacherSystemPrompt(sources, history, state, body.language as StudyLanguage);

  const history2 = parseMessages(row.messages);
  const thread: Message[] = [new Message("system", systemPrompt)];
  for (const m of history2) {
    const content = m.role === "assistant" ? m.content.replace(/\n*##\s*Sources[\s\S]*$/i, "").trim() : m.content;
    thread.push(new Message(m.role, content));
  }
  thread.push(new Message("user", body.message));

  // Persist the user message immediately.
  const userMsg: StoredMessage = { role: "user", content: body.message, timestamp: new Date().toISOString() };
  const updatedMessages = [...history2, userMsg];
  await prisma.teacherSession.update({
    where: { id: row.id },
    data: {
      messages: JSON.stringify(updatedMessages),
      lastMessageAt: new Date(),
      state: JSON.stringify(state),
    },
  });

  const clientWindows: ClientWindowInfo[] = (body.windows ?? []) as ClientWindowInfo[];
  const abort = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => abort.abort());

  // Load the user's role to filter paid-only/pro-only tools (same pattern as
  // the main Athena chat route). Previously this used ALL_TOOLS directly,
  // which gave FREE users access to Pro/Paid-only tools (Atlas, Crunch,
  // sandbox) inside teacher sessions.
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const role = userRow?.role ?? "FREE";
  const allowedTools = await toolsForUser(userId, role);

  return streamSSE(c, async (stream) => {
    const plugin = new AthenaToolsPlugin(allowedTools, { userId, windows: clientWindows });
    model.addPlugin(plugin);

    // Patch the internal OpenAI client's fetch to retry on transient
    // "Upstream request failed" 400 errors from the provider. This happens
    // intermittently during multi-step tool call loops (same fix as athena.ts).
    const engine = (model as any).engine;
    const client = engine?.client;
    if (client && typeof client.fetch === "function") {
      const origFetch = client.fetch.bind(client);
      client.fetch = async (url: string, init?: any) => {
        const maxRetries = 5;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const res = await origFetch(url, init);
          if (res.status !== 400 || attempt === maxRetries) return res;
          const cloned = res.clone();
          let isTransient = false;
          try {
            const body = await cloned.json();
            const msg = body?.error?.message ?? body?.message ?? "";
            isTransient = /upstream request failed/i.test(msg);
          } catch { /* not JSON */ }
          if (!isTransient) return res;
          const base = Math.min(2000 * 2 ** attempt, 32000);
          const jitter = Math.floor(Math.random() * 500);
          console.warn(`[teacher] transient upstream error, retrying (${attempt + 1}/${maxRetries}) in ${base + jitter}ms…`);
          await new Promise((r) => setTimeout(r, base + jitter));
        }
        return origFetch(url, init);
      };
    }

    let full = "";
    let errored = false;
    const toolEvents: { id: string; name: string; state: string }[] = [];
    try {
      for await (const chunk of model.generate(thread, { tools: true, abortSignal: abort.signal })) {
        if (chunk.type === "content") {
          full += chunk.text ?? "";
          await stream.writeSSE({
            event: "content",
            data: JSON.stringify({ text: chunk.text ?? "", done: chunk.done }),
          });
        } else if (chunk.type === "tool") {
          await stream.writeSSE({
            event: "tool",
            data: JSON.stringify({
              id: chunk.id,
              name: chunk.name,
              state: chunk.state,
              status: chunk.status ?? "",
              result: chunk.state === "completed" ? chunk.call?.result : undefined,
            }),
          });
          if (chunk.state === "completed") {
            toolEvents.push({ id: chunk.id, name: chunk.name, state: chunk.state });
            const result = chunk.call?.result as any;
            if (DESTRUCTIVE_TOOLS.has(chunk.name) && result && !result?.error) {
              await stream.writeSSE({ event: "data_change", data: JSON.stringify({ tool: chunk.name }) });
            }
            if (CLIENT_ACTION_TOOLS.has(chunk.name) && result && !result?.error) {
              await stream.writeSSE({
                event: "client_action",
                data: JSON.stringify({ tool: chunk.name, payload: result }),
              });
            }
          }
        } else if (chunk.type === "usage") {
          await stream.writeSSE({ event: "usage", data: JSON.stringify({ usage: chunk.usage }) });
        }
      }
    } catch (e) {
      errored = true;
      const msg = e instanceof Error ? e.message : "Generation failed";
      const status = e instanceof LlmError ? e.status : 500;
      console.error(`[teacher] generation error: ${msg} (status=${status}, contentLen=${full.length}, tools=${toolEvents.length})`);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: msg, status }) });
      if (!full.trim()) return;
    }

    console.log(`[teacher] stream done: contentLen=${full.length}, tools=${toolEvents.length}, errored=${errored}`);

    // Persist the assistant message.
    const assistantMsg: StoredMessage = {
      role: "assistant",
      content: full.trim(),
      tools: toolEvents.length > 0 ? toolEvents : undefined,
      timestamp: new Date().toISOString(),
    };
    const prior = parseMessages(
      (await prisma.teacherSession.findFirst({ where: { id: row.id }, select: { messages: true } }))?.messages ?? "[]"
    );
    // Persist the updated state (source-history + comprehension log) sent by
    // the client so resumption restores the full session context. Re-read the
    // row because /assess may have written mastery while the turn streamed.
    const stateToPersist: TeacherSessionState = mergeState(
      parseState(
        (await prisma.teacherSession.findFirst({ where: { id: row.id }, select: { state: true } }))?.state ?? "{}"
      ),
      state
    );
    await prisma.teacherSession.update({
      where: { id: row.id },
      data: {
        messages: JSON.stringify([...prior, assistantMsg]),
        lastMessageAt: new Date(),
        state: JSON.stringify(stateToPersist),
      },
    });

    await logSessionSafe(userId, "teach_turn_completed", row.title, sourceIds.join(","), {
      sessionId: row.id,
      tools: toolEvents.length,
    });
    const sourcesOpened = toolEvents.filter((t) => t.name === "show_source").length;
    if (sourcesOpened > 0) {
      await logSessionSafe(userId, "teach_source_opened", row.title, row.id, { count: sourcesOpened });
    }

    if (!errored || full.trim()) {
      await stream.writeSSE({ event: "done", data: JSON.stringify({ done: true }) });
    }
  });
});

export default teacher;
