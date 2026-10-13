import type { ToolDef } from "./plugin";

// Fullscreen management tool. The Fullscreen API requires a user gesture to
// enter fullscreen, so direct "enter" actions are surfaced as a client-side
// prompt. Exiting or disabling the preference works immediately.

export const fullscreenTools: ToolDef[] = [
  {
    name: "manage_fullscreen",
    description:
      "Manage Mavino's fullscreen state. Use this when the user asks to enter or exit fullscreen, or to enable/disable the auto-fullscreen preference. Note: entering fullscreen requires a user gesture in the browser, so the tool may show a one-click confirmation prompt instead of entering immediately.",
    clientAction: true,
    parameters: [
      {
        name: "action",
        type: "string",
        description: "What to do: enter fullscreen, exit fullscreen, toggle the current state, or set the auto-fullscreen preference without changing state immediately.",
        required: true,
        enum: ["enter", "exit", "toggle", "set_preference"],
      },
      {
        name: "enabled",
        type: "boolean",
        description: "For set_preference: whether Mavino should automatically enter fullscreen on the next user gesture.",
      },
    ],
    handler: async (args) => {
      const action = String(args.action ?? "toggle");
      const enabled = args.enabled === true;

      switch (action) {
        case "exit":
          return {
            action: "manage_fullscreen",
            operation: "exit",
            message: "Exiting fullscreen.",
          };
        case "set_preference":
          return {
            action: "manage_fullscreen",
            operation: "set_preference",
            enabled,
            message: enabled
              ? "Auto-fullscreen enabled. Mavino will enter fullscreen on your next click or keypress."
              : "Auto-fullscreen disabled. Mavino will stay windowed.",
          };
        case "enter":
        case "toggle":
        default:
          return {
            action: "manage_fullscreen",
            operation: action === "enter" ? "enter" : "toggle",
            showPrompt: true,
            message:
              "I'll enable fullscreen mode. Because browsers require a click or keypress to enter fullscreen, please confirm the prompt on screen.",
          };
      }
    },
  },
];
