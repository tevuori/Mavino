// ===== Atlas: global knowledge graph service (Pro tier) =====
// Stitches together every Study Hub ConceptGraph the user has built, plus
// their notes, flashcards, tasks, and courses, into one living map of their
// knowledge.
//
// Build pipeline (deterministic — no LLM needed unless the user has notes
// but zero Study Hub graphs, in which case one extraction pass seeds
// concepts from note text):
//   1. Load all ready ConceptGraphs → collect concepts + relationships,
//      namespaced per source graph to avoid id collisions.
//   2. Merge concepts across graphs by normalized label (lowercase, strip
//      stopwords/punctuation) → unified concepts with sourceGraphIds[].
//   3. Remap relationship edges to merged concept ids.
//   4. Load notes / flashcard decks+cards / tasks / courses+assignments.
//   5. Link items to concepts by text matching (concept label appears in
//      the item's text). This is the "cross-app" stitching.
//   6. Compute mastery per concept from FlashcardReview (avg quality / 5)
//      for cards in linked decks. Compute gradePct from Assignments in
//      linked courses. Flag weak = mastery < 0.6 OR gradePct < 60.
//   7. Build clusters (one per source graph + one per course).
//   8. If the user has notes but NO graphs, run one LLM extraction pass
//      over note titles+snippets to seed concepts (so Atlas is useful
//      standalone, not only as a graph-of-graphs).
//
// The build is fire-and-forget + polling, mirroring ConceptGraph: the row
// is flipped to "building" synchronously, the (potentially slow) stitching
// runs in the background, and the client polls until "ready"/"error".

import type { LlmModel } from "multi-llm-ts";
import prisma from "../db/client";
import { generateJson } from "./study/llm-json";
import type { ConceptGraphData, ConceptNode, ConceptEdge } from "./study/graph";

// ----- Atlas data shape (stored as JSON in AtlasGraph.data) -----

export interface AtlasLinkedItems {
  notes: { id: string; title: string }[];
  flashcardDecks: { id: string; name: string }[];
  tasks: { id: string; title: string; status: string; dueDate: string | null }[];
  courses: { id: string; name: string; code: string }[];
}

export interface AtlasConcept {
  id: string; // canonical merged id (normalized label slug)
  label: string;
  type: string;
  definition: string;
  importance: number;
  sourceGraphIds: string[]; // which ConceptGraphs it came from
  items: AtlasLinkedItems;
  mastery: number; // 0..1 (from flashcard reviews); -1 = no data
  gradePct: number | null; // 0..100 (from linked course assignments); null = no data
  weak: boolean;
}

export interface AtlasLink {
  from: string;
  to: string;
  relation: string;
  sourceGraphId: string;
}

export interface AtlasCluster {
  id: string;
  label: string;
  kind: "studyGraph" | "course";
  conceptIds: string[];
  color?: string;
}

export interface AtlasStats {
  conceptCount: number;
  linkCount: number;
  clusterCount: number;
  weakCount: number;
  sourceGraphCount: number;
  linkedNoteCount: number;
  linkedFlashcardDeckCount: number;
  linkedTaskCount: number;
  linkedCourseCount: number;
}

export interface AtlasData {
  concepts: AtlasConcept[];
  links: AtlasLink[];
  clusters: AtlasCluster[];
  stats: AtlasStats;
  builtAt: string;
}

export interface AtlasStatus {
  id: string;
  status: "building" | "ready" | "error";
  error: string;
  data: AtlasData | null;
  updatedAt: string;
  sourceSnapshot: { graphId: string; updatedAt: string }[];
}

// ----- helpers -----

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "is",
  "are", "be", "by", "with", "from", "as", "that", "this", "it", "its",
  "into", "via", "using", "use", "used",
]);

/** Normalize a concept label for cross-graph matching:
 *  lowercase, strip non-alphanumerics, drop stopwords, sort tokens.
 *  Two concepts with the same normalized form are treated as the same
 *  concept (e.g. "Derivative of a function" ≈ "function derivative"). */
function normalizeLabel(label: string): string {
  const tokens = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(tokens)].sort().join(" ");
}

function slugify(s: string, fallback: string): string {
  const slug = String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** Case-insensitive whole-word / phrase substring match. */
export function textContains(haystack: string, needle: string): boolean {
  if (!needle || !haystack) return false;
  // Escape regex metacharacters in the needle.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word-boundary match for labels that are single words; plain substring
  // for multi-word labels (word boundaries don't work well across spaces).
  const pattern = needle.includes(" ")
    ? escaped
    : `\\b${escaped}\\b`;
  return new RegExp(pattern, "i").test(haystack);
}

/** Count case-insensitive occurrences of a needle in haystack (whole-word for
 *  single-word labels, plain substring for multi-word labels). Mirrors
 *  `textContains` but returns the match count. */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle || !haystack) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = needle.includes(" ")
    ? escaped
    : `\\b${escaped}\\b`;
  const matches = haystack.match(new RegExp(pattern, "gi"));
  return matches ? matches.length : 0;
}

// ----- status / fetch -----

export async function getAtlasStatus(userId: string): Promise<AtlasStatus | null> {
  const row = await prisma.atlasGraph.findUnique({ where: { userId } });
  if (!row) return null;
  return serializeStatus(row);
}

export async function getAtlas(userId: string): Promise<AtlasStatus | null> {
  const row = await prisma.atlasGraph.findUnique({ where: { userId } });
  if (!row) return null;
  return serializeStatus(row);
}

function serializeStatus(row: {
  id: string;
  status: string;
  error: string;
  data: string;
  updatedAt: Date;
  sourceSnapshot: string;
}): AtlasStatus {
  let data: AtlasData | null = null;
  if (row.status === "ready") {
    try {
      data = JSON.parse(row.data) as AtlasData;
    } catch {
      data = null;
    }
  }
  let snapshot: { graphId: string; updatedAt: string }[] = [];
  try {
    snapshot = JSON.parse(row.sourceSnapshot) as { graphId: string; updatedAt: string }[];
  } catch {
    snapshot = [];
  }
  return {
    id: row.id,
    status: row.status as AtlasStatus["status"],
    error: row.error,
    data,
    updatedAt: row.updatedAt.toISOString(),
    sourceSnapshot: snapshot,
  };
}

// ----- staleness check -----

/** True if any source ConceptGraph was created/updated/removed since the
 *  last Atlas build (i.e. the snapshot is stale and a rebuild is needed). */
export async function isAtlasStale(userId: string): Promise<boolean> {
  const row = await prisma.atlasGraph.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return true;
  let snapshot: { graphId: string; updatedAt: string }[] = [];
  try {
    snapshot = JSON.parse(row.sourceSnapshot) as { graphId: string; updatedAt: string }[];
  } catch {
    return true;
  }
  const current = await prisma.conceptGraph.findMany({
    where: { userId, status: "ready" },
    select: { id: true, updatedAt: true },
  });
  const snapMap = new Map(snapshot.map((s) => [s.graphId, s.updatedAt]));
  if (current.length !== snapshot.length) return true;
  for (const g of current) {
    const snap = snapMap.get(g.id);
    if (!snap) return true;
    if (snap !== g.updatedAt.toISOString()) return true;
  }
  return false;
}

// ----- build (fire-and-forget + polling, like ConceptGraph) -----

export async function startBuildAtlas(
  userId: string,
  model: LlmModel
): Promise<{ id: string; status: "ready" | "building"; data: AtlasData | null }> {
  const existing = await prisma.atlasGraph.findUnique({ where: { userId } });
  const reservation = {
    data: "{}",
    status: "building",
    error: "",
    sourceSnapshot: "[]",
  };
  const row = existing
    ? await prisma.atlasGraph.update({ where: { id: existing.id }, data: reservation })
    : await prisma.atlasGraph.create({ data: { userId, ...reservation } });

  // Fire-and-forget: the HTTP response returns before this settles.
  void buildAtlasData(userId, model)
    .then((data) =>
      prisma.atlasGraph.update({
        where: { id: row.id },
        data: {
          data: JSON.stringify(data),
          status: "ready",
          error: "",
        },
      })
    )
    .then(() => updateSnapshot(userId))
    .catch((e) =>
      prisma.atlasGraph
        .update({
          where: { id: row.id },
          data: {
            status: "error",
            error: e instanceof Error ? e.message : "Atlas build failed",
          },
        })
        .catch(() => {})
    );

  return { id: row.id, status: "building", data: null };
}

/** Refresh the sourceSnapshot after a successful build. */
async function updateSnapshot(userId: string): Promise<void> {
  const current = await prisma.conceptGraph.findMany({
    where: { userId, status: "ready" },
    select: { id: true, updatedAt: true },
  });
  const snapshot = current.map((g) => ({ graphId: g.id, updatedAt: g.updatedAt.toISOString() }));
  await prisma.atlasGraph.update({
    where: { userId },
    data: { sourceSnapshot: JSON.stringify(snapshot) },
  });
}

// ----- core build logic -----

interface RawConcept {
  graphId: string;
  node: ConceptNode;
}

/** Build the full AtlasData for a user. */
export async function buildAtlasData(userId: string, model: LlmModel): Promise<AtlasData> {
  // 1. Load all ready ConceptGraphs.
  const graphRows = await prisma.conceptGraph.findMany({
    where: { userId, status: "ready" },
    orderBy: { updatedAt: "desc" },
  });

  const graphs: { id: string; name: string; data: ConceptGraphData }[] = [];
  for (const row of graphRows) {
    try {
      const data = JSON.parse(row.data) as ConceptGraphData;
      if (data.concepts && data.concepts.length > 0) {
        graphs.push({ id: row.id, name: row.name, data });
      }
    } catch {
      // skip malformed
    }
  }

  // 2. Collect raw concepts (namespaced) + edges.
  const rawConcepts: RawConcept[] = [];
  const rawEdges: { graphId: string; edge: ConceptEdge }[] = [];
  for (const g of graphs) {
    for (const c of g.data.concepts) {
      rawConcepts.push({ graphId: g.id, node: c });
    }
    for (const r of g.data.relationships) {
      rawEdges.push({ graphId: g.id, edge: r });
    }
  }

  // 3. Load notes / flashcards / tasks / courses for text-matching + linking.
  const [notes, decks, tasks, courses, assignments, reviews] = await Promise.all([
    prisma.note.findMany({
      where: { userId },
      select: { id: true, title: true, content: true },
    }),
    prisma.flashcardDeck.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        cards: { select: { id: true, front: true, back: true, deckId: true } },
      },
    }),
    prisma.task.findMany({
      where: { userId },
      select: { id: true, title: true, description: true, status: true, dueDate: true },
    }),
    prisma.course.findMany({
      where: { userId },
      select: { id: true, name: true, code: true, color: true },
    }),
    prisma.assignment.findMany({
      where: { course: { userId } },
      select: { id: true, courseId: true, name: true, score: true, maxScore: true, weight: true },
    }),
    prisma.flashcardReview.findMany({
      where: { userId },
      select: { cardId: true, quality: true },
    }),
  ]);

  // 4a. If there are no Study Hub graphs but the user has notes, seed
  //     concepts from notes via one LLM extraction pass so Atlas is useful
  //     standalone.
  let seededConcepts: { label: string; type: string; definition: string; noteId: string }[] = [];
  if (graphs.length === 0 && notes.length > 0) {
    seededConcepts = await seedConceptsFromNotes(model, notes);
  }

  // 4b. Merge concepts across graphs by normalized label.
  //     mergedId = slug(normalizedLabel) ; collect sourceGraphIds + pick the
  //     highest-importance node as the canonical label/definition.
  const merged = new Map<
    string,
    {
      id: string;
      label: string;
      type: string;
      definition: string;
      importance: number;
      sourceGraphIds: Set<string>;
    }
  >();

  const ensureMerged = (norm: string, label: string, type: string, definition: string, importance: number, graphId: string | null) => {
    const id = slugify(norm, `concept-${merged.size + 1}`);
    let entry = merged.get(id);
    if (!entry) {
      entry = {
        id,
        label,
        type: type || "concept",
        definition,
        importance,
        sourceGraphIds: new Set<string>(),
      };
      merged.set(id, entry);
    }
    if (graphId) entry.sourceGraphIds.add(graphId);
    // Promote the highest-importance node's label/definition as canonical.
    if (importance > entry.importance) {
      entry.importance = importance;
      entry.label = label;
      entry.definition = definition || entry.definition;
      if (type) entry.type = type;
    }
  };

  for (const rc of rawConcepts) {
    const n = rc.node;
    const norm = normalizeLabel(n.label);
    if (!norm) continue;
    ensureMerged(norm, n.label, n.type, n.definition, n.importance, rc.graphId);
  }

  // Seed concepts from notes (synthetic graph id "notes-seed").
  for (const sc of seededConcepts) {
    const norm = normalizeLabel(sc.label);
    if (!norm) continue;
    ensureMerged(norm, sc.label, sc.type, sc.definition, 3, null);
  }

  // 5. Remap edges to merged concept ids. Build a lookup from
  //    (graphId, originalConceptId) → mergedId.
  const edgeRemap = new Map<string, string>(); // `${graphId}:${origId}` → mergedId
  for (const rc of rawConcepts) {
    const norm = normalizeLabel(rc.node.label);
    if (!norm) continue;
    const mergedId = slugify(norm, "");
    if (mergedId) edgeRemap.set(`${rc.graphId}:${rc.node.id}`, mergedId);
  }

  const links: AtlasLink[] = [];
  const seenLinks = new Set<string>();
  for (const re of rawEdges) {
    const from = edgeRemap.get(`${re.graphId}:${re.edge.from}`);
    const to = edgeRemap.get(`${re.graphId}:${re.edge.to}`);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}|${re.edge.relation}`;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    links.push({ from, to, relation: re.edge.relation, sourceGraphId: re.graphId });
  }

  // 6. Link items to concepts by text matching.
  //    Build a searchable text blob per item, then for each concept check
  //    which items mention its label.
  const conceptLabels = [...merged.values()].map((c) => ({ id: c.id, label: c.label }));

  const noteMatches = new Map<string, string[]>(); // conceptId → noteIds
  const deckMatches = new Map<string, string[]>(); // conceptId → deckIds
  const taskMatches = new Map<string, string[]>(); // conceptId → taskIds
  const courseMatches = new Map<string, string[]>(); // conceptId → courseIds

  const addMatch = (map: Map<string, string[]>, conceptId: string, itemId: string) => {
    const arr = map.get(conceptId);
    if (arr) {
      if (!arr.includes(itemId)) arr.push(itemId);
    } else {
      map.set(conceptId, [itemId]);
    }
  };

  for (const cl of conceptLabels) {
    // Notes: match in title + content.
    for (const n of notes) {
      if (textContains(`${n.title} ${n.content}`, cl.label)) {
        addMatch(noteMatches, cl.id, n.id);
      }
    }
    // Flashcard decks: match in deck name or any card front/back.
    for (const d of decks) {
      const blob = `${d.name} ${d.cards.map((c) => `${c.front} ${c.back}`).join(" ")}`;
      if (textContains(blob, cl.label)) {
        addMatch(deckMatches, cl.id, d.id);
      }
    }
    // Tasks: match in title + description.
    for (const t of tasks) {
      if (textContains(`${t.title} ${t.description}`, cl.label)) {
        addMatch(taskMatches, cl.id, t.id);
      }
    }
    // Courses: match in name + code.
    for (const c of courses) {
      if (textContains(`${c.name} ${c.code}`, cl.label)) {
        addMatch(courseMatches, cl.id, c.id);
      }
    }
  }

  // 7. Compute mastery per concept from flashcard reviews.
  //    mastery = avg(quality) / 5 for all reviews of cards in linked decks.
  const reviewsByCard = new Map<string, number[]>();
  for (const r of reviews) {
    const arr = reviewsByCard.get(r.cardId);
    if (arr) arr.push(r.quality);
    else reviewsByCard.set(r.cardId, [r.quality]);
  }
  const deckMastery = new Map<string, number>(); // deckId → mastery 0..1
  for (const d of decks) {
    const qualities: number[] = [];
    for (const card of d.cards) {
      const qs = reviewsByCard.get(card.id);
      if (qs) qualities.push(...qs);
    }
    if (qualities.length > 0) {
      deckMastery.set(d.id, qualities.reduce((a, b) => a + b, 0) / qualities.length / 5);
    }
  }

  // 8. Compute gradePct per course (weighted average of assignments).
  const courseGrade = new Map<string, number>(); // courseId → pct 0..100
  const assignmentsByCourse = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const arr = assignmentsByCourse.get(a.courseId);
    if (arr) arr.push(a);
    else assignmentsByCourse.set(a.courseId, [a]);
  }
  for (const [courseId, asgs] of assignmentsByCourse) {
    let totalWeight = 0;
    let weightedScore = 0;
    for (const a of asgs) {
      const w = a.weight || 1;
      const pct = a.maxScore > 0 ? (a.score / a.maxScore) * 100 : 0;
      totalWeight += w;
      weightedScore += pct * w;
    }
    if (totalWeight > 0) {
      courseGrade.set(courseId, weightedScore / totalWeight);
    }
  }

  // 9. Assemble final concepts with linked items + mastery + grade + weak flag.
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const deckById = new Map(decks.map((d) => [d.id, d]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const concepts: AtlasConcept[] = [...merged.values()].map((c) => {
    const noteIds = noteMatches.get(c.id) ?? [];
    const deckIds = deckMatches.get(c.id) ?? [];
    const taskIds = taskMatches.get(c.id) ?? [];
    const courseIds = courseMatches.get(c.id) ?? [];

    // Mastery: average of linked deck masteries.
    let mastery = -1;
    const deckMasteryValues = deckIds.map((id) => deckMastery.get(id)).filter((v): v is number => v !== undefined);
    if (deckMasteryValues.length > 0) {
      mastery = deckMasteryValues.reduce((a, b) => a + b, 0) / deckMasteryValues.length;
    }

    // Grade: average of linked course grades.
    let gradePct: number | null = null;
    const courseGradeValues = courseIds.map((id) => courseGrade.get(id)).filter((v): v is number => v !== undefined);
    if (courseGradeValues.length > 0) {
      gradePct = courseGradeValues.reduce((a, b) => a + b, 0) / courseGradeValues.length;
    }

    const weak = (mastery >= 0 && mastery < 0.6) || (gradePct !== null && gradePct < 60);

    return {
      id: c.id,
      label: c.label,
      type: c.type,
      definition: c.definition,
      importance: c.importance,
      sourceGraphIds: [...c.sourceGraphIds],
      items: {
        notes: noteIds.map((id) => ({ id, title: noteById.get(id)?.title ?? "Untitled" })),
        flashcardDecks: deckIds.map((id) => ({ id, name: deckById.get(id)?.name ?? "Untitled" })),
        tasks: taskIds.map((id) => {
          const t = taskById.get(id);
          return {
            id,
            title: t?.title ?? "Untitled",
            status: t?.status ?? "TODO",
            dueDate: t?.dueDate ? t.dueDate.toISOString() : null,
          };
        }),
        courses: courseIds.map((id) => {
          const c2 = courseById.get(id);
          return { id, name: c2?.name ?? "Untitled", code: c2?.code ?? "" };
        }),
      },
      mastery,
      gradePct,
      weak,
    };
  });

  // 10. Build clusters: one per source graph + one per course (if it has
  //     linked concepts).
  const clusters: AtlasCluster[] = [];
  for (const g of graphs) {
    const conceptIds = concepts.filter((c) => c.sourceGraphIds.includes(g.id)).map((c) => c.id);
    if (conceptIds.length > 0) {
      clusters.push({ id: g.id, label: g.name, kind: "studyGraph", conceptIds });
    }
  }
  for (const c of courses) {
    const conceptIds = courseMatches.size > 0
      ? [...courseMatches.entries()].filter(([, ids]) => ids.includes(c.id)).map(([cid]) => cid)
      : [];
    if (conceptIds.length > 0) {
      clusters.push({ id: c.id, label: c.name, kind: "course", conceptIds, color: c.color });
    }
  }

  // 11. Stats.
  const linkedNoteIds = new Set<string>();
  const linkedDeckIds = new Set<string>();
  const linkedTaskIds = new Set<string>();
  const linkedCourseIds = new Set<string>();
  for (const c of concepts) {
    c.items.notes.forEach((n) => linkedNoteIds.add(n.id));
    c.items.flashcardDecks.forEach((d) => linkedDeckIds.add(d.id));
    c.items.tasks.forEach((t) => linkedTaskIds.add(t.id));
    c.items.courses.forEach((co) => linkedCourseIds.add(co.id));
  }

  const stats: AtlasStats = {
    conceptCount: concepts.length,
    linkCount: links.length,
    clusterCount: clusters.length,
    weakCount: concepts.filter((c) => c.weak).length,
    sourceGraphCount: graphs.length,
    linkedNoteCount: linkedNoteIds.size,
    linkedFlashcardDeckCount: linkedDeckIds.size,
    linkedTaskCount: linkedTaskIds.size,
    linkedCourseCount: linkedCourseIds.size,
  };

  return {
    concepts,
    links,
    clusters,
    stats,
    builtAt: new Date().toISOString(),
  };
}

// ----- LLM note-seeding (only when the user has notes but no graphs) -----

interface NoteForSeed {
  id: string;
  title: string;
  content: string;
}

async function seedConceptsFromNotes(
  model: LlmModel,
  notes: NoteForSeed[]
): Promise<{ label: string; type: string; definition: string; noteId: string }[]> {
  // Truncate each note to keep the prompt bounded.
  const SNIPPET = 600;
  const trimmed = notes.slice(0, 30).map((n) => ({
    id: n.id,
    title: n.title,
    snippet: n.content.replace(/\s+/g, " ").trim().slice(0, SNIPPET),
  }));
  const prompt = `Below are ${trimmed.length} of the user's notes (title + text snippet). Extract the KEY CONCEPTS that appear across them — the important terms, ideas, formulas, and topics a student would need to understand. Return a JSON object: { "concepts": [{ "label": string, "type": string, "definition": string, "noteIndexes": number[] }] } where noteIndexes is the 1-based index of the note(s) the concept appears in (from the list below). Keep labels short (1-4 words). Types: concept|term|formula|process|person|event|other. Aim for 10-30 concepts, prioritizing ones that appear in multiple notes.\n\nNotes:\n${trimmed.map((n, i) => `[${i + 1}] ${n.title}\n${n.snippet}`).join("\n\n")}`;
  const schemaHint = `Respond with { "concepts": [{ "label": string, "type": string, "definition": string, "noteIndexes": number[] }] }.`;
  try {
    const raw = await generateJson<{ concepts: any[] }>(model, prompt, schemaHint);
    const out: { label: string; type: string; definition: string; noteId: string }[] = [];
    for (const c of raw.concepts ?? []) {
      const label = String(c?.label ?? "").trim();
      if (!label) continue;
      const idxs: number[] = Array.isArray(c?.noteIndexes) ? c.noteIndexes.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n) && n >= 1 && n <= trimmed.length) : [];
      const noteId = idxs[0] ? trimmed[idxs[0] - 1].id : trimmed[0]?.id ?? "";
      out.push({
        label,
        type: String(c?.type ?? "concept").trim() || "concept",
        definition: String(c?.definition ?? "").trim(),
        noteId,
      });
    }
    return out;
  } catch {
    // LLM failure is non-fatal — Atlas just won't have seeded concepts.
    return [];
  }
}

// ----- concept detail (for the sidebar) -----

export interface AtlasConceptDetail extends AtlasConcept {
  relatedConcepts: { id: string; label: string; relation: string }[];
}

export async function getConceptDetail(
  userId: string,
  conceptId: string
): Promise<AtlasConceptDetail | null> {
  const row = await prisma.atlasGraph.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return null;
  let data: AtlasData;
  try {
    data = JSON.parse(row.data) as AtlasData;
  } catch {
    return null;
  }
  const concept = data.concepts.find((c) => c.id === conceptId);
  if (!concept) return null;
  const related: { id: string; label: string; relation: string }[] = [];
  for (const l of data.links) {
    if (l.from === conceptId) {
      const target = data.concepts.find((c) => c.id === l.to);
      if (target) related.push({ id: target.id, label: target.label, relation: l.relation });
    } else if (l.to === conceptId) {
      const source = data.concepts.find((c) => c.id === l.from);
      if (source) related.push({ id: source.id, label: source.label, relation: l.relation });
    }
  }
  return { ...concept, relatedConcepts: related.slice(0, 20) };
}

// ----- weak concepts (for Athena + UI highlights) -----

export async function getWeakConcepts(userId: string): Promise<AtlasConcept[]> {
  const row = await prisma.atlasGraph.findUnique({ where: { userId } });
  if (!row || row.status !== "ready") return [];
  try {
    const data = JSON.parse(row.data) as AtlasData;
    return data.concepts.filter((c) => c.weak);
  } catch {
    return [];
  }
}
