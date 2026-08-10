// ===== Study Hub: Knowledge Graph routes =====
// Build, list, fetch, refresh, and delete persisted ConceptGraphs — a
// structured (concepts + relationships, all cited) representation of a
// source-set that Flashcards/Quiz/Summarize/Explain/Study Guide derive from.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { studyFunctionMiddleware } from "../middleware/study-functions";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../services/athena/llm";
import { resolveAndCache, type SourceDescriptor } from "../services/study/source";
import { startBuildGraph, getGraphStatus } from "../services/study/graph";

const graphRoutes = new Hono();
graphRoutes.use("*", authMiddleware, studyFunctionMiddleware("graph"));

const sourceSchema = z.object({
  kind: z.enum(["note", "file", "paste", "moodle", "url"]),
  id: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
});

const languageSchema = z.enum(["en", "cs"]).optional().default("en");

async function loadModel(c: any, userId: string) {
  const configured = await isLlmConfiguredFor(userId);
  if (!configured) {
    return {
      error: c.json({ error: "No AI provider configured. Add an API key in Settings → AI." }, 400),
    } as const;
  }
  try {
    const { model } = await acquireLlmModel(userId);
    return { model } as const;
  } catch (e) {
    if (e instanceof LlmError) {
      return { error: c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500) } as const;
    }
    return { error: c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500) } as const;
  }
}

function serializeSummary(row: { id: string; name: string; sourceIds: string; data: string; createdAt: Date; updatedAt: Date }) {
  let conceptCount = 0;
  let relationshipCount = 0;
  try {
    const data = JSON.parse(row.data);
    conceptCount = Array.isArray(data.concepts) ? data.concepts.length : 0;
    relationshipCount = Array.isArray(data.relationships) ? data.relationships.length : 0;
  } catch {
    // ignore malformed rows
  }
  return {
    id: row.id,
    name: row.name,
    sourceCount: (() => {
      try {
        return (JSON.parse(row.sourceIds) as string[]).length;
      } catch {
        return 0;
      }
    })(),
    conceptCount,
    relationshipCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** POST / — build (or reuse the cached) graph for a set of sources. */
const buildSchema = z.object({
  source: sourceSchema.optional(),
  sources: z.array(sourceSchema).max(20).optional(),
  forceRefresh: z.boolean().optional().default(false),
  language: languageSchema,
});

// Kicks off the (potentially minutes-long) LLM extraction pass in the
// background and returns immediately with `status: "building"` — the
// client polls GET /:id until it flips to "ready"/"error". This keeps the
// request itself fast regardless of source size or model speed, so it
// isn't killed by intermediate proxy/edge timeouts (e.g. Cloudflare
// defaults to ~100s for proxied requests, well under worst-case extraction
// time on a slow/free model).
graphRoutes.post("/", zValidator("json", buildSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  const list = body.sources && body.sources.length > 0 ? body.sources : body.source ? [body.source] : [];
  if (list.length === 0) return c.json({ error: "No source provided" }, 400);

  let cachedSources;
  try {
    cachedSources = await Promise.all(list.map((s) => resolveAndCache(userId, s as SourceDescriptor)));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Source error" }, 400);
  }

  try {
    const graph = await startBuildGraph(userId, loaded.model, cachedSources, {
      forceRefresh: body.forceRefresh,
      lang: body.language,
    });
    return c.json({
      graphId: graph.id,
      name: graph.name,
      status: graph.status,
      data: graph.data,
      cached: graph.cached,
    }, graph.status === "ready" ? 200 : 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Graph generation failed" }, 502);
  }
});

/** GET / — list the user's graphs (summary only, no full data). */
graphRoutes.get("/", async (c) => {
  const { userId } = c.get("auth");
  const rows = await prisma.conceptGraph.findMany({
    where: { userId, status: "ready" },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return c.json({ graphs: rows.map(serializeSummary) });
});

/** GET /:id — graph status + data (if ready). Also used to poll an
 *  in-progress build/refresh kicked off by POST / or POST /:id/refresh. */
graphRoutes.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const graph = await getGraphStatus(userId, c.req.param("id"));
  if (!graph) return c.json({ error: "Graph not found" }, 404);
  return c.json({
    graphId: graph.id,
    name: graph.name,
    status: graph.status,
    error: graph.error,
    data: graph.data,
    updatedAt: graph.updatedAt.toISOString(),
  });
});

/** POST /:id/refresh — re-resolve the same sources and force-rebuild the
 *  graph in the background (same fire-and-forget + polling pattern as
 *  POST /). */
graphRoutes.post("/:id/refresh", zValidator("json", z.object({ language: languageSchema })), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const row = await prisma.conceptGraph.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Graph not found" }, 404);

  const loaded = await loadModel(c, userId);
  if ("error" in loaded) return loaded.error;

  const sourceIds = JSON.parse(row.sourceIds) as string[];
  const studySources = await prisma.studySource.findMany({ where: { id: { in: sourceIds }, userId } });
  if (studySources.length === 0) return c.json({ error: "Underlying sources no longer exist" }, 400);

  try {
    const graph = await startBuildGraph(userId, loaded.model, studySources, { forceRefresh: true, lang: body.language });
    return c.json({
      graphId: graph.id,
      name: graph.name,
      status: graph.status,
      data: graph.data,
      cached: false,
    }, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Graph generation failed" }, 502);
  }
});

/** DELETE /:id */
graphRoutes.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const row = await prisma.conceptGraph.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!row) return c.json({ error: "Graph not found" }, 404);
  await prisma.conceptGraph.delete({ where: { id: row.id } });
  return c.json({ ok: true });
});

export default graphRoutes;
