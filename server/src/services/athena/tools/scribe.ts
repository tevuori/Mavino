// ===== Athena tools: Scribe (Pro-tier thesis/essay writing coach) =====
// Lets Athena list documents, get document content + feedback, generate
// feedback, and open the Scribe app. Integrates with Compass (citation
// gap detection) and Atlas (concept coverage).

import type { ToolDef } from "./plugin";
import {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  startGenerateFeedback,
  getFeedbackStatus,
} from "../../scribe";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../llm";

export const scribeTools: ToolDef[] = [
  {
    name: "scribe_list_documents",
    description:
      "List the user's Scribe documents — drafts they're working on for essays, theses, reports, or literature reviews. Each has id, title, doc type, thesis statement, content length, and feedback count. Use this when the user asks about their writing projects.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const docs = await listDocuments(userId);
      if (docs.length === 0) {
        return { count: 0, documents: [], note: "No documents yet. The user can create one in the Scribe app or you can use scribe_create_document." };
      }
      return {
        count: docs.length,
        documents: docs.map((d) => ({
          id: d.id,
          title: d.title,
          docType: d.docType,
          thesisStatement: d.thesisStatement.slice(0, 200),
          contentLength: d.contentLength,
          feedbackCount: d.feedbackCount,
        })),
      };
    },
  },
  {
    name: "scribe_get_document",
    description:
      "Get a specific Scribe document by id — returns the full content + all feedback passes (with issues, scores, and Markdown feedback content). Use this after scribe_list_documents when the user asks about a specific document or wants to review feedback.",
    proOnly: true,
    parameters: [
      { name: "documentId", type: "string", description: "The document id (from scribe_list_documents)", required: true },
    ],
    handler: async (args, { userId }) => {
      const docId = String(args.documentId ?? "").trim();
      if (!docId) return { error: "documentId is required" };
      const doc = await getDocument(userId, docId);
      if (!doc) return { error: "Document not found" };
      return {
        id: doc.id,
        title: doc.title,
        docType: doc.docType,
        thesisStatement: doc.thesisStatement,
        contentLength: doc.content.length,
        content: doc.content.slice(0, 5000),
        feedbackCount: doc.feedbacks.length,
        feedbacks: doc.feedbacks.map((f) => ({
          id: f.id,
          feedbackType: f.feedbackType,
          status: f.status,
          score: f.score,
          issueCount: f.issues.length,
          content: f.status === "ready" ? f.content.slice(0, 2000) : "",
          issues: f.status === "ready" ? f.issues.slice(0, 10) : [],
        })),
      };
    },
  },
  {
    name: "scribe_create_document",
    description:
      "Create a new Scribe document for the user's essay, thesis, report, or literature review. Optionally link it to a Compass research project for citation gap detection. Use this when the user wants to start a new writing project or when they ask you to create a draft.",
    proOnly: true,
    destructive: true,
    parameters: [
      { name: "title", type: "string", description: "Document title", required: true },
      { name: "content", type: "string", description: "Initial content (Markdown)" },
      { name: "docType", type: "string", description: "Document type: 'essay', 'thesis', 'report', 'literature_review', or 'other'" },
      { name: "thesisStatement", type: "string", description: "The thesis statement or research question" },
      { name: "compassProjectId", type: "string", description: "Optional Compass project id for citation gap detection" },
    ],
    handler: async (args, { userId }) => {
      const title = String(args.title ?? "").trim();
      if (!title) return { error: "title is required" };
      try {
        const doc = await createDocument(userId, {
          title,
          content: args.content ? String(args.content) : undefined,
          docType: args.docType as any,
          thesisStatement: args.thesisStatement ? String(args.thesisStatement) : undefined,
          compassProjectId: args.compassProjectId ? String(args.compassProjectId) : undefined,
        });
        return { ...doc, message: `Created document "${title}". Use scribe_generate_feedback to get writing coaching, or open_scribe to let the user start writing.` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Creation failed" };
      }
    },
  },
  {
    name: "scribe_update_document",
    description:
      "Update a Scribe document's content or metadata. Use this when the user asks to modify their draft, add a thesis statement, or link a Compass project.",
    proOnly: true,
    destructive: true,
    parameters: [
      { name: "documentId", type: "string", description: "The document id", required: true },
      { name: "title", type: "string", description: "New title" },
      { name: "content", type: "string", description: "New content (Markdown)" },
      { name: "docType", type: "string", description: "Document type: 'essay', 'thesis', 'report', 'literature_review', or 'other'" },
      { name: "thesisStatement", type: "string", description: "Thesis statement or research question" },
      { name: "compassProjectId", type: "string", description: "Compass project id for citation gap detection" },
    ],
    handler: async (args, { userId }) => {
      const docId = String(args.documentId ?? "").trim();
      if (!docId) return { error: "documentId is required" };
      try {
        const update: any = {};
        if (args.title !== undefined) update.title = String(args.title);
        if (args.content !== undefined) update.content = String(args.content);
        if (args.docType !== undefined) update.docType = String(args.docType);
        if (args.thesisStatement !== undefined) update.thesisStatement = String(args.thesisStatement);
        if (args.compassProjectId !== undefined) update.compassProjectId = String(args.compassProjectId);
        await updateDocument(userId, docId, update);
        return { ok: true };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Update failed" };
      }
    },
  },
  {
    name: "scribe_generate_feedback",
    description:
      "Generate AI writing feedback for a Scribe document. Feedback types: 'outline' (structure analysis), 'draft' (paragraph-level critique), 'citations' (citation gap detection against Compass), 'full' (comprehensive review with score). The generation is fire-and-forget — returns immediately with status 'building'. Use scribe_get_feedback to poll until it's ready. Use this when the user asks for feedback on their writing, wants to improve their essay, or asks 'what's wrong with my draft?'.",
    proOnly: true,
    destructive: true,
    parameters: [
      { name: "documentId", type: "string", description: "The document id", required: true },
      { name: "feedbackType", type: "string", description: "Feedback type: 'outline', 'draft', 'citations', or 'full' (default)" },
    ],
    handler: async (args, { userId }) => {
      const docId = String(args.documentId ?? "").trim();
      if (!docId) return { error: "documentId is required" };
      const configured = await isLlmConfiguredFor(userId);
      if (!configured) return { error: "No AI provider configured. Add an API key in Settings → AI." };
      let model;
      try {
        ({ model } = await acquireLlmModel(userId));
      } catch (e) {
        if (e instanceof LlmError) return { error: e.message };
        return { error: e instanceof Error ? e.message : "LLM error" };
      }
      try {
        const result = await startGenerateFeedback(userId, docId, model, (args.feedbackType as any) ?? "full");
        return { ...result, message: "Feedback generation started. Use scribe_get_feedback to check when it's ready, or open_scribe to let the user see it in the app." };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Generation failed" };
      }
    },
  },
  {
    name: "scribe_get_feedback",
    description:
      "Check the status of a Scribe feedback generation and return the full feedback content when ready. Use this after scribe_generate_feedback to poll for completion. Returns status ('building', 'ready', 'error'), score (0-100), issues, and the full Markdown feedback content when ready.",
    proOnly: true,
    parameters: [
      { name: "feedbackId", type: "string", description: "The feedback id (from scribe_generate_feedback response or scribe_get_document)", required: true },
    ],
    handler: async (args, { userId }) => {
      const feedbackId = String(args.feedbackId ?? "").trim();
      if (!feedbackId) return { error: "feedbackId is required" };
      const feedback = await getFeedbackStatus(userId, feedbackId);
      if (!feedback) return { error: "Feedback not found" };
      return {
        id: feedback.id,
        status: feedback.status,
        error: feedback.error,
        score: feedback.score,
        feedbackType: feedback.feedbackType,
        content: feedback.status === "ready" ? feedback.content : "",
        issues: feedback.status === "ready" ? feedback.issues : [],
        generatedAt: feedback.generatedAt,
      };
    },
  },
  {
    name: "open_scribe",
    description:
      "Open the Scribe app on the user's desktop, optionally focused on a specific document. Use after generating feedback or when the user asks to work on their writing.",
    clientAction: true,
    proOnly: true,
    parameters: [
      { name: "documentId", type: "string", description: "Optional document id to focus on" },
    ],
    handler: async (args) => ({ action: "open_scribe", documentId: args.documentId ? String(args.documentId) : undefined }),
  },
];
