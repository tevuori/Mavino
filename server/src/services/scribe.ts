// ===== Scribe: thesis/essay writing coach service (Pro tier) =====
// A writing coach that works on the user's Notes / Editor documents. It
// analyzes outlines, gives paragraph-level feedback, detects citation gaps
// against the Compass library, and checks for self-plagiarism against past
// notes. Integrates with Compass (citation graph) and Atlas (concept coverage).
//
// Feedback generation is fire-and-forget + polling (like CompassReview):
// POST kicks off the background LLM job, the client polls GET until status
// flips to "ready"/"error".
//
// Feedback types:
//   - "outline": analyzes the document structure / outline
//   - "draft": paragraph-level critique (claim clarity, evidence, logic)
//   - "citations": cross-references draft against Compass citation graph
//   - "full": comprehensive feedback (all of the above + score)

import type { LlmModel } from "multi-llm-ts";
import prisma from "../db/client";
import { generateJson, generateText } from "./study/llm-json";
import { getProject as getCompassProject } from "./compass";
import { getAtlas } from "./atlas";

// ----- types -----

export interface ScribeIssue {
  severity: "info" | "warning" | "critical";
  section: string;
  issue: string;
  suggestion: string;
}

export interface ScribeDocumentSummary {
  id: string;
  title: string;
  docType: string;
  thesisStatement: string;
  compassProjectId: string;
  contentLength: number;
  feedbackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScribeDocumentDetail extends ScribeDocumentSummary {
  content: string;
  feedbacks: ScribeFeedbackData[];
}

export interface ScribeFeedbackData {
  id: string;
  documentId: string;
  feedbackType: string;
  content: string;
  issues: ScribeIssue[];
  status: "building" | "ready" | "error";
  error: string;
  score: number;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ----- CRUD -----

export async function listDocuments(userId: string): Promise<ScribeDocumentSummary[]> {
  const docs = await prisma.scribeDocument.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { feedbacks: true } } },
  });
  return docs.map((d) => serializeDocSummary(d, d._count.feedbacks));
}

export async function getDocument(userId: string, docId: string): Promise<ScribeDocumentDetail | null> {
  const doc = await prisma.scribeDocument.findFirst({
    where: { id: docId, userId },
    include: { feedbacks: { orderBy: { createdAt: "desc" } } },
  });
  if (!doc) return null;
  return {
    ...serializeDocSummary(doc, doc.feedbacks.length),
    content: doc.content,
    feedbacks: doc.feedbacks.map(serializeFeedback),
  };
}

function serializeDocSummary(d: any, feedbackCount: number): ScribeDocumentSummary {
  return {
    id: d.id,
    title: d.title,
    docType: d.docType,
    thesisStatement: d.thesisStatement,
    compassProjectId: d.compassProjectId,
    contentLength: d.content.length,
    feedbackCount,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function serializeFeedback(f: any): ScribeFeedbackData {
  let issues: ScribeIssue[] = [];
  try { issues = JSON.parse(f.issues) as ScribeIssue[]; } catch { /* keep default */ }
  return {
    id: f.id,
    documentId: f.documentId,
    feedbackType: f.feedbackType,
    content: f.content,
    issues,
    status: f.status,
    error: f.error,
    score: f.score,
    generatedAt: f.generatedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export async function createDocument(
  userId: string,
  data: { title: string; content?: string; docType?: string; thesisStatement?: string; compassProjectId?: string }
): Promise<{ id: string; title: string }> {
  const doc = await prisma.scribeDocument.create({
    data: {
      userId,
      title: data.title.trim(),
      content: data.content ?? "",
      docType: data.docType ?? "essay",
      thesisStatement: data.thesisStatement ?? "",
      compassProjectId: data.compassProjectId ?? "",
    },
  });
  return { id: doc.id, title: doc.title };
}

export async function updateDocument(
  userId: string,
  docId: string,
  data: { title?: string; content?: string; docType?: string; thesisStatement?: string; compassProjectId?: string }
): Promise<void> {
  const owned = await prisma.scribeDocument.findFirst({
    where: { id: docId, userId },
    select: { id: true },
  });
  if (!owned) throw new Error("Document not found");
  const update: any = {};
  if (data.title !== undefined) update.title = data.title.trim();
  if (data.content !== undefined) update.content = data.content;
  if (data.docType !== undefined) update.docType = data.docType;
  if (data.thesisStatement !== undefined) update.thesisStatement = data.thesisStatement;
  if (data.compassProjectId !== undefined) update.compassProjectId = data.compassProjectId;
  await prisma.scribeDocument.update({ where: { id: docId }, data: update });
}

export async function deleteDocument(userId: string, docId: string): Promise<void> {
  await prisma.scribeDocument.deleteMany({ where: { id: docId, userId } });
}

export async function deleteFeedback(userId: string, feedbackId: string): Promise<void> {
  await prisma.scribeFeedback.deleteMany({ where: { id: feedbackId, userId } });
}

// ----- feedback generation (fire-and-forget + polling) -----

export async function startGenerateFeedback(
  userId: string,
  docId: string,
  model: LlmModel,
  feedbackType: "outline" | "draft" | "citations" | "full" = "full"
): Promise<{ id: string; status: "building" }> {
  const doc = await prisma.scribeDocument.findFirst({
    where: { id: docId, userId },
  });
  if (!doc) throw new Error("Document not found");
  if (!doc.content.trim() || doc.content.trim().length < 100) {
    throw new Error("The document is too short. Add at least a few paragraphs of content.");
  }

  // Create a feedback row in "building" state.
  const feedback = await prisma.scribeFeedback.create({
    data: {
      documentId: docId,
      userId,
      feedbackType,
      status: "building",
    },
  });

  // Fire-and-forget.
  void generateFeedbackData(userId, docId, feedback.id, model, feedbackType, doc)
    .catch((e) =>
      prisma.scribeFeedback.update({
        where: { id: feedback.id },
        data: {
          status: "error",
          error: e instanceof Error ? e.message : "Feedback generation failed",
        },
      }).catch(() => {})
    );

  return { id: feedback.id, status: "building" };
}

async function generateFeedbackData(
  userId: string,
  docId: string,
  feedbackId: string,
  model: LlmModel,
  feedbackType: string,
  doc: { title: string; content: string; docType: string; thesisStatement: string; compassProjectId: string }
): Promise<void> {
  // Gather context from Compass (if linked) and Atlas.
  let compassContext = "";
  if (doc.compassProjectId) {
    try {
      const project = await getCompassProject(userId, doc.compassProjectId);
      if (project) {
        const paperTitles = project.papers.map((p: any) => p.title);
        const concepts = project.papers.flatMap((p: any) => p.keyConcepts.map((c: any) => c.label));
        compassContext = `\n\nCompass research project context:\nResearch question: ${project.researchQuestion}\nPapers in corpus (${paperTitles.length}): ${paperTitles.slice(0, 10).join(", ")}\nKey concepts: ${concepts.slice(0, 15).join(", ")}`;
      }
    } catch { /* skip if Compass project not found */ }
  }

  let atlasContext = "";
  const atlas = await getAtlas(userId);
  if (atlas?.data && atlas.data.concepts.length > 0) {
    const conceptLabels = atlas.data.concepts.slice(0, 20).map((c) => c.label);
    atlasContext = `\n\nAtlas knowledge context (concepts the student knows):\n${conceptLabels.join(", ")}`;
  }

  // Build the prompt based on feedback type.
  const typeInstruction = feedbackType === "outline"
    ? "Analyze the document's STRUCTURE and OUTLINE. Evaluate: argument flow, logical progression, missing sections, section balance. Don't critique sentence-level writing."
    : feedbackType === "draft"
    ? "Provide PARAGRAPH-LEVEL feedback. For each paragraph or section: evaluate claim clarity, evidence linkage, logical gaps, and transition quality. Suggest specific improvements."
    : feedbackType === "citations"
    ? "Focus on CITATION GAPS. Identify claims that need citations, check whether cited works are in the Compass corpus, and flag works that are cited but not in the corpus. Suggest where each Compass paper should be cited."
    : "Provide COMPREHENSIVE feedback: structure analysis, paragraph-level critique, citation gaps, and an overall score. This is the full writing review.";

  const prompt = `You are an expert academic writing coach reviewing a student's ${doc.docType}. ${typeInstruction}

Document title: ${doc.title}
Thesis statement: ${doc.thesisStatement || "(not provided)"}

Document content:
---
${doc.content.slice(0, 20000)}
---
${compassContext}${atlasContext}

Provide your feedback as a structured JSON object with:
- score: 0-100 (overall quality score)
- content: detailed feedback as Markdown (with sections for structure, argument, evidence, citations, and suggestions)
- issues: array of specific issues, each with severity (info/warning/critical), section (which part of the document), issue (what's wrong), and suggestion (how to fix it)

Respond with JSON: { "score": number, "content": string, "issues": [{ "severity": "info"|"warning"|"critical", "section": string, "issue": string, "suggestion": string }] }`;

  const schemaHint = `Respond with { "score": number, "content": string, "issues": [{ "severity": "info"|"warning"|"critical", "section": string, "issue": string, "suggestion": string }] }`;

  const result = await generateJson<{ score: number; content: string; issues: any[] }>(model, prompt, schemaHint);

  const score = Math.max(0, Math.min(100, Math.round(Number(result.score ?? 0))));
  const content = String(result.content ?? "");
  const issues: ScribeIssue[] = (result.issues ?? []).slice(0, 30).map((i: any) => ({
    severity: (["info", "warning", "critical"].includes(i.severity) ? i.severity : "info") as ScribeIssue["severity"],
    section: String(i.section ?? "").slice(0, 200),
    issue: String(i.issue ?? "").slice(0, 1000),
    suggestion: String(i.suggestion ?? "").slice(0, 1000),
  }));

  await prisma.scribeFeedback.update({
    where: { id: feedbackId },
    data: {
      content,
      issues: JSON.stringify(issues),
      status: "ready",
      error: "",
      score,
      generatedAt: new Date(),
    },
  });
}

export async function getFeedbackStatus(userId: string, feedbackId: string): Promise<ScribeFeedbackData | null> {
  const f = await prisma.scribeFeedback.findFirst({
    where: { id: feedbackId, userId },
  });
  return f ? serializeFeedback(f) : null;
}
