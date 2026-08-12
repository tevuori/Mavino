// ===== Athena tools: Compass (Pro-tier research & literature review) =====
// Lets Athena query the user's research projects — list projects, get a
// project with its paper corpus, search for related work, view the citation
// graph, analyze reading gaps, generate a literature review draft, and
// open the Compass app.

import type { ToolDef } from "./plugin";
import {
  listProjects,
  getProject,
  searchRelatedWork,
  analyzeReadingGaps,
  getReviewStatus,
} from "../../compass";

export const compassTools: ToolDef[] = [
  {
    name: "compass_list_projects",
    description:
      "List the user's Compass research projects — each with id, title, research question, and paper count. Use this when the user asks about their research projects or literature reviews.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const projects = await listProjects(userId);
      if (projects.length === 0) {
        return { count: 0, projects: [], note: "No research projects yet. The user can create one in the Compass app." };
      }
      return {
        count: projects.length,
        projects: projects.map((p: { id: string; title: string; researchQuestion: string; paperCount: number }) => ({
          id: p.id,
          title: p.title,
          researchQuestion: p.researchQuestion,
          paperCount: p.paperCount,
        })),
      };
    },
  },
  {
    name: "compass_get_project",
    description:
      "Get a specific Compass research project by id — returns the full project with all papers (title, authors, year, status, key concepts), the citation graph (which paper cites which), and the literature review draft status. Use this after compass_list_projects when the user asks about a specific project.",
    proOnly: true,
    parameters: [
      { name: "projectId", type: "string", description: "The project id (from compass_list_projects)", required: true },
    ],
    handler: async (args, { userId }) => {
      const projectId = String(args.projectId ?? "").trim();
      if (!projectId) return { error: "projectId is required" };
      const project = await getProject(userId, projectId);
      if (!project) return { error: "Project not found" };
      return {
        id: project.id,
        title: project.title,
        researchQuestion: project.researchQuestion,
        paperCount: project.papers.length,
        papers: project.papers.map((p: any) => ({
          id: p.id,
          title: p.title,
          authors: p.authors,
          year: p.year,
          status: p.status,
          extracted: p.extracted,
          keyConcepts: p.keyConcepts.slice(0, 5).map((c: any) => c.label),
        })),
        citationCount: project.citations.length,
        reviewStatus: project.review?.status ?? "empty",
        reviewGeneratedAt: project.review?.generatedAt ?? null,
        // Include the FULL review content when ready so the model can answer
        // questions about it without a separate compass_draft_review call.
        reviewContent: project.review?.status === "ready" ? project.review.content : "",
      };
    },
  },
  {
    name: "compass_search",
    description:
      "Search for related academic work for a Compass research project. Uses the project's research question and key concepts to enrich the query. Returns web search results (title, URL, description) with a flag indicating whether each result is already in the corpus. Use this when the user asks to find related work, discover new papers, or expand their literature review.",
    proOnly: true,
    parameters: [
      { name: "projectId", type: "string", description: "The project id", required: true },
      { name: "query", type: "string", description: "Search query (what kind of related work to find)", required: true },
    ],
    handler: async (args, { userId }) => {
      const projectId = String(args.projectId ?? "").trim();
      const query = String(args.query ?? "").trim();
      if (!projectId) return { error: "projectId is required" };
      if (!query) return { error: "query is required" };
      try {
        const results = await searchRelatedWork(userId, projectId, query);
        return {
          query: results.query,
          resultCount: results.results.length,
          results: results.results.slice(0, 8),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Search failed" };
      }
    },
  },
  {
    name: "compass_citation_graph",
    description:
      "Get the citation graph for a Compass research project — which papers cite which (including cited works not yet in the corpus). Use this when the user asks about citation patterns, foundational works, or how papers in their corpus relate to each other.",
    proOnly: true,
    parameters: [
      { name: "projectId", type: "string", description: "The project id", required: true },
    ],
    handler: async (args, { userId }) => {
      const projectId = String(args.projectId ?? "").trim();
      if (!projectId) return { error: "projectId is required" };
      const project = await getProject(userId, projectId);
      if (!project) return { error: "Project not found" };
      const paperTitles = new Map(project.papers.map((p: any) => [p.id, p.title]));
      return {
        edgeCount: project.citations.length,
        edges: project.citations.map((c: any) => ({
          source: paperTitles.get(c.sourcePaperId) ?? "Unknown",
          target: c.targetPaperId ? (paperTitles.get(c.targetPaperId) ?? c.targetTitle) : c.targetTitle,
          inCorpus: Boolean(c.targetPaperId),
          context: c.context.slice(0, 200),
        })),
      };
    },
  },
  {
    name: "compass_reading_gaps",
    description:
      "Analyze reading gaps in a Compass research project's corpus — identifies recency gaps (too many old papers), coverage gaps (papers not yet analyzed), and citation balance issues (frequently-cited works not in the corpus). Use this when the user asks what's missing from their literature review or what they should read next.",
    proOnly: true,
    parameters: [
      { name: "projectId", type: "string", description: "The project id", required: true },
    ],
    handler: async (args, { userId }) => {
      const projectId = String(args.projectId ?? "").trim();
      if (!projectId) return { error: "projectId is required" };
      try {
        const gaps = await analyzeReadingGaps(userId, projectId);
        return gaps;
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Analysis failed" };
      }
    },
  },
  {
    name: "compass_draft_review",
    description:
      "Check the status of a Compass project's literature review draft — whether it's generated, building, or empty — and return the FULL Markdown content when ready. The actual generation is triggered from the Compass app UI (POST /api/compass/projects/:id/review/generate) since it's a fire-and-forget background job. Use this to check if the review is ready, to read its content, and to answer the user's questions about the review (e.g. 'what does my lit review say about X?', 'summarize my literature review', 'what gaps did it identify?'). The full Markdown is returned so you can quote, summarize, or reason about it.",
    proOnly: true,
    parameters: [
      { name: "projectId", type: "string", description: "The project id", required: true },
    ],
    handler: async (args, { userId }) => {
      const projectId = String(args.projectId ?? "").trim();
      if (!projectId) return { error: "projectId is required" };
      const review = await getReviewStatus(userId, projectId);
      if (!review) return { status: "empty", content: "" };
      return {
        status: review.status,
        error: review.error,
        generatedAt: review.generatedAt,
        contentLength: review.content.length,
        // Return the FULL content so the model can answer questions about it.
        // The review is typically 800-2000 words — well within tool-result
        // budgets. If it's unusually large, the model can still summarize it.
        content: review.status === "ready" ? review.content : "",
      };
    },
  },
  {
    name: "open_compass",
    description:
      "Open the Compass app on the user's desktop, optionally focused on a specific project. Use after answering a research-related question so the user can explore their project visually.",
    clientAction: true,
    proOnly: true,
    parameters: [
      { name: "projectId", type: "string", description: "Optional project id to focus on (from compass_list_projects)" },
    ],
    handler: async (args) => ({ action: "open_compass", projectId: args.projectId ? String(args.projectId) : undefined }),
  },
];
