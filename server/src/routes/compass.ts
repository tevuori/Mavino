// ===== Compass routes (Pro-tier research & literature review assistant) =====
// CRUD for research projects, papers, citation edges; LLM extraction
// (fire-and-forget + polling); related-work search; reading-gap analysis;
// literature review draft generation (fire-and-forget + polling).
//
// Tier gating: Compass is a Pro-tier app. The middleware returns 402 for
// users below Pro (the client shows a paywall preview instead).

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { isAppAvailableFor } from "../services/features";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../services/athena/llm";
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addPaper,
  updatePaper,
  deletePaper,
  startPaperExtraction,
  searchRelatedWork,
  analyzeReadingGaps,
  getReviewStatus,
  startGenerateReview,
  updateReviewContent,
} from "../services/compass";

const compass = new Hono();
compass.use("*", authMiddleware);

/** Middleware: 402 if the user can't access the Compass app (Pro-only). */
async function compassGate(c: any, next: any) {
  const { userId } = c.get("auth");
  if (!(await isAppAvailableFor(userId, "compass"))) {
    return c.json({ error: "Compass is a Pro feature. Upgrade to Pro to use the research & literature review assistant." }, 402);
  }
  await next();
}

compass.use("*", compassGate);

// ----- projects -----

/** GET /projects — list the user's research projects. */
compass.get("/projects", async (c) => {
  const { userId } = c.get("auth");
  const projects = await listProjects(userId);
  return c.json({ projects });
});

/** POST /projects — create a new research project. */
compass.post("/projects", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json().catch(() => ({})) as { title?: string; researchQuestion?: string };
  if (!body.title?.trim()) return c.json({ error: "Project title is required." }, 400);
  const project = await createProject(userId, { title: body.title, researchQuestion: body.researchQuestion });
  return c.json({ project }, 201);
});

/** GET /projects/:id — get a project with papers, citations, and review. */
compass.get("/projects/:id", async (c) => {
  const { userId } = c.get("auth");
  const project = await getProject(userId, c.req.param("id"));
  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json({ project });
});

/** PATCH /projects/:id — update project metadata. */
compass.patch("/projects/:id", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json().catch(() => ({})) as { title?: string; researchQuestion?: string; notes?: string };
  try {
    const project = await updateProject(userId, c.req.param("id"), body);
    return c.json({ project });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Update failed" }, 400);
  }
});

/** DELETE /projects/:id — delete a project and all its papers/citations/review. */
compass.delete("/projects/:id", async (c) => {
  const { userId } = c.get("auth");
  await deleteProject(userId, c.req.param("id"));
  return c.json({ ok: true });
});

// ----- papers -----

/** POST /projects/:id/papers — add a paper to a project. */
compass.post("/projects/:id/papers", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json().catch(() => ({})) as {
    sourceType?: "file" | "url" | "manual";
    fileId?: string;
    url?: string;
    title?: string;
    authors?: string[];
    year?: number;
    venue?: string;
    doi?: string;
  };
  if (!body.sourceType || !["file", "url", "manual"].includes(body.sourceType)) {
    return c.json({ error: "sourceType must be 'file', 'url', or 'manual'." }, 400);
  }
  if (body.sourceType === "file" && !body.fileId) {
    return c.json({ error: "fileId is required for sourceType 'file'." }, 400);
  }
  if (body.sourceType === "url" && !body.url?.trim()) {
    return c.json({ error: "url is required for sourceType 'url'." }, 400);
  }
  if (body.sourceType === "manual" && !body.title?.trim()) {
    return c.json({ error: "title is required for sourceType 'manual'." }, 400);
  }
  try {
    const paper = await addPaper(userId, c.req.param("id"), {
      sourceType: body.sourceType as "file" | "url" | "manual",
      fileId: body.fileId,
      url: body.url,
      title: body.title,
      authors: body.authors,
      year: body.year,
      venue: body.venue,
      doi: body.doi,
    });
    return c.json({ paper }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to add paper" }, 400);
  }
});

/** PATCH /projects/:id/papers/:paperId — update paper metadata/status/annotations. */
compass.patch("/projects/:id/papers/:paperId", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json().catch(() => ({}));
  try {
    const paper = await updatePaper(userId, c.req.param("paperId"), body);
    return c.json({ paper });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Update failed" }, 400);
  }
});

/** DELETE /projects/:id/papers/:paperId — remove a paper from the project. */
compass.delete("/projects/:id/papers/:paperId", async (c) => {
  const { userId } = c.get("auth");
  try {
    await deletePaper(userId, c.req.param("paperId"));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Delete failed" }, 400);
  }
});

// ----- LLM extraction (fire-and-forget + polling) -----

/** POST /projects/:id/papers/:paperId/extract — kick off LLM extraction. */
compass.post("/projects/:id/papers/:paperId/extract", async (c) => {
  const { userId } = c.get("auth");
  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  }
  let model;
  try {
    ({ model } = await acquireLlmModel(userId));
  } catch (e) {
    if (e instanceof LlmError) {
      return c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500);
    }
    return c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500);
  }
  try {
    const result = await startPaperExtraction(userId, c.req.param("paperId"), model);
    return c.json(result, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Extraction failed" }, 400);
  }
});

// ----- related-work search -----

/** POST /projects/:id/search — search for related work. */
compass.post("/projects/:id/search", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json().catch(() => ({})) as { query?: string };
  if (!body.query?.trim()) return c.json({ error: "query is required" }, 400);
  try {
    const results = await searchRelatedWork(userId, c.req.param("id"), body.query);
    return c.json(results);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Search failed" }, 400);
  }
});

// ----- reading-gap analysis -----

/** GET /projects/:id/gaps — analyze reading gaps in the corpus. */
compass.get("/projects/:id/gaps", async (c) => {
  const { userId } = c.get("auth");
  try {
    const gaps = await analyzeReadingGaps(userId, c.req.param("id"));
    return c.json(gaps);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Analysis failed" }, 400);
  }
});

// ----- literature review draft (fire-and-forget + polling) -----

/** GET /projects/:id/review — get review status + content. */
compass.get("/projects/:id/review", async (c) => {
  const { userId } = c.get("auth");
  const review = await getReviewStatus(userId, c.req.param("id"));
  if (!review) return c.json({ status: "empty", content: "", error: "" });
  return c.json(review);
});

/** POST /projects/:id/review/generate — kick off review generation. */
compass.post("/projects/:id/review/generate", async (c) => {
  const { userId } = c.get("auth");
  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400);
  }
  let model;
  try {
    ({ model } = await acquireLlmModel(userId));
  } catch (e) {
    if (e instanceof LlmError) {
      return c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500);
    }
    return c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500);
  }
  try {
    const result = await startGenerateReview(userId, c.req.param("id"), model);
    return c.json(result, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Generation failed" }, 400);
  }
});

/** PATCH /projects/:id/review — manually edit the review content. */
compass.patch("/projects/:id/review", async (c) => {
  const { userId } = c.get("auth");
  const body = await c.req.json().catch(() => ({})) as { content?: string };
  if (body.content === undefined) return c.json({ error: "content is required" }, 400);
  try {
    const review = await updateReviewContent(userId, c.req.param("id"), body.content);
    return c.json({ review });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Update failed" }, 400);
  }
});

export default compass;
