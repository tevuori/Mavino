// ===== Athena Study Hub tools: Knowledge Graph =====
// Lets Athena build (or reuse) a persisted concept graph for a source-set
// and inspect its full structure — the same graph that backs the Study
// Hub's Flashcards/Quiz/Summarize/Explain/Study Guide features.

import type { ToolDef } from "./plugin";
import { getUserConfig, acquireLlmModel } from "../llm";
import { resolveAndCache, type SourceDescriptor, type SourceKind } from "../../study/source";
import { getOrBuildGraph, getGraphById } from "../../study/graph";
import { withStudyGate } from "./study-gate";

const rawStudyGraphTools: ToolDef[] = [
  {
    name: "build_concept_graph",
    description:
      "Build (or reuse a cached) knowledge graph from one or more sources: concepts with definitions and facts, plus typed relationships between them, all cited to the source material. This is the same structured representation the Study Hub uses to derive flashcards, quizzes, summaries, explanations, and study guides — build it once, then reuse the returned graphId for those tools (or pass graphId directly to open_study_hub). Returns a compact overview (concept/relationship counts, top concepts) rather than the full graph — use get_concept_graph for the full structure.",
    destructive: true,
    parameters: [
      { name: "kind", type: "string", description: "Source kind", enum: ["note", "file", "paste", "url"], required: true },
      { name: "id", type: "string", description: "Note id or file id (required for kind note/file)" },
      { name: "url", type: "string", description: "URL (required for kind url)" },
      { name: "text", type: "string", description: "Pasted text (required for kind paste)" },
      { name: "name", type: "string", description: "Optional display name" },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId);

      const src: SourceDescriptor = {
        kind: String(args.kind) as SourceKind,
        id: args.id ? String(args.id) : undefined,
        url: args.url ? String(args.url) : undefined,
        text: args.text ? String(args.text) : undefined,
        name: args.name ? String(args.name) : undefined,
      };

      let cachedSource;
      try {
        cachedSource = await resolveAndCache(userId, src);
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Source error" };
      }

      try {
        const graph = await getOrBuildGraph(userId, model, [cachedSource]);
        const topConcepts = [...graph.data.concepts]
          .sort((a, b) => b.importance - a.importance)
          .slice(0, 8)
          .map((c) => c.label);
        return {
          graphId: graph.id,
          name: graph.name,
          cached: graph.cached,
          summary: graph.data.summary,
          conceptCount: graph.data.concepts.length,
          relationshipCount: graph.data.relationships.length,
          topConcepts,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Graph generation failed" };
      }
    },
  },
  {
    name: "get_concept_graph",
    description:
      "Fetch the full structure of a previously built knowledge graph (from build_concept_graph or the Knowledge Graph app): all concepts (with definitions, facts, importance, source citations) and relationships between them. Use this to answer questions about the material's structure or to reason over it directly.",
    parameters: [
      { name: "graphId", type: "string", description: "Graph id from build_concept_graph or list results", required: true },
    ],
    handler: async (args, { userId }) => {
      const graph = await getGraphById(userId, String(args.graphId));
      if (!graph) return { error: "Graph not found" };
      return {
        graphId: graph.id,
        name: graph.name,
        summary: graph.data.summary,
        sources: graph.data.sources.map((s) => ({ index: s.index, name: s.name, kind: s.kind })),
        concepts: graph.data.concepts,
        relationships: graph.data.relationships,
      };
    },
  },
];

export const studyGraphTools: ToolDef[] = rawStudyGraphTools.map((t) =>
  t.name === "build_concept_graph" || t.name === "get_concept_graph" ? withStudyGate(t, "graph") : t
);
