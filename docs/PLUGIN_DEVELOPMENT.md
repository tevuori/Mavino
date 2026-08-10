# Plugin Development Guide

This guide walks you through creating a plugin for the Mavino Plugin Marketplace — from writing the React component, to declaring Athena LLM tools, to publishing and testing.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Plugin Manifest](#plugin-manifest)
- [Creating a Plugin App (Frontend)](#creating-a-plugin-app-frontend)
- [Creating Athena Tools (Backend Webhook)](#creating-athena-tools-backend-webhook)
- [Publishing a Plugin](#publishing-a-plugin)
- [Testing Your Plugin](#testing-your-plugin)
- [Security Model](#security-model)
- [API Reference](#api-reference)
- [Complete Example](#complete-example)

---

## Overview

A Mavino plugin extends the platform with a **frontend app** (a React component loaded from a remote ES module) and optionally **Athena tools** (LLM-callable functions backed by a webhook on your own server). Plugins are installed by paid/pro users from the in-app Marketplace; they appear in the taskbar, start menu, desktop, and command palette alongside built-in apps.

Plugins do **not** require modifying core Mavino code. You build, host, and publish them independently.

### Who can use plugins?

| Tier | Browse marketplace | Install plugins | Use installed plugins |
|------|-------------------|-----------------|----------------------|
| Free | No (402) | No | No |
| Paid | Yes | Yes (paid + pro-tier plugins with admin override) | Yes |
| Pro | Yes | Yes (all plugins) | Yes |
| Admin/Manager | Yes | Yes | Yes |

Each plugin declares a `minTier` of `"paid"` or `"pro"` — this controls who can install it.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Mavino Client (browser)                                │
│                                                         │
│  ┌──────────────┐    dynamic import(entryUrl)           │
│  │ PluginApp    │ ──────────────────────────►  Your     │
│  │ (runtime)    │                              ES module │
│  │              │    renders default export   (hosted on │
│  │              │ ◄──────────────────────────  your CDN) │
│  └──────────────┘                              │        │
│         │                                      │        │
│         │ window.open() / api calls             │        │
│         ▼                                      │        │
│  ┌──────────────┐                              │        │
│  │ Mavino API   │                              │        │
│  │ (server)     │                              │        │
│  └──────────────┘                              │        │
│         │                                      │        │
│         │ Athena tool call (proxy)             │        │
│         ▼                                      │        │
│  ┌──────────────┐   POST {plugin, arguments}   │        │
│  │ Mavino Server│ ──────────────────────────►  │        │
│  │ (proxy)      │                              ▼        │
│  └──────────────┘    ┌──────────────────────────────┐  │
│                      │ Your webhook endpoint        │  │
│                      │ (handlerUrl)                 │  │
│                      │ Returns JSON                 │  │
│                      └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Key points:**
- The **frontend** (your React component) is loaded via `import()` directly in the browser. It runs in the same origin as Mavino.
- The **backend** (your Athena tool webhook) is called server-to-server by the Mavino backend. The user's JWT/session is **never** forwarded to your webhook — only the tool arguments and an anonymous plugin key.
- The **manifest** (JSON metadata) is stored in the Mavino database and published by an admin via Settings → Plugins.

---

## Plugin Manifest

The manifest is a JSON object that describes your plugin. It's what an admin pastes into Settings → Plugins → Publish plugin.

### Full schema

```json
{
  "id": "my-awesome-plugin",
  "name": "My Awesome Plugin",
  "description": "Does something cool with the Mavino AI assistant.",
  "icon": "Sparkles",
  "version": "1.0.0",
  "author": "your-github-username",
  "category": "productivity",
  "entryUrl": "https://cdn.example.com/my-awesome-plugin/1.0.0/index.js",
  "minTier": "paid",
  "permissions": ["storage"],
  "tools": [
    {
      "name": "my_tool",
      "description": "Does something useful when the user asks Mavino to do X.",
      "parameters": [
        {
          "name": "query",
          "type": "string",
          "description": "What to search for",
          "required": true
        },
        {
          "name": "limit",
          "type": "number",
          "description": "Max results to return (default 10)"
        }
      ],
      "handlerUrl": "https://api.example.com/my-awesome-plugin/tool",
      "destructive": false,
      "requiresConfirmation": false
    }
  ]
}
```

### Field reference

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `id` | string | Yes | 1–64 chars, lowercase kebab-case (`^[a-z0-9-]+$`) | Unique plugin slug. Used as the `pluginKey` and in the synthetic appId `plugin:<id>`. |
| `name` | string | Yes | 1–100 chars | Display name shown in the taskbar, marketplace, etc. |
| `description` | string | No | max 500 chars | Shown in the marketplace card. |
| `icon` | string | No | max 50 chars | [Lucide icon name](https://lucide.dev/icons) (e.g. `"Sparkles"`, `"Puzzle"`, `"Rocket"`). Defaults to `"Puzzle"`. |
| `version` | string | No | max 20 chars | Semantic version string. Defaults to `"1.0.0"`. |
| `author` | string | No | max 100 chars | Your name/handle. Shown as "by \<author\>". |
| `category` | string | No | max 50 chars | Used for filtering in the marketplace (e.g. `"productivity"`, `"study"`, `"games"`). Defaults to `"general"`. |
| `entryUrl` | string | Yes | valid URL | Absolute URL to your plugin's ES module. **Must be HTTPS in production.** This is `import()`-ed by the browser. |
| `minTier` | `"paid"` \| `"pro"` | No | enum | Minimum subscription tier to install. Defaults to `"paid"`. |
| `permissions` | string[] | No | — | Declared permissions (informational — shown as a badge). e.g. `["storage", "network"]`. |
| `tools` | ToolManifest[] | No | — | Athena tool definitions. See [below](#creating-athena-tools-backend-webhook). |

### Tool manifest fields

Each entry in the `tools` array:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes (1–80 chars) | Tool name as seen by the LLM. Must be unique across all installed plugins. |
| `description` | string | Yes (1–500 chars) | What the tool does — the LLM uses this to decide when to call it. Be descriptive. |
| `parameters` | PluginParameter[] | Yes | JSON-schema-like parameter definitions. See [Parameter format](#parameter-format). |
| `handlerUrl` | string | Yes (valid URL) | Your webhook endpoint. Mavino POSTs `{ plugin, arguments }` to this URL. |
| `destructive` | boolean | No | If true, Mavino marks the tool result as a data-change event. Default false. |
| `requiresConfirmation` | boolean | No | If true, the client asks the user to confirm before executing. Default false. |

### Parameter format

Parameters use the `PluginParameter` format (from `multi-llm-ts`):

```typescript
interface PluginParameter {
  name: string;
  type: string;           // "string" | "number" | "boolean" | "object" | "array"
  description: string;
  required?: boolean;
  enum?: string[];        // constrains the value to one of these strings
  items?: {               // for array-type parameters
    type: string;
    properties?: PluginParameter[];  // for array-of-objects
  };
}
```

**Example — array of objects:**

```json
{
  "name": "items",
  "type": "array",
  "description": "List of items to process",
  "items": {
    "type": "object",
    "properties": [
      { "name": "title", "type": "string", "description": "Item title" },
      { "name": "url", "type": "string", "description": "Item URL" }
    ]
  }
}
```

---

## Creating a Plugin App (Frontend)

Your plugin's frontend is a single ES module that **default-exports a React component**. The module is loaded via `import(entryUrl)` when the user opens your plugin's window.

### Props

Your component receives two props:

```typescript
interface PluginAppProps {
  win: WindowInstance;
  plugin: PluginContext;
}

interface PluginContext {
  pluginKey: string;       // your plugin id, e.g. "my-awesome-plugin"
  name: string;            // display name
  version: string;         // semantic version
  permissions: string[];   // declared permissions
}

interface WindowInstance {
  id: string;              // unique window instance id
  appId: string;           // "plugin:<pluginKey>"
  title: string;
  icon: string;
  rect: { x: number; y: number; width: number; height: number };
  minimized: boolean;
  workspaceId: string;
  payload?: Record<string, unknown>;  // optional open-time payload
}
```

### Minimal example

```jsx
// src/index.jsx
export default function MyPlugin({ win, plugin }) {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>{plugin.name}</h1>
      <p>Welcome to my plugin! (v{plugin.version})</p>
      <p>Window id: {win.id}</p>
    </div>
  );
}
```

### Using Mavino's API from your plugin

Your plugin runs in the same browser context as Mavino, so it has access to the user's JWT token (stored in `localStorage`). You can call Mavino's API directly:

```jsx
export default function MyPlugin({ win, plugin }) {
  const [notes, setNotes] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem("athena.token");
    fetch("/api/notes", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setNotes(data.notes ?? []))
      .catch(console.error);
  }, []);

  return (
    <div style={{ padding: "1rem", overflow: "auto", height: "100%" }}>
      <h2>My Notes ({notes.length})</h2>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>{n.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

> **Note:** On the Capacitor native app, API paths are relative to the configured server URL. For broad compatibility, read the base URL:
> ```js
> const baseUrl = localStorage.getItem("athena.serverUrl")?.replace(/\/+$/, "") ?? "";
> const url = baseUrl + "/api/notes";
> ```

### Styling

Your plugin renders inside a Mavino window. You can use:

1. **Inline styles** — always work, no dependencies.
2. **Your own CSS** — bundle it into your JS module (Vite/esbuild handle this) or load it via a `<link>` tag.
3. **Mavino's Tailwind classes** — Mavino uses Tailwind CSS with these theme tokens:

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `bg-surface` | near-white | dark slate | Window background |
| `bg-surface-2` | light gray | slate-800 | Cards, inputs |
| `bg-surface-3` | gray-300 | slate-700 | Hover states, badges |
| `text-ink` | slate-900 | slate-100 | Primary text |
| `text-ink-muted` | slate-500 | slate-400 | Secondary text |
| `border-edge` | slate-300 | slate-700 | Borders |
| `bg-accent` / `text-accent` | indigo-500 | indigo-500 | Accent color (user-configurable) |
| `text-accent-fg` | white | white | Text on accent background |

Example using Mavino's classes:

```jsx
export default function MyPlugin({ win, plugin }) {
  return (
    <div className="flex h-full flex-col bg-surface p-4">
      <h2 className="text-base font-semibold text-ink">{plugin.name}</h2>
      <p className="text-sm text-ink-muted">Built by {plugin.permissions.join(", ")}</p>
      <div className="mt-4 rounded-lg border border-edge bg-surface-2 p-3">
        <p className="text-sm text-ink">Content goes here</p>
      </div>
    </div>
  );
}
```

> **Caution:** Tailwind classes only work if your module is loaded in the Mavino context (where Tailwind is already loaded). If you're testing in isolation, use inline styles or your own CSS.

### Container queries

Mavino's window content area uses Tailwind container queries (`@container`). You can use `@sm:`, `@lg:`, `@2xl:` breakpoints to make your plugin responsive to the window size:

```jsx
<div className="grid grid-cols-1 @lg:grid-cols-2 @2xl:grid-cols-3 gap-3">
  {/* cards */}
</div>
```

### Error handling

Mavino wraps your plugin in an **error boundary**. If your component throws during render or the module fails to load, the user sees a friendly error message with a Retry button. You don't need to handle this yourself — but you should still handle errors gracefully in async operations (fetch failures, etc.).

### Building your frontend module

Bundle your component as a single ES module. The default export must be your React component.

**Vite config (recommended):**

```js
// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/index.jsx",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["react", "react-dom"], // don't bundle React — Mavino provides it
    },
  },
});
```

> **Important:** Mark `react` and `react-dom` as external. Mavino already has React loaded; bundling your own copy wastes bandwidth and can cause hook errors. If you must bundle React (for isolated testing), use a shared chunk — but external is strongly recommended.

**Output:** A single `index.js` (ES module format) that you host on a CDN or static host. The URL goes in `entryUrl`.

### TypeScript types

If you use TypeScript, here are the type definitions for the plugin contract:

```typescript
// types.d.ts — copy into your plugin project
export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowInstance {
  id: string;
  appId: string;
  title: string;
  icon: string;
  rect: WindowRect;
  minimized: boolean;
  workspaceId: string;
  payload?: Record<string, unknown>;
}

export interface PluginContext {
  pluginKey: string;
  name: string;
  version: string;
  permissions: string[];
}

export interface PluginAppProps {
  win: WindowInstance;
  plugin: PluginContext;
}

declare function PluginComponent(props: PluginAppProps): JSX.Element;
export default PluginComponent;
```

---

## Creating Athena Tools (Backend Webhook)

Athena tools let the Mavino AI assistant call your plugin's backend. When a user asks Mavino to do something your tool handles, the LLM calls your tool, and Mavino proxies the call to your `handlerUrl` webhook.

### How it works

1. The user installs your plugin (which declares tools in its manifest).
2. On each Mavino chat turn, the server loads your tool definitions and registers them with the LLM.
3. When the LLM decides to call your tool, Mavino's server sends a POST request to your `handlerUrl`.
4. Your webhook processes the request and returns JSON.
5. The LLM sees the result and continues the conversation.

### Webhook contract

**Request:**
```
POST <handlerUrl>
Content-Type: application/json

{
  "plugin": "my-awesome-plugin",
  "arguments": {
    "query": "example search",
    "limit": 5
  }
}
```

**Response (success):**
```json
{
  "results": [
    { "title": "Example", "url": "https://example.com" }
  ],
  "count": 1
}
```

**Response (error):**
```json
{
  "error": "Something went wrong: invalid query"
}
```

If your webhook returns a non-2xx status, Mavino wraps the response body in an `error` field and returns it to the LLM.

**Timeout:** 30 seconds. If your webhook takes longer, the call is aborted and an error is returned to the LLM.

### Example webhook (Node.js / Express)

```javascript
import express from "express";

const app = express();
app.use(express.json());

app.post("/my-awesome-plugin/tool", async (req, res) => {
  const { plugin, arguments: args } = req.body;

  // Verify the plugin key matches yours (basic sanity check)
  if (plugin !== "my-awesome-plugin") {
    return res.status(400).json({ error: "Unknown plugin" });
  }

  const { query, limit = 10 } = args;

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "query is required" });
  }

  try {
    // Do your work here — call an API, query a database, etc.
    const results = await searchSomething(query, limit);
    return res.json({ results, count: results.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Plugin webhook on :3000"));
```

### Example webhook (Bun + Hono)

```typescript
import { Hono } from "hono";

const app = new Hono();

app.post("/my-awesome-plugin/tool", async (c) => {
  const body = await c.req.json();
  const { plugin, arguments: args } = body;

  if (plugin !== "my-awesome-plugin") {
    return c.json({ error: "Unknown plugin" }, 400);
  }

  const { query, limit = 10 } = args;
  if (!query) return c.json({ error: "query is required" }, 400);

  const results = await searchSomething(query, limit);
  return c.json({ results, count: results.length });
});

export default { port: 3000, fetch: app.fetch };
```

### Tool design tips

- **Be descriptive in `description`**: The LLM uses this to decide when to call your tool. Write it as if explaining to a smart assistant: "Searches the university library catalog for books matching a query. Returns title, author, and availability."
- **Keep parameters simple**: Use `string`, `number`, `boolean`, and arrays. Avoid deeply nested objects unless necessary.
- **Return structured JSON**: The LLM reads the JSON result. Use clear keys: `{ results: [...], count: N }` is better than a bare array.
- **Handle errors gracefully**: Return `{ error: "..." }` instead of crashing. The LLM will relay the error to the user.
- **Mark destructive tools**: If your tool modifies data (creates, updates, deletes), set `"destructive": true` so Mavino can emit data-refresh events.
- **Require confirmation for risky actions**: Set `"requiresConfirmation": true` for tools that have side effects the user might want to review (sending emails, deleting records, etc.).

---

## Publishing a Plugin

Plugins are published by a **Mavino admin** via Settings → Plugins → Publish plugin.

### Steps

1. **Build and host your frontend module** — produce a single ES module `.js` file and host it at a public HTTPS URL (e.g. GitHub Releases, Cloudflare Pages, Vercel, S3+CloudFront).
2. **Host your webhook** (if you have Athena tools) — deploy your webhook server to a public HTTPS URL.
3. **Prepare your manifest JSON** — following the [schema above](#plugin-manifest).
4. **As an admin, open Settings → Plugins** in Mavino.
5. **Click "Publish plugin"** and paste your manifest JSON.
6. **Click "Publish"** — your plugin appears in the marketplace immediately.
7. **Toggle "Featured"** (star icon) to highlight it in the Featured section.
8. **Toggle "Published"** (eye icon) to hide/show it without deleting.

### Updating a plugin

To update a plugin (new version, new features, bug fix):

1. **Deploy the new version** of your frontend module to a new URL (e.g. `.../1.1.0/index.js`) — or overwrite the same URL if you want all users to get the update immediately.
2. **As an admin, edit the plugin** in Settings → Plugins (click the save/edit icon).
3. **Update the manifest** — change `version`, `entryUrl`, and/or `tools` as needed.
4. **Click "Update"**.

> **Versioning tip:** If you use versioned URLs (`.../1.0.0/index.js`), existing windows keep running the old version until the user reopens the plugin. If you use a fixed URL (`.../latest/index.js`), all users get the new version on next load. Choose based on your stability needs.

### Deleting a plugin

Click the trash icon in Settings → Plugins. This **uninstalls the plugin from all users** and removes it from the catalog. The plugin's windows (if open) show a "Plugin no longer installed" message.

---

## Testing Your Plugin

### Local development

1. **Build your module in watch mode:**
   ```bash
   cd my-plugin
   npx vite build --watch
   ```
   This produces `dist/index.js` and rebuilds on changes.

2. **Serve it locally:**
   ```bash
   npx serve dist --cors -p 4000
   ```
   Your module is now at `http://localhost:4000/index.js`.

3. **Publish a test plugin** in Mavino with `entryUrl: "http://localhost:4000/index.js"`. (Use `http://` for local dev — production requires HTTPS.)

4. **Install it** from the Marketplace and open it.

5. **Iterate:** Changes rebuild automatically. Close and reopen the plugin window to pick up the new module (the runtime caches by URL — see [Caching](#caching)).

### Testing Athena tools

1. **Run your webhook server locally:**
   ```bash
   bun run server.ts  # or node server.js
   ```

2. **Use a tunnel** (ngrok, Cloudflare Tunnel) to expose it:
   ```bash
   ngrok http 3000
   ```
   This gives you a public HTTPS URL like `https://abc123.ngrok.io`.

3. **Set `handlerUrl`** in your manifest to the tunneled URL + path (e.g. `https://abc123.ngrok.io/my-awesome-plugin/tool`).

4. **Install the plugin**, then ask Mavino to use your tool:
   > "Use my_tool to search for 'calculus textbooks'"

5. **Check your webhook logs** to see the incoming request.

### Caching

The plugin runtime caches loaded modules **by entryUrl**. To force a reload during development:
- Use a cache-busting query param: `http://localhost:4000/index.js?v=2`
- Or click "Retry" in the error boundary (if your module throws)
- Or close and reopen the window (the cache is in-memory, not persistent)

For production updates, either use versioned URLs or change the `entryUrl` in the manifest.

### Debugging

- **Browser DevTools:** Your plugin runs in the main Mavino page. Open DevTools → Console to see errors (prefixed with `[plugin:<name>]`).
- **Network tab:** Watch for the `import()` request to your `entryUrl` and any API calls your plugin makes.
- **Error boundary:** If your module fails to load or throws during render, Mavino shows an error card with the message and a Retry button.

---

## Security Model

### Trust boundary

Plugins are **admin-curated**. The admin who publishes a plugin is vouching for its safety. Users install plugins at their own discretion from the admin-curated catalog.

### What plugin code can access

| Resource | Access | Notes |
|----------|--------|-------|
| User's JWT token | Yes (via `localStorage`) | The plugin runs in the same browser context. Only publish plugins you trust. |
| Mavino API | Yes | Plugins can call any `/api/*` endpoint with the user's credentials. |
| DOM | Yes | Plugins can manipulate the DOM within their window. |
| Other origins | Yes (fetch) | Plugins can make cross-origin requests (subject to CORS). |
| User's session/cookies | No (webhook) | The webhook never receives the JWT — only `{ plugin, arguments }`. |

### Best practices for plugin authors

1. **Don't exfiltrate the JWT.** Your plugin has access to the user's token — don't send it to your own server. Use Mavino's API directly from the client, or use Athena tools (which proxy through Mavino's server without forwarding credentials).
2. **Use HTTPS for `entryUrl` and `handlerUrl`.** HTTP is allowed in development but blocked by browser security in production.
3. **Validate webhook inputs.** Your `handlerUrl` receives untrusted input (the LLM generates the arguments). Validate types, ranges, and content before processing.
4. **Set timeouts on your webhook.** Mavino times out after 30s, but your internal operations should be faster. Stream long operations if needed.
5. **Declare permissions honestly.** The `permissions` array is shown to users as a badge. Don't claim you need fewer permissions than you actually use.
6. **Don't bundle React.** Mark it as external — Mavino provides it. Bundling your own copy causes hook errors and bloats the download.

### Best practices for admins

1. **Only publish plugins from trusted sources.** The plugin code runs in the user's browser with full access to their Mavino session.
2. **Review the manifest before publishing.** Check the `entryUrl` and `handlerUrl` point to legitimate hosts.
3. **Use `published: false` to stage plugins.** You can add a plugin to the catalog without making it visible, then flip the switch when ready.
4. **Monitor install counts.** If a plugin has issues, you can unpublish it (hides from marketplace) or delete it (uninstalls from everyone).

---

## API Reference

### Marketplace routes (paid/pro users)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/plugins` | Browse published catalog (with install status + counts) |
| `GET` | `/api/plugins/:pluginKey` | Get a single plugin's detail |
| `GET` | `/api/plugins/installed` | List the current user's installed + enabled plugins |
| `POST` | `/api/plugins/:pluginKey/install` | Install a plugin |
| `DELETE` | `/api/plugins/:pluginKey/install` | Uninstall a plugin |
| `PUT` | `/api/plugins/:pluginKey/enabled` | Enable/disable an installed plugin (`{ enabled: boolean }`) |

All marketplace routes return **402** for free-tier users.

### Admin routes (admin only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/plugins/admin` | List all plugins (including unpublished) + install counts |
| `POST` | `/api/plugins/admin` | Publish a new plugin (body = manifest JSON) |
| `PUT` | `/api/plugins/admin/:pluginKey` | Update an existing plugin (body = partial manifest) |
| `DELETE` | `/api/plugins/admin/:pluginKey` | Delete a plugin from the catalog |
| `PUT` | `/api/plugins/admin/:pluginKey/featured` | Toggle featured (`{ featured: boolean }`) |
| `PUT` | `/api/plugins/admin/:pluginKey/published` | Toggle published (`{ published: boolean }`) |

### Webhook contract (plugin backend)

```
POST <handlerUrl>
Content-Type: application/json
Body: { "plugin": "<pluginKey>", "arguments": { ... } }
Timeout: 30s
Response: JSON (2xx = success, non-2xx = error)
```

---

## Complete Example

Here's a complete, working example plugin: a **Pomodoro Stats** plugin that shows your focus session history and exposes an Athena tool to get a summary.

### Project structure

```
pomodoro-stats/
├── package.json
├── vite.config.js
├── src/
│   └── index.jsx        # Frontend component
└── server/
    └── webhook.js       # Athena tool webhook
```

### `package.json`

```json
{
  "name": "pomodoro-stats",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "serve": "npx serve dist --cors -p 4000",
    "webhook": "bun run server/webhook.js"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0"
  }
}
```

### `vite.config.js`

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/index.jsx",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["react", "react-dom"],
    },
  },
});
```

### `src/index.jsx`

```jsx
import { useState, useEffect } from "react";

export default function PomodoroStats({ win, plugin }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const baseUrl = localStorage.getItem("athena.serverUrl")?.replace(/\/+$/, "") ?? "";
    const token = localStorage.getItem("athena.token");
    fetch(`${baseUrl}/api/focus`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSessions(data.sessions ?? []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMin || 0), 0);
  const completedCount = sessions.filter((s) => s.completed).length;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-500">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface p-4 overflow-y-auto">
      <h2 className="text-lg font-semibold text-ink">{plugin.name}</h2>
      <p className="text-sm text-ink-muted mb-4">
        by {plugin.version} · {plugin.permissions.join(", ")}
      </p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg border border-edge bg-surface-2 p-3">
          <p className="text-xs text-ink-muted">Total focus time</p>
          <p className="text-xl font-bold text-ink">
            {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m
          </p>
        </div>
        <div className="rounded-lg border border-edge bg-surface-2 p-3">
          <p className="text-xs text-ink-muted">Sessions completed</p>
          <p className="text-xl font-bold text-ink">{completedCount}</p>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-ink mb-2">Recent sessions</h3>
      <div className="space-y-2">
        {sessions.slice(0, 20).map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-lg border border-edge bg-surface-2 p-2.5"
          >
            <div>
              <p className="text-sm text-ink">
                {new Date(s.startedAt).toLocaleDateString()} · {s.durationMin}min
              </p>
              <p className="text-xs text-ink-muted">{s.taskTitle || "No task"}</p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                s.completed
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "bg-amber-500/15 text-amber-500"
              }`}
            >
              {s.completed ? "Done" : "Incomplete"}
            </span>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="text-sm text-ink-muted text-center py-4">
            No focus sessions yet. Start a Pomodoro!
          </p>
        )}
      </div>
    </div>
  );
}
```

### `server/webhook.js`

```javascript
// Athena tool webhook — returns a summary of the user's focus sessions.
// Note: this webhook does NOT receive the user's JWT. If you need user-specific
// data, your frontend component should call Mavino's API directly. The webhook
// is for plugin-specific backend logic (e.g. calling an external API).

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/pomodoro-stats/tool" && req.method === "POST") {
      const body = await req.json();
      const { plugin, arguments: args } = body;

      if (plugin !== "pomodoro-stats") {
        return new Response(JSON.stringify({ error: "Unknown plugin" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { days = 7 } = args;

      // In a real plugin, you'd query your own database or external API here.
      // This example returns a static summary.
      return new Response(
        JSON.stringify({
          summary: `In the last ${days} days, the user completed 12 Pomodoro sessions totaling 5 hours of focused study time. Most productive day was Tuesday with 4 sessions.`,
          totalSessions: 12,
          totalMinutes: 300,
          daysCovered: days,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Pomodoro Stats webhook on http://localhost:${server.port}`);
```

### Manifest (paste into Settings → Plugins → Publish plugin)

```json
{
  "id": "pomodoro-stats",
  "name": "Pomodoro Stats",
  "description": "Visualize your focus session history and let Mavino summarize your productivity.",
  "icon": "Timer",
  "version": "1.0.0",
  "author": "community-dev",
  "category": "productivity",
  "entryUrl": "https://your-cdn.example.com/pomodoro-stats/1.0.0/index.js",
  "minTier": "paid",
  "permissions": ["focus-sessions"],
  "tools": [
    {
      "name": "get_focus_summary",
      "description": "Get a summary of the user's recent Pomodoro/focus sessions, including total time, session count, and most productive day. Use when the user asks about their productivity or study time.",
      "parameters": [
        {
          "name": "days",
          "type": "number",
          "description": "Number of days to include in the summary (default 7)"
        }
      ],
      "handlerUrl": "https://your-api.example.com/pomodoro-stats/tool",
      "destructive": false
    }
  ]
}
```

### Build, host, and publish

```bash
# Build the frontend
cd pomodoro-stats
npm run build

# Host the frontend (or deploy to your CDN)
npm run serve  # http://localhost:4000/index.js

# Run the webhook (or deploy to your server)
npm run webhook  # http://localhost:3000/pomodoro-stats/tool
```

Then as a Mavino admin:
1. Open **Settings → Plugins → Publish plugin**
2. Paste the manifest JSON (with your real URLs)
3. Click **Publish**
4. Open the **Marketplace** app and install your plugin
5. Ask Mavino: *"Summarize my recent focus sessions"*

---

## FAQ

**Can I use TypeScript for my frontend module?**
Yes. Compile to JS and bundle with Vite/esbuild. The runtime expects a JS ES module with a default export.

**Can my plugin open other Mavino apps?**
Yes — call the Mavino API or dispatch a custom event. The window manager listens for app-open requests. However, there's no formal public API for this yet; the safest approach is to use the Mavino API endpoints directly.

**Can my plugin store its own data?**
You can store data in your own backend (via your webhook) or use `localStorage` for client-side persistence. There's no plugin-specific storage in the Mavino database yet.

**Can multiple plugins define tools with the same name?**
No. Tool names must be unique across all installed plugins. Prefix your tool names with your plugin id to avoid collisions (e.g. `pomodoro_stats_get_summary` instead of `get_summary`).

**What happens if my `entryUrl` is down?**
The user sees a loading spinner, then an error message with a Retry button. The error is logged to the browser console. Mavino continues to work normally — only your plugin is affected.

**Can I charge for my plugin?**
The marketplace doesn't currently support per-plugin payments. Plugins are available to all paid/pro users. You can restrict installation to pro users only by setting `minTier: "pro"`.

**How do I update my plugin without breaking existing users?**
Use versioned `entryUrl`s (`.../1.0.0/index.js`, `.../1.1.0/index.js`) and update the manifest when you're ready for users to get the new version. Users get the new version when they next open the plugin window.
