import type { ToolDef, ClientWindowInfo } from "./plugin";

// All window management tools are clientAction: the server returns a payload
// and the Athena client dispatches it to the windows Zustand store. The server
// can't directly manipulate the client DOM, so we emit a client_action SSE
// event that the client interprets.

/** Valid app ids that can be opened. */
const VALID_APPS = [
  "notes", "tasks", "files", "music", "settings", "terminal",
  "pomodoro", "flashcards", "grades", "editor", "viewer", "athena",
  "browser",
];

/** Human-readable app names for the model. */
const APP_NAMES: Record<string, string> = {
  notes: "Notes", tasks: "Tasks", files: "Files", music: "Music",
  settings: "Settings", terminal: "Terminal", pomodoro: "Pomodoro",
  flashcards: "Flashcards", grades: "Grades",
  editor: "Code Editor", viewer: "File Viewer", athena: "Mavino",
  browser: "Browser",
};

export const windowTools: ToolDef[] = [
  {
    name: "open_app",
    description:
      "Open a new app window on the user's desktop. Valid app ids: notes, tasks, files, music, settings, terminal, pomodoro, flashcards, grades, editor, viewer, athena. For side-by-side layouts, provide x/y/width/height. Example: open notes at left half (x=0,y=0,width=960,height=700) and tasks at right half (x=960,y=0,width=960,height=700). If no position is given, the window opens at a default cascaded position.",
    clientAction: true,
    parameters: [
      {
        name: "appId",
        type: "string",
        description: "App to open",
        enum: VALID_APPS,
        required: true,
      },
      { name: "title", type: "string", description: "Window title (defaults to app name)" },
      { name: "x", type: "number", description: "Window x position in pixels (0 = left edge)" },
      { name: "y", type: "number", description: "Window y position in pixels (0 = top edge)" },
      { name: "width", type: "number", description: "Window width in pixels" },
      { name: "height", type: "number", description: "Window height in pixels" },
    ],
    handler: async (args) => {
      const appId = String(args.appId ?? "");
      if (!VALID_APPS.includes(appId)) {
        return { error: `Invalid app id: ${appId}. Valid: ${VALID_APPS.join(", ")}` };
      }
      const rect: Record<string, number> = {};
      if (typeof args.x === "number") rect.x = args.x;
      if (typeof args.y === "number") rect.y = args.y;
      if (typeof args.width === "number") rect.width = args.width;
      if (typeof args.height === "number") rect.height = args.height;
      return {
        action: "open_app",
        appId,
        title: String(args.title ?? APP_NAMES[appId] ?? appId),
        ...(Object.keys(rect).length > 0 ? { rect } : {}),
      };
    },
  },
  {
    name: "close_window",
    description: "Close a specific window by its id. Use list_open_windows or the system prompt's 'Open windows' list to get the id.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Window id (e.g. win-3)", required: true },
    ],
    handler: async (args) => ({
      action: "close_window",
      windowId: String(args.windowId ?? ""),
    }),
  },
  {
    name: "focus_window",
    description: "Bring a window to the front and focus it (also un-minimizes it).",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Window id", required: true },
    ],
    handler: async (args) => ({
      action: "focus_window",
      windowId: String(args.windowId ?? ""),
    }),
  },
  {
    name: "minimize_window",
    description: "Minimize a window to the taskbar.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Window id", required: true },
    ],
    handler: async (args) => ({
      action: "minimize_window",
      windowId: String(args.windowId ?? ""),
    }),
  },
  {
    name: "resize_window",
    description: "Resize a window to a new width and height (in pixels). The window stays at its current position.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Window id", required: true },
      { name: "width", type: "number", description: "New width in pixels", required: true },
      { name: "height", type: "number", description: "New height in pixels", required: true },
    ],
    handler: async (args) => ({
      action: "resize_window",
      windowId: String(args.windowId ?? ""),
      width: Number(args.width ?? 0),
      height: Number(args.height ?? 0),
    }),
  },
  {
    name: "move_window",
    description: "Move a window to a new x, y position (in pixels, top-left origin).",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Window id", required: true },
      { name: "x", type: "number", description: "New x position in pixels", required: true },
      { name: "y", type: "number", description: "New y position in pixels", required: true },
    ],
    handler: async (args) => ({
      action: "move_window",
      windowId: String(args.windowId ?? ""),
      x: Number(args.x ?? 0),
      y: Number(args.y ?? 0),
    }),
  },
  {
    name: "list_open_windows",
    description:
      "List all currently open windows with their ids, app, title, position, size, and state (open/minimized/focused). Use this to get window ids before calling close/focus/minimize/resize/move.",
    parameters: [],
    handler: async (_args, ctx) => {
      const wins: ClientWindowInfo[] = ctx.windows ?? [];
      return {
        count: wins.length,
        windows: wins.map((w) => ({
          id: w.id,
          appId: w.appId,
          title: w.title,
          state: w.minimized ? "minimized" : w.focused ? "focused" : "open",
          x: w.rect.x,
          y: w.rect.y,
          width: w.rect.width,
          height: w.rect.height,
        })),
      };
    },
  },
  {
    name: "tile_windows",
    description:
      "Tile all open windows in a grid layout. Options: 'horizontal' (side by side), 'vertical' (stacked), 'grid' (auto rows/cols). Useful when the user says 'organize my windows' or 'tile side by side'.",
    clientAction: true,
    parameters: [
      {
        name: "layout",
        type: "string",
        description: "Tiling layout",
        enum: ["horizontal", "vertical", "grid"],
      },
    ],
    handler: async (args) => ({
      action: "tile_windows",
      layout: (args.layout as string) ?? "grid",
    }),
  },
];
