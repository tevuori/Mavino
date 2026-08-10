import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { streamSSE } from "hono/streaming";
import { Message } from "multi-llm-ts";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { authMiddleware } from "../middleware/auth";
import { buildModel, getUserConfig, LlmError, acquireLlmModel } from "../services/athena/llm";
import { buildSystemPrompt } from "../services/athena/context";
import {
  AthenaToolsPlugin,
  toolsForRole,
  CLIENT_ACTION_TOOLS,
  DESTRUCTIVE_TOOLS,
  toolManifest,
  type ClientWindowInfo,
} from "../services/athena/tools";
import { generateJson } from "../services/study/llm-json";
import prisma from "../db/client";
import { getStorageStatus } from "../services/storage-quota";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
const TEMP_DIR = path.join(UPLOAD_DIR, "temp");

// Accepted file types for Athena attachment
const ACCEPTED_EXT = new Set(["pdf", "txt", "c", "h", "cpp", "cc", "cxx", "hpp", "java", "ts", "tsx", "js", "jsx", "py", "md"]);

function isAcceptedFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ACCEPTED_EXT.has(ext);
}

function isTextFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext !== "pdf";
}

const athena = new Hono();
athena.use("*", authMiddleware);

/** GET /api/athena/tools — list available tools (for client UI).
 *  Paid-only tools (e.g. run_code sandbox) are hidden from FREE/DEMO users. */
athena.get("/tools", async (c) => {
  const { userId } = c.get("auth");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const role = user?.role ?? "FREE";
  return c.json({ tools: toolManifest(role) });
});

// ---------- Custom instructions (injected into the system prompt) ----------

/** GET /api/athena/instructions — fetch the user's custom Athena instructions. */
athena.get("/instructions", async (c) => {
  const { userId } = c.get("auth");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { athenaInstructions: true },
  });
  return c.json({ instructions: user?.athenaInstructions ?? "" });
});

const instructionsSchema = z.object({
  instructions: z.string().max(4000),
});

/** PUT /api/athena/instructions — save the user's custom Athena instructions. */
athena.put("/instructions", zValidator("json", instructionsSchema), async (c) => {
  const { userId } = c.get("auth");
  await prisma.user.update({
    where: { id: userId },
    data: { athenaInstructions: c.req.valid("json").instructions },
  });
  return c.json({ ok: true });
});

const windowSchema = z.object({
  id: z.string(),
  appId: z.string(),
  title: z.string(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  minimized: z.boolean().default(false),
  focused: z.boolean().default(false),
  browserUrl: z.string().optional(),
  mapsCenter: z
    .object({ lat: z.number(), lon: z.number(), zoom: z.number() })
    .optional(),
});

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        // The attach endpoint truncates file/PDF text to 50k chars, and the
        // client injects that text into a user message (plus wrapper text).
        // Keep this comfortably above the attach limit so large attachments
        // don't trip validation (which previously caused a 400 + "[object Object]").
        content: z.string().min(1).max(100000),
      })
    )
    .min(1)
    .max(50),
  /** Current open windows on the client (for window management tools + context). */
  windows: z.array(windowSchema).default([]),
});

/** Format a zValidator failure into a human-readable string for the client. */
function formatZodError(result: { success: false; error: z.ZodError }): string {
  const issues = result.error.issues;
  if (!issues.length) return "Invalid request body";
  const first = issues[0];
  const path = first.path.length ? first.path.join(".") : "(root)";
  return `Invalid request: ${first.message} (at ${path})`;
}

/**
 * POST /api/athena/chat — streaming agent turn.
 * Emits SSE events: content | tool | client_action | usage | error | done.
 * The client reads this with fetch + ReadableStream (EventSource can't POST).
 */
athena.post("/chat", zValidator("json", chatSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: formatZodError(result as any) }, 400);
  }
}), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  const cfg = await getUserConfig(userId);
  if (!cfg.apiKey) {
    return c.json(
      { error: "No AI provider configured. Add an API key in Settings → AI." },
      400
    );
  }
  let acquired;
  try {
    acquired = await acquireLlmModel(userId);
  } catch (e) {
    if (e instanceof LlmError) return c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500);
    return c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500);
  }

  const clientWindows: ClientWindowInfo[] = body.windows ?? [];
  const systemPrompt = await buildSystemPrompt(userId, clientWindows);

  // Load the user's role to filter paid-only tools (e.g. run_code sandbox).
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const role = userRow?.role ?? "FREE";
  const allowedTools = toolsForRole(role);

  // Build the message list, ensuring alternating user/assistant roles.
  // Some providers (DeepSeek/OpenAI) reject consecutive same-role messages
  // with 400. If the client sends two user messages in a row (e.g. because
  // an assistant turn with only tool calls was omitted), insert a placeholder.
  const rawMessages = body.messages;
  const fixedMessages: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of rawMessages) {
    const last = fixedMessages[fixedMessages.length - 1];
    if (last && last.role === m.role) {
      // Consecutive same-role — insert a placeholder of the opposite role.
      fixedMessages.push({
        role: m.role === "user" ? "assistant" : "user",
        content: "(Done)",
      });
    }
    fixedMessages.push({ role: m.role as "user" | "assistant", content: m.content });
  }

  // Use Message instances (multi-llm-ts expects them for vision checks etc.)
  const thread: Message[] = [
    new Message("system", systemPrompt),
    ...fixedMessages.map((m) => new Message(m.role, m.content)),
  ];

  // Abort when the client disconnects.
  const abort = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => abort.abort());

  return streamSSE(
    c,
    async (stream) => {
      const model = acquired.model;
      const plugin = new AthenaToolsPlugin(allowedTools, {
        userId,
        windows: clientWindows,
      });
      model.addPlugin(plugin);

      // Patch the internal OpenAI client's fetch to retry on transient
      // failures from the provider. Two classes of transient failure are
      // handled:
      //   1. HTTP 400 "Upstream request failed" — the provider's upstream
      //      dropped mid-request but returned a 400 wrapper. Happens
      //      intermittently during multi-step tool call loops and is not a
      //      request format issue.
      //   2. Network-level throws — fetch() rejects with no Response at all
      //      (connection reset, socket hangup, DNS hiccup, ETIMEDOUT, abort
      //      due to provider-side timeout). Previously these propagated
      //      immediately and killed the whole turn even when tools had
      //      already completed, surfacing as an opaque "network error" /
      //      "Failed to fetch" / "fetch failed" to the user.
      const engine = (model as any).engine;
      const client = engine?.client;
      if (client && typeof client.fetch === "function") {
        const origFetch = client.fetch.bind(client);
        const backoff = (attempt: number) =>
          Math.min(2000 * 2 ** attempt, 32000) + Math.floor(Math.random() * 500);
        client.fetch = async (url: string, init?: any) => {
          const maxRetries = 5;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            // --- Network-level failure: fetch itself throws (no Response) ---
            let res: Response;
            try {
              res = await origFetch(url, init);
            } catch (e) {
              // Don't retry if the caller aborted (user navigated away).
              const isAbort = (e instanceof Error && e.name === "AbortError")
                || (init?.signal as AbortSignal | undefined)?.aborted;
              if (isAbort || attempt === maxRetries) throw e;
              const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
              console.warn(
                `[athena] network error from provider (attempt ${attempt + 1}/${maxRetries + 1}): ${reason}`
              );
              await new Promise((r) => setTimeout(r, backoff(attempt)));
              continue;
            }
            // --- HTTP 400 "Upstream request failed" (transient wrapper) ---
            if (res.status !== 400 || attempt === maxRetries) return res;
            const cloned = res.clone();
            let isTransient = false;
            let rawBody = "";
            try {
              rawBody = await cloned.text();
              let body: any;
              try { body = JSON.parse(rawBody); } catch { body = null; }
              const msg = body?.error?.message ?? body?.message ?? rawBody;
              isTransient = /upstream request failed/i.test(msg);
              // Log the real underlying error so we can diagnose provider
              // issues instead of seeing only the wrapped "Upstream request
              // failed" message. Also log whether reasoning_content is being
              // sent in the request payload (DeepSeek V4 thinking mode
              // requires it on follow-up turns).
              let hasReasoningContent = false;
              let msgRoles: string[] = [];
              try {
                const payload = init?.body ? JSON.parse(init.body) : null;
                if (Array.isArray(payload?.messages)) {
                  msgRoles = payload.messages.map((m: any) => m.role);
                  hasReasoningContent = payload.messages.some(
                    (m: any) => m.role === "assistant" && "reasoning_content" in m
                  );
                }
              } catch { /* payload not JSON */ }
              console.warn(
                `[athena] 400 from provider (attempt ${attempt + 1}/${maxRetries + 1})`,
                `\n  url: ${url}`,
                `\n  body: ${rawBody.slice(0, 500)}`,
                `\n  msg roles: [${msgRoles.join(", ")}]`,
                `\n  assistant turns with reasoning_content: ${hasReasoningContent}`,
                `\n  isTransient (will retry): ${isTransient}`
              );
            } catch { /* not readable */ }
            if (!isTransient) return res;
            await new Promise((r) => setTimeout(r, backoff(attempt)));
          }
          return origFetch(url, init);
        };
      }

      // Track successfully completed tool calls so we can produce a graceful
      // fallback message if the final text generation fails with a transient
      // upstream error *after* the requested actions were already performed.
      let completedTools = 0;
      let failedTools = 0;

      try {
        for await (const chunk of model.generate(thread, {
          tools: true,
          abortSignal: abort.signal,
        })) {
          if (chunk.type === "content") {
            await stream.writeSSE({
              event: "content",
              data: JSON.stringify({ text: chunk.text ?? "", done: chunk.done }),
            });
          } else if (chunk.type === "reasoning") {
            await stream.writeSSE({
              event: "reasoning",
              data: JSON.stringify({ text: chunk.text ?? "" }),
            });
          } else if (chunk.type === "tool") {
            await stream.writeSSE({
              event: "tool",
              data: JSON.stringify({
                id: chunk.id,
                name: chunk.name,
                state: chunk.state,
                status: chunk.status ?? "",
                result: chunk.state === "completed" ? chunk.call?.result : undefined,
              }),
            });
            if (chunk.state === "completed") {
              const result = chunk.call?.result as any;
              if (result && typeof result === "object" && "error" in result) {
                failedTools++;
              } else {
                completedTools++;
              }
              // Emit a data_change event so already-open apps can refresh
              // their data after Athena mutates it (e.g. create_note → the
              // Notes app reloads its list without being reopened).
              if (
                DESTRUCTIVE_TOOLS.has(chunk.name) &&
                result &&
                !result?.error
              ) {
                await stream.writeSSE({
                  event: "data_change",
                  data: JSON.stringify({ tool: chunk.name }),
                });
              }
              if (
                CLIENT_ACTION_TOOLS.has(chunk.name) &&
                result &&
                !result?.error
              ) {
                await stream.writeSSE({
                  event: "client_action",
                  data: JSON.stringify({
                    tool: chunk.name,
                    payload: result,
                  }),
                });
              }
            }
          } else if (chunk.type === "usage") {
            await stream.writeSSE({
              event: "usage",
              data: JSON.stringify({ usage: chunk.usage }),
            });
          }
        }
        await stream.writeSSE({ event: "done", data: "{}" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Mavino request failed";
        const status = e instanceof LlmError ? e.status : 500;
        console.error("[athena] chat error:", msg);
        if (e instanceof Error) {
          const err = e as any;
          console.error("[athena] error details:", {
            status: err.status,
            code: err.code,
            type: err.type,
            error: err.error,
            requestID: err.requestID,
          });
        }

        // Graceful fallback: if the model already completed tool calls
        // successfully (e.g. created tasks/notes) but the final text
        // generation failed with a transient error, tell the user their
        // actions were performed instead of showing a raw error. Covers both
        // the provider's "Upstream request failed" 400 wrapper and raw
        // network-level failures (fetch rejected: "network error",
        // "Failed to fetch", "fetch failed", socket hangup, ETIMEDOUT, etc.)
        // — the latter previously surfaced as an opaque "network error" even
        // though all requested actions had already succeeded.
        const isTransientError =
          /upstream request failed/i.test(msg) ||
          /network error|failed to fetch|fetch failed|socket hang up|etimedout|econnreset|econnrefused|terminated/i.test(msg);
        if (isTransientError && completedTools > 0 && failedTools === 0) {
          const fallbackText =
            `I completed ${completedTools} action${completedTools > 1 ? "s" : ""} ` +
            `you requested, but my connection to the AI provider dropped while ` +
            `generating this final response (transient network error). ` +
            `Everything was saved successfully — no need to resend.`;
          await stream.writeSSE({
            event: "content",
            data: JSON.stringify({ text: fallbackText, done: true }),
          });
          await stream.writeSSE({ event: "done", data: "{}" });
        } else if (isTransientError && completedTools > 0) {
          const fallbackText =
            `I completed ${completedTools} action${completedTools > 1 ? "s" : ""} ` +
            `(${failedTools} reported an error), but my connection to the AI ` +
            `provider dropped while generating this final response ` +
            `(transient network error). Please verify the results.`;
          await stream.writeSSE({
            event: "content",
            data: JSON.stringify({ text: fallbackText, done: true }),
          });
          await stream.writeSSE({ event: "done", data: "{}" });
        } else {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: msg, status }),
          });
        }
      }
    },
    (err, stream) =>
      stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: err.message }),
      })
  );
});

// ===== File attachment endpoints =====

/**
 * POST /api/athena/attach — upload a file, extract text, return it for chat context.
 * Accepts multipart: file field "file".
 * Stores the file temporarily so it can be saved to permanent storage later.
 * Returns: { tempId, fileName, fileType, fileSize, text, truncated }
 */
athena.post("/attach", async (c) => {
  const { userId } = c.get("auth");
  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }
  if (!isAcceptedFile(file.name)) {
    return c.json({ error: `File type not supported. Accepted: ${[...ACCEPTED_EXT].join(", ")}` }, 400);
  }
  if (file.size > 20 * 1024 * 1024) {
    return c.json({ error: "File too large (max 20 MB)" }, 400);
  }

  // Store temporarily.
  const tempId = `${userId}/${Date.now()}-${path.basename(file.name).replace(/[^\w.\- ]+/g, "_")}`;
  const tempPath = path.join(TEMP_DIR, tempId);
  await mkdir(path.dirname(tempPath), { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(tempPath, buf);

  // Extract text.
  let text = "";
  let truncated = false;
  const MAX_CHARS = 50_000; // ~50k chars max for chat context

  if (isTextFile(file.name)) {
    text = buf.toString("utf-8");
  } else {
    // PDF extraction using pdf-parse v2 API
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      const result = await parser.getText();
      text = result.text || "";
      await parser.destroy();
    } catch (e) {
      // If PDF parsing fails, return a placeholder so the user knows.
      text = `[PDF text extraction failed: ${e instanceof Error ? e.message : "unknown error"}]`;
    }
  }

  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return c.json({
    tempId,
    fileName: file.name,
    fileType: ext,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    text,
    truncated,
    tempPath: tempId, // relative path for later save
  }, 201);
});

/**
 * POST /api/athena/save-attached — save a temporarily uploaded file to permanent
 * storage in a specific folder. Also marks it as opened (recent files).
 * Body: { tempPath, folderId?, name? }
 */
const saveAttachedSchema = z.object({
  tempPath: z.string().min(1),
  folderId: z.string().nullable().optional(),
  name: z.string().optional(),
});

athena.post("/save-attached", zValidator("json", saveAttachedSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  const srcPath = path.join(TEMP_DIR, body.tempPath);
  try {
    await readFile(srcPath);
  } catch {
    return c.json({ error: "Temporary file not found — it may have expired." }, 404);
  }

  const name = body.name || path.basename(body.tempPath).replace(/^\d+-/, "");
  const safeName = path.basename(name).replace(/[^\w.\- ]+/g, "_");
  const storageKey = `${userId}/${Date.now()}-${safeName}`;
  const destPath = path.join(UPLOAD_DIR, storageKey);
  await mkdir(path.dirname(destPath), { recursive: true });

  // Copy from temp to permanent location.
  const content = await readFile(srcPath);

  // Enforce role-based storage quota before persisting the file.
  const quota = await getStorageStatus(userId, content.length);
  if (!quota.allowed) {
    return c.json({ error: quota.message }, 413);
  }

  await writeFile(destPath, content);

  const ext = path.extname(name).slice(1).toLowerCase();
  const mimeType = ext === "pdf" ? "application/pdf"
    : ext === "md" || ext === "markdown" ? "text/markdown"
    : ext === "json" ? "application/json"
    : ext === "html" || ext === "htm" ? "text/html"
    : ext === "css" ? "text/css"
    : ext === "js" || ext === "jsx" ? "text/javascript"
    : ext === "ts" || ext === "tsx" ? "text/typescript"
    : "text/plain";

  const record = await prisma.vFile.create({
    data: {
      name,
      mimeType,
      size: content.length,
      storageKey,
      folderId: body.folderId ?? null,
      userId,
      lastOpenedAt: new Date(), // Mark as recent
    },
  });

  // Clean up temp file.
  try { await import("node:fs/promises").then(fs => fs.unlink(srcPath)); } catch { /* ok */ }

  return c.json({ file: record }, 201);
});

/**
 * POST /api/athena/suggest-folder — use the LLM to suggest the best folder
 * for saving a file based on its name, content preview, and the user's folder tree.
 * Body: { fileName, contentPreview }
 * Returns: { folderId: string | null, folderPath: string, reason: string, confidence: number }
 */
const suggestFolderSchema = z.object({
  fileName: z.string().min(1),
  contentPreview: z.string().max(5000).default(""),
});

athena.post("/suggest-folder", zValidator("json", suggestFolderSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");

  // Get the user's folder tree.
  const folders = await prisma.vFolder.findMany({ where: { userId }, orderBy: { name: "asc" } });

  if (folders.length === 0) {
    return c.json({
      folderId: null,
      folderPath: "Root",
      reason: "You have no folders yet. The file will be saved at the root level.",
      confidence: 1.0,
    });
  }

  // Build folder paths for the LLM.
  const byId = new Map(folders.map((f) => [f.id, f]));
  function folderPath(id: string): string {
    const parts: string[] = [];
    let curId: string | null = id;
    let guard = 0;
    while (curId && guard++ < 50) {
      const f = byId.get(curId);
      if (!f) break;
      parts.unshift(f.name);
      curId = f.parentId;
    }
    return parts.join("/") || "Root";
  }

  const folderList = folders.map((f) => ({
    id: f.id,
    path: folderPath(f.id),
    name: f.name,
  }));

  // Also get course names for context (Athena might suggest a course-related folder).
  const courses = await prisma.course.findMany({ where: { userId }, select: { name: true } });
  const courseNames = courses.map((c) => c.name);

  const cfg = await getUserConfig(userId);
  if (!cfg.apiKey) {
    // No LLM configured — return root as fallback.
    return c.json({
      folderId: null,
      folderPath: "Root",
      reason: "AI not configured — saving to root. Configure an API key in Settings for smart suggestions.",
      confidence: 0.0,
    });
  }
  let model;
  try {
    model = (await acquireLlmModel(userId)).model;
  } catch (e) {
    if (e instanceof LlmError) return c.json({ error: e.message }, e.status as 400 | 402 | 429 | 500);
    return c.json({ error: e instanceof Error ? e.message : "LLM error" }, 500);
  }
  const prompt = `You are helping organize a student's files. Given a file and the user's folder structure, suggest the BEST folder to save it in.

File name: ${body.fileName}
Content preview (first ~500 chars): ${body.contentPreview.slice(0, 500)}
User's courses: ${courseNames.join(", ") || "none"}

Available folders (id | path):
${folderList.map((f) => `- id=${f.id} | ${f.path}`).join("\n")}

Respond with JSON: { "folderId": "<folder id or null for root>", "reason": "<short explanation>", "confidence": <0-1> }`;

  try {
    const result = await generateJson<{ folderId: string | null; reason: string; confidence: number }>(
      model,
      prompt,
      'Respond with: { "folderId": "string or null", "reason": "string", "confidence": number }'
    );

    // Validate the suggested folderId exists.
    const suggestedId = result.folderId;
    if (suggestedId && !byId.has(suggestedId)) {
      return c.json({
        folderId: null,
        folderPath: "Root",
        reason: `${result.reason} (Note: suggested folder not found, saving to root.)`,
        confidence: result.confidence ?? 0.5,
      });
    }

    return c.json({
      folderId: suggestedId,
      folderPath: suggestedId ? folderPath(suggestedId) : "Root",
      reason: result.reason || "AI suggestion",
      confidence: result.confidence ?? 0.7,
    });
  } catch (e) {
    return c.json({
      folderId: null,
      folderPath: "Root",
      reason: `AI suggestion failed: ${e instanceof Error ? e.message : "unknown"}. Saving to root.`,
      confidence: 0.0,
    });
  }
});

export default athena;
