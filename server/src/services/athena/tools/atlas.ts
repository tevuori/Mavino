// ===== Athena tools: Atlas (Pro-tier global knowledge graph) =====
// Lets Athena query the user's global knowledge map — find concepts, list
// weak spots, and open the Atlas app focused on a concept.

import type { ToolDef } from "./plugin";
import { getAtlasStatus, getWeakConcepts, getConceptDetail } from "../../atlas";

export const atlasTools: ToolDef[] = [
  {
    name: "atlas_status",
    description:
      "Check the status of the user's Atlas (global knowledge graph) — whether it's built, how many concepts/links/clusters it has, how many concepts are flagged weak, and whether a rebuild is needed (stale). Returns null if Atlas hasn't been built yet. Use this before answering questions about the user's overall knowledge structure.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const status = await getAtlasStatus(userId);
      if (!status || status.status !== "ready" || !status.data) {
        return { built: false, status: status?.status ?? "empty" };
      }
      const d = status.data;
      return {
        built: true,
        status: status.status,
        updatedAt: status.updatedAt,
        stats: d.stats,
        topConcepts: [...d.concepts].sort((a, b) => b.importance - a.importance).slice(0, 10).map((c) => c.label),
        weakConcepts: d.concepts.filter((c) => c.weak).slice(0, 10).map((c) => ({ label: c.label, mastery: c.mastery, gradePct: c.gradePct })),
      };
    },
  },
  {
    name: "atlas_weak_concepts",
    description:
      "List the user's weak knowledge concepts — ones with low flashcard mastery (<60%) or low linked course grades (<60%). Returns each weak concept with its mastery, grade, and linked items (notes/flashcards/tasks/courses). Use this when the user asks what they're struggling with or what to study next.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const weak = await getWeakConcepts(userId);
      if (weak.length === 0) {
        return { count: 0, concepts: [], note: "No weak concepts found. Either Atlas hasn't been built, or all tracked concepts are above the weak threshold." };
      }
      return {
        count: weak.length,
        concepts: weak.map((c) => ({
          id: c.id,
          label: c.label,
          type: c.type,
          mastery: c.mastery,
          gradePct: c.gradePct,
          linkedNotes: c.items.notes.length,
          linkedFlashcardDecks: c.items.flashcardDecks.length,
          linkedTasks: c.items.tasks.length,
          linkedCourses: c.items.courses.length,
        })),
      };
    },
  },
  {
    name: "atlas_find_concept",
    description:
      "Find a concept in the user's Atlas by label (case-insensitive substring match) and return its full detail: definition, importance, mastery, grade, linked items (notes/flashcards/tasks/courses with ids + names), and related concepts. Use this when the user asks about a specific topic they've studied.",
    proOnly: true,
    parameters: [
      { name: "label", type: "string", description: "The concept label to search for (substring match)", required: true },
    ],
    handler: async (args, { userId }) => {
      const status = await getAtlasStatus(userId);
      if (!status || status.status !== "ready" || !status.data) {
        return { error: "Atlas hasn't been built yet. Ask the user to open the Atlas app and build it." };
      }
      const needle = String(args.label ?? "").toLowerCase().trim();
      if (!needle) return { error: "No label provided" };
      const match = status.data.concepts.find((c) => c.label.toLowerCase().includes(needle));
      if (!match) return { error: `No concept matching "${args.label}" found in Atlas.` };
      const detail = await getConceptDetail(userId, match.id);
      return detail ?? { error: "Concept detail unavailable" };
    },
  },
  {
    name: "open_atlas",
    description:
      "Open the Atlas app on the user's desktop, optionally focused on a specific concept (by id from atlas_find_concept/atlas_weak_concepts). Use after answering a knowledge-structure question so the user can explore visually.",
    clientAction: true,
    proOnly: true,
    parameters: [
      { name: "conceptId", type: "string", description: "Optional concept id to focus on (from atlas_find_concept or atlas_weak_concepts)" },
    ],
    handler: async (args) => ({ action: "open_atlas", conceptId: args.conceptId ? String(args.conceptId) : undefined }),
  },
];
