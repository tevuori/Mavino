import { type ToolDef, paidOnly } from "./plugin";
import { fetchPageText } from "../../browser";

// Browser tools. The navigation + DOM automation tools are clientAction: the
// server returns a payload and the Athena client dispatches it to the Browser
// app (opening a window/tab, navigating, clicking, filling, highlighting, etc.).
// get_browser_content is server-side: it fetches the page the browser is
// currently showing (via the per-user cookie jar) and extracts its text so
// Athena can read what the user is looking at.

/** Build a URL from a query: if it's not a URL, treat it as a DuckDuckGo search. */
function resolveTargetUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "https://duckduckgo.com/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(trimmed) && !/\s/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

// Browser is a Paid-tier app — all browser tools are paid-only.
export const browserTools: ToolDef[] = paidOnly([
  {
    name: "open_browser",
    description:
      "Open the Browser app on the user's desktop and navigate to a URL or search query. Opens a new tab in an existing Browser window, or opens a new window if none is open. Use this when the user asks to open, visit, show, or look at a website, or for web questions where seeing the page would help. If the input is not a URL (e.g. 'wikipedia python'), it becomes a DuckDuckGo search. After opening, consider using highlight_text to highlight the relevant section. Some sites (YouTube, Google login, social media) can't be embedded and will auto-open in the user's external browser instead.",
    clientAction: true,
    parameters: [
      {
        name: "url",
        type: "string",
        description: "URL or search query to open (e.g. 'https://en.wikipedia.org/wiki/Python' or 'python tutorial').",
        required: true,
      },
    ],
    handler: async (args, ctx) => {
      const target = resolveTargetUrl(String(args.url ?? ""));
      // Update the server-side window context so subsequent server-side tools
      // (get_browser_content, list_tabs) in the same turn can see the browser
      // window. The client will assign the real window id; we use a synthetic
      // id here so get_browser_content can find the URL.
      const existing = ctx.windows.find((w) => w.appId === "browser");
      if (existing) {
        existing.browserUrl = target;
        existing.focused = true;
      } else {
        ctx.windows.push({
          id: `browser-${Date.now()}`,
          appId: "browser",
          title: "Browser",
          rect: { x: 0, y: 0, width: 960, height: 700 },
          minimized: false,
          focused: true,
          browserUrl: target,
        });
      }
      return { action: "open_browser", url: target };
    },
  },
  {
    name: "navigate_browser",
    description:
      "Navigate an already-open Browser tab to a new URL or search query. Use the window id from 'Open windows' / list_open_windows. If omitted, the most recently focused browser window is used. Optionally target a specific tab by id (from list_tabs).",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (from list_open_windows). Optional — defaults to the focused browser window." },
      { name: "tabId", type: "string", description: "Tab id within the window (from list_tabs). Optional — defaults to the active tab." },
      {
        name: "url",
        type: "string",
        description: "URL or search query to navigate to.",
        required: true,
      },
    ],
    handler: async (args, ctx) => {
      const target = resolveTargetUrl(String(args.url ?? ""));
      // Update the server-side window context so get_browser_content in the
      // same turn reads the new URL.
      const wins = ctx.windows.filter((w) => w.appId === "browser");
      let target2: any;
      if (args.windowId) target2 = wins.find((w) => w.id === String(args.windowId));
      if (!target2) target2 = wins.find((w) => w.focused) ?? wins[wins.length - 1];
      if (target2) target2.browserUrl = target;
      return {
        action: "navigate_browser",
        url: target,
        ...(args.windowId ? { windowId: String(args.windowId) } : {}),
        ...(args.tabId ? { tabId: String(args.tabId) } : {}),
      };
    },
  },
  {
    name: "browser_back",
    description: "Go back in the browser history of a Browser tab.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
      { name: "tabId", type: "string", description: "Tab id (optional — defaults to the active tab)." },
    ],
    handler: async (args) => ({
      action: "browser_back",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      ...(args.tabId ? { tabId: String(args.tabId) } : {}),
    }),
  },
  {
    name: "browser_forward",
    description: "Go forward in the browser history of a Browser tab.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
      { name: "tabId", type: "string", description: "Tab id (optional — defaults to the active tab)." },
    ],
    handler: async (args) => ({
      action: "browser_forward",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      ...(args.tabId ? { tabId: String(args.tabId) } : {}),
    }),
  },
  {
    name: "browser_reload",
    description: "Reload the current page in a Browser tab.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
      { name: "tabId", type: "string", description: "Tab id (optional — defaults to the active tab)." },
    ],
    handler: async (args) => ({
      action: "browser_reload",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      ...(args.tabId ? { tabId: String(args.tabId) } : {}),
    }),
  },
  {
    name: "new_tab",
    description:
      "Open a new tab in a Browser window and navigate to a URL. If no Browser window is open, one is opened first. Use this to open multiple pages side by side.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id to add the tab to (optional — defaults to the focused browser window)." },
      {
        name: "url",
        type: "string",
        description: "URL or search query to open in the new tab.",
        required: true,
      },
    ],
    handler: async (args, ctx) => {
      const target = resolveTargetUrl(String(args.url ?? ""));
      // Update the server-side window context — a new tab changes the active
      // URL of the browser window.
      const wins = ctx.windows.filter((w) => w.appId === "browser");
      let target2: any;
      if (args.windowId) target2 = wins.find((w) => w.id === String(args.windowId));
      if (!target2) target2 = wins.find((w) => w.focused) ?? wins[wins.length - 1];
      if (target2) target2.browserUrl = target;
      return {
        action: "new_tab",
        url: target,
        ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      };
    },
  },
  {
    name: "close_tab",
    description:
      "Close a specific tab in a Browser window. If it's the last tab, the window is closed. If no tabId is given, the active tab is closed.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
      { name: "tabId", type: "string", description: "Tab id to close (optional — defaults to the active tab)." },
    ],
    handler: async (args) => ({
      action: "close_tab",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      ...(args.tabId ? { tabId: String(args.tabId) } : {}),
    }),
  },
  {
    name: "list_tabs",
    description:
      "List all open browser tabs across all Browser windows. Returns each tab's id, url, title, and the window id it belongs to. Use tab ids with navigate_browser, close_tab, click_element, fill_field, etc.",
    parameters: [],
    handler: async (_args, ctx) => {
      // The tab list is maintained client-side in the browser store and
      // reported via the window context. We read it from the browser windows
      // in the context — each browser window's payload includes its tab list.
      // Since the server doesn't have direct access to the client store, we
      // return what we know from the window context (browserUrl per window).
      const wins = (ctx.windows ?? []).filter((w) => w.appId === "browser");
      return {
        count: wins.length,
        windows: wins.map((w) => ({
          windowId: w.id,
          url: (w as any).browserUrl ?? "",
          title: w.title,
          focused: w.focused,
          minimized: w.minimized,
        })),
      };
    },
  },
  {
    name: "click_element",
    description:
      "Click an element on the current browser page. Find the element by CSS selector (e.g. 'button.search-btn', '#submit') or by visible text (e.g. 'Search', 'Sign in'). This is a client-side action — the click executes in the browser iframe. After clicking, use get_browser_content to read the resulting page (the URL may change after a click).",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
      { name: "selector", type: "string", description: "CSS selector for the element to click (e.g. 'button.submit', '#login-btn', 'a[href=\"/about\"]')" },
      { name: "text", type: "string", description: "Visible text of the element to click (alternative to selector — finds buttons/links with matching text)" },
    ],
    handler: async (args) => ({
      action: "click_element",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      ...(args.selector ? { selector: String(args.selector) } : {}),
      ...(args.text ? { text: String(args.text) } : {}),
    }),
  },
  {
    name: "fill_field",
    description:
      "Fill a value into an input field on the current browser page. Find the field by CSS selector (e.g. 'input[name=q]', '#username'), by label text (e.g. 'Email', 'Password'), by placeholder text, or by name attribute. Triggers input + change events so React/Vue forms detect the value. Use this to fill search boxes, login forms, etc. After filling, use click_element to submit the form.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
      { name: "selector", type: "string", description: "CSS selector for the input field (e.g. 'input[name=\"q\"]', '#email')" },
      { name: "text", type: "string", description: "Label text, placeholder, or name attribute to find the field (alternative to selector)" },
      { name: "value", type: "string", description: "Value to fill into the field", required: true },
    ],
    handler: async (args) => ({
      action: "fill_field",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      ...(args.selector ? { selector: String(args.selector) } : {}),
      ...(args.text ? { text: String(args.text) } : {}),
      value: String(args.value ?? ""),
    }),
  },
  {
    name: "submit_form",
    description:
      "Submit a form on the current browser page. Find the form by CSS selector, or submit the first form on the page if no selector is given. This triggers form submission — the page will navigate to the form's action URL. Use after fill_field to complete a login or search.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
      { name: "selector", type: "string", description: "CSS selector for the form (e.g. '#login-form', 'form.search'). Optional — defaults to the first form on the page." },
    ],
    handler: async (args) => ({
      action: "submit_form",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      ...(args.selector ? { selector: String(args.selector) } : {}),
    }),
  },
  {
    name: "highlight_text",
    description:
      "Highlight text on the current browser page. Find the text by exact string match or by CSS selector. The highlighted text gets a colored background and scrolls into view. Use this after open_browser to draw the user's attention to the relevant section. Call clear_highlight to remove it.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
      { name: "text", type: "string", description: "Text to highlight on the page (first match is highlighted + scrolled into view)" },
      { name: "selector", type: "string", description: "CSS selector for the element to highlight (alternative to text)" },
    ],
    handler: async (args) => ({
      action: "highlight_text",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      ...(args.text ? { text: String(args.text) } : {}),
      ...(args.selector ? { selector: String(args.selector) } : {}),
    }),
  },
  {
    name: "clear_browser_highlight",
    description: "Clear all highlights on the current browser page.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
    ],
    handler: async (args) => ({
      action: "clear_browser_highlight",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
    }),
  },
  {
    name: "scroll_page",
    description:
      "Scroll the current browser page. Scroll up/down by one viewport, jump to top/bottom, or scroll to specific text or a CSS selector.",
    clientAction: true,
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id (optional — defaults to the focused browser window)." },
      { name: "direction", type: "string", description: "Scroll direction: 'up', 'down', 'top', 'bottom'", enum: ["up", "down", "top", "bottom"] },
      { name: "text", type: "string", description: "Scroll to the first occurrence of this text (alternative to direction)" },
      { name: "selector", type: "string", description: "Scroll to this CSS selector (alternative to direction)" },
    ],
    handler: async (args) => ({
      action: "scroll_page",
      ...(args.windowId ? { windowId: String(args.windowId) } : {}),
      ...(args.direction ? { direction: String(args.direction) } : {}),
      ...(args.text ? { text: String(args.text) } : {}),
      ...(args.selector ? { selector: String(args.selector) } : {}),
    }),
  },
  {
    name: "get_browser_content",
    description:
      "Read the main text content of the page currently shown in a Browser window (or an explicit URL). Uses the user's browser cookie jar, so logged-in pages are read correctly. Returns { url, title, content, truncated }. Use this when the user asks what's on the current page, or to extract information from a page they're viewing, or after click_element/submit_form to read the resulting page. Optional selector extracts text from specific DOM elements only (e.g. 'div.results', 'article', '.search-results'). Prefer open_browser first if no browser window is open.",
    parameters: [
      { name: "windowId", type: "string", description: "Browser window id whose current URL to read (optional — defaults to the focused browser window)." },
      { name: "url", type: "string", description: "Explicit URL to read instead of a window's current URL (optional)." },
      { name: "selector", type: "string", description: "CSS selector to extract text from specific elements only (optional — e.g. 'div.results', 'article', '#main-content')" },
    ],
    handler: async (args, ctx) => {
      let url = String(args.url ?? "").trim();
      if (!url) {
        const wins = ctx.windows ?? [];
        const browserWins = wins.filter((w) => w.appId === "browser" && (w as any).browserUrl);
        let target: any;
        if (args.windowId) {
          target = browserWins.find((w) => w.id === String(args.windowId));
        }
        if (!target) {
          target = browserWins.find((w) => w.focused) ?? browserWins[browserWins.length - 1];
        }
        url = target?.browserUrl ?? "";
      }
      if (!url) {
        return {
          error:
            "No browser window is open and no url was provided. Open the Browser first with open_browser, or pass an explicit url.",
        };
      }
      try {
        const selector = args.selector ? String(args.selector) : undefined;
        const page = await fetchPageText(ctx.userId, url, 20_000, selector);
        return page;
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to read page content" };
      }
    },
  },
]);
