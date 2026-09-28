// ===== Ntfy HTTP client =====
// Publish + poll + subscribe against an ntfy server (ntfy.sh or self-hosted).
// Auth: optional Bearer token (stored encrypted in NtfyConfig).
//
// ntfy JSON poll endpoint returns one JSON object per line (NDJSON). Each
// object has an `event` field: "open" | "keepalive" | "message" | "poll_request".
// We only act on "message" events. The `id` field is monotonic per topic and
// used as the resume cursor (`since=<id>`).

export interface NtfyUsableConfig {
  serverUrl: string; // no trailing slash
  token: string; // plaintext bearer token ("" = none)
  notifyTopic: string;
  inboxTopic: string;
  defaultPriority: number; // 1-5
}

export interface NtfyPublishOptions {
  topic: string;
  title?: string;
  body: string;
  priority?: number; // 1-5
  tags?: string;
  clickUrl?: string;
  // Render the body as Markdown in clients that support it (ntfy web/PWA).
  // Sets the `Markdown: yes` header. Default true, since most bodies are
  // Athena-generated Markdown; plain text renders identically either way.
  markdown?: boolean;
}

export interface NtfyMessage {
  id: string;
  time: number; // unix seconds
  event: string;
  message: string;
  title?: string;
  priority?: number;
  tags?: string;
}

/** Normalize a server URL (trim + strip trailing slash). */
export function normalizeServerUrl(url: string): string {
  return (url || "").trim().replace(/\/+$/, "");
}

/** Validate a topic name (ntfy allows alnum, _ - /). We keep it simple. */
export function isValidTopic(topic: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(topic);
}

function authHeaders(token: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (token && token.trim()) h["Authorization"] = `Bearer ${token.trim()}`;
  return h;
}

/** Publish a message to a topic. Throws on non-2xx. */
export async function publish(
  cfg: NtfyUsableConfig,
  opts: NtfyPublishOptions
): Promise<void> {
  const priority = opts.priority ?? cfg.defaultPriority;
  const payload: Record<string, string | number | boolean> = {
    topic: opts.topic,
    message: opts.body,
    markdown: opts.markdown !== false,
  };
  if (opts.title) payload.title = opts.title;
  if (priority) payload.priority = priority;
  if (opts.tags) payload.tags = opts.tags;
  if (opts.clickUrl) payload.click = opts.clickUrl;

  const res = await fetch(cfg.serverUrl, {
    method: "POST",
    headers: {
      ...authHeaders(cfg.token),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ntfy publish failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Poll messages from a topic since a cursor (message id) or "all".
 * Returns messages in chronological order. Does not block.
 */
export async function pollMessages(
  cfg: NtfyUsableConfig,
  topic: string,
  since: string = "all"
): Promise<NtfyMessage[]> {
  const url = `${cfg.serverUrl}/${encodeURIComponent(topic)}/json?poll=1&since=${encodeURIComponent(since)}`;
  const res = await fetch(url, {
    headers: authHeaders(cfg.token),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ntfy poll failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const raw = await res.text();
  const out: NtfyMessage[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object") {
        out.push({
          id: String(obj.id ?? ""),
          time: Number(obj.time ?? 0),
          event: String(obj.event ?? "message"),
          message: String(obj.message ?? ""),
          title: obj.title ? String(obj.title) : undefined,
          priority: obj.priority ? Number(obj.priority) : undefined,
          tags: obj.tags ? (Array.isArray(obj.tags) ? obj.tags.join(",") : String(obj.tags)) : undefined,
        });
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/**
 * Subscribe to a topic via long-poll. Calls `onMessage` for each new message.
 * Resumes from `since` (a message id) to avoid replaying history.
 * Returns a stop() function. Reconnects with backoff on error/disconnect.
 *
 * ntfy's /json endpoint without poll=1 is a streaming (SSE-like) connection
 * that stays open and emits one JSON object per line as messages arrive.
 */
export function subscribeStream(
  cfg: NtfyUsableConfig,
  topic: string,
  since: string,
  onMessage: (msg: NtfyMessage) => void,
  onError?: (err: Error) => void
): { stop: () => void } {
  let stopped = false;
  let abortController: AbortController | null = null;
  let backoff = 1000; // start at 1s

  const loop = async () => {
    while (!stopped) {
      const url = `${cfg.serverUrl}/${encodeURIComponent(topic)}/json?since=${encodeURIComponent(since)}`;
      abortController = new AbortController();
      try {
        const res = await fetch(url, {
          headers: authHeaders(cfg.token),
          signal: abortController.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`ntfy subscribe HTTP ${res.status}`);
        }
        backoff = 1000; // reset on successful connect
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
              const obj = JSON.parse(line);
              if (obj?.event === "message") {
                const msg: NtfyMessage = {
                  id: String(obj.id ?? ""),
                  time: Number(obj.time ?? 0),
                  event: "message",
                  message: String(obj.message ?? ""),
                  title: obj.title ? String(obj.title) : undefined,
                  priority: obj.priority ? Number(obj.priority) : undefined,
                  tags: obj.tags ? (Array.isArray(obj.tags) ? obj.tags.join(",") : String(obj.tags)) : undefined,
                };
                since = msg.id; // advance cursor
                onMessage(msg);
              }
            } catch {
              // skip malformed line
            }
          }
        }
      } catch (e) {
        if (stopped) break;
        if (abortController.signal.aborted) break;
        onError?.(e instanceof Error ? e : new Error("ntfy subscribe error"));
      }
      if (stopped) break;
      // Reconnect with capped exponential backoff (max 60s).
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60000);
    }
  };

  loop();

  return {
    stop: () => {
      stopped = true;
      try {
        abortController?.abort();
      } catch {
        /* ignore */
      }
    },
  };
}
