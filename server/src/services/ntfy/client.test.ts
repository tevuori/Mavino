import { afterEach, describe, expect, it } from "bun:test";
import { publish, type NtfyUsableConfig } from "./client";

const originalFetch = globalThis.fetch;

const config: NtfyUsableConfig = {
  serverUrl: "https://ntfy.example.com",
  token: "secret-token",
  notifyTopic: "notify-topic",
  inboxTopic: "inbox-topic",
  defaultPriority: 3,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ntfy publish", () => {
  it("preserves Czech diacritics and emoji in the JSON payload", async () => {
    let request: { input: string | URL | Request; init?: RequestInit } | undefined;
    globalThis.fetch = (async (input, init) => {
      request = { input, init };
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await publish(config, {
      topic: "notify-topic",
      title: "Předání IP adresy poskytovateli domény ⏰",
      body: "Úkol je stále otevřený. Připomeň ho zítra.",
      priority: 4,
      tags: "warning,clipboard",
      clickUrl: "https://mavino.example.com/úkoly",
    });

    expect(request?.input).toBe("https://ntfy.example.com");
    expect(request?.init?.method).toBe("POST");
    expect(request?.init?.headers).toEqual({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json; charset=utf-8",
    });
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      topic: "notify-topic",
      message: "Úkol je stále otevřený. Připomeň ho zítra.",
      markdown: true,
      title: "Předání IP adresy poskytovateli domény ⏰",
      priority: 4,
      tags: "warning,clipboard",
      click: "https://mavino.example.com/úkoly",
    });
  });

  it("uses defaults and can disable Markdown", async () => {
    let body = "";
    globalThis.fetch = (async (_input, init) => {
      body = String(init?.body);
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await publish(config, {
      topic: "notify-topic",
      body: "Plain text",
      markdown: false,
    });

    expect(JSON.parse(body)).toEqual({
      topic: "notify-topic",
      message: "Plain text",
      markdown: false,
      priority: 3,
    });
  });
});
