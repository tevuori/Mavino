/**
 * Mavino (Athena) multi-user performance & deployment-readiness test.
 *
 * Spawns N temporary users (default 50), each running a realistic workload
 * concurrently: auth, notes CRUD, tasks CRUD, flashcards, calendar events,
 * Athena LLM chat (SSE), and Study Hub (summarize + flashcard generation).
 * Verifies per-user data isolation and collects latency metrics.
 *
 * === Requirements ===
 *  - Server running (bun run dev or docker compose up)
 *  - Admin credentials (default admin/admin for local dev)
 *  - LLM API key in env vars (OPENAI_API_KEY + optional OPENAI_PROVIDER/OPENAI_BASE_URL/OPENAI_MODEL)
 *    The script sets this as the global LLM key so all test users share it.
 *
 * === Usage ===
 *  bun run scripts/perf-test.ts
 *  bun run scripts/perf-test.ts --users=20 --url=http://localhost:3001
 *  OPENAI_API_KEY=sk-... bun run scripts/perf-test.ts --users=50
 *
 * === CLI flags ===
 *  --users=N         Number of concurrent test users (default 50)
 *  --url=URL         Server base URL (default http://localhost:3001)
 *  --admin-user=U    Admin username (default admin)
 *  --admin-pass=P    Admin password (default admin)
 *  --no-cleanup      Keep test users/data after the run
 *  --skip-llm        Skip LLM-dependent tests (Athena chat, Study Hub)
 *  --login-batch=N   Users per login batch (default 4, to respect rate limit)
 *  --login-delay=Ms  Delay between login batches in ms (default 16000)
 *  --verbose         Print per-request details
 *
 * === Environment variables ===
 *  OPENAI_API_KEY     LLM API key (required for LLM tests unless --skip-llm)
 *  OPENAI_PROVIDER    LLM provider engine id (default openai)
 *  OPENAI_BASE_URL    Custom base URL for OpenAI-compatible endpoints
 *  OPENAI_MODEL       Model id (default gpt-4o-mini)
 */

// ---------- Types ----------

interface TestUser {
  username: string;
  password: string;
  userId: string;
  token: string;
}

interface OpResult {
  op: string;
  user: string;
  success: boolean;
  durationMs: number;
  error?: string;
  httpStatus?: number;
}

interface Metrics {
  op: string;
  count: number;
  successes: number;
  failures: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  avgMs: number;
}

// ---------- CLI parsing ----------

function parseArgs(): {
  userCount: number;
  baseUrl: string;
  adminUser: string;
  adminPass: string;
  cleanup: boolean;
  skipLlm: boolean;
  loginBatch: number;
  loginDelayMs: number;
  verbose: boolean;
} {
  const args = process.argv.slice(2);
  const get = (key: string, fallback: string): string => {
    const found = args.find((a) => a.startsWith(`--${key}=`));
    return found ? found.slice(key.length + 3) : fallback;
  };
  return {
    userCount: parseInt(get("users", "50"), 10),
    baseUrl: get("url", "http://localhost:3001").replace(/\/$/, ""),
    adminUser: get("admin-user", "admin"),
    adminPass: get("admin-pass", "admin"),
    cleanup: !args.includes("--no-cleanup"),
    skipLlm: args.includes("--skip-llm"),
    loginBatch: parseInt(get("login-batch", "4"), 10),
    loginDelayMs: parseInt(get("login-delay", "16000"), 10),
    verbose: args.includes("--verbose"),
  };
}

const cfg = parseArgs();

const LLM_API_KEY = process.env.OPENAI_API_KEY ?? "";
const LLM_PROVIDER = process.env.OPENAI_PROVIDER ?? "openai";
const LLM_BASE_URL = process.env.OPENAI_BASE_URL ?? "";
const LLM_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

// ---------- HTTP helpers ----------

async function request(
  method: string,
  url: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; data: any; durationMs: number }> {
  const start = performance.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const durationMs = performance.now() - start;
  let data: any = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, durationMs };
}

/** Parse an SSE stream from a fetch Response, calling onEvent for each event. */
async function consumeSSE(
  res: Response,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData = line.slice(5).trim();
      } else if (line === "" && currentEvent) {
        onEvent(currentEvent, currentData);
        currentEvent = "";
        currentData = "";
      }
    }
  }
  // Flush any trailing event
  if (currentEvent) onEvent(currentEvent, currentData);
}

// ---------- Metrics collection ----------

const results: OpResult[] = [];

function record(r: OpResult): void {
  results.push(r);
  if (cfg.verbose && !r.success) {
    console.log(
      `  [FAIL] ${r.op} @${r.user}: ${r.error ?? `HTTP ${r.httpStatus}`} (${r.durationMs.toFixed(0)}ms)`,
    );
  }
}

function computeMetrics(op: string): Metrics | null {
  const opResults = results.filter((r) => r.op === op);
  if (opResults.length === 0) return null;
  const sorted = opResults.map((r) => r.durationMs).sort((a, b) => a - b);
  const successes = opResults.filter((r) => r.success).length;
  const pct = (p: number): number => sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
  return {
    op,
    count: opResults.length,
    successes,
    failures: opResults.length - successes,
    minMs: sorted[0],
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
    p99Ms: pct(0.99),
    maxMs: sorted[sorted.length - 1],
    avgMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

function printReport(): void {
  console.log("\n" + "=".repeat(80));
  console.log("  MAVINO PERFORMANCE TEST — FINAL REPORT");
  console.log("=".repeat(80));
  console.log(`  Users: ${cfg.userCount}  |  Server: ${cfg.baseUrl}  |  LLM tests: ${cfg.skipLlm ? "SKIPPED" : "ENABLED"}`);
  console.log(`  Total operations: ${results.length}`);
  console.log(`  Total successes:  ${results.filter((r) => r.success).length}`);
  console.log(`  Total failures:   ${results.filter((r) => !r.success).length}`);
  console.log("-".repeat(80));

  // Collect unique op names in insertion order
  const ops: string[] = [];
  for (const r of results) {
    if (!ops.includes(r.op)) ops.push(r.op);
  }

  // Table header
  const fmt = (s: string, w: number): string => s.padEnd(w);
  console.log(
    fmt("Operation", 28) +
      fmt("Count", 7) +
      fmt("OK", 6) +
      fmt("Fail", 6) +
      fmt("Avg", 9) +
      fmt("p50", 9) +
      fmt("p95", 9) +
      fmt("p99", 9) +
      fmt("Max", 9),
  );
  console.log("-".repeat(80));

  for (const op of ops) {
    const m = computeMetrics(op);
    if (!m) continue;
    const f = (v: number): string => `${v.toFixed(0)}ms`;
    console.log(
      fmt(op, 28) +
        fmt(String(m.count), 7) +
        fmt(String(m.successes), 6) +
        fmt(String(m.failures), 6) +
        fmt(f(m.avgMs), 9) +
        fmt(f(m.p50Ms), 9) +
        fmt(f(m.p95Ms), 9) +
        fmt(f(m.p99Ms), 9) +
        fmt(f(m.maxMs), 9),
    );
  }

  const failRate = results.length > 0 ? (results.filter((r) => !r.success).length / results.length) * 100 : 0;
  console.log("-".repeat(80));
  console.log(`  Overall failure rate: ${failRate.toFixed(1)}%`);
  if (failRate > 0) {
    console.log("\n  Failure breakdown:");
    const failByOp: Record<string, number> = {};
    for (const r of results.filter((r) => !r.success)) {
      failByOp[r.op] = (failByOp[r.op] ?? 0) + 1;
    }
    for (const [op, count] of Object.entries(failByOp)) {
      console.log(`    ${op}: ${count} failures`);
    }
  }
  console.log("=".repeat(80));
}

// ---------- Phase: Setup (admin) ----------

async function adminLogin(): Promise<string> {
  const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/auth/login`, null, {
    username: cfg.adminUser,
    password: cfg.adminPass,
  });
  if (status !== 200 || !data?.token) {
    throw new Error(`Admin login failed (HTTP ${status}): ${JSON.stringify(data)}`);
  }
  console.log(`[setup] Admin logged in (${durationMs.toFixed(0)}ms)`);
  return data.token;
}

async function enableRegistration(adminToken: string): Promise<void> {
  const { status, data } = await request("PUT", `${cfg.baseUrl}/api/users/registration`, adminToken, {
    enabled: true,
  });
  if (status !== 200) {
    console.warn(`[setup] Could not enable registration (HTTP ${status}): ${JSON.stringify(data)}`);
  } else {
    console.log("[setup] Open registration enabled");
  }
}

async function setGlobalLlmKey(adminToken: string): Promise<void> {
  if (!LLM_API_KEY) {
    console.warn("[setup] No OPENAI_API_KEY env var — LLM tests will fail. Use --skip-llm to skip them.");
    return;
  }
  // Set mode to global
  const { status: modeStatus } = await request("PUT", `${cfg.baseUrl}/api/admin/llm/mode`, adminToken, {
    mode: "global",
  });
  if (modeStatus !== 200) {
    console.warn(`[setup] Could not set global LLM mode (HTTP ${modeStatus})`);
    return;
  }
  console.log("[setup] LLM mode set to 'global'");

  // Set the global key
  const keyBody: Record<string, string> = {
    apiKey: LLM_API_KEY,
    provider: LLM_PROVIDER,
    modelId: LLM_MODEL,
  };
  if (LLM_BASE_URL) keyBody.baseUrl = LLM_BASE_URL;

  const { status: keyStatus, data } = await request("PUT", `${cfg.baseUrl}/api/admin/llm/key`, adminToken, keyBody);
  if (keyStatus !== 200) {
    console.warn(`[setup] Could not set global LLM key (HTTP ${keyStatus}): ${JSON.stringify(data)}`);
    return;
  }
  console.log(`[setup] Global LLM key set (provider=${LLM_PROVIDER}, model=${LLM_MODEL})`);
}

// ---------- Phase: Create test users ----------

async function createTestUsers(adminToken: string, count: number): Promise<TestUser[]> {
  console.log(`[setup] Creating ${count} test users...`);
  const users: TestUser[] = [];
  const prefix = `perftest_${Date.now()}`;

  for (let i = 0; i < count; i++) {
    const username = `${prefix}_u${i}`;
    const password = `TestPass#${i}!`;
    const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/users`, adminToken, {
      username,
      password,
      displayName: `PerfTest User ${i}`,
      role: "FREE",
    });
    if (status !== 201) {
      console.error(`[setup] Failed to create user ${username} (HTTP ${status}): ${JSON.stringify(data)}`);
      continue;
    }
    users.push({ username, password, userId: data.id, token: "" });
    if ((i + 1) % 10 === 0) console.log(`[setup]   Created ${i + 1}/${count} users`);
  }
  console.log(`[setup] Created ${users.length}/${count} test users`);
  return users;
}

// ---------- Phase: Login users (batched to respect rate limit) ----------

async function loginUsers(users: TestUser[]): Promise<void> {
  console.log(`[login] Logging in ${users.length} users (batch=${cfg.loginBatch}, delay=${cfg.loginDelayMs}ms)...`);
  for (let i = 0; i < users.length; i += cfg.loginBatch) {
    const batch = users.slice(i, i + cfg.loginBatch);
    const promises = batch.map(async (u) => {
      const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/auth/login`, null, {
        username: u.username,
        password: u.password,
      });
      if (status !== 200 || !data?.token) {
        record({
          op: "auth_login",
          user: u.username,
          success: false,
          durationMs,
          error: `HTTP ${status}: ${data?.error ?? "no token"}`,
          httpStatus: status,
        });
        return;
      }
      u.token = data.token;
      u.userId = data.user?.id ?? u.userId;
      record({ op: "auth_login", user: u.username, success: true, durationMs });
    });
    await Promise.all(promises);

    const loggedIn = batch.filter((u) => u.token).length;
    const batchNum = Math.floor(i / cfg.loginBatch) + 1;
    const totalBatches = Math.ceil(users.length / cfg.loginBatch);
    const totalLoggedIn = users.slice(0, i + batch.length).filter((u) => u.token).length;
    console.log(
      `[login]   Batch ${batchNum}/${totalBatches}: ${loggedIn}/${batch.length} logged in ` +
        `(total: ${totalLoggedIn}/${users.length})` +
        (loggedIn < batch.length ? " — SOME FAILURES" : ""),
    );

    // Wait before next batch to respect the 5-per-15s rate limit
    if (i + cfg.loginBatch < users.length) {
      process.stdout.write(`[login]   Waiting ${(cfg.loginDelayMs / 1000).toFixed(0)}s for rate limit...`);
      await sleep(cfg.loginDelayMs);
      process.stdout.write("\r" + " ".repeat(70) + "\r");
    }
  }
  const total = users.filter((u) => u.token).length;
  console.log(`[login] ${total}/${users.length} users logged in successfully`);
}

// ---------- Phase: Per-user workload ----------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomText(words: number): string {
  const vocab = "the quick brown fox jumps over lazy dog students study algorithms data structures hash maps binary trees recursion dynamic programming complexity analysis sorting graphs".split(" ");
  let text = "";
  for (let i = 0; i < words; i++) {
    text += vocab[Math.floor(Math.random() * vocab.length)] + " ";
  }
  return text.trim();
}

async function userWorkload(user: TestUser, index: number): Promise<void> {
  const { token, username } = user;
  const tag = `[u${index}]`;

  // --- Notes CRUD ---
  const noteIds: string[] = [];
  for (let n = 0; n < 3; n++) {
    const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/notes`, token, {
      title: `Note ${n} — ${username}`,
      content: `# Note ${n}\n\n${randomText(50)}`,
      tags: `test,perf,user${index}`,
    });
    record({
      op: "notes_create",
      user: username,
      success: status === 201,
      durationMs,
      httpStatus: status,
      error: status !== 201 ? JSON.stringify(data) : undefined,
    });
    if (data?.note?.id) noteIds.push(data.note.id);
  }

  // List notes
  {
    const { status, data, durationMs } = await request("GET", `${cfg.baseUrl}/api/notes`, token);
    record({
      op: "notes_list",
      user: username,
      success: status === 200,
      durationMs,
      httpStatus: status,
      error: status !== 200 ? JSON.stringify(data) : undefined,
    });
    // Isolation check: verify only own notes are visible
    const notes = data?.notes ?? [];
    const foreignNotes = notes.filter((n: any) => !n.title?.includes(username));
    record({
      op: "isolation_notes",
      user: username,
      success: foreignNotes.length === 0,
      durationMs: 0,
      error: foreignNotes.length > 0 ? `Found ${foreignNotes.length} foreign notes!` : undefined,
    });
  }

  // Update a note
  if (noteIds[0]) {
    const { status, data, durationMs } = await request("PATCH", `${cfg.baseUrl}/api/notes/${noteIds[0]}`, token, {
      title: `Updated Note — ${username}`,
      content: `# Updated\n\n${randomText(30)}`,
    });
    record({
      op: "notes_update",
      user: username,
      success: status === 200,
      durationMs,
      httpStatus: status,
      error: status !== 200 ? JSON.stringify(data) : undefined,
    });
  }

  // Delete a note
  if (noteIds[2]) {
    const { status, durationMs } = await request("DELETE", `${cfg.baseUrl}/api/notes/${noteIds[2]}`, token);
    record({
      op: "notes_delete",
      user: username,
      success: status === 200,
      durationMs,
      httpStatus: status,
    });
  }

  // --- Tasks CRUD ---
  const taskIds: string[] = [];
  for (let t = 0; t < 3; t++) {
    const dueDate = new Date(Date.now() + (t + 1) * 86400000).toISOString();
    const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/tasks`, token, {
      title: `Task ${t} — ${username}`,
      description: randomText(20),
      status: "TODO",
      priority: t === 0 ? "HIGH" : "MEDIUM",
      dueDate,
    });
    record({
      op: "tasks_create",
      user: username,
      success: status === 201,
      durationMs,
      httpStatus: status,
      error: status !== 201 ? JSON.stringify(data) : undefined,
    });
    if (data?.task?.id) taskIds.push(data.task.id);
  }

  // List tasks
  {
    const { status, data, durationMs } = await request("GET", `${cfg.baseUrl}/api/tasks`, token);
    record({
      op: "tasks_list",
      user: username,
      success: status === 200,
      durationMs,
      httpStatus: status,
      error: status !== 200 ? JSON.stringify(data) : undefined,
    });
    const tasks = data?.tasks ?? [];
    const foreignTasks = tasks.filter((t: any) => !t.title?.includes(username));
    record({
      op: "isolation_tasks",
      user: username,
      success: foreignTasks.length === 0,
      durationMs: 0,
      error: foreignTasks.length > 0 ? `Found ${foreignTasks.length} foreign tasks!` : undefined,
    });
  }

  // Update a task to DONE
  if (taskIds[0]) {
    const { status, data, durationMs } = await request("PATCH", `${cfg.baseUrl}/api/tasks/${taskIds[0]}`, token, {
      status: "DONE",
    });
    record({
      op: "tasks_update",
      user: username,
      success: status === 200,
      durationMs,
      httpStatus: status,
      error: status !== 200 ? JSON.stringify(data) : undefined,
    });
  }

  // Delete a task
  if (taskIds[2]) {
    const { status, durationMs } = await request("DELETE", `${cfg.baseUrl}/api/tasks/${taskIds[2]}`, token);
    record({
      op: "tasks_delete",
      user: username,
      success: status === 200,
      durationMs,
      httpStatus: status,
    });
  }

  // --- Flashcards ---
  let deckId: string | null = null;
  {
    const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/flashcards/decks`, token, {
      name: `PerfTest Deck — ${username}`,
      description: "Created by perf test",
      color: "#6366f1",
    });
    record({
      op: "flashcards_create_deck",
      user: username,
      success: status === 201,
      durationMs,
      httpStatus: status,
      error: status !== 201 ? JSON.stringify(data) : undefined,
    });
    deckId = data?.deck?.id ?? null;
  }

  if (deckId) {
    for (let c = 0; c < 5; c++) {
      const { status, data, durationMs } = await request(
        "POST",
        `${cfg.baseUrl}/api/flashcards/decks/${deckId}/cards`,
        token,
        { front: `Question ${c}?`, back: `Answer ${c}.` },
      );
      record({
        op: "flashcards_create_card",
        user: username,
        success: status === 201,
        durationMs,
        httpStatus: status,
        error: status !== 201 ? JSON.stringify(data) : undefined,
      });
    }
  }

  // --- Calendar ---
  {
    const start = new Date(Date.now() + 86400000);
    const end = new Date(Date.now() + 86400000 + 3600000);
    const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/calendar`, token, {
      title: `Study Session — ${username}`,
      description: "Perf test event",
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      color: "#6366f1",
      location: "Library",
    });
    record({
      op: "calendar_create",
      user: username,
      success: status === 201,
      durationMs,
      httpStatus: status,
      error: status !== 201 ? JSON.stringify(data) : undefined,
    });
  }

  // List calendar events
  {
    const { status, data, durationMs } = await request("GET", `${cfg.baseUrl}/api/calendar`, token);
    record({
      op: "calendar_list",
      user: username,
      success: status === 200,
      durationMs,
      httpStatus: status,
      error: status !== 200 ? JSON.stringify(data) : undefined,
    });
  }

  // --- Conversations ---
  let conversationId: string | null = null;
  {
    const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/conversations`, token);
    record({
      op: "conversations_create",
      user: username,
      success: status === 201,
      durationMs,
      httpStatus: status,
      error: status !== 201 ? JSON.stringify(data) : undefined,
    });
    conversationId = data?.conversation?.id ?? null;
  }

  // --- Athena Chat (SSE) ---
  if (!cfg.skipLlm && conversationId) {
    await athenaChat(user, index, conversationId);
  }

  // --- Study Hub: Summarize ---
  if (!cfg.skipLlm) {
    await studySummarize(user, index);
  }

  // --- Study Hub: Flashcards from paste ---
  if (!cfg.skipLlm) {
    await studyFlashcards(user, index);
  }

  // --- Auth: verify token / me ---
  {
    const { status, data, durationMs } = await request("GET", `${cfg.baseUrl}/api/auth/me`, token);
    record({
      op: "auth_me",
      user: username,
      success: status === 200,
      durationMs,
      httpStatus: status,
      error: status !== 200 ? JSON.stringify(data) : undefined,
    });
  }

  if (cfg.verbose) {
    console.log(`  ${tag} workload complete`);
  }
}

async function athenaChat(user: TestUser, index: number, conversationId: string): Promise<void> {
  const { token, username } = user;
  const start = performance.now();
  try {
    const res = await fetch(`${cfg.baseUrl}/api/athena/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: `Hello! I'm a student studying computer science. Can you create a note titled "Study Plan" with a brief study plan for learning data structures? Just create it, don't overthink it.`,
          },
        ],
        windows: [],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      record({
        op: "athena_chat",
        user: username,
        success: false,
        durationMs: performance.now() - start,
        httpStatus: res.status,
        error: text.slice(0, 200),
      });
      return;
    }

    let contentReceived = false;
    let toolCalls = 0;
    let done = false;
    let errorEvent = false;

    await consumeSSE(res, (event, data) => {
      if (event === "content") {
        contentReceived = true;
      } else if (event === "tool") {
        toolCalls++;
      } else if (event === "done") {
        done = true;
      } else if (event === "error") {
        errorEvent = true;
      }
    });

    const durationMs = performance.now() - start;
    record({
      op: "athena_chat",
      user: username,
      success: done && !errorEvent && contentReceived,
      durationMs,
      httpStatus: 200,
      error: errorEvent ? "SSE error event received" : !contentReceived ? "No content received" : undefined,
    });

    if (cfg.verbose) {
      console.log(`  [u${index}] athena_chat: ${durationMs.toFixed(0)}ms, ${toolCalls} tool calls`);
    }

    // Persist the conversation (like the client does after a turn)
    if (conversationId && contentReceived) {
      const { status, durationMs: saveMs } = await request(
        "PUT",
        `${cfg.baseUrl}/api/conversations/${conversationId}`,
        token,
        {
          messages: [
            { role: "user", content: "Create a study plan note" },
            { role: "assistant", content: "I've created a study plan note for you." },
          ],
          title: "Study Plan Request",
        },
      );
      record({
        op: "conversations_save",
        user: username,
        success: status === 200,
        durationMs: saveMs,
        httpStatus: status,
      });
    }
  } catch (e) {
    record({
      op: "athena_chat",
      user: username,
      success: false,
      durationMs: performance.now() - start,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function studySummarize(user: TestUser, index: number): Promise<void> {
  const { token, username } = user;
  const start = performance.now();
  try {
    const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/study/summarize`, token, {
      source: {
        kind: "paste",
        text: `# Binary Search Trees

A binary search tree (BST) is a data structure that maintains elements in sorted order.
Each node has at most two children. The left subtree contains values less than the node,
and the right subtree contains values greater than the node.

## Operations
- Search: O(log n) average, O(n) worst case
- Insert: O(log n) average, O(n) worst case
- Delete: O(log n) average, O(n) worst case

## Traversals
- In-order: left, root, right (produces sorted output)
- Pre-order: root, left, right
- Post-order: left, right, root

## Balancing
Self-balancing BSTs (AVL trees, Red-Black trees) guarantee O(log n) for all operations
by maintaining a height balance invariant.`,
        name: "BST Notes",
      },
      mode: "keypoints",
      saveAsNote: true,
      language: "en",
    });

    record({
      op: "study_summarize",
      user: username,
      success: status === 200 && Boolean(data?.summary),
      durationMs: durationMs,
      httpStatus: status,
      error: status !== 200 ? JSON.stringify(data).slice(0, 200) : undefined,
    });

    if (cfg.verbose) {
      console.log(`  [u${index}] study_summarize: ${durationMs.toFixed(0)}ms, summary=${Boolean(data?.summary)}`);
    }
  } catch (e) {
    record({
      op: "study_summarize",
      user: username,
      success: false,
      durationMs: performance.now() - start,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function studyFlashcards(user: TestUser, index: number): Promise<void> {
  const { token, username } = user;
  const start = performance.now();
  try {
    const { status, data, durationMs } = await request("POST", `${cfg.baseUrl}/api/study/flashcards`, token, {
      source: {
        kind: "paste",
        text: `Hash Maps use a hash function to map keys to bucket indices.
Average case O(1) for lookup, insert, delete.
Worst case O(n) when all keys collide into the same bucket.
Load factor = number of entries / number of buckets.
Resizing occurs when load factor exceeds a threshold (typically 0.75).
Open addressing: collisions resolved by probing (linear, quadratic, double hashing).
Chaining: collisions resolved by storing a linked list at each bucket.`,
        name: "Hash Maps Notes",
      },
      count: 5,
      mode: "mixed",
      create: true,
      language: "en",
    });

    record({
      op: "study_flashcards",
      user: username,
      success: status === 200 && (data?.cards?.length ?? 0) > 0,
      durationMs: durationMs,
      httpStatus: status,
      error: status !== 200 ? JSON.stringify(data).slice(0, 200) : undefined,
    });

    if (cfg.verbose) {
      console.log(`  [u${index}] study_flashcards: ${durationMs.toFixed(0)}ms, cards=${data?.cards?.length ?? 0}`);
    }
  } catch (e) {
    record({
      op: "study_flashcards",
      user: username,
      success: false,
      durationMs: performance.now() - start,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------- Phase: Cleanup ----------

async function cleanupUsers(adminToken: string, users: TestUser[]): Promise<void> {
  console.log(`\n[cleanup] Deleting ${users.length} test users...`);
  let deleted = 0;
  let failed = 0;
  for (const u of users) {
    const { status, durationMs } = await request("DELETE", `${cfg.baseUrl}/api/users/${u.userId}`, adminToken);
    if (status === 200) {
      deleted++;
    } else {
      failed++;
      if (cfg.verbose) {
        console.log(`  [cleanup] Failed to delete ${u.username} (HTTP ${status})`);
      }
    }
  }
  console.log(`[cleanup] Deleted ${deleted} users, ${failed} failures`);

  // Disable open registration
  await request("PUT", `${cfg.baseUrl}/api/users/registration`, adminToken, { enabled: false });
  console.log("[cleanup] Open registration disabled");
}

// ---------- Main ----------

async function main(): Promise<void> {
  const totalStart = performance.now();
  console.log("=".repeat(80));
  console.log("  MAVINO PERFORMANCE TEST");
  console.log("=".repeat(80));
  console.log(`  Users: ${cfg.userCount}`);
  console.log(`  Server: ${cfg.baseUrl}`);
  console.log(`  LLM tests: ${cfg.skipLlm ? "SKIPPED" : `ENABLED (${LLM_PROVIDER}/${LLM_MODEL})`}`);
  console.log(`  Cleanup: ${cfg.cleanup ? "YES" : "NO"}`);
  console.log(`  Login batching: ${cfg.loginBatch} per ${cfg.loginDelayMs}ms`);
  console.log("-".repeat(80));

  // 1. Health check
  console.log("\n[1/6] Health check...");
  {
    let healthResult;
    try {
      healthResult = await request("GET", `${cfg.baseUrl}/health`, null);
    } catch {
      console.error(`  Cannot connect to ${cfg.baseUrl}. Is the server running?`);
      console.error(`  Start it with: bun run dev  (or docker compose up)`);
      process.exit(1);
    }
    const { status, data, durationMs } = healthResult;
    if (status !== 200) {
      console.error(`  Server not healthy (HTTP ${status}). Is it running on ${cfg.baseUrl}?`);
      process.exit(1);
    }
    console.log(`  Server healthy: ${data?.service} v${data?.version} (${durationMs.toFixed(0)}ms)`);
  }

  // 2. Admin login + setup
  console.log("\n[2/6] Admin setup...");
  const adminToken = await adminLogin();
  await enableRegistration(adminToken);
  if (!cfg.skipLlm) {
    await setGlobalLlmKey(adminToken);
  }

  // 3. Create test users
  console.log("\n[3/6] Creating test users...");
  const users = await createTestUsers(adminToken, cfg.userCount);
  if (users.length === 0) {
    console.error("No test users created. Aborting.");
    process.exit(1);
  }

  // 4. Login users
  console.log("\n[4/6] Logging in users...");
  await loginUsers(users);
  const loggedInUsers = users.filter((u) => u.token);
  if (loggedInUsers.length === 0) {
    console.error("No users logged in successfully. Aborting.");
    if (cfg.cleanup) await cleanupUsers(adminToken, users);
    process.exit(1);
  }
  console.log(`  ${loggedInUsers.length}/${users.length} users ready for workload`);

  // 5. Run workloads concurrently
  console.log(`\n[5/6] Running workloads for ${loggedInUsers.length} users concurrently...`);
  const workloadStart = performance.now();

  // Track completion progress
  let completed = 0;
  const total = loggedInUsers.length;
  const progressInterval = setInterval(() => {
    const elapsed = ((performance.now() - workloadStart) / 1000).toFixed(1);
    console.log(`[workload] ${completed}/${total} users done (${elapsed}s elapsed)`);
  }, 10000);

  // Run all user workloads in parallel
  await Promise.all(
    loggedInUsers.map(async (u, i) => {
      await userWorkload(u, i);
      completed++;
    }),
  );

  clearInterval(progressInterval);
  const workloadDuration = performance.now() - workloadStart;
  console.log(`  All workloads completed in ${(workloadDuration / 1000).toFixed(1)}s`);

  // 6. Report
  console.log("\n[6/6] Generating report...");
  printReport();

  // Cleanup
  if (cfg.cleanup) {
    await cleanupUsers(adminToken, users);
  } else {
    console.log("\n[cleanup] Skipped (--no-cleanup). Test users remain in the database.");
    console.log("  To clean up manually, delete users with username prefix 'perftest_'.");
  }

  const totalDuration = performance.now() - totalStart;
  console.log(`\nTotal test duration: ${(totalDuration / 1000).toFixed(1)}s`);

  // Exit code: 0 if no failures, 1 if any failures
  const totalFailures = results.filter((r) => !r.success).length;
  if (totalFailures > 0) {
    console.log(`\n⚠  ${totalFailures} operation(s) failed — see report above.`);
    process.exit(1);
  } else {
    console.log("\n✓ All operations succeeded.");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
