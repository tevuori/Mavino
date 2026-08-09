// ===== Concept graph (knowledge graph) service =====
// Builds a persisted, structured representation of a fixed set of
// StudySources — concepts (with definitions/facts) and typed relationships
// between them, each citing the source(s) it was drawn from — via a single
// LLM extraction pass. Cached per unique (userId, sorted source ids) so
// repeated feature requests (flashcards, quiz, summary, explain, study
// guide) on the same sources reuse the same graph instead of re-reading and
// re-analyzing the raw source text every time.

import type { LlmModel } from "multi-llm-ts";
import prisma from "../../db/client";
import { generateJson } from "./llm-json";
import { conceptGraphPrompt, conceptGraphSchemaHint, type StudyLanguage } from "./prompts";

export interface GraphSourceRef {
  index: number;
  studySourceId: string;
  name: string;
  kind: string;
  refId: string;
}

export interface ConceptFact {
  text: string;
  sourceIndexes: number[];
}

export interface ConceptNode {
  id: string;
  label: string;
  type: string;
  definition: string;
  importance: number;
  facts: ConceptFact[];
  sourceIndexes: number[];
}

export interface ConceptEdge {
  from: string;
  to: string;
  relation: string;
  sourceIndexes: number[];
}

export interface ConceptGraphData {
  summary: string;
  sources: GraphSourceRef[];
  concepts: ConceptNode[];
  relationships: ConceptEdge[];
}

export interface CachedStudySource {
  id: string;
  name: string;
  kind: string;
  refId: string;
  textCache: string;
}

function slugify(s: string, fallback: string): string {
  const slug = String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function toNumArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

/** Validate + sanitize the raw LLM output into a well-formed ConceptGraphData. */
function sanitizeGraph(raw: any, sources: GraphSourceRef[]): ConceptGraphData {
  const validIndexes = new Set(sources.map((s) => s.index));
  const clampIndexes = (arr: number[]) => arr.filter((n) => validIndexes.has(n));

  const seenIds = new Set<string>();
  const concepts: ConceptNode[] = (Array.isArray(raw?.concepts) ? raw.concepts : [])
    .map((c: any, i: number): ConceptNode | null => {
      const label = String(c?.label ?? "").trim();
      if (!label) return null;
      let id = slugify(c?.id ?? label, `concept-${i + 1}`);
      while (seenIds.has(id)) id = `${id}-${i + 1}`;
      seenIds.add(id);
      const facts: ConceptFact[] = (Array.isArray(c?.facts) ? c.facts : [])
        .map((f: any) => ({
          text: String(f?.text ?? "").trim(),
          sourceIndexes: clampIndexes(toNumArray(f?.sourceIndexes)),
        }))
        .filter((f: ConceptFact) => f.text.length > 0);
      const importance = Math.min(5, Math.max(1, Math.round(Number(c?.importance) || 3)));
      return {
        id,
        label,
        type: String(c?.type ?? "concept").trim() || "concept",
        definition: String(c?.definition ?? "").trim(),
        importance,
        facts,
        sourceIndexes: clampIndexes(toNumArray(c?.sourceIndexes)),
      };
    })
    .filter((c: ConceptNode | null): c is ConceptNode => c !== null);

  const conceptIds = new Set(concepts.map((c) => c.id));
  const relationships: ConceptEdge[] = (Array.isArray(raw?.relationships) ? raw.relationships : [])
    .map((r: any): ConceptEdge | null => {
      const from = slugify(r?.from ?? "", "");
      const to = slugify(r?.to ?? "", "");
      const relation = String(r?.relation ?? "").trim();
      if (!from || !to || !relation || from === to) return null;
      if (!conceptIds.has(from) || !conceptIds.has(to)) return null;
      return { from, to, relation, sourceIndexes: clampIndexes(toNumArray(r?.sourceIndexes)) };
    })
    .filter((r: ConceptEdge | null): r is ConceptEdge => r !== null);

  return {
    summary: String(raw?.summary ?? "").trim(),
    sources,
    concepts,
    relationships,
  };
}

/** Run the LLM extraction pass over the given (already resolved) source texts. */
export async function buildConceptGraphData(
  model: LlmModel,
  sources: GraphSourceRef[],
  texts: Record<number, string>,
  lang?: StudyLanguage
): Promise<ConceptGraphData> {
  if (sources.length === 0) throw new Error("No sources provided for concept graph");
  const promptSources = sources.map((s) => ({ index: s.index, name: s.name, text: texts[s.index] ?? "" }));
  const raw = await generateJson<any>(model, conceptGraphPrompt(promptSources, lang), conceptGraphSchemaHint());
  const graph = sanitizeGraph(raw, sources);
  if (graph.concepts.length === 0) {
    throw new Error("The AI did not extract any concepts from the material.");
  }
  return graph;
}

function serializeRow(row: {
  id: string;
  name: string;
  sourceIds: string;
  data: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    sourceIds: JSON.parse(row.sourceIds) as string[],
    data: JSON.parse(row.data) as ConceptGraphData,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Get (or build + cache) the concept graph for a set of StudySources.
 * Graphs are deduped per user by the sorted set of StudySource ids — the
 * same source-set always resolves to the same graph unless `forceRefresh`
 * is set, so features that share sources also share the (expensive) graph
 * extraction pass.
 */
export async function getOrBuildGraph(
  userId: string,
  model: LlmModel,
  cachedSources: CachedStudySource[],
  opts?: { forceRefresh?: boolean; lang?: StudyLanguage }
): Promise<{ id: string; name: string; data: ConceptGraphData; cached: boolean; createdAt: Date; updatedAt: Date }> {
  if (cachedSources.length === 0) throw new Error("No sources provided");
  const sorted = [...cachedSources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sortedIds = sorted.map((s) => s.id);
  const sourceKey = sortedIds.join(",");
  const name = sorted.map((s) => s.name).join(", ").slice(0, 200);

  if (!opts?.forceRefresh) {
    const existing = await prisma.conceptGraph.findFirst({
      where: { userId, sourceKey, status: "ready" },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) {
      return { ...serializeRow(existing), cached: true };
    }
  }

  const sourceRefs: GraphSourceRef[] = sorted.map((s, i) => ({
    index: i + 1,
    studySourceId: s.id,
    name: s.name,
    kind: s.kind,
    refId: s.refId,
  }));
  const texts: Record<number, string> = {};
  sorted.forEach((s, i) => {
    texts[i + 1] = s.textCache;
  });

  const data = await buildConceptGraphData(model, sourceRefs, texts, opts?.lang);
  const payload = {
    name,
    sourceIds: JSON.stringify(sortedIds),
    sourceKey,
    data: JSON.stringify(data),
    status: "ready",
    error: "",
  };

  const existing = await prisma.conceptGraph.findFirst({ where: { userId, sourceKey } });
  const row = existing
    ? await prisma.conceptGraph.update({ where: { id: existing.id }, data: payload })
    : await prisma.conceptGraph.create({ data: { userId, ...payload } });

  return { ...serializeRow(row), cached: false };
}

/** Fetch an existing graph by id (own-user only). */
export async function getGraphById(userId: string, id: string) {
  const row = await prisma.conceptGraph.findFirst({ where: { id, userId, status: "ready" } });
  if (!row) return null;
  return serializeRow(row);
}
