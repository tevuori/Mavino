// ===== Athena tools: Concept Bridge (Pro-tier interdisciplinary connections) =====
// Lets Athena discover, list, and surface cross-course concept connections.
// Integrates with Atlas (reads the knowledge graph) to find non-obvious
// interdisciplinary links.

import type { ToolDef } from "./plugin";
import {
  listBridges,
  getBridgeStats,
  discoverBridges,
  getBridgesForConcept,
  getBridgesForLabel,
  markAllBridgesSeen,
} from "../../bridge";
import { isLlmConfiguredFor, acquireLlmModel, LlmError } from "../llm";

export const bridgeTools: ToolDef[] = [
  {
    name: "bridge_list",
    description:
      "List the user's Concept Bridges — interdisciplinary connections between concepts from different courses/sources. Each bridge has two concepts, a relation type (prerequisite, shared_application, analogy, contrasts, generalizes), and an explanation. Optionally filter to only unseen bridges. Use this when the user asks about connections between their courses or concepts.",
    proOnly: true,
    parameters: [
      { name: "onlyUnseen", type: "boolean", description: "If true, only return bridges the user hasn't seen yet" },
    ],
    handler: async (args, { userId }) => {
      const onlyUnseen = Boolean(args.onlyUnseen);
      const bridges = await listBridges(userId, onlyUnseen);
      if (bridges.length === 0) {
        return {
          count: 0,
          bridges: [],
          note: onlyUnseen
            ? "No unseen bridges. Run bridge_discover to find new connections."
            : "No concept bridges yet. Run bridge_discover to find interdisciplinary connections in the user's Atlas.",
        };
      }
      return {
        count: bridges.length,
        bridges: bridges.map((b) => ({
          id: b.id,
          conceptA: b.conceptALabel,
          conceptB: b.conceptBLabel,
          relation: b.relation,
          explanation: b.explanation.slice(0, 300),
          sourceA: b.sourceA,
          sourceB: b.sourceB,
          seen: b.seen,
        })),
      };
    },
  },
  {
    name: "bridge_discover",
    description:
      "Discover new interdisciplinary connections in the user's Atlas knowledge graph using AI. Finds non-obvious links between concepts from different courses/sources (e.g. 'the eigenvalues from Linear Algebra are why PCA works in Machine Learning'). Requires the user's Atlas to be built with concepts from at least 2 different sources. Use this when the user asks to find connections, or proactively when they have a rich Atlas graph.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
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
        const result = await discoverBridges(userId, model);
        return {
          ...result,
          message: result.created > 0
            ? `Discovered ${result.created} new interdisciplinary connection${result.created !== 1 ? "s" : ""}. Total: ${result.total}. Use open_bridge to let the user explore them.`
            : `No new connections found. The user already has ${result.total} bridges. Try adding more concepts from different courses to the Atlas.`,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Discovery failed" };
      }
    },
  },
  {
    name: "bridge_stats",
    description:
      "Get stats about the user's Concept Bridges — total count, unseen count, and breakdown by relation type. Use this when the user asks about their bridge stats or you want to check if there are new unseen bridges to surface.",
    proOnly: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      return await getBridgeStats(userId);
    },
  },
  {
    name: "bridge_for_concept",
    description:
      "Find Concept Bridges that involve a specific Atlas concept (by concept id or label). Returns bridges where the concept is either side of the connection. Use this when the user asks about connections for a specific concept or when discussing a topic that might have interdisciplinary links.",
    proOnly: true,
    parameters: [
      { name: "conceptId", type: "string", description: "Atlas concept id (if known)" },
      { name: "label", type: "string", description: "Concept label to search by (used if conceptId is not provided)" },
    ],
    handler: async (args, { userId }) => {
      const conceptId = args.conceptId ? String(args.conceptId) : undefined;
      const label = args.label ? String(args.label) : undefined;
      if (!conceptId && !label) return { error: "Either conceptId or label is required" };
      let bridges;
      if (conceptId) {
        bridges = await getBridgesForConcept(userId, conceptId);
      } else {
        bridges = await getBridgesForLabel(userId, label!);
      }
      return {
        count: bridges.length,
        bridges: bridges.map((b) => ({
          id: b.id,
          conceptA: b.conceptALabel,
          conceptB: b.conceptBLabel,
          relation: b.relation,
          explanation: b.explanation.slice(0, 300),
        })),
      };
    },
  },
  {
    name: "bridge_mark_all_seen",
    description:
      "Mark all the user's Concept Bridges as seen. Use this after the user has reviewed their bridges or when they dismiss the bridge notifications.",
    proOnly: true,
    destructive: true,
    parameters: [],
    handler: async (_args, { userId }) => {
      await markAllBridgesSeen(userId);
      return { ok: true };
    },
  },
  {
    name: "open_bridge",
    description:
      "Open the Concept Bridge app on the user's desktop so they can explore their interdisciplinary connections visually.",
    clientAction: true,
    proOnly: true,
    parameters: [],
    handler: async () => ({ action: "open_bridge" }),
  },
];
