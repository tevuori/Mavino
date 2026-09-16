import { describe, it, expect } from "bun:test";
import {
  ALL_TOOLS,
  toolsForRole,
  toolsForAssistant,
  toolsForTeacher,
  MAX_TOOLS_PER_REQUEST,
} from "./index";
import { AthenaToolsPlugin } from "./plugin";
import type { ClientWindowInfo } from "./plugin";

function makeWindow(appId: string, focused = false): ClientWindowInfo {
  return {
    id: `${appId}-1`,
    appId,
    title: appId,
    rect: { x: 0, y: 0, width: 100, height: 100 },
    minimized: false,
    focused,
  };
}

describe("tool scoping", () => {
  it("ALL_TOOLS contains every defined tool", () => {
    expect(ALL_TOOLS.length).toBeGreaterThan(0);
  });

  it("exposes no more than MAX_TOOLS tools for the main assistant (no open windows)", async () => {
    const tools = await toolsForAssistant("user-free", "FREE", []);
    expect(tools.length).toBeLessThanOrEqual(MAX_TOOLS_PER_REQUEST);
  });

  it("exposes no more than MAX_TOOLS tools for paid users with no open windows", async () => {
    const tools = await toolsForAssistant("user-paid", "PAID", []);
    expect(tools.length).toBeLessThanOrEqual(MAX_TOOLS_PER_REQUEST);
    expect(tools.some((t) => t.name === "create_task")).toBe(true);
    expect(tools.some((t) => t.name === "open_app")).toBe(true);
    expect(tools.some((t) => t.name === "open_maps")).toBe(false);
    expect(tools.some((t) => t.name === "show_source")).toBe(false);
  });

  it("adds app-specific tools only when the matching app window is open", async () => {
    const noMaps = await toolsForAssistant("user-paid", "PAID", []);
    const withMaps = await toolsForAssistant("user-paid", "PAID", [makeWindow("maps")]);
    expect(withMaps.length).toBeGreaterThan(noMaps.length);
    expect(withMaps.some((t) => t.name === "plan_route")).toBe(true);
    expect(withMaps.length).toBeLessThanOrEqual(MAX_TOOLS_PER_REQUEST);
  });

  it("keeps browser tools scoped to an open browser window", async () => {
    const withBrowser = await toolsForAssistant("user-paid", "PAID", [makeWindow("browser")]);
    expect(withBrowser.some((t) => t.name === "get_browser_content")).toBe(true);
  });

  it("keeps study-hub session tools scoped to an open Study Hub window", async () => {
    const withStudy = await toolsForAssistant("user-paid", "PAID", [makeWindow("study")]);
    expect(withStudy.some((t) => t.name === "start_teacher_session")).toBe(true);
    expect(withStudy.some((t) => t.name === "generate_podcast")).toBe(true);
  });

  it("does not expose Teach Me action tools to the main assistant", async () => {
    const tools = await toolsForAssistant("user-admin", "ADMIN", []);
    const teacherNames = [
      "show_source",
      "highlight_source",
      "scroll_source",
      "clear_highlight",
      "focus_source",
      "close_source",
      "check_comprehension",
      "mark_concept_covered",
      "finish_lesson",
      "point_at_image",
    ];
    for (const name of teacherNames) {
      expect(tools.some((t) => t.name === name)).toBe(false);
    }
  });

  it("exposes exactly the Teach Me action tools in teacher mode", async () => {
    const tools = await toolsForTeacher("user-paid", "PAID");
    expect(tools.length).toBe(10);
    expect(tools.every((t) => t.scopes?.includes("teacher"))).toBe(true);
    const names = tools.map((t) => t.name).sort();
    const expected = [
      "check_comprehension",
      "clear_highlight",
      "close_source",
      "finish_lesson",
      "focus_source",
      "highlight_source",
      "mark_concept_covered",
      "point_at_image",
      "scroll_source",
      "show_source",
    ].sort();
    expect(names).toEqual(expected);
  });

  it("does not leak maps/browser/app-specific tools into Teach Me mode", async () => {
    const tools = await toolsForTeacher("user-admin", "ADMIN");
    expect(tools.some((t) => t.name === "plan_route")).toBe(false);
    expect(tools.some((t) => t.name === "open_browser")).toBe(false);
    expect(tools.some((t) => t.name === "create_task")).toBe(false);
  });

  it("teacher-mode plugin exposure stays under the provider limit", async () => {
    const tools = await toolsForTeacher("user-admin", "ADMIN");
    expect(tools.length).toBeLessThanOrEqual(MAX_TOOLS_PER_REQUEST);
  });

  it("resolves unique tool names even when scopes overlap", async () => {
    const withStudyAndMaps = await toolsForAssistant("user-paid", "PAID", [
      makeWindow("study"),
      makeWindow("maps"),
    ]);
    const names = new Set(withStudyAndMaps.map((t) => t.name));
    expect(names.size).toBe(withStudyAndMaps.length);
    expect(withStudyAndMaps.length).toBeLessThanOrEqual(MAX_TOOLS_PER_REQUEST);
  });
});

describe("AthenaToolsPlugin tool serialization", () => {
  it("serializes no more than MAX_TOOLS OpenAI tool definitions", async () => {
    const tools = await toolsForAssistant("user-admin", "ADMIN", [
      makeWindow("study"),
      makeWindow("maps"),
      makeWindow("browser"),
    ]);
    const plugin = new AthenaToolsPlugin(tools, {
      userId: "user-admin",
      windows: [],
    });
    const openAiTools = await plugin.getTools();
    expect(openAiTools.length).toBe(tools.length);
    expect(openAiTools.length).toBeLessThanOrEqual(MAX_TOOLS_PER_REQUEST);
    for (const tool of openAiTools) {
      expect(tool.type).toBe("function");
      expect(typeof tool.function.name).toBe("string");
      expect(typeof tool.function.description).toBe("string");
      expect(tool.function.parameters.type).toBe("object");
    }
  });

  it("serializes exactly the Teach Me tools in teacher mode", async () => {
    const tools = await toolsForTeacher("user-paid", "PAID");
    const plugin = new AthenaToolsPlugin(tools, {
      userId: "user-paid",
      windows: [],
    });
    const openAiTools = await plugin.getTools();
    expect(openAiTools.length).toBe(10);
    expect(openAiTools.every((t) => t.function.name.startsWith("show_") || t.function.name.startsWith("highlight_") || t.function.name.startsWith("scroll_") || t.function.name.startsWith("clear_") || t.function.name.startsWith("focus_") || t.function.name.startsWith("close_") || t.function.name.startsWith("check_") || t.function.name.startsWith("mark_") || t.function.name.startsWith("finish_") || t.function.name.startsWith("point_"))).toBe(true);
  });
});

describe("toolsForRole", () => {
  it("still filters paid-only and pro-only tools by tier", () => {
    const free = toolsForRole("FREE");
    const paid = toolsForRole("PAID");
    const pro = toolsForRole("PRO");
    expect(free.length).toBeLessThan(paid.length);
    expect(paid.length).toBeLessThanOrEqual(pro.length);
  });
});
