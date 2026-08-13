// ===== Concept Bridge: interdisciplinary connection surfacer (Pro tier) =====
// A background job that runs over AtlasGraph, finds cross-course concept
// connections (shared prerequisites, shared applications, analogies), and
// stores them as labeled edges. These are surfaced as weekly "Did you know?"
// cards, inline hints in Notes, and Atlas graph edges.
//
// The bridge discovery is LLM-powered: given the user's Atlas concepts
// grouped by source (course/graph), the LLM identifies non-obvious
// connections between concepts from different sources and explains them.
//
// Integrates with:
//   - Atlas: reads the concept graph + cluster/source info
//   - Notes: surfaces inline hints ("This concept also appears in...")
//   - ntfy/Today: weekly "Did you know?" card delivery

import type { LlmModel } from "multi-llm-ts";
import prisma from "../db/client";
import { generateJson } from "./study/llm-json";
import { getAtlas, type AtlasData, type AtlasConcept } from "./atlas";

// ----- types -----

export interface ConceptBridgeData {
  id: string;
  conceptAId: string;
  conceptALabel: string;
  conceptBId: string;
  conceptBLabel: string;
  relation: string;
  explanation: string;
  sourceA: string;
  sourceB: string;
  seen: boolean;
  createdAt: string;
}

export interface BridgeStats {
  totalBridges: number;
  unseenBridges: number;
  byRelation: Record<string, number>;
}

// ----- helpers -----

/** Get the source label for a concept (which course/graph it came from). */
function conceptSourceLabel(concept: AtlasConcept, data: AtlasData): string {
  // Check clusters — find which cluster(s) this concept belongs to.
  const clusters = data.clusters.filter((c) => c.conceptIds.includes(concept.id));
  if (clusters.length > 0) {
    return clusters.map((c) => c.label).join(", ");
  }
  // Fall back to source graph ids.
  if (concept.sourceGraphIds.length > 0) {
    return `graph:${concept.sourceGraphIds[0]}`;
  }
  return "unknown";
}

// ----- CRUD -----

export async function listBridges(userId: string, onlyUnseen = false): Promise<ConceptBridgeData[]> {
  const bridges = await prisma.conceptBridge.findMany({
    where: { userId, ...(onlyUnseen ? { seen: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return bridges.map(serializeBridge);
}

export async function getBridge(userId: string, bridgeId: string): Promise<ConceptBridgeData | null> {
  const bridge = await prisma.conceptBridge.findFirst({
    where: { id: bridgeId, userId },
  });
  return bridge ? serializeBridge(bridge) : null;
}

export async function markBridgeSeen(userId: string, bridgeId: string): Promise<void> {
  await prisma.conceptBridge.updateMany({
    where: { id: bridgeId, userId },
    data: { seen: true },
  });
}

export async function markAllBridgesSeen(userId: string): Promise<void> {
  await prisma.conceptBridge.updateMany({
    where: { userId, seen: false },
    data: { seen: true },
  });
}

export async function deleteBridge(userId: string, bridgeId: string): Promise<void> {
  await prisma.conceptBridge.deleteMany({ where: { id: bridgeId, userId } });
}

export async function getBridgeStats(userId: string): Promise<BridgeStats> {
  const bridges = await prisma.conceptBridge.findMany({
    where: { userId },
    select: { relation: true, seen: true },
  });
  const byRelation: Record<string, number> = {};
  let unseen = 0;
  for (const b of bridges) {
    byRelation[b.relation] = (byRelation[b.relation] ?? 0) + 1;
    if (!b.seen) unseen++;
  }
  return {
    totalBridges: bridges.length,
    unseenBridges: unseen,
    byRelation,
  };
}

function serializeBridge(b: any): ConceptBridgeData {
  return {
    id: b.id,
    conceptAId: b.conceptAId,
    conceptALabel: b.conceptALabel,
    conceptBId: b.conceptBId,
    conceptBLabel: b.conceptBLabel,
    relation: b.relation,
    explanation: b.explanation,
    sourceA: b.sourceA,
    sourceB: b.sourceB,
    seen: b.seen,
    createdAt: b.createdAt.toISOString(),
  };
}

// ----- bridge discovery (LLM) -----

/** Discover cross-source concept connections using the LLM.
 *  Returns the number of new bridges created. */
export async function discoverBridges(
  userId: string,
  model: LlmModel
): Promise<{ created: number; total: number }> {
  const atlas = await getAtlas(userId);
  if (!atlas?.data || atlas.data.concepts.length < 4) {
    throw new Error("Your Atlas knowledge graph needs at least 4 concepts to discover bridges. Build your Atlas first.");
  }

  const data = atlas.data;

  // Group concepts by source label.
  const bySource = new Map<string, { label: string; definition: string; id: string }[]>();
  for (const concept of data.concepts) {
    const source = conceptSourceLabel(concept, data);
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source)!.push({
      label: concept.label,
      definition: concept.definition,
      id: concept.id,
    });
  }

  // Need at least 2 different sources to find cross-source bridges.
  if (bySource.size < 2) {
    throw new Error("Your Atlas concepts all come from the same source. Add concepts from different courses or study materials to discover interdisciplinary connections.");
  }

  // Build a prompt that asks the LLM to find connections between concepts
  // from DIFFERENT sources.
  const sourceGroups = [...bySource.entries()];
  const prompt = `You are an expert educator identifying interdisciplinary connections in a student's knowledge graph. The student has concepts from different sources (courses, study materials). Find NON-OBVIOUS connections between concepts from DIFFERENT sources.

Here are the concepts grouped by source:

${sourceGroups.map(([source, concepts]) =>
  `## Source: ${source}\n${concepts.slice(0, 30).map((c) => `- [id:${c.id}] ${c.label}: ${c.definition}`).join("\n")}`
).join("\n\n")}

Find 3-10 connections between concepts from DIFFERENT sources. For each connection:
- conceptAId and conceptBId: the concept ids (must be from different sources)
- relation: one of "prerequisite" (A is needed to understand B), "shared_application" (both used in the same real-world application), "analogy" (A is analogous to B), "contrasts" (A contrasts with B), "generalizes" (A generalizes B or vice versa)
- explanation: a 1-3 sentence explanation of WHY these concepts are connected, written for a student. Make it insightful — the goal is to help the student see connections they wouldn't have noticed on their own.

Only include connections that are genuinely insightful and non-obvious. Skip trivial connections (e.g. "both are math concepts").

Respond with JSON: { "bridges": [{ "conceptAId": string, "conceptBId": string, "relation": string, "explanation": string }] }`;

  const schemaHint = `Respond with { "bridges": [{ "conceptAId": string, "conceptBId": string, "relation": "prerequisite"|"shared_application"|"analogy"|"contrasts"|"generalizes", "explanation": string }] }`;

  const result = await generateJson<{ bridges: any[] }>(model, prompt, schemaHint);
  const rawBridges = (result.bridges ?? []).slice(0, 15);

  if (rawBridges.length === 0) {
    return { created: 0, total: await prisma.conceptBridge.count({ where: { userId } }) };
  }

  // Build a concept lookup map.
  const conceptMap = new Map(data.concepts.map((c) => [c.id, c]));

  // Create bridges, deduplicating by (conceptAId, conceptBId).
  let created = 0;
  for (const rb of rawBridges) {
    const aId = String(rb.conceptAId ?? "").trim();
    const bId = String(rb.conceptBId ?? "").trim();
    if (!aId || !bId || aId === bId) continue;
    const conceptA = conceptMap.get(aId);
    const conceptB = conceptMap.get(bId);
    if (!conceptA || !conceptB) continue;

    // Normalize: always store the lower-id concept first to avoid duplicates.
    const [firstId, secondId, firstConcept, secondConcept] = aId < bId
      ? [aId, bId, conceptA, conceptB]
      : [bId, aId, conceptB, conceptA];

    const relation = String(rb.relation ?? "analogy").trim();
    const explanation = String(rb.explanation ?? "").trim();
    if (!explanation) continue;

    // Check if this bridge already exists.
    const existing = await prisma.conceptBridge.findFirst({
      where: { userId, conceptAId: firstId, conceptBId: secondId },
    });
    if (existing) {
      // Update the explanation if the new one is better.
      if (explanation.length > existing.explanation.length) {
        await prisma.conceptBridge.update({
          where: { id: existing.id },
          data: { relation, explanation, updatedAt: new Date() },
        });
      }
      continue;
    }

    await prisma.conceptBridge.create({
      data: {
        userId,
        conceptAId: firstId,
        conceptALabel: firstConcept.label,
        conceptBId: secondId,
        conceptBLabel: secondConcept.label,
        relation,
        explanation,
        sourceA: conceptSourceLabel(firstConcept, data),
        sourceB: conceptSourceLabel(secondConcept, data),
      },
    });
    created++;
  }

  const total = await prisma.conceptBridge.count({ where: { userId } });
  return { created, total };
}

// ----- inline hint lookup -----

/** Find bridges that involve a given concept (for inline hints in Notes).
 *  Returns bridges where the concept is either A or B. */
export async function getBridgesForConcept(userId: string, conceptId: string): Promise<ConceptBridgeData[]> {
  const bridges = await prisma.conceptBridge.findMany({
    where: {
      userId,
      OR: [{ conceptAId: conceptId }, { conceptBId: conceptId }],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return bridges.map(serializeBridge);
}

/** Find bridges that involve a concept with the given label (for inline
 *  hints in Notes, where we match by label text). */
export async function getBridgesForLabel(userId: string, label: string): Promise<ConceptBridgeData[]> {
  const lower = label.toLowerCase().trim();
  if (!lower) return [];
  const bridges = await prisma.conceptBridge.findMany({
    where: {
      userId,
      OR: [
        { conceptALabel: { contains: label, mode: "insensitive" } },
        { conceptBLabel: { contains: label, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return bridges.map(serializeBridge);
}
