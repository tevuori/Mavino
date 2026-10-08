// ===== Athena research tool (multi-step web research with citations) =====
// Orchestrates: DuckDuckGo search → fetch top result pages → LLM synthesis
// with inline [n] citations. Returns a cited answer + source list to the model,
// which then presents it in its response. The client renders sources as chips.

import type { ToolDef } from "./plugin";
import { getUserConfig, buildModel, acquireLlmModel } from "../llm";
import { generateText } from "../../study/llm-json";
import { webSearch } from "../../../services/search";
import { fetchUrl } from "../../../services/fetcher";
import { researchSynthesizePrompt, researchRefinePrompt } from "../../study/prompts";
import { logSessionSafe } from "../../study/logSession";

type ResearchDepth = "quick" | "standard" | "deep";

const DEPTH_CONFIG: Record<ResearchDepth, { searches: number; fetchPerSearch: number; maxCharsPerPage: number }> = {
  quick: { searches: 1, fetchPerSearch: 2, maxCharsPerPage: 4000 },
  standard: { searches: 1, fetchPerSearch: 4, maxCharsPerPage: 6000 },
  deep: { searches: 2, fetchPerSearch: 3, maxCharsPerPage: 6000 },
};

export const researchTools: ToolDef[] = [
  {
    name: "research",
    description:
      "Research a topic on the web and return a synthesized answer with inline citations. Runs a web search, fetches the top result pages, and synthesizes a cited answer. Prefer this over web_search + fetch_url when the user wants a thorough answer to a factual question (e.g. 'research the causes of X', 'look up Y and summarize'). Depth: 'quick' (2 sources), 'standard' (4 sources, default), 'deep' (2 searches, 6 sources).",
    parameters: [
      { name: "query", type: "string", description: "Research question or topic", required: true },
      {
        name: "depth",
        type: "string",
        description: "Research depth",
        enum: ["quick", "standard", "deep"],
      },
    ],
    handler: async (args, { userId }) => {
      const cfg = await getUserConfig(userId);
      if (!cfg.apiKey) return { error: "No AI provider configured." };
      const { model } = await acquireLlmModel(userId, { feature: "research" });

      const query = String(args.query ?? "").trim();
      if (!query) return { error: "query is required" };

      const depth = (["quick", "standard", "deep"].includes(String(args.depth))
        ? String(args.depth)
        : "standard") as ResearchDepth;
      const config = DEPTH_CONFIG[depth];

      const searchedQueries: string[] = [query];
      const sources: { index: number; title: string; url: string; content: string }[] = [];
      let sourceIndex = 1;

      // First search.
      let searchRes = await webSearch(query, { count: config.fetchPerSearch * 2 });
      let resultsToFetch = searchRes.results.slice(0, config.fetchPerSearch);

      // For 'deep' depth, generate a refined second query.
      if (depth === "deep") {
        try {
          const refined = await generateText(
            model,
            researchRefinePrompt(query),
            "Return only the query text."
          );
          const refinedQuery = refined.trim().replace(/^["']|["']$/g, "");
          if (refinedQuery && refinedQuery.toLowerCase() !== query.toLowerCase()) {
            searchedQueries.push(refinedQuery);
            const search2 = await webSearch(refinedQuery, { count: config.fetchPerSearch * 2 });
            resultsToFetch = [...resultsToFetch, ...search2.results.slice(0, config.fetchPerSearch)];
          }
        } catch {
          // refined query is optional — continue with just the original.
        }
      }

      // Fetch pages in parallel (with a concurrency cap of 4).
      const uniqueUrls = new Set<string>();
      const fetchTargets = resultsToFetch.filter((r) => {
        if (uniqueUrls.has(r.url)) return false;
        uniqueUrls.add(r.url);
        return true;
      });

      const concurrency = 4;
      for (let i = 0; i < fetchTargets.length; i += concurrency) {
        const batch = fetchTargets.slice(i, i + concurrency);
        const pages = await Promise.allSettled(
          batch.map((r) => fetchUrl(r.url, config.maxCharsPerPage))
        );
        for (const p of pages) {
          if (p.status === "fulfilled" && p.value.content.trim().length > 100) {
            sources.push({
              index: sourceIndex++,
              title: p.value.title,
              url: p.value.finalUrl,
              content: p.value.content,
            });
          }
        }
      }

      if (sources.length === 0) {
        return {
          query,
          searchedQueries,
          answer: "I couldn't retrieve any usable content from the search results. Try rephrasing the query or using web_search to see the raw snippets.",
          sources: [],
          sourceCount: 0,
        };
      }

      // Synthesize a cited answer.
      let answer: string;
      try {
        answer = await generateText(
          model,
          researchSynthesizePrompt(query, sources),
          "You are a research assistant. Synthesize an accurate, well-cited answer using only the provided sources."
        );
      } catch (e) {
        return {
          error: `Research synthesis failed: ${e instanceof Error ? e.message : "unknown"}`,
          query,
          searchedQueries,
          sources: sources.map((s) => ({ index: s.index, title: s.title, url: s.url })),
        };
      }

      await logSessionSafe(userId, "research", query, "web", {
        depth,
        sourceCount: sources.length,
        searchedQueries,
      });

      return {
        query,
        searchedQueries,
        answer,
        sources: sources.map((s) => ({ index: s.index, title: s.title, url: s.url })),
        sourceCount: sources.length,
      };
    },
  },
];
