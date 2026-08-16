// ===== Study Hub: source library routes =====
// Persistent StudySource entities (note/file/pdf/paste/url with cached
// extracted text) that grounded Q&A, podcasts, and cited study materials
// reference. Mounted at /api/study/sources.

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddleware } from "../middleware/auth";
import {
  resolveSource,
  resolveAndCache,
  type SourceDescriptor,
  type SourceKind,
} from "../services/study/source";
import { cleanupOrphanLinks } from "../db/links";

const sources = new Hono();
sources.use("*", authMiddleware);

const sourceSchema = z.object({
  kind: z.enum(["note", "file", "paste", "url"]),
  id: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
});

function serialize(s: any) {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    refId: s.refId,
    truncated: s.truncated,
    charCount: s.charCount,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** GET / — list the user's saved sources (no textCache to keep payloads small). */
sources.get("/", async (c) => {
  const { userId } = c.get("auth");
  const rows = await prisma.studySource.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return c.json({ sources: rows.map(serialize) });
});

/** POST / — resolve + cache a new source (or refresh an existing one by kind+refId). */
sources.post("/", zValidator("json", sourceSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  try {
    const cached = await resolveAndCache(userId, body as SourceDescriptor);
    return c.json({ source: cached }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Source error" }, 400);
  }
});

/** GET /:id — full source incl. textCache (for Q&A injection / display). */
sources.get("/:id", async (c) => {
  const { userId } = c.get("auth");
  const s = await prisma.studySource.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!s) return c.json({ error: "Source not found" }, 404);
  return c.json({
    ...serialize(s),
    textCache: s.textCache,
  });
});

/** DELETE /:id — remove a source and its links. */
sources.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const s = await prisma.studySource.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!s) return c.json({ error: "Source not found" }, 404);
  await prisma.studySource.delete({ where: { id: s.id } });
  await cleanupOrphanLinks(userId, "studySource", s.id);
  return c.json({ ok: true });
});

/** POST /:id/refresh — re-extract text from the underlying note/file/url. */
sources.post("/:id/refresh", async (c) => {
  const { userId } = c.get("auth");
  const s = await prisma.studySource.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!s) return c.json({ error: "Source not found" }, 404);
  // Rebuild a descriptor from the stored kind/refId. Paste sources can't be
  // refreshed (the text isn't stored separately) — return the cached copy.
  if (s.kind === "paste") {
    return c.json({ source: { ...serialize(s), textCache: s.textCache } });
  }
  const descriptor: SourceDescriptor = {
    kind: s.kind as SourceKind,
    id: s.kind === "note" || s.kind === "file" ? s.refId : undefined,
    url: s.kind === "url" ? s.refId : undefined,
    name: s.name,
  };
  try {
    const cached = await resolveAndCache(userId, descriptor);
    return c.json({ source: cached });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Refresh failed" }, 400);
  }
});

/** POST /bulk — resolve + cache several sources at once (used when starting a
 *  grounded chat / podcast from on-the-fly source picks). */
sources.post("/bulk", zValidator("json", z.object({ sources: z.array(sourceSchema).max(10) })), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const out: any[] = [];
  for (const src of body.sources) {
    try {
      out.push(await resolveAndCache(userId, src as SourceDescriptor));
    } catch (e) {
      out.push({
        error: e instanceof Error ? e.message : "Source error",
        kind: src.kind,
        refId: src.id ?? src.url ?? "paste",
      });
    }
  }
  return c.json({ sources: out });
});

export default sources;
