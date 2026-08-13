// ===== Scribe routes (Pro-tier thesis/essay writing coach) =====
// CRUD for documents + feedback; LLM feedback generation (fire-and-forget +
// polling); feedback status polling.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { isAppAvailableFor } from "../services/features";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../services/athena/llm";
import {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  deleteFeedback,
  startGenerateFeedback,
  getFeedbackStatus,
} from "../services/scribe";

const scribe = new Hono();
scribe.use("*", authMiddleware);

/** Middleware: 402 if the user can't access the Scribe app (Pro-only). */
async function scribeGate(c: any, next: any) {
  const { userId } = c.get("auth");
  if (!(await isAppAvailableFor(userId, "scribe"))) {
    return c.json({ error: "Scribe is a Pro feature. Upgrade to Pro to use the writing coach." }, 402);
  }
  await next();
}

scribe.use("*", scribeGate);

const createDocSchema = z.object({
  title: z.string().max(500),
  content: z.string().max(200000).optional(),
  docType: z.enum(["essay", "thesis", "report", "literature_review", "other"]).optional(),
  thesisStatement: z.string().max(5000).optional(),
  compassProjectId: z.string().max(200).optional(),
});

const updateDocSchema = z.object({
  title: z.string().max(500).optional(),
  content: z.string().max(200000).optional(),
  docType: z.enum(["essay", "thesis", "report", "literature_review", "other"]).optional(),
  thesisStatement: z.string().max(5000).optional(),
  compassProjectId: z.string().max(200).optional(),
});

const generateSchema = z.object({
  feedbackType: z.enum(["outline", "draft", "citations", "full"]).optional(),
});

/** GET /documents — list the user's documents. */
scribe.get("/documents", async (c) => {
  const { userId } = c.get("auth");
  const docs = await listDocuments(userId);
  return c.json({ documents: docs });
});

/** POST /documents — create a new document. */
scribe.post("/documents", zValidator("json", createDocSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  if (!body.title?.trim()) return c.json({ error: "Title is required." }, 400);
  const doc = await createDocument(userId, body);
  return c.json({ document: doc }, 201);
});

/** GET /documents/:id — get a document with feedbacks. */
scribe.get("/documents/:id", async (c) => {
  const { userId } = c.get("auth");
  const doc = await getDocument(userId, c.req.param("id"));
  if (!doc) return c.json({ error: "Document not found" }, 404);
  return c.json({ document: doc });
});

/** PATCH /documents/:id — update document content/metadata. */
scribe.patch("/documents/:id", zValidator("json", updateDocSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  try {
    await updateDocument(userId, c.req.param("id"), body);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Update failed" }, 400);
  }
});

/** DELETE /documents/:id — delete a document. */
scribe.delete("/documents/:id", async (c) => {
  const { userId } = c.get("auth");
  await deleteDocument(userId, c.req.param("id"));
  return c.json({ ok: true });
});

/** POST /documents/:id/feedback — kick off feedback generation (fire-and-forget). */
scribe.post("/documents/:id/feedback", zValidator("json", generateSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  }
  let model;
  try {
    ({ model } = await acquireLlmModel(userId));
  } catch (e) {
    if (e instanceof LlmError) return c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500);
    return c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500);
  }
  try {
    const result = await startGenerateFeedback(userId, c.req.param("id"), model, body.feedbackType ?? "full");
    return c.json(result, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Generation failed" }, 400);
  }
});

/** GET /feedback/:id — poll feedback status. */
scribe.get("/feedback/:id", async (c) => {
  const { userId } = c.get("auth");
  const feedback = await getFeedbackStatus(userId, c.req.param("id"));
  if (!feedback) return c.json({ error: "Feedback not found" }, 404);
  return c.json({ feedback });
});

/** DELETE /feedback/:id — delete a feedback. */
scribe.delete("/feedback/:id", async (c) => {
  const { userId } = c.get("auth");
  await deleteFeedback(userId, c.req.param("id"));
  return c.json({ ok: true });
});

export default scribe;
