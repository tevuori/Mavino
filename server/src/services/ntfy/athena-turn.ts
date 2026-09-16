// ===== Non-streaming Athena turn (for ntfy inbound + cron) =====
// Runs a full Athena agent turn (with tools) server-side and returns the
// final text. Used by the ntfy inbox subscriber (user messages from phone)
// and athena-driven cron jobs. Output goes to ntfy instead of an SSE stream.

import { Message } from "multi-llm-ts";
import prisma from "../../db/client";
import { acquireLlmModel, getUserConfig } from "../athena/llm";
import { buildSystemPrompt } from "../athena/context";
import { AthenaToolsPlugin, toolsForAssistant } from "../athena/tools";

/**
 * Run one Athena turn for a user. Returns the assistant's final text reply,
 * or null if no LLM is configured. Tool calls execute normally (e.g. Athena
 * can create a task then reply). Graceful fallback on transient upstream
 * errors after successful tool calls.
 */
export async function runAthenaTurn(
  userId: string,
  userText: string
): Promise<string | null> {
  const cfg = await getUserConfig(userId);
  if (!cfg.apiKey) return null;

  const systemPrompt = await buildSystemPrompt(userId, []);
  const thread: Message[] = [
    new Message("system", systemPrompt),
    new Message("user", userText),
  ];

  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const role = userRow?.role ?? "FREE";

  const { model } = await acquireLlmModel(userId);
  const allowedTools = await toolsForAssistant(userId, role, []);
  const plugin = new AthenaToolsPlugin(allowedTools, { userId, windows: [] });
  model.addPlugin(plugin);

  // Patch the internal OpenAI client's fetch to retry on transient
  // "Upstream request failed" 400 errors (same logic as routes/athena.ts).
  const engine = (model as any).engine;
  const client = engine?.client;
  if (client && typeof client.fetch === "function") {
    const origFetch = client.fetch.bind(client);
    client.fetch = async (url: string, init?: any) => {
      const maxRetries = 5;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const res = await origFetch(url, init);
        if (res.status !== 400 || attempt === maxRetries) return res;
        const cloned = res.clone();
        let isTransient = false;
        try {
          const body = await cloned.json();
          const msg = body?.error?.message ?? body?.message ?? "";
          isTransient = /upstream request failed/i.test(msg);
        } catch {
          /* not JSON */
        }
        if (!isTransient) return res;
        const base = Math.min(2000 * 2 ** attempt, 32000);
        const jitter = Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, base + jitter));
      }
      return origFetch(url, init);
    };
  }

  let text = "";
  let completedTools = 0;
  let failedTools = 0;

  try {
    for await (const chunk of model.generate(thread, { tools: true })) {
      if (chunk.type === "content") {
        text += chunk.text ?? "";
      } else if (chunk.type === "tool" && chunk.state === "completed") {
        const result = chunk.call?.result as any;
        if (result && typeof result === "object" && "error" in result) {
          failedTools++;
        } else {
          completedTools++;
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mavino turn failed";
    const isUpstream = /upstream request failed/i.test(msg);
    if (isUpstream && completedTools > 0 && failedTools === 0) {
      return (
        `I completed ${completedTools} action${completedTools > 1 ? "s" : ""} ` +
        `you requested, but my connection to the AI provider dropped while ` +
        `generating this response. Everything was saved — no need to resend.`
      );
    } else if (isUpstream && completedTools > 0) {
      return (
        `I completed ${completedTools} action${completedTools > 1 ? "s" : ""} ` +
        `(${failedTools} reported an error), but my connection dropped while ` +
        `generating this response. Please verify the results.`
      );
    }
    throw e;
  }

  return text.trim() || "(no response)";
}

/** Convenience: is the LLM configured for this user? */
export async function isAthenaReady(userId: string): Promise<boolean> {
  const cfg = await getUserConfig(userId);
  return Boolean(cfg.apiKey);
}

export { prisma };
