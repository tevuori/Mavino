// ===== Quick Capture inbox =====
// POST /  — accepts { text }, uses the per-user LLM to classify the input
// into task | note | flashcard | athena, performs the action, and returns a
// clientAction so the client can open the created item. Falls back to
// creating a Task with the raw text if no LLM is configured.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { acquireLlmModel, isLlmConfiguredFor } from "../services/athena/llm";
import { generateJson } from "../services/study/llm-json";

const capture = new Hono();
capture.use("*", authMiddleware);

const captureSchema = z.object({
  text: z.string().min(1).max(2000),
});

interface CaptureClassification {
  target: "task" | "note" | "flashcard" | "athena" | "study";
  title: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  dueDate?: string; // ISO datetime
  front?: string; // flashcard
  back?: string; // flashcard
  studyMode?: "flashcards" | "summarize" | "quiz" | "explain"; // for study target
}

const SCHEMA_HINT =
  'Respond with JSON: {"target":"task|note|flashcard|athena|study","title":string,"description"?:string,"priority"?:\"LOW\"|\"MEDIUM\"|\"HIGH\",\"dueDate"?:ISO8601,"front"?:string,"back"?:string,"studyMode"?:\"flashcards\"|\"summarize\"|\"quiz\"|\"explain\"}. ' +
  "Use 'task' for to-dos/reminders/deadlines, 'note' for ideas/knowledge to save, 'flashcard' for a Q/A study card, 'study' for text the user wants to study (summarize, quiz, explain, or make flashcards from — set studyMode accordingly), 'athena' for questions/conversations that need a chat response.";

capture.post("/", zValidator("json", captureSchema), async (c) => {
  const { userId } = c.get("auth");
  const { text } = c.req.valid("json");

  let classification: CaptureClassification;

  if (await isLlmConfiguredFor(userId)) {
    try {
      const { model } = await acquireLlmModel(userId, { feature: "capture" });
      classification = await generateJson<CaptureClassification>(
        model,
        `Classify this student input and extract structured fields:\n\n"${text}"`,
        SCHEMA_HINT
      );
    } catch {
      // LLM failure → fall back to a plain task.
      classification = { target: "task", title: text.slice(0, 200) };
    }
  } else {
    // No LLM configured → create a task with the raw text.
    classification = { target: "task", title: text.slice(0, 200) };
  }

  const target = classification.target ?? "task";
  const title = (classification.title ?? text).slice(0, 200) || text.slice(0, 200);

  if (target === "task") {
    // Ensure the task is assigned to a workspace (default to first/create "Default")
    let ws = await prisma.taskWorkspace.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
    if (!ws) ws = await prisma.taskWorkspace.create({ data: { name: "Default", userId } });
    const task = await prisma.task.create({
      data: {
        userId,
        title,
        description: classification.description ?? "",
        priority: (classification.priority as any) ?? "MEDIUM",
        dueDate: classification.dueDate ? new Date(classification.dueDate) : null,
        workspaceId: ws.id,
      },
    });
    return c.json({
      target: "task",
      created: { id: task.id, title: task.title },
      clientAction: { tool: "open_app", payload: { appId: "tasks", title: "Tasks" } },
    });
  }

  if (target === "note") {
    const note = await prisma.note.create({
      data: {
        userId,
        title,
        content: classification.description ?? text,
      },
    });
    return c.json({
      target: "note",
      created: { id: note.id, title: note.title },
      clientAction: { tool: "open_app", payload: { appId: "notes", title: "Notes", noteId: note.id } },
    });
  }

  if (target === "flashcard" && classification.front && classification.back) {
    // Upsert a "Quick Capture" deck, add the card.
    let deck = await prisma.flashcardDeck.findFirst({
      where: { userId, name: "Quick Capture" },
    });
    if (!deck) {
      deck = await prisma.flashcardDeck.create({
        data: { userId, name: "Quick Capture", color: "#8b5cf6" },
      });
    }
    const card = await prisma.flashcard.create({
      data: {
        deckId: deck.id,
        front: classification.front.slice(0, 500),
        back: classification.back.slice(0, 500),
      },
    });
    return c.json({
      target: "flashcard",
      created: { id: card.id, deckId: deck.id, front: card.front },
      clientAction: { tool: "open_app", payload: { appId: "flashcards", title: "Flashcards", deckId: deck.id } },
    });
  }

  if (target === "study") {
    const studyMode = classification.studyMode ?? "summarize";
    return c.json({
      target: "study",
      created: null,
      clientAction: {
        tool: "open_study_hub",
        payload: { mode: studyMode, sourceKind: "paste", text },
      },
    });
  }

  // athena (or flashcard without front/back) → open Athena with the text prefilled.
  return c.json({
    target: "athena",
    created: null,
    clientAction: { tool: "open_athena", payload: { prompt: text } },
  });
});

export default capture;
