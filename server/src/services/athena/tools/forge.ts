// ===== Athena tools: Forge (Pro-tier AI practice problem generator) =====
// Lets Athena generate practice problems from sources, grade answers, list
// problem sets, and open the Forge app. Integrates with Atlas (weak concepts)
// and Pulse (mastery targeting).

import type { ToolDef } from "./plugin";
import {
  listProblemSets,
  getProblemSet,
  generateProblemSet,
  gradeAttempt,
  listAttempts,
  getStats,
  type ForgeSource,
} from "../../forge";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../llm";

export const forgeTools: ToolDef[] = [
  {
    name: "forge_list_sets",
    description:
      "List the user's Forge practice problem sets — each with id, title, format, difficulty, problem count, and source. Use this when the user asks about their practice problems or wants to see what sets they have.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const sets = await listProblemSets(userId);
      if (sets.length === 0) {
        return { count: 0, sets: [], note: "No practice problem sets yet. The user can generate one with forge_generate." };
      }
      return {
        count: sets.length,
        sets: sets.map((s) => ({
          id: s.id,
          title: s.title,
          format: s.format,
          difficulty: s.difficulty,
          count: s.count,
          sourceName: s.source.name,
          sourceKind: s.source.kind,
        })),
      };
    },
  },
  {
    name: "forge_get_set",
    description:
      "Get a specific Forge problem set by id — returns all problems with their prompts, options (for MCQ), and solutions. Use this after forge_list_sets when the user asks about a specific set or wants to review the problems.",
    proOnly: true,
    parameters: [
      { name: "setId", type: "string", description: "The problem set id (from forge_list_sets)", required: true },
    ],
    handler: async (args, { userId }) => {
      const setId = String(args.setId ?? "").trim();
      if (!setId) return { error: "setId is required" };
      const set = await getProblemSet(userId, setId);
      if (!set) return { error: "Problem set not found" };
      return {
        id: set.id,
        title: set.title,
        format: set.format,
        difficulty: set.difficulty,
        count: set.problems.length,
        problems: set.problems.map((p) => ({
          id: p.id,
          type: p.type,
          difficulty: p.difficulty,
          prompt: p.prompt,
          options: p.options.length > 0 ? p.options : undefined,
          answer: p.answer,
          solution: p.solution.slice(0, 500),
          hint: p.hint,
        })),
      };
    },
  },
  {
    name: "forge_generate",
    description:
      "Generate a new set of AI practice problems from a source. The source can be: a note (kind='note', refId=noteId), a file (kind='file', refId=fileId), the user's Atlas knowledge graph (kind='atlas'), or free text (kind='text', text='...'). Optionally specify format ('mcq', 'short_answer', 'step_by_step', 'mixed'), difficulty ('easy', 'medium', 'hard', 'adaptive'), and count (3-20). Use this when the user asks to generate practice problems, create a quiz, or test their knowledge on a topic.",
    proOnly: true,
    parameters: [
      { name: "title", type: "string", description: "Optional title for the problem set" },
      { name: "sourceKind", type: "string", description: "Source type: 'note', 'file', 'atlas', 'text', or 'moodle'", required: true },
      { name: "sourceRefId", type: "string", description: "Note/file id (for 'note'/'file' sources)" },
      { name: "sourceName", type: "string", description: "Display name for the source", required: true },
      { name: "sourceText", type: "string", description: "Text content (for 'text' source)" },
      { name: "format", type: "string", description: "Problem format: 'mcq', 'short_answer', 'step_by_step', or 'mixed' (default)" },
      { name: "difficulty", type: "string", description: "Difficulty: 'easy', 'medium', 'hard', or 'adaptive' (default — targets weak Atlas concepts)" },
      { name: "count", type: "number", description: "Number of problems to generate (3-20, default 8)" },
      { name: "conceptIds", type: "array", description: "Optional Atlas concept ids to target", items: { type: "string" } },
    ],
    handler: async (args, { userId }) => {
      const sourceKind = String(args.sourceKind ?? "").trim();
      if (!sourceKind) return { error: "sourceKind is required" };
      const source: ForgeSource = {
        kind: sourceKind as ForgeSource["kind"],
        refId: args.sourceRefId ? String(args.sourceRefId) : undefined,
        name: String(args.sourceName ?? "Practice Set"),
        text: args.sourceText ? String(args.sourceText) : undefined,
      };
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
        const result = await generateProblemSet(userId, model, {
          title: args.title ? String(args.title) : undefined,
          source,
          format: args.format as any,
          difficulty: args.difficulty as any,
          count: args.count ? Number(args.count) : undefined,
          conceptIds: Array.isArray(args.conceptIds) ? args.conceptIds.map(String) : undefined,
        });
        return { ...result, message: `Generated ${result.count} practice problems in set "${result.title}". Use open_forge to let the user start practicing.` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Generation failed" };
      }
    },
  },
  {
    name: "forge_stats",
    description:
      "Get the user's Forge practice statistics — total sets, problems, attempts, average score, and concepts targeted. Use this when the user asks about their practice progress or performance.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      const stats = await getStats(userId);
      return stats;
    },
  },
  {
    name: "forge_attempts",
    description:
      "List the user's recent Forge attempt history — each attempt with the problem, submitted answer, result (correct/partial/incorrect), score, and feedback. Optionally filter by setId. Use this when the user asks about their past attempts or wants to review mistakes.",
    proOnly: true,
    parameters: [
      { name: "setId", type: "string", description: "Optional problem set id to filter by" },
    ],
    handler: async (args, { userId }) => {
      const attempts = await listAttempts(userId, args.setId ? String(args.setId) : undefined);
      return {
        count: attempts.length,
        attempts: attempts.slice(0, 20).map((a) => ({
          id: a.id,
          problemId: a.problemId,
          result: a.result,
          score: a.score,
          summary: a.feedback.summary?.slice(0, 200),
          misconception: a.feedback.misconception,
          createdAt: a.createdAt,
        })),
      };
    },
  },
  {
    name: "open_forge",
    description:
      "Open the Forge app on the user's desktop, optionally focused on a specific problem set. Use after generating problems or when the user asks to practice.",
    clientAction: true,
    proOnly: true,
    parameters: [
      { name: "setId", type: "string", description: "Optional problem set id to focus on (from forge_list_sets or forge_generate)" },
    ],
    handler: async (args) => ({ action: "open_forge", setId: args.setId ? String(args.setId) : undefined }),
  },
];
