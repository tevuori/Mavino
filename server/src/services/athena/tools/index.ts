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
import { moodleTools } from "./moodle";
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

export { AthenaToolsPlugin, type ToolDef, type ToolContext, type ClientWindowInfo } from "./plugin";

/** All Athena tools, in registration order. */
export const ALL_TOOLS: ToolDef[] = [
  ...taskTools,
  ...taskWorkspaceTools,
  ...gradeTools,
  ...noteTools,
  ...fileTools,
  ...pomodoroTools,
  ...windowTools,
  ...workspaceTools,
  ...studyTools,
  ...studyHubTools,
  ...studyGraphTools,
  ...flashcardsTools,
  ...moodleTools,
  ...calendarTools,
  ...habitsTools,
  ...searchTools,
  ...fetchTools,
  ...researchTools,
  ...sandboxTools,
  ...notetakeTools,
  ...crossAppTools,
  ...memoryTools,
  ...profileTools,
  ...linkTools,
  ...browserTools,
  ...teacherTools,
  ...ntfyTools,
  ...reminderTools,
  ...mapTools,
];

/** Roles that get access to `paidOnly` tools (sandbox, etc.). */
const PAID_TIERS = new Set(["PAID", "MANAGER", "ADMIN"]);

/** Filter the full tool list by user role (drops paidOnly tools for free/demo). */
export function toolsForRole(role: string): ToolDef[] {
  if (PAID_TIERS.has(role)) return ALL_TOOLS;
  return ALL_TOOLS.filter((t) => !t.paidOnly);
}

/** Tool metadata safe to expose to the client (no handlers). */
export function toolManifest(role?: string) {
  const tools = role ? toolsForRole(role) : ALL_TOOLS;
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
