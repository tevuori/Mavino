// ===== Proactive alerts scheduler =====
// A 60-second tick that fires due ProactiveAlertConfig rows. For each due
// user, runs an Athena LLM turn (with tools) that gathers context from the
// workspace (calendar, tasks, habits, due flashcards) and publishes a concise
// daily briefing to the user's ntfy notify topic. After firing, nextRunAt is
// recomputed to the next occurrence of the configured hour:minute.
//
// Requires both ntfy (publish channel) and an LLM provider to be configured;
// otherwise the tick skips the user and reschedules without firing.

import { Message } from "multi-llm-ts";
import prisma from "../../db/client";
import { decryptNtfyConfig, isNtfyEnabled } from "./config";
import { publish, type NtfyUsableConfig } from "./client";
import { isAthenaReady } from "./athena-turn";
import { acquireLlmModel, getUserConfig } from "../athena/llm";
import { buildSystemPrompt } from "../athena/context";
import { AthenaToolsPlugin, toolsForAssistant } from "../athena/tools";
import { getUserTimezone, computeNextOccurrence } from "../timezone";

const TICK_MS = 60_000;
const MAX_BODY_LEN = 4000;
// Proactive alerts are non-interactive, so we can afford aggressive retries.
const TURN_RETRIES = 3; // retry the entire generation this many times
const FETCH_RETRIES = 8; // per-fetch retries within a turn
const RETRY_BASE_MS = 3000; // base backoff for fetch retries

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a proactive Athena turn with aggressive retry logic. Unlike
 * runAthenaTurn (designed for interactive chat, gives up fast), this is
 * non-interactive and can afford to retry heavily — some LLM endpoints
 * drop connections mid-generation.
 *
 * Key optimization: tool results from the first attempt are captured and
 * injected into retry turns, so retries don't re-fetch the same data. The
 * flaky endpoint typically drops during text generation (after tools complete),
 * so this avoids redundant tool calls on retry.
 *
 * Handles:
 *   - Network-level errors (fetch throws TypeError on connection drop)
 *   - HTTP 5xx server errors
 *   - HTTP 400 "upstream request failed" (transient provider errors)
 *   - Top-level turn retries with tool-result caching (no re-gathering)
 */
async function runProactiveTurn(userId: string, userText: string): Promise<string | null> {
  const cfg = await getUserConfig(userId);
  if (!cfg.apiKey) return null;

  const systemPrompt = await buildSystemPrompt(userId, []);

  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const role = userRow?.role ?? "FREE";

  // Accumulated tool results from prior attempts — injected into retry turns
  // so Athena doesn't re-call tools it already ran.
  let gatheredContext = "";

  for (let turnAttempt = 0; turnAttempt < TURN_RETRIES; turnAttempt++) {
    // On retry, append the gathered context so Athena can skip re-calling tools.
    const effectivePrompt = gatheredContext
      ? `${userText}\n\n---\nContext already gathered from your tools (do NOT re-call these tools — use this data directly):\n${gatheredContext}\n---\nNow write the briefing based on the above.`
      : userText;

    const thread: Message[] = [
      new Message("system", systemPrompt),
      new Message("user", effectivePrompt),
    ];

    const { model } = await acquireLlmModel(userId);
    const allowedTools = await toolsForAssistant(userId, role, []);
    const plugin = new AthenaToolsPlugin(allowedTools, { userId, windows: [] });
    model.addPlugin(plugin);

    // Patch fetch with aggressive retry: catches network throws + 5xx + 400.
    const engine = (model as any).engine;
    const client = engine?.client;
    if (client && typeof client.fetch === "function") {
      const origFetch = client.fetch.bind(client);
      client.fetch = async (url: string, init?: any) => {
        for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
          try {
            const res = await origFetch(url, init);
            // Retry on 5xx or 400 "upstream request failed"
            if (res.status >= 500 || res.status === 400) {
              const shouldRetry = await shouldRetryResponse(res, attempt, FETCH_RETRIES);
              if (shouldRetry) continue;
            }
            return res;
          } catch (e) {
            // Network-level error (connection drop, DNS, timeout) — retry
            if (attempt < FETCH_RETRIES) {
              const base = Math.min(RETRY_BASE_MS * 2 ** attempt, 30000);
              const jitter = Math.floor(Math.random() * 1000);
              await sleep(base + jitter);
              continue;
            }
            throw e;
          }
        }
        return origFetch(url, init);
      };
    }

    let text = "";
    let completedTools = 0;
    let failedTools = 0;
    const newToolResults: string[] = [];

    try {
      for await (const chunk of model.generate(thread, { tools: true })) {
        if (chunk.type === "content") {
          text += chunk.text ?? "";
        } else if (chunk.type === "tool" && chunk.state === "completed") {
          const call = chunk.call;
          const result = call?.result as any;
          const isError = result && typeof result === "object" && "error" in result;
          if (isError) {
            failedTools++;
          } else {
            completedTools++;
            // Cache the tool result for retry injection.
            const toolName = (chunk as any).name ?? "unknown";
            const summary = summarizeToolResult(toolName, result);
            if (summary) newToolResults.push(summary);
          }
        }
      }
      const result = text.trim();
      if (result) return result;
      // Empty text but no error — cache tools and try once more.
      if (newToolResults.length) {
        gatheredContext += newToolResults.join("\n");
      }
      if (turnAttempt < TURN_RETRIES - 1) {
        await sleep(5000);
        continue;
      }
      return "(no response)";
    } catch (e) {
      // Cache whatever tools completed before the failure.
      if (newToolResults.length) {
        gatheredContext += newToolResults.join("\n");
      }
      const msg = e instanceof Error ? e.message : "unknown";
      const isTransient = /upstream|timeout|fetch|network|connection|ECONN/i.test(msg);
      if (isTransient && turnAttempt < TURN_RETRIES - 1) {
        console.error(
          `[proactive] turn ${turnAttempt + 1}/${TURN_RETRIES} failed (${msg}), ` +
            `retrying with ${completedTools} cached tool result${completedTools === 1 ? "" : "s"}...`
        );
        await sleep(8000 * (turnAttempt + 1));
        continue;
      }
      // Last attempt failed — return an honest error.
      if (completedTools > 0) {
        return (
          `I gathered your workspace context (${completedTools} tool call${completedTools > 1 ? "s" : ""} ` +
          `succeeded) but couldn't generate the final briefing — the AI provider was unavailable. ` +
          `Try again later or configure a more reliable provider in Settings → Mavino Assistant.`
        );
      }
      throw e;
    }
  }
  return "(no response)";
}

/**
 * Summarize a tool result into a compact text string for retry injection.
 * Truncates large results to avoid blowing up the prompt.
 */
function summarizeToolResult(toolName: string, result: any): string {
  if (!result) return "";
  try {
    const json = typeof result === "string" ? result : JSON.stringify(result);
    // Truncate to 800 chars per tool to keep the retry prompt manageable.
    const truncated = json.length > 800 ? json.slice(0, 800) + "…(truncated)" : json;
    return `[${toolName}] → ${truncated}`;
  } catch {
    return `[${toolName}] → (unserializable result)`;
  }
}

/** Check if an HTTP error response is transient and should be retried. */
async function shouldRetryResponse(
  res: Response,
  attempt: number,
  maxRetries: number
): Promise<boolean> {
  if (attempt >= maxRetries) return false;
  if (res.status >= 500) return true; // 5xx always retry
  // 400: only retry if "upstream request failed"
  if (res.status === 400) {
    try {
      const cloned = res.clone();
      const body = await cloned.json();
      const msg = (body as any)?.error?.message ?? (body as any)?.message ?? "";
      return /upstream request failed/i.test(msg);
    } catch {
      return false;
    }
  }
  return false;
}

/** Compute the next occurrence of hour:minute after `from` (defaults to now).
 *  Pass `tz` (IANA name) to evaluate the wall-clock time in the user's
 *  timezone; omit for the server's local timezone (legacy behavior). */
export function computeNextRunAt(
  hour: number,
  minute: number,
  from: Date = new Date(),
  tz?: string
): Date {
  if (tz) return computeNextOccurrence(hour, minute, tz, from);
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/** Sanitize/normalize a comma-separated category list against the known set. */
export function normalizeCategories(raw: string): string[] {
  const known = ["calendar", "tasks", "flashcards", "habits"];
  const parts = (raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => known.includes(s));
  return parts.length ? Array.from(new Set(parts)) : known;
}

/** Build the proactive briefing prompt from the enabled categories. */
export function buildProactivePrompt(categories: string[], customPrompt: string): string {
  if (customPrompt.trim()) return customPrompt.trim();

  const lines: string[] = [
    "This is your proactive daily check-in. Use your tools to review the user's workspace and give a concise, friendly briefing (max ~150 words).",
  ];
  if (categories.includes("calendar")) {
    lines.push(
      "- Calendar: call list_calendar_events for today and tomorrow to surface upcoming classes, exams, or appointments."
    );
  }
  if (categories.includes("tasks")) {
    lines.push(
      "- Tasks: call list_tasks for open tasks, highlighting any due today or tomorrow."
    );
  }
  if (categories.includes("flashcards")) {
    lines.push(
      "- Flashcards: the workspace summary already shows how many cards are due for review — mention the count and suggest a review session if any are due."
    );
  }
  if (categories.includes("habits")) {
    lines.push(
      "- Habits: call list_habits to check streaks and which daily habits haven't been completed yet today."
    );
  }
  lines.push(
    "Even if there is nothing urgent or due, still send a brief encouraging message so the user knows the channel is alive. End with one concrete suggestion for the day. Do not use tool calls that open windows or create items unless asked — this is a read-only briefing."
  );
  return lines.join("\n");
}

async function fireAlert(cfg: {
  id: string;
  userId: string;
  categories: string;
  customPrompt: string;
}): Promise<string> {
  // Both ntfy and an LLM provider must be configured.
  const [ntfyReady, athenaReady] = await Promise.all([
    isNtfyEnabled(cfg.userId),
    isAthenaReady(cfg.userId),
  ]);
  if (!ntfyReady || !athenaReady) {
    return "[Proactive alert skipped — ntfy or Mavino LLM not configured.]";
  }

  const ntfyCfg: NtfyUsableConfig | null = await decryptNtfyConfig(cfg.userId);
  if (!ntfyCfg) {
    return "[Proactive alert skipped — ntfy config missing.]";
  }

  const categories = normalizeCategories(cfg.categories);
  const prompt = buildProactivePrompt(categories, cfg.customPrompt);

  let body = "";
  try {
    const reply = await runProactiveTurn(cfg.userId, prompt);
    body = reply ?? "[Mavino is not configured with an AI provider — cannot generate a briefing.]";
  } catch (e) {
    body = `[Proactive alert error: ${e instanceof Error ? e.message : "unknown"}]`;
  }

  body = body.slice(0, MAX_BODY_LEN);
  const title = "Mavino daily briefing";

  try {
    await publish(ntfyCfg, {
      topic: ntfyCfg.notifyTopic,
      title,
      body,
      priority: ntfyCfg.defaultPriority,
      tags: "bell",
    });
    await prisma.ntfyMessage.create({
      data: {
        userId: cfg.userId,
        direction: "proactive",
        topic: ntfyCfg.notifyTopic,
        title,
        body,
        priority: ntfyCfg.defaultPriority,
        tags: "bell",
      },
    });
  } catch (e) {
    console.error(
      `[proactive] publish failed (user ${cfg.userId}):`,
      e instanceof Error ? e.message : e
    );
  }
  return body;
}

async function tick(): Promise<void> {
  if (running) return; // guard against overlap
  running = true;
  try {
    const now = new Date();
    const due = await prisma.proactiveAlertConfig.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      take: 100,
    });
    for (const cfg of due) {
      try {
        await fireAlert(cfg);
      } catch (e) {
        console.error(
          `[proactive] fire error (user ${cfg.userId}):`,
          e instanceof Error ? e.message : e
        );
      }
      // Reschedule to the next occurrence of the configured time in the user's
      // timezone so the wall-clock hour:minute matches their locale.
      const tz = await getUserTimezone(cfg.userId);
      const next = computeNextRunAt(cfg.hour, cfg.minute, new Date(), tz);
      await prisma.proactiveAlertConfig.update({
        where: { id: cfg.id },
        data: { lastRunAt: new Date(), nextRunAt: next },
      });
    }
  } finally {
    running = false;
  }
}

/** Start the scheduler (idempotent). */
export function startProactiveScheduler(): void {
  if (timer) return;
  setTimeout(
    () => tick().catch((e) => console.error("[proactive] scheduler tick error:", e)),
    5000
  );
  timer = setInterval(
    () => tick().catch((e) => console.error("[proactive] scheduler tick error:", e)),
    TICK_MS
  );
}

export function stopProactiveScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Fire a one-off alert immediately (used by the "test" endpoint). Returns the generated body. */
export async function runProactiveAlertNow(userId: string): Promise<string> {
  const cfg = await prisma.proactiveAlertConfig.findUnique({ where: { userId } });
  if (!cfg) {
    return "[No proactive alert config — enable proactive alerts first.]";
  }
  return fireAlert({
    id: cfg.id,
    userId: cfg.userId,
    categories: cfg.categories,
    customPrompt: cfg.customPrompt,
  });
}
