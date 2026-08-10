import { type ToolDef, paidOnly } from "./plugin";

// Pomodoro runs client-side (Web Audio chime + timer + DND). The server can't
// start it directly, so this tool returns a `client_action` payload that the
// Athena client UI dispatches to the pomodoro store. Marked clientAction so the
// /api/athena/chat stream emits it as a dedicated chunk the client can act on.
// Pomodoro is a Paid-tier app — the tool is paid-only.
export const pomodoroTools: ToolDef[] = paidOnly([
  {
    name: "start_pomodoro",
    description:
      "Start a Pomodoro / focus timer on the user's desktop. Optionally choose a phase and duration (minutes). The timer UI opens automatically.",
    clientAction: true,
    parameters: [
      {
        name: "phase",
        type: "string",
        description: "Which phase to start",
        enum: ["work", "short_break", "long_break"],
      },
      { name: "durationMinutes", type: "number", description: "Custom duration in minutes (overrides default 25/5/15)" },
    ],
    handler: async (args) => {
      return {
        action: "start_pomodoro",
        phase: (args.phase as string) ?? "work",
        durationMinutes: typeof args.durationMinutes === "number" ? args.durationMinutes : null,
      };
    },
  },
]);
