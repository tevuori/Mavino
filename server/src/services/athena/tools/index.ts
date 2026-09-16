import type { ToolDef } from "./plugin";
import { taskTools } from "./tasks";
import { taskWorkspaceTools } from "./task-workspaces";
import { gradeTools } from "./grades";
import { noteTools } from "./notes";
import { fileTools } from "./files";
import { pomodoroTools } from "./pomodoro";
import { windowTools } from "./windows";
import { workspaceTools } from "./workspaces";
import { studyTools } from "./study";
import { studyHubTools } from "./study-hub";
import { studyGraphTools } from "./study-graph";
import { flashcardsTools } from "./flashcards";
import { calendarTools } from "./calendar";
import { habitsTools } from "./habits";
import { searchTools } from "./search";
import { fetchTools } from "./fetch";
import { sandboxTools } from "./sandbox";
import { notetakeTools } from "./notetake";
import { crossAppTools } from "./crossapp";
import { researchTools } from "./research";
import { memoryTools } from "./memory";
import { profileTools } from "./profile";
import { linkTools } from "./links";
import { browserTools } from "./browser";
import { teacherTools } from "./teacher";
import { ntfyTools } from "./ntfy";
import { reminderTools } from "./reminders";
import { mapTools } from "./maps";
import { atlasTools } from "./atlas";
import { crunchTools } from "./crunch";
import { compassTools } from "./compass";
import { echoTools } from "./echo";
import { pulseTools } from "./pulse";
import { forgeTools } from "./forge";
import { bridgeTools } from "./bridge";
import { scribeTools } from "./scribe";
import { circleTools } from "./circle";
import { loadPluginTools } from "../../plugins";
import type { ClientWindowInfo } from "./plugin";

export { AthenaToolsPlugin, type ToolDef, type ToolContext, type ClientWindowInfo } from "./plugin";

/** Map app window ids to tool scopes. Tools tagged with "app:<appId>" are only
 *  exposed to the LLM when a window for that app is open. */
const APP_SCOPES: Record<string, string> = {
  browser: "app:browser",
  maps: "app:maps",
  atlas: "app:atlas",
  crunch: "app:crunch",
  compass: "app:compass",
  echo: "app:echo",
  pulse: "app:pulse",
  forge: "app:forge",
  bridge: "app:bridge",
  scribe: "app:scribe",
  circle: "app:circle",
  study: "app:study",
  terminal: "app:terminal",
};

/** Provider-agnostic tool limit observed by Groq (and a sensible ceiling for
 *  other OpenAI-compatible endpoints). */
export const MAX_TOOLS_PER_REQUEST = 128;

/** Attach scopes to a group of tool definitions without mutating the originals. */
function tag(tools: ToolDef[], scopes: string[]): ToolDef[] {
  return tools.map((t) => ({
    ...t,
    scopes: [...new Set([...(t.scopes ?? []), ...scopes])],
  }));
}

/** All Athena tools, in registration order, with per-context scope tags. */
export const ALL_TOOLS: ToolDef[] = [
  // Core assistant workspace: tasks, notes, files, search, window/workspace
  // management, cross-app workflows, and everyday utilities.
  ...tag(taskTools, ["core"]),
  ...tag(taskWorkspaceTools, ["core"]),
  ...tag(gradeTools, ["core"]),
  ...tag(noteTools, ["core"]),
  ...tag(fileTools, ["core"]),
  ...tag(pomodoroTools, ["core"]),
  ...tag(windowTools, ["core"]),
  ...tag(workspaceTools, ["core"]),
  ...tag(searchTools, ["core"]),
  ...tag(fetchTools, ["core"]),
  ...tag(crossAppTools, ["core"]),
  ...tag(memoryTools, ["core"]),
  ...tag(profileTools, ["core"]),
  ...tag(linkTools, ["core"]),
  // Study Hub: core study actions (flashcards, summarize, etc.) plus source/
  // session management. "app:study" tools are only exposed when Study Hub is
  // open, keeping the main assistant's tool list small.
  ...tag(studyTools, ["core"]),
  ...tag(studyGraphTools, ["core"]),
  ...tag(flashcardsTools, ["core"]),
  ...tag(notetakeTools, ["core"]),
  ...tag(studyHubTools, ["app:study"]),
  // Paid-tier daily productivity tools: always available to the assistant when
  // the user's tier permits.
  ...tag(calendarTools, ["core"]),
  ...tag(habitsTools, ["core"]),
  ...tag(ntfyTools, ["core"]),
  ...tag(reminderTools, ["core"]),
  // App-specific tool sets. These are gated by open windows so a provider like
  // Groq doesn't receive tools for apps the user isn't currently using.
  ...tag(browserTools, ["app:browser"]),
  ...tag(mapTools, ["app:maps"]),
  ...tag(researchTools, ["core"]),
  ...tag(sandboxTools, ["app:terminal"]),
  ...tag(atlasTools, ["app:atlas"]),
  ...tag(crunchTools, ["app:crunch"]),
  ...tag(compassTools, ["app:compass"]),
  ...tag(echoTools, ["app:echo"]),
  ...tag(pulseTools, ["app:pulse"]),
  ...tag(forgeTools, ["app:forge"]),
  ...tag(bridgeTools, ["app:bridge"]),
  ...tag(scribeTools, ["app:scribe"]),
  ...tag(circleTools, ["app:circle"]),
  // Teach Me mode has its own isolated tool set so the tutor can't accidentally
  // invoke general workspace tools during a lesson.
  ...tag(teacherTools, ["teacher"]),
];

/** Roles that get access to `paidOnly` tools (sandbox, etc.).
 *  Includes PRO since Pro is a higher tier than Paid. */
const PAID_TIERS = new Set(["PAID", "PRO", "MANAGER", "ADMIN"]);

/** Roles that get access to `proOnly` tools (Atlas, etc.). */
const PRO_TIERS = new Set(["PRO", "MANAGER", "ADMIN"]);

/** Filter the full tool list by user role (drops paidOnly/proOnly tools for
 *  lower tiers). */
export function toolsForRole(role: string): ToolDef[] {
  if (PRO_TIERS.has(role)) return ALL_TOOLS;
  if (PAID_TIERS.has(role)) return ALL_TOOLS.filter((t) => !t.proOnly);
  return ALL_TOOLS.filter((t) => !t.paidOnly && !t.proOnly);
}

/**
 * Build the tool list for a user: built-in tools (filtered by role) + any
 * plugin tools from the user's installed+enabled plugins. Plugin tools are
 * only loaded for paid/pro users (the marketplace is paid-only).
 */
export async function toolsForUser(userId: string, role: string): Promise<ToolDef[]> {
  const builtin = toolsForRole(role);
  if (!PAID_TIERS.has(role)) return builtin;
  try {
    const pluginTools = await loadPluginTools(userId);
    return [...builtin, ...pluginTools];
  } catch {
    // Plugin loading failure should never break Athena chat.
    return builtin;
  }
}

/** Validate and optionally shrink a tool list so it stays within the provider
 *  tool-count ceiling. Logs the full list at debug time so provider rejections
 *  are never silent. */
export function validateTools(
  tools: ToolDef[],
  context: string,
  debug = false
): ToolDef[] {
  if (tools.length <= MAX_TOOLS_PER_REQUEST) {
    if (debug || tools.length >= MAX_TOOLS_PER_REQUEST - 10) {
      console.log(
        `[athena] ${context} tools: ${tools.length}/${MAX_TOOLS_PER_REQUEST}`
      );
    }
    return tools;
  }

  console.warn(
    `[athena] ${context} tool count ${tools.length} exceeds provider limit ${MAX_TOOLS_PER_REQUEST}; ` +
      `falling back to core-only tools. Tool names: ${tools.map((t) => t.name).join(", ")}`
  );

  const coreOnly = tools.filter((t) => t.scopes?.includes("core"));
  if (coreOnly.length <= MAX_TOOLS_PER_REQUEST) {
    console.warn(
      `[athena] ${context} fallback to ${coreOnly.length} core-only tools.`
    );
    return coreOnly;
  }

  console.error(
    `[athena] ${context} even core-only tool count ${coreOnly.length} exceeds ${MAX_TOOLS_PER_REQUEST}. ` +
      `Keeping first ${MAX_TOOLS_PER_REQUEST} core tools as last resort. Tool names: ${coreOnly
        .map((t) => t.name)
        .join(", ")}`
  );
  return coreOnly.slice(0, MAX_TOOLS_PER_REQUEST);
}

/** Build the scoped tool list for the main Athena assistant.
 *  - Always includes "core" tools.
 *  - Includes "app:<appId>" tools only when a window for that app is open.
 *  - Never includes Teach Me action tools (those are isolated to teacher mode).
 *  - Loads plugin tools for paid/pro users and tags them as core. */
export async function toolsForAssistant(
  userId: string,
  role: string,
  windows: ClientWindowInfo[] = []
): Promise<ToolDef[]> {
  const builtin = toolsForRole(role);
  const appIds = new Set(
    windows.map((w) => w.appId).filter((id): id is string => Boolean(id))
  );
  const activeScopes = new Set<string>(["core"]);
  for (const id of appIds) {
    const scope = APP_SCOPES[id];
    if (scope) activeScopes.add(scope);
  }

  let scoped = builtin.filter((t) =>
    t.scopes?.some((s) => activeScopes.has(s))
  );

  if (PAID_TIERS.has(role)) {
    try {
      const pluginTools = await loadPluginTools(userId);
      scoped = [...scoped, ...tag(pluginTools, ["core"])];
    } catch {
      // Plugin loading failure should never break Athena chat.
    }
  }

  return validateTools(scoped, "assistant");
}

/** Build the scoped tool list for Teach Me streaming turns.
 *  Exposes only the teacher action tools so the model stays focused on
 *  tutoring instead of seeing the full workspace tool set. */
export async function toolsForTeacher(
  userId: string,
  role: string
): Promise<ToolDef[]> {
  const builtin = toolsForRole(role);
  let scoped = builtin.filter((t) => t.scopes?.includes("teacher"));

  if (PAID_TIERS.has(role)) {
    try {
      const pluginTools = await loadPluginTools(userId);
      scoped = [...scoped, ...tag(pluginTools, ["core"])];
    } catch {
      // Plugin loading failure should never break the teacher stream.
    }
  }

  return validateTools(scoped, "teacher");
}

/** Tool metadata safe to expose to the client (no handlers). */
export function toolManifest(tools: ToolDef[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    destructive: Boolean(t.destructive),
    requiresConfirmation: Boolean(t.requiresConfirmation),
    clientAction: Boolean(t.clientAction),
  }));
}

/** Names of tools that produce a client_action payload. */
export const CLIENT_ACTION_TOOLS = new Set(
  ALL_TOOLS.filter((t) => t.clientAction).map((t) => t.name)
);

/** Names of tools that mutate data (used to emit `data_change` SSE events). */
export const DESTRUCTIVE_TOOLS = new Set(
  ALL_TOOLS.filter((t) => t.destructive).map((t) => t.name)
);
