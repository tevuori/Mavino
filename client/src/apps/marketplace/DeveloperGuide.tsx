// ===== In-app Plugin Developer Guide =====
// Renders the plugin development documentation directly inside the Marketplace
// app as a "Develop" tab. Structured as a scrollable article with a sticky
// table-of-contents sidebar for navigation.

import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  BookOpen, Rocket, FileJson, Code2, Wrench, Upload, FlaskConical,
  ShieldCheck, Copy, Check, ChevronRight, ExternalLink,
} from "lucide-react";

// ----- code block with copy button -----

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-edge bg-surface-3/50">
      {lang && (
        <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">{lang}</span>
          <button
            onClick={copy}
            className="flex items-center gap-1 text-[10px] text-ink-muted opacity-0 transition group-hover:opacity-100 hover:text-ink"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className="font-mono text-ink">{code}</code>
      </pre>
      {!lang && (
        <button
          onClick={copy}
          className="absolute right-2 top-2 flex items-center gap-1 rounded bg-surface-2 px-1.5 py-1 text-[10px] text-ink-muted opacity-0 transition group-hover:opacity-100 hover:text-ink"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      )}
    </div>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-accent">
      {children}
    </code>
  );
}

function Callout({ type = "info", children }: { type?: "info" | "warn" | "tip"; children: ReactNode }) {
  const styles = {
    info: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    tip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };
  const icons = { info: "ℹ️", warn: "⚠️", tip: "💡" };
  return (
    <div className={`my-3 flex gap-2.5 rounded-lg border p-3 text-xs ${styles[type]}`}>
      <span className="shrink-0">{icons[type]}</span>
      <div className="flex-1 text-ink-muted">{children}</div>
    </div>
  );
}

function FieldTable({ rows }: { rows: Array<[string, string, string, string]> }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-edge">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-edge bg-surface-2">
            <th className="px-3 py-2 text-left font-semibold text-ink">Field</th>
            <th className="px-3 py-2 text-left font-semibold text-ink">Type</th>
            <th className="px-3 py-2 text-left font-semibold text-ink">Required</th>
            <th className="px-3 py-2 text-left font-semibold text-ink">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([field, type, req, desc], i) => (
            <tr key={i} className={i < rows.length - 1 ? "border-b border-edge" : ""}>
              <td className="px-3 py-2 font-mono text-accent">{field}</td>
              <td className="px-3 py-2 font-mono text-ink-muted">{type}</td>
              <td className="px-3 py-2 text-ink-muted">{req}</td>
              <td className="px-3 py-2 text-ink-muted">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----- table of contents -----

interface TocEntry {
  id: string;
  label: string;
  icon: ReactNode;
}

const TOC: TocEntry[] = [
  { id: "overview", label: "Overview", icon: <Rocket size={14} /> },
  { id: "manifest", label: "Plugin Manifest", icon: <FileJson size={14} /> },
  { id: "frontend", label: "Frontend App", icon: <Code2 size={14} /> },
  { id: "tools", label: "Athena Tools", icon: <Wrench size={14} /> },
  { id: "publishing", label: "Publishing", icon: <Upload size={14} /> },
  { id: "testing", label: "Testing", icon: <FlaskConical size={14} /> },
  { id: "security", label: "Security", icon: <ShieldCheck size={14} /> },
];

// ----- main component -----

export default function DeveloperGuide() {
  const [activeSection, setActiveSection] = useState("overview");
  const contentRef = useRef<HTMLDivElement>(null);

  // Track which section is in view for the TOC highlight.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px", root: el }
    );
    for (const toc of TOC) {
      const section = el.querySelector(`#${toc.id}`);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = contentRef.current?.querySelector(`#${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex h-full">
      {/* Sidebar — table of contents */}
      <div className="hidden w-48 shrink-0 overflow-y-auto border-r border-edge bg-surface-2/50 p-3 @lg:block">
        <h3 className="mb-3 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <BookOpen size={13} /> Developer Guide
        </h3>
        <nav className="space-y-0.5">
          {TOC.map((toc) => (
            <button
              key={toc.id}
              onClick={() => scrollTo(toc.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                activeSection === toc.id
                  ? "bg-accent/15 font-medium text-accent"
                  : "text-ink-muted hover:bg-surface-3 hover:text-ink"
              }`}
            >
              {toc.icon}
              {toc.label}
            </button>
          ))}
        </nav>
        <div className="mt-4 rounded-lg border border-edge bg-surface-3/50 p-2.5">
          <p className="text-[10px] leading-relaxed text-ink-muted">
            Full docs also at{" "}
            <span className="font-mono">docs/PLUGIN_DEVELOPMENT.md</span>{" "}
            in the repository.
          </p>
        </div>
      </div>

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 py-6">
          {/* ===== Overview ===== */}
          <Section id="overview" icon={<Rocket size={18} />} title="Overview">
            <p>
              A Mavino plugin extends the platform with a <strong>frontend app</strong> (a React
              component loaded from a remote ES module) and optionally <strong>Athena tools</strong>{" "}
              (LLM-callable functions backed by a webhook on your own server). Plugins are installed
              by paid/pro users from the in-app Marketplace; they appear in the taskbar, start menu,
              desktop, and command palette alongside built-in apps.
            </p>
            <p>
              Plugins do <strong>not</strong> require modifying core Mavino code. You build, host,
              and publish them independently.
            </p>

            <h4 className="mt-5 mb-2 text-sm font-semibold text-ink">Who can use plugins?</h4>
            <div className="overflow-x-auto rounded-lg border border-edge">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-edge bg-surface-2">
                    <th className="px-3 py-2 text-left font-semibold text-ink">Tier</th>
                    <th className="px-3 py-2 text-left font-semibold text-ink">Browse</th>
                    <th className="px-3 py-2 text-left font-semibold text-ink">Install</th>
                    <th className="px-3 py-2 text-left font-semibold text-ink">Use</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Free", "No (402)", "No", "No"],
                    ["Paid", "Yes", "Yes", "Yes"],
                    ["Pro", "Yes", "Yes (all)", "Yes"],
                    ["Admin", "Yes", "Yes", "Yes"],
                  ].map(([tier, browse, install, use], i) => (
                    <tr key={i} className={i < 3 ? "border-b border-edge" : ""}>
                      <td className="px-3 py-2 font-medium text-ink">{tier}</td>
                      <td className="px-3 py-2 text-ink-muted">{browse}</td>
                      <td className="px-3 py-2 text-ink-muted">{install}</td>
                      <td className="px-3 py-2 text-ink-muted">{use}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 className="mt-5 mb-2 text-sm font-semibold text-ink">How it works</h4>
            <CodeBlock lang="text" code={`Browser (Mavino client)
  │
  ├── import(entryUrl) ──► Your ES module (CDN)
  │                         default export = React component
  │
  └── Mavino API calls (with user's JWT)
        │
Server (Mavino backend)
  │
  └── Athena tool call (proxy)
        │
        └── POST { plugin, arguments } ──► Your webhook (handlerUrl)
                                           Returns JSON`} />

            <Callout type="info">
              The frontend is loaded via <InlineCode>import()</InlineCode> in the browser (same
              origin). The backend webhook is called server-to-server — the user's JWT/session is{" "}
              <strong>never</strong> forwarded to your webhook.
            </Callout>
          </Section>

          {/* ===== Manifest ===== */}
          <Section id="manifest" icon={<FileJson size={18} />} title="Plugin Manifest">
            <p>
              The manifest is a JSON object describing your plugin. An admin pastes it into{" "}
              <strong>Settings → Plugins → Publish plugin</strong>.
            </p>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Full example</h4>
            <CodeBlock lang="json" code={MANIFEST_EXAMPLE} />

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Field reference</h4>
            <FieldTable
              rows={[
                ["id", "string", "Yes", "Unique slug, lowercase kebab-case (a-z0-9-), 1–64 chars. Used as pluginKey."],
                ["name", "string", "Yes", "Display name (1–100 chars)."],
                ["description", "string", "No", "Marketplace card description (max 500 chars)."],
                ["icon", "string", "No", "Lucide icon name (e.g. \"Sparkles\"). Default: \"Puzzle\"."],
                ["version", "string", "No", "Semantic version. Default: \"1.0.0\"."],
                ["author", "string", "No", "Your name/handle."],
                ["category", "string", "No", "Filter category (e.g. \"productivity\"). Default: \"general\"."],
                ["entryUrl", "string", "Yes", "HTTPS URL to your ES module. This is import()-ed by the browser."],
                ["minTier", "\"paid\"|\"pro\"", "No", "Minimum tier to install. Default: \"paid\"."],
                ["permissions", "string[]", "No", "Declared permissions (shown as a badge)."],
                ["tools", "Tool[]", "No", "Athena tool definitions. See Athena Tools section."],
              ]}
            />

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Tool fields</h4>
            <FieldTable
              rows={[
                ["name", "string", "Yes", "Tool name (1–80 chars). Must be unique across all installed plugins."],
                ["description", "string", "Yes", "What the tool does — the LLM uses this to decide when to call it."],
                ["parameters", "PluginParameter[]", "Yes", "JSON-schema-like parameter definitions."],
                ["handlerUrl", "string", "Yes", "Your webhook URL. Mavino POSTs { plugin, arguments } here."],
                ["destructive", "boolean", "No", "If true, marks the result as a data-change event."],
                ["requiresConfirmation", "boolean", "No", "If true, client asks user to confirm before executing."],
              ]}
            />

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Parameter format</h4>
            <CodeBlock lang="typescript" code={`interface PluginParameter {
  name: string;
  type: string;           // "string" | "number" | "boolean" | "object" | "array"
  description: string;
  required?: boolean;
  enum?: string[];        // constrains value to one of these
  items?: {               // for array-type parameters
    type: string;
    properties?: PluginParameter[];  // for array-of-objects
  };
}`} />

            <p className="mt-3 text-xs text-ink-muted">Example — array of objects:</p>
            <CodeBlock lang="json" code={`{
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
}`} />
          </Section>

          {/* ===== Frontend ===== */}
          <Section id="frontend" icon={<Code2 size={18} />} title="Frontend App">
            <p>
              Your plugin's frontend is a single ES module that{" "}
              <strong>default-exports a React component</strong>. It's loaded via{" "}
              <InlineCode>import(entryUrl)</InlineCode> when the user opens your plugin's window.
            </p>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Props</h4>
            <CodeBlock lang="typescript" code={PROPS_TYPES} />

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Minimal example</h4>
            <CodeBlock lang="jsx" code={`export default function MyPlugin({ win, plugin }) {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>{plugin.name}</h1>
      <p>Welcome to my plugin! (v{plugin.version})</p>
    </div>
  );
}`} />

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Calling Mavino's API</h4>
            <p>
              Your plugin runs in the same browser context as Mavino, so it has access to the user's
              JWT token (in <InlineCode>localStorage</InlineCode>):
            </p>
            <CodeBlock lang="jsx" code={`import { useState, useEffect } from "react";

export default function MyPlugin({ win, plugin }) {
  const [notes, setNotes] = useState([]);

  useEffect(() => {
    const baseUrl = localStorage.getItem("athena.serverUrl")
      ?.replace(/\\/+$/, "") ?? "";
    const token = localStorage.getItem("athena.token");
    fetch(\`\${baseUrl}/api/notes\`, {
      headers: { Authorization: \`Bearer \${token}\` },
    })
      .then((r) => r.json())
      .then((data) => setNotes(data.notes ?? []))
      .catch(console.error);
  }, []);

  return (
    <ul>
      {notes.map((n) => <li key={n.id}>{n.title}</li>)}
    </ul>
  );
}`} />

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Styling</h4>
            <p>
              Your plugin renders inside a Mavino window. You can use inline styles, your own CSS,
              or Mavino's Tailwind classes with these theme tokens:
            </p>
            <div className="overflow-x-auto rounded-lg border border-edge">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-edge bg-surface-2">
                    <th className="px-3 py-2 text-left font-semibold text-ink">Token</th>
                    <th className="px-3 py-2 text-left font-semibold text-ink">Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["bg-surface / text-ink", "Window background / primary text"],
                    ["bg-surface-2 / bg-surface-3", "Cards / hover states"],
                    ["text-ink-muted", "Secondary text"],
                    ["border-edge", "Borders"],
                    ["bg-accent / text-accent-fg", "Accent color (user-configurable)"],
                  ].map(([token, usage], i) => (
                    <tr key={i} className={i < 4 ? "border-b border-edge" : ""}>
                      <td className="px-3 py-2 font-mono text-accent">{token}</td>
                      <td className="px-3 py-2 text-ink-muted">{usage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              Container queries (<InlineCode>@lg:</InlineCode>, <InlineCode>@2xl:</InlineCode>) are
              available for responsive layouts based on window size.
            </p>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Build config (Vite)</h4>
            <Callout type="warn">
              Mark <InlineCode>react</InlineCode> and <InlineCode>react-dom</InlineCode> as{" "}
              <strong>external</strong>. Mavino already has React loaded — bundling your own copy
              causes hook errors and bloats the download.
            </Callout>
            <CodeBlock lang="javascript" code={`// vite.config.js
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
});`} />

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Error handling</h4>
            <p>
              Mavino wraps your plugin in an <strong>error boundary</strong>. If your component
              throws during render or the module fails to load, the user sees a friendly error
              message with a Retry button. You don't need to handle this — but still handle errors
              in async operations (fetch failures, etc.).
            </p>
          </Section>

          {/* ===== Athena Tools ===== */}
          <Section id="tools" icon={<Wrench size={18} />} title="Athena Tools">
            <p>
              Athena tools let the Mavino AI assistant call your plugin's backend. When a user asks
              Mavino to do something your tool handles, the LLM calls your tool, and Mavino proxies
              the call to your <InlineCode>handlerUrl</InlineCode> webhook.
            </p>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Webhook contract</h4>
            <CodeBlock lang="http" code={`POST <handlerUrl>
Content-Type: application/json

{
  "plugin": "my-awesome-plugin",
  "arguments": {
    "query": "example search",
    "limit": 5
  }
}`} />
            <p className="mt-2 text-xs text-ink-muted">Success response (2xx):</p>
            <CodeBlock lang="json" code={`{
  "results": [
    { "title": "Example", "url": "https://example.com" }
  ],
  "count": 1
}`} />
            <p className="mt-2 text-xs text-ink-muted">Error response:</p>
            <CodeBlock lang="json" code={`{ "error": "Something went wrong: invalid query" }`} />

            <Callout type="warn">
              <strong>Timeout:</strong> 30 seconds. If your webhook takes longer, the call is
              aborted and an error is returned to the LLM.
            </Callout>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Example (Bun + Hono)</h4>
            <CodeBlock lang="typescript" code={`import { Hono } from "hono";

const app = new Hono();

app.post("/my-plugin/tool", async (c) => {
  const { plugin, arguments: args } = await c.req.json();

  if (plugin !== "my-plugin") {
    return c.json({ error: "Unknown plugin" }, 400);
  }

  const { query, limit = 10 } = args;
  if (!query) return c.json({ error: "query is required" }, 400);

  // Do your work — call an API, query a database, etc.
  const results = await searchSomething(query, limit);
  return c.json({ results, count: results.length });
});

export default { port: 3000, fetch: app.fetch };`} />

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Tool design tips</h4>
            <ul className="space-y-1.5 text-xs text-ink-muted">
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Be descriptive</strong> — the LLM uses <InlineCode>description</InlineCode> to decide when to call your tool. Write it as if explaining to a smart assistant.</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Keep parameters simple</strong> — use <InlineCode>string</InlineCode>, <InlineCode>number</InlineCode>, <InlineCode>boolean</InlineCode>, and arrays. Avoid deeply nested objects.</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Return structured JSON</strong> — <InlineCode>{"{ results: [...], count: N }"}</InlineCode> is better than a bare array.</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Handle errors gracefully</strong> — return <InlineCode>{"{ error: '...' }"}</InlineCode> instead of crashing.</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Prefix tool names</strong> — use <InlineCode>myplugin_verb</InlineCode> to avoid collisions with other plugins.</span></li>
            </ul>
          </Section>

          {/* ===== Publishing ===== */}
          <Section id="publishing" icon={<Upload size={18} />} title="Publishing">
            <p>Plugins are published by a <strong>Mavino admin</strong> via Settings → Plugins.</p>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Steps</h4>
            <ol className="space-y-2 text-xs text-ink-muted">
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">1</span>
                <span><strong>Build &amp; host your frontend module</strong> — produce a single ES module <InlineCode>.js</InlineCode> file at a public HTTPS URL (GitHub Releases, Cloudflare Pages, Vercel, S3+CloudFront).</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">2</span>
                <span><strong>Host your webhook</strong> (if you have Athena tools) — deploy to a public HTTPS URL.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">3</span>
                <span><strong>Prepare your manifest JSON</strong> following the schema above.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">4</span>
                <span>As an admin, open <strong>Settings → Plugins</strong> → click <strong>Publish plugin</strong> → paste your manifest → click <strong>Publish</strong>.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">5</span>
                <span>Toggle <strong>Featured</strong> (star) to highlight it. Toggle <strong>Published</strong> (eye) to hide/show.</span>
              </li>
            </ol>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Updating</h4>
            <Callout type="tip">
              Use <strong>versioned URLs</strong> (<InlineCode>.../1.0.0/index.js</InlineCode>) for
              stable releases — existing windows keep the old version. Use a{" "}
              <strong>fixed URL</strong> (<InlineCode>.../latest/index.js</InlineCode>) to push
              updates to everyone immediately.
            </Callout>
            <p>
              To update: deploy the new version, then edit the plugin in Settings → Plugins (save
              icon), update <InlineCode>version</InlineCode> and <InlineCode>entryUrl</InlineCode>,
              and click Update.
            </p>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Deleting</h4>
            <p>
              Click the trash icon in Settings → Plugins. This{" "}
              <strong>uninstalls the plugin from all users</strong> and removes it from the catalog.
              Open windows show a "Plugin no longer installed" message.
            </p>
          </Section>

          {/* ===== Testing ===== */}
          <Section id="testing" icon={<FlaskConical size={18} />} title="Testing">
            <h4 className="mb-2 text-sm font-semibold text-ink">Local development</h4>
            <CodeBlock lang="bash" code={`# Build in watch mode
cd my-plugin
npx vite build --watch

# Serve the module locally
npx serve dist --cors -p 4000
# → http://localhost:4000/index.js`} />
            <p className="mt-2">
              Publish a test plugin with{" "}
              <InlineCode>entryUrl: "http://localhost:4000/index.js"</InlineCode>, install it from
              the Marketplace, and open it. Changes rebuild automatically — close and reopen the
              window to pick up the new module.
            </p>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Testing Athena tools</h4>
            <CodeBlock lang="bash" code={`# Run your webhook
bun run server.ts

# Expose it via tunnel
ngrok http 3000
# → https://abc123.ngrok.io`} />
            <p className="mt-2">
              Set <InlineCode>handlerUrl</InlineCode> to the tunneled URL, install the plugin, then
              ask Mavino: <em>"Use my_tool to search for 'calculus textbooks'"</em>
            </p>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Caching</h4>
            <p>
              The runtime caches modules <strong>by entryUrl</strong>. To force a reload:
            </p>
            <ul className="ml-4 list-disc text-xs text-ink-muted">
              <li>Use a cache-busting query: <InlineCode>?v=2</InlineCode></li>
              <li>Click "Retry" in the error boundary (if your module throws)</li>
              <li>Close and reopen the window (cache is in-memory)</li>
            </ul>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Debugging</h4>
            <ul className="ml-4 list-disc text-xs text-ink-muted">
              <li><strong>DevTools Console:</strong> errors prefixed with <InlineCode>[plugin:&lt;name&gt;]</InlineCode></li>
              <li><strong>Network tab:</strong> watch for the <InlineCode>import()</InlineCode> request and API calls</li>
              <li><strong>Error boundary:</strong> shows error message + Retry button on load/render failures</li>
            </ul>
          </Section>

          {/* ===== Security ===== */}
          <Section id="security" icon={<ShieldCheck size={18} />} title="Security">
            <h4 className="mb-2 text-sm font-semibold text-ink">Trust boundary</h4>
            <p>
              Plugins are <strong>admin-curated</strong>. The admin who publishes a plugin is
              vouching for its safety. Users install plugins at their own discretion from the
              admin-curated catalog.
            </p>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">What plugin code can access</h4>
            <div className="overflow-x-auto rounded-lg border border-edge">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-edge bg-surface-2">
                    <th className="px-3 py-2 text-left font-semibold text-ink">Resource</th>
                    <th className="px-3 py-2 text-left font-semibold text-ink">Access</th>
                    <th className="px-3 py-2 text-left font-semibold text-ink">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["User's JWT token", "Yes", "Via localStorage. Only publish plugins you trust."],
                    ["Mavino API", "Yes", "Any /api/* endpoint with user's credentials."],
                    ["DOM", "Yes", "Within the plugin's window."],
                    ["Cross-origin fetch", "Yes", "Subject to CORS."],
                    ["User's session (webhook)", "No", "Webhook never receives JWT — only { plugin, arguments }."],
                  ].map(([res, access, notes], i) => (
                    <tr key={i} className={i < 4 ? "border-b border-edge" : ""}>
                      <td className="px-3 py-2 font-medium text-ink">{res}</td>
                      <td className={`px-3 py-2 font-medium ${access === "Yes" ? "text-amber-500" : "text-emerald-500"}`}>{access}</td>
                      <td className="px-3 py-2 text-ink-muted">{notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Best practices for authors</h4>
            <ul className="space-y-1.5 text-xs text-ink-muted">
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Don't exfiltrate the JWT.</strong> Use Mavino's API directly from the client, or Athena tools (which proxy without forwarding credentials).</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Use HTTPS</strong> for <InlineCode>entryUrl</InlineCode> and <InlineCode>handlerUrl</InlineCode>.</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Validate webhook inputs</strong> — the LLM generates the arguments. Validate types and ranges.</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Don't bundle React</strong> — mark it external. Mavino provides it.</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Declare permissions honestly</strong> — the <InlineCode>permissions</InlineCode> array is shown to users.</span></li>
            </ul>

            <h4 className="mt-4 mb-2 text-sm font-semibold text-ink">Best practices for admins</h4>
            <ul className="space-y-1.5 text-xs text-ink-muted">
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Only publish plugins from trusted sources.</strong> Plugin code runs with full session access.</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Review the manifest</strong> — check <InlineCode>entryUrl</InlineCode> and <InlineCode>handlerUrl</InlineCode> point to legitimate hosts.</span></li>
              <li className="flex gap-2"><ChevronRight size={14} className="mt-0.5 shrink-0 text-accent" /><span><strong>Use <InlineCode>published: false</InlineCode></strong> to stage plugins before making them visible.</span></li>
            </ul>
          </Section>

          {/* Footer */}
          <div className="mt-8 border-t border-edge pt-4">
            <p className="text-center text-xs text-ink-muted">
              Plugin Development Guide · Mavino Student OS ·{" "}
              <span className="font-mono">docs/PLUGIN_DEVELOPMENT.md</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- section wrapper -----

function Section({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-10 scroll-mt-4">
      <h2 className="mb-3 flex items-center gap-2 border-b border-edge pb-2 text-lg font-bold text-ink">
        {icon}
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-ink-muted">
        {children}
      </div>
    </section>
  );
}

// ----- code constants -----

const MANIFEST_EXAMPLE = `{
  "id": "my-awesome-plugin",
  "name": "My Awesome Plugin",
  "description": "Does something cool with the Mavino AI.",
  "icon": "Sparkles",
  "version": "1.0.0",
  "author": "your-github-username",
  "category": "productivity",
  "entryUrl": "https://cdn.example.com/my-plugin/1.0.0/index.js",
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
      "handlerUrl": "https://api.example.com/my-plugin/tool",
      "destructive": false
    }
  ]
}`;

const PROPS_TYPES = `interface WindowInstance {
  id: string;             // unique window instance id
  appId: string;          // "plugin:<pluginKey>"
  title: string;
  icon: string;
  rect: { x, y, width, height };
  minimized: boolean;
  workspaceId: string;
  payload?: Record<string, unknown>;
}

interface PluginContext {
  pluginKey: string;      // your plugin id
  name: string;           // display name
  version: string;        // semantic version
  permissions: string[];  // declared permissions
}

// Your component receives:
{ win: WindowInstance; plugin: PluginContext }`;
