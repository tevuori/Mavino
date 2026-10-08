import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ArrowLeft, ArrowRight, RotateCw, Home, Globe, ExternalLink,
  Loader2, AlertCircle, Search, Lock, Trash2, Plus, X,
} from "lucide-react";
import { useWindows } from "../../store/windows";
import { useBrowser, type BrowserCommand } from "../../store/browser";
import { useShowControl } from "../../store/showControl";
import { browserApi } from "../../services/browser";
import type { WindowInstance } from "../../store/windows";

const HOME_URL = "athena://home";
const FAIL_TIMEOUT_MS = 8000;

/** Quick links for the start page. */
const QUICK_LINKS: { name: string; url: string; color: string; icon: string }[] = [
  { name: "Wikipedia", url: "https://en.wikipedia.org", color: "#6366f1", icon: "W" },
  { name: "DuckDuckGo", url: "https://duckduckgo.com", color: "#de5833", icon: "D" },
  { name: "GitHub", url: "https://github.com", color: "#24292e", icon: "G" },
  { name: "YouTube", url: "https://youtube.com", color: "#ff0000", icon: "Y" },
  { name: "Reddit", url: "https://reddit.com", color: "#ff4500", icon: "R" },
  { name: "Stack Overflow", url: "https://stackoverflow.com", color: "#f48024", icon: "S" },
  { name: "MDN", url: "https://developer.mozilla.org", color: "#000000", icon: "M" },
  { name: "arXiv", url: "https://arxiv.org", color: "#b31b1b", icon: "a" },
];

/** Normalize user input into a URL (prefix https:// for bare domains, else search). */
function normalizeInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return HOME_URL;
  if (trimmed === HOME_URL) return HOME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(trimmed) && !/\s/.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

/** Pretty-print a URL for the address bar. */
function prettyUrl(url: string): string {
  if (url === HOME_URL) return "";
  return url;
}

/** Generate a unique tab id. */
let tabIdCounter = 0;
function newTabId(): string {
  return `tab-${Date.now()}-${++tabIdCounter}`;
}

interface Tab {
  id: string;
  /** Display URL (address bar). Updated by __athenaBrowser reports (pushState,
   *  redirects) without reloading the iframe. */
  url: string;
  /** The URL the iframe was last loaded with (proxy src). Only updated on
   *  explicit navigation (navigate, back, forward, reload) — NOT by in-page
   *  pushState/replaceState reports. This prevents reload loops where a SPA
   *  calls pushState on load → URL report → proxySrc change → iframe reload →
   *  SPA calls pushState again → infinite loop. */
  loadedUrl: string;
  title: string;
  history: string[];
  historyIdx: number;
  loading: boolean;
  error: string | null;
  renderFailed: boolean;
  iframeKey: number;
  /** Checked embeddable status: true = can iframe, false = open external, null = not checked. */
  embeddable: boolean | null;
}

function createTab(url: string): Tab {
  return {
    id: newTabId(),
    url,
    loadedUrl: url,
    title: url === HOME_URL ? "Home" : "",
    history: [url],
    historyIdx: 0,
    loading: false,
    error: null,
    renderFailed: false,
    iframeKey: 0,
    embeddable: null,
  };
}

export default function BrowserApp({ win }: { win: WindowInstance }) {
  const setTitle = useWindows((s) => s.setTitle);
  const closeWin = useWindows((s) => s.close);
  const setUrl = useBrowser((s) => s.setUrl);
  const setTabs = useBrowser((s) => s.setTabs);
  const removeWindow = useBrowser((s) => s.removeWindow);
  const navRequests = useBrowser((s) => s.navRequests);
  const commands = useBrowser((s) => s.commands);

  // Multi-tab state.
  const [tabs, setTabsState] = useState<Tab[]>(() => {
    const initialUrl = (win.payload?.url as string) ?? HOME_URL;
    return [createTab(initialUrl)];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  const [addressValue, setAddressValue] = useState("");
  const lastProcessedSeq = useRef(0);
  const lastProcessedCmd = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // Track whether the iframe has finished loading the current page.
  // Commands (highlight/scroll/click/fill) sent before the page reports
  // loaded are queued and replayed once the TEACHER_SHOW_SCRIPT is ready.
  const iframeLoadedRef = useRef(false);
  const pendingCmdsRef = useRef<BrowserCommand[]>([]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  // Keep address bar in sync with active tab URL.
  useEffect(() => {
    setAddressValue(prettyUrl(activeTab?.url ?? HOME_URL));
  }, [activeTab?.url]);

  // Update window title + shared browser state when active tab URL changes.
  useEffect(() => {
    const url = activeTab?.url ?? HOME_URL;
    const isHome = url === HOME_URL;
    if (isHome) {
      setTitle(win.id, "Browser");
      setUrl(win.id, "");
    } else {
      const title = activeTab?.title || "Browser";
      setTitle(win.id, title.length > 60 ? title.slice(0, 57) + "…" : title);
      setUrl(win.id, url);
    }
  }, [activeTab?.url, activeTab?.title, win.id, setTitle, setUrl]);

  // Report tab list to the shared store (for Athena's list_tabs tool).
  useEffect(() => {
    setTabs(
      win.id,
      tabs.map((t) => ({ id: t.id, url: t.url, title: t.title || t.url }))
    );
  }, [tabs, win.id, setTabs]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => removeWindow(win.id);
  }, [win.id, removeWindow]);

  // ===== Tab management =====

  const updateTab = useCallback((tabId: string, patch: Partial<Tab>) => {
    setTabsState((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
  }, []);

  const newTab = useCallback((url: string = HOME_URL) => {
    const tab = createTab(url);
    setTabsState((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabsState((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx < 0) return prev;
      const remaining = prev.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        // Last tab closed — close the window.
        closeWin(win.id);
        return prev;
      }
      // If we closed the active tab, switch to the adjacent one.
      if (tabId === activeTabIdRef.current) {
        const newActive = remaining[Math.min(idx, remaining.length - 1)];
        setActiveTabId(newActive.id);
      }
      return remaining;
    });
  }, [closeWin, win.id]);

  // ===== Navigation =====

  const navigate = useCallback(
    (rawUrl: string, tabId?: string, opts?: { replace?: boolean }) => {
      const url = normalizeInput(rawUrl);
      const targetId = tabId ?? activeTabIdRef.current;
      setTabsState((prev) =>
        prev.map((t) => {
          if (t.id !== targetId) return t;
          if (opts?.replace && t.history.length > 0) {
            const next = [...t.history];
            next[t.historyIdx] = url;
            return { ...t, url, loadedUrl: url, history: next, error: null, renderFailed: false, embeddable: null };
          }
          const base = t.history.slice(0, t.historyIdx + 1);
          if (base[base.length - 1] === url) return t;
          return {
            ...t,
            url,
            loadedUrl: url,
            history: [...base, url],
            historyIdx: base.length,
            error: null,
            renderFailed: false,
            embeddable: null,
          };
        })
      );
    },
    []
  );

  const goBack = useCallback((tabId?: string) => {
    const targetId = tabId ?? activeTabIdRef.current;
    setTabsState((prev) =>
      prev.map((t) => {
        if (t.id !== targetId || t.historyIdx <= 0) return t;
        const url = t.history[t.historyIdx - 1];
        return { ...t, historyIdx: t.historyIdx - 1, url, loadedUrl: url, error: null, renderFailed: false, embeddable: null };
      })
    );
  }, []);

  const goForward = useCallback((tabId?: string) => {
    const targetId = tabId ?? activeTabIdRef.current;
    setTabsState((prev) =>
      prev.map((t) => {
        if (t.id !== targetId || t.historyIdx >= t.history.length - 1) return t;
        const url = t.history[t.historyIdx + 1];
        return { ...t, historyIdx: t.historyIdx + 1, url, loadedUrl: url, error: null, renderFailed: false, embeddable: null };
      })
    );
  }, []);

  const reload = useCallback((tabId?: string) => {
    const targetId = tabId ?? activeTabIdRef.current;
    setTabsState((prev) =>
      prev.map((t) => (t.id === targetId ? { ...t, iframeKey: t.iframeKey + 1, loadedUrl: t.url, error: null, renderFailed: false, embeddable: null } : t))
    );
  }, []);

  const goHome = useCallback(() => {
    navigate(HOME_URL);
  }, [navigate]);

  // ===== Embeddability check + external fallback =====

  // Reset iframe loaded state when the active tab navigates (new URL or
  // reload via iframeKey bump). The TEACHER_SHOW_SCRIPT will set it back to
  // true when it reports via postMessage.
  useEffect(() => {
    iframeLoadedRef.current = false;
    pendingCmdsRef.current = [];
  }, [activeTab?.loadedUrl, activeTab?.iframeKey]);

  // When a tab navigates to a new URL, check if it's embeddable. If not,
  // auto-open in external browser and show a notice in the tab.
  useEffect(() => {
    if (!activeTab || activeTab.loadedUrl === HOME_URL || activeTab.embeddable !== null) return;
    let cancelled = false;
    browserApi.embeddable(activeTab.loadedUrl).then((res) => {
      if (cancelled) return;
      const embeddable = res?.embeddable ?? true;
      if (!embeddable) {
        // Auto-open in external browser.
        window.open(activeTab.loadedUrl, "_blank", "noopener,noreferrer");
        updateTab(activeTab.id, { embeddable: false, loading: false, renderFailed: false });
      } else {
        updateTab(activeTab.id, { embeddable: true });
      }
    }).catch(() => {
      if (!cancelled) updateTab(activeTab.id, { embeddable: true });
    });
    return () => { cancelled = true; };
  }, [activeTab?.url, activeTab?.embeddable, activeTab?.id, updateTab]);

  // ===== postMessage from iframe =====

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.__athenaBrowserNav) {
        const navUrl = String(data.url ?? "");
        if (navUrl) navigate(navUrl);
        return;
      }
      if (!data.__athenaBrowser) return;
      const realUrl = String(data.url ?? "");
      const pageTitle = String(data.title ?? "");
      if (!realUrl) return;
      // The iframe page has loaded and reported its real URL — the
      // TEACHER_SHOW_SCRIPT's message listener is now ready to receive
      // highlight/scroll commands.
      iframeLoadedRef.current = true;
      // Update the display URL (address bar) + title, but do NOT update
      // loadedUrl — that would change proxySrc and reload the iframe,
      // causing a loop (SPA calls pushState → reports URL → proxySrc
      // changes → iframe reloads → SPA calls pushState again → ...).
      const tid = activeTabIdRef.current;
      setTabsState((prev) =>
        prev.map((t) => {
          if (t.id !== tid) return t;
          const next = [...t.history];
          next[t.historyIdx] = realUrl;
          return { ...t, url: realUrl, title: pageTitle || t.title, history: next, loading: false, renderFailed: false };
        })
      );
      setAddressValue(prettyUrl(realUrl));
      if (failTimerRef.current) {
        clearTimeout(failTimerRef.current);
        failTimerRef.current = null;
      }
      // Replay any commands that were queued while the page was loading.
      if (pendingCmdsRef.current.length > 0) {
        const queued = pendingCmdsRef.current;
        pendingCmdsRef.current = [];
        // Small delay to let the page's DOM settle after the report.
        setTimeout(() => {
          for (const c of queued) executeCommandRef.current(c);
        }, 100);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [navigate]);

  // ===== Process navigation requests from Athena =====

  const currentReq = navRequests[win.id];
  useEffect(() => {
    if (!currentReq || currentReq.seq === lastProcessedSeq.current) return;
    lastProcessedSeq.current = currentReq.seq;
    switch (currentReq.kind) {
      case "navigate":
        if (currentReq.url) navigate(currentReq.url, currentReq.tabId);
        break;
      case "back":
        goBack(currentReq.tabId);
        break;
      case "forward":
        goForward(currentReq.tabId);
        break;
      case "reload":
        reload(currentReq.tabId);
        break;
    }
  }, [currentReq, navigate, goBack, goForward, reload]);

  // ===== Process DOM automation commands from Athena =====

  const currentCmd = commands[win.id];
  // Ref to executeCommand so the postMessage handler can replay queued cmds.
  const executeCommandRef = useRef<(cmd: BrowserCommand) => void>(() => {});
  useEffect(() => {
    if (!currentCmd || currentCmd.seq === lastProcessedCmd.current) return;
    lastProcessedCmd.current = currentCmd.seq;
    executeCommand(currentCmd);
  }, [currentCmd]);

  /** Execute a DOM automation command on the active tab's iframe document. */
  const executeCommand = useCallback((cmd: BrowserCommand) => {
    // Handle tab management commands first (these don't need the iframe loaded).
    if (cmd.kind === "new_tab") {
      newTab(cmd.url || HOME_URL);
      return;
    }
    if (cmd.kind === "close_tab") {
      const targetId = cmd.tabId ?? activeTabIdRef.current;
      closeTab(targetId);
      return;
    }

    // DOM commands that use postMessage (highlight, clear_highlight, scroll)
    // require the TEACHER_SHOW_SCRIPT to be loaded. If the iframe hasn't
    // reported loaded yet, queue the command for replay when it does.
    const needsPostMessage = cmd.kind === "highlight" || cmd.kind === "clear_highlight" || cmd.kind === "scroll";
    if (needsPostMessage && !iframeLoadedRef.current) {
      pendingCmdsRef.current.push(cmd);
      return;
    }

    // DOM commands target the iframe document.
    const iframe = iframeRef.current;
    if (!iframe) return;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch { /* cross-origin — shouldn't happen since proxy is same-origin */ }
    if (!doc) return;

    try {
      switch (cmd.kind) {
        case "click": {
          if (cmd.selector) {
            const el = doc.querySelector(cmd.selector) as HTMLElement | null;
            if (el) { el.click(); break; }
          }
          if (cmd.text) {
            // Find element by visible text.
            const elements = Array.from(doc.querySelectorAll("button, a, input[type=submit], input[type=button], [role=button], [onclick]"));
            const match = elements.find((el) => (el.textContent || "").trim().toLowerCase().includes(cmd.text!.toLowerCase()));
            if (match) { (match as HTMLElement).click(); break; }
            // Broader search: any element with the text.
            const all = Array.from(doc.querySelectorAll("*")) as HTMLElement[];
            const match2 = all.find((el) => (el.textContent || "").trim().toLowerCase() === cmd.text!.toLowerCase());
            if (match2) { match2.click(); break; }
          }
          break;
        }
        case "fill": {
          if (cmd.selector) {
            const el = doc.querySelector(cmd.selector) as HTMLInputElement | HTMLTextAreaElement | null;
            if (el) {
              // Set value using the native setter to trigger React/Vue change events.
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
              const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
              if (el.tagName === "TEXTAREA" && nativeTextareaValueSetter) {
                nativeTextareaValueSetter.call(el, cmd.value || "");
              } else if (nativeInputValueSetter) {
                nativeInputValueSetter.call(el, cmd.value || "");
              } else {
                el.value = cmd.value || "";
              }
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              break;
            }
          }
          if (cmd.text) {
            // Find input by associated label text or placeholder.
            const labels = Array.from(doc.querySelectorAll("label"));
            const labelMatch = labels.find((l) => (l.textContent || "").trim().toLowerCase().includes(cmd.text!.toLowerCase()));
            if (labelMatch && labelMatch.htmlFor) {
              const input = doc.getElementById(labelMatch.htmlFor) as HTMLInputElement | null;
              if (input) {
                input.value = cmd.value || "";
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                break;
              }
            }
            // Try placeholder match.
            const inputs = Array.from(doc.querySelectorAll("input, textarea")) as (HTMLInputElement | HTMLTextAreaElement)[];
            const placeholderMatch = inputs.find((el) => (el.placeholder || "").toLowerCase().includes(cmd.text!.toLowerCase()));
            if (placeholderMatch) {
              placeholderMatch.value = cmd.value || "";
              placeholderMatch.dispatchEvent(new Event("input", { bubbles: true }));
              placeholderMatch.dispatchEvent(new Event("change", { bubbles: true }));
              break;
            }
            // Try name attribute match.
            const nameMatch = inputs.find((el) => (el.name || "").toLowerCase().includes(cmd.text!.toLowerCase()));
            if (nameMatch) {
              nameMatch.value = cmd.value || "";
              nameMatch.dispatchEvent(new Event("input", { bubbles: true }));
              nameMatch.dispatchEvent(new Event("change", { bubbles: true }));
              break;
            }
          }
          break;
        }
        case "submit": {
          if (cmd.selector) {
            const form = doc.querySelector(cmd.selector) as HTMLFormElement | null;
            if (form) { form.submit(); break; }
          }
          // Submit the first form on the page.
          const firstForm = doc.querySelector("form") as HTMLFormElement | null;
          if (firstForm) firstForm.submit();
          break;
        }
        case "highlight": {
          // Use postMessage to the injected TEACHER_SHOW_SCRIPT.
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage(
              { __athenaTeacherShow: true, kind: "highlight", text: cmd.text, selector: cmd.selector },
              "*"
            );
          }
          break;
        }
        case "clear_highlight": {
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage(
              { __athenaTeacherShow: true, kind: "clear_highlight" },
              "*"
            );
          }
          break;
        }
        case "scroll": {
          if (cmd.selector) {
            const el = doc.querySelector(cmd.selector);
            if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); break; }
          }
          if (cmd.text) {
            if (iframe.contentWindow) {
              iframe.contentWindow.postMessage(
                { __athenaTeacherShow: true, kind: "scroll_to", text: cmd.text },
                "*"
              );
            }
            break;
          }
          // Direction-based scroll.
          const dir = cmd.direction || "down";
          if (iframe.contentWindow) {
            if (dir === "top") iframe.contentWindow.scrollTo({ top: 0, behavior: "smooth" });
            else if (dir === "bottom") iframe.contentWindow.scrollTo({ top: 999999, behavior: "smooth" });
            else if (dir === "up") iframe.contentWindow.scrollBy({ top: -window.innerHeight * 0.8, behavior: "smooth" });
            else iframe.contentWindow.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
          }
          break;
        }
      }
    } catch { /* never let a DOM command error crash the app */ }
  }, [newTab, closeTab]);

  // Keep executeCommandRef in sync so the postMessage handler can replay
  // queued commands using the latest executeCommand closure.
  useEffect(() => {
    executeCommandRef.current = executeCommand;
  }, [executeCommand]);

  // ===== Show-control (Teacher highlight/scroll) =====

  const showCommands = useShowControl((s) => s.commands);
  const removeShowWindow = useShowControl((s) => s.removeWindow);
  const reportShowResult = useShowControl((s) => s.reportResult);
  const lastShowSeq = useRef(0);
  const showCmd = showCommands[win.id];
  useEffect(() => {
    if (!showCmd || showCmd.seq === lastShowSeq.current) return;
    lastShowSeq.current = showCmd.seq;
    // Queue if the iframe hasn't loaded yet — the TEACHER_SHOW_SCRIPT
    // listener won't be ready. The pending commands are replayed when
    // the iframe reports loaded via __athenaBrowser postMessage.
    if (!iframeLoadedRef.current) {
      pendingCmdsRef.current.push({
        kind: showCmd.kind === "scroll_to" ? "scroll" : showCmd.kind === "highlight" ? "highlight" : "clear_highlight",
        text: showCmd.text,
        selector: showCmd.selector,
      } as BrowserCommand);
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) {
      reportShowResult(win.id, showCmd.seq, showCmd.kind, false, "not-loaded");
      return;
    }
    if (showCmd.kind === "scroll_to" || showCmd.kind === "highlight" || showCmd.kind === "clear_highlight") {
      // The injected teacher script replies with __athenaTeacherShowResult,
      // echoing this seq, so the Teacher learns whether the text was found.
      iframe.contentWindow.postMessage(
        {
          __athenaTeacherShow: true,
          id: showCmd.seq,
          kind: showCmd.kind,
          text: showCmd.text,
          selector: showCmd.selector,
          line: showCmd.line,
        },
        "*"
      );
    }
  }, [showCmd, win.id, reportShowResult]);

  // Relay the injected script's show results into the show-control store.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object" || !data.__athenaTeacherShowResult) return;
      reportShowResult(
        win.id,
        Number(data.id) || 0,
        (data.kind as "highlight" | "scroll_to" | "clear_highlight") ?? "highlight",
        Boolean(data.ok),
        data.ok ? undefined : "no-match"
      );
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [win.id, reportShowResult]);
  useEffect(() => {
    return () => { if (win.id) removeShowWindow(win.id); };
  }, [win.id, removeShowWindow]);

  // A page that refuses to embed (X-Frame-Options / CSP) or never rendered can
  // never be highlighted — tell the Teacher so it quotes the cached text.
  const blockedFromEmbedding = activeTab?.embeddable === false || activeTab?.renderFailed === true;
  useEffect(() => {
    if (blockedFromEmbedding) {
      reportShowResult(win.id, 0, "highlight", false, "blocked-by-cors");
    }
  }, [blockedFromEmbedding, win.id, reportShowResult]);

  // ===== Loading + fail timeout =====

  useEffect(() => {
    if (failTimerRef.current) {
      clearTimeout(failTimerRef.current);
      failTimerRef.current = null;
    }
    if (!activeTab || activeTab.loadedUrl === HOME_URL || activeTab.embeddable === false) {
      return;
    }
    if (!activeTab.embeddable) return; // Still checking embeddability — don't start timer yet.
    // Start loading timer.
    updateTab(activeTab.id, { loading: true, renderFailed: false });
    failTimerRef.current = setTimeout(() => {
      const tid = activeTabIdRef.current;
      setTabsState((prev) => prev.map((t) => (t.id === tid ? { ...t, renderFailed: true, loading: false } : t)));
      failTimerRef.current = null;
    }, FAIL_TIMEOUT_MS);
    return () => {
      if (failTimerRef.current) {
        clearTimeout(failTimerRef.current);
        failTimerRef.current = null;
      }
    };
  }, [activeTab?.loadedUrl, activeTab?.iframeKey, activeTab?.embeddable, activeTab?.id, updateTab]);

  // ===== UI handlers =====

  const openExternal = useCallback(() => {
    if (activeTab && activeTab.url !== HOME_URL) {
      window.open(activeTab.url, "_blank", "noopener,noreferrer");
    }
  }, [activeTab]);

  const clearSession = useCallback(async () => {
    try {
      await browserApi.clearCookies();
      reload();
    } catch { /* ignore */ }
  }, [reload]);

  const onAddressEnter = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        navigate(addressValue);
        (e.target as HTMLInputElement).blur();
      } else if (e.key === "Escape") {
        setAddressValue(prettyUrl(activeTab?.url ?? HOME_URL));
        (e.target as HTMLInputElement).blur();
      }
    },
    [addressValue, activeTab?.url, navigate]
  );

  const proxySrc = useMemo(
    () => {
      if (!activeTab || activeTab.loadedUrl === HOME_URL || activeTab.embeddable === false) return "";
      if (activeTab.embeddable === null) return ""; // Wait for embeddability check.
      return browserApi.proxyUrl(activeTab.loadedUrl);
    },
    [activeTab?.loadedUrl, activeTab?.embeddable, activeTab?.iframeKey]
  );

  const isHome = activeTab?.url === HOME_URL;
  const showExternalNotice = activeTab?.embeddable === false;

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-edge bg-surface-2 px-1 pt-1" style={{ scrollbarWidth: "thin" }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`group flex h-7 min-w-[120px] max-w-[200px] cursor-pointer items-center gap-1.5 rounded-t-lg border-t border-l border-r px-2 text-xs transition-colors ${
              tab.id === activeTabId
                ? "border-edge bg-surface text-ink"
                : "border-transparent bg-surface-3/50 text-ink-muted hover:bg-surface-3"
            }`}
          >
            {tab.loading && <Loader2 size={10} className="animate-spin shrink-0" />}
            <span className="flex-1 truncate">
              {tab.url === HOME_URL ? "Home" : tab.title || tab.url.replace(/^https?:\/\//, "").split("/")[0]}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="shrink-0 rounded p-0.5 text-ink-muted opacity-0 transition-opacity hover:bg-surface-3 hover:text-ink group-hover:opacity-100"
              title="Close tab"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={() => newTab()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
          title="New tab"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-edge bg-surface-2 px-2 py-1.5">
        <NavBtn onClick={() => goBack()} disabled={!activeTab || activeTab.historyIdx === 0} title="Back">
          <ArrowLeft size={16} />
        </NavBtn>
        <NavBtn
          onClick={() => goForward()}
          disabled={!activeTab || activeTab.historyIdx >= activeTab.history.length - 1}
          title="Forward"
        >
          <ArrowRight size={16} />
        </NavBtn>
        <NavBtn onClick={() => reload()} disabled={isHome} title="Reload" className="@3xl:flex hidden">
          {activeTab?.loading ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
        </NavBtn>
        <NavBtn onClick={goHome} title="Home" className="@3xl:flex hidden">
          <Home size={16} />
        </NavBtn>

        {/* Address bar */}
        <div className="relative mx-1 flex flex-1 items-center">
          <div className="pointer-events-none absolute left-2.5 text-ink-muted">
            {isHome ? <Search size={13} /> : <Lock size={12} />}
          </div>
          <input
            type="text"
            value={addressValue}
            onChange={(e) => setAddressValue(e.target.value)}
            onKeyDown={onAddressEnter}
            onFocus={(e) => e.target.select()}
            placeholder="Search DuckDuckGo or type a URL"
            className="w-full rounded-full border border-edge bg-surface py-1 pl-8 pr-3 text-xs text-ink outline-none focus:border-focus focus:ring-1 focus:ring-accent/40"
            spellCheck={false}
          />
        </div>

        <NavBtn onClick={openExternal} disabled={isHome} title="Open in new tab" className="@3xl:flex hidden">
          <ExternalLink size={15} />
        </NavBtn>
        <NavBtn onClick={clearSession} title="Clear session (log out)" className="@3xl:flex hidden">
          <Trash2 size={15} />
        </NavBtn>
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden bg-white">
        {isHome ? (
          <StartPage onNavigate={(url) => navigate(url)} />
        ) : showExternalNotice ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center text-ink-muted">
            <ExternalLink size={36} className="text-accent" />
            <div>
              <p className="text-sm font-medium text-ink">Opened in your browser</p>
              <p className="mt-1 max-w-md text-xs break-all">
                <span className="text-ink">{activeTab?.url}</span> can't be embedded in the in-app
                browser (frame-blocking). It has been opened in your system browser instead.
              </p>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={openExternal}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-accent-fg"
              >
                <ExternalLink size={13} /> Open again
              </button>
              <button
                onClick={() => navigate(HOME_URL)}
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
              >
                <Home size={13} /> Go home
              </button>
            </div>
          </div>
        ) : proxySrc ? (
          <>
            <iframe
              key={activeTab?.iframeKey ?? 0}
              ref={iframeRef}
              src={proxySrc}
              className={`h-full w-full border-0 bg-white ${activeTab?.renderFailed ? "opacity-0" : "opacity-100"}`}
              title="Browser"
              sandbox="allow-same-origin allow-forms allow-scripts allow-popups allow-popups-to-escape-sandbox"
              onLoad={() => {
                setTimeout(() => {
                  const tid = activeTabIdRef.current;
                  setTabsState((prev) => prev.map((t) => (t.id === tid ? { ...t, loading: false } : t)));
                }, 300);
              }}
              onError={() => {
                updateTab(activeTab?.id ?? "", { error: "Failed to load page", loading: false });
              }}
            />
            {activeTab?.error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface text-ink-muted">
                <AlertCircle size={32} className="text-danger" />
                <p className="text-sm">{activeTab.error}</p>
                <button
                  onClick={() => reload()}
                  className="mt-1 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-accent-fg"
                >
                  <RotateCw size={13} /> Retry
                </button>
              </div>
            )}
            {activeTab?.renderFailed && !activeTab?.error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center text-ink-muted">
                <AlertCircle size={36} className="text-warning" />
                <div>
                  <p className="text-sm font-medium text-ink">This site may not render in the embedded browser</p>
                  <p className="mt-1 max-w-md text-xs">
                    Some sites with heavy SPA frameworks or consent walls don't work through the proxy.
                    You can still open it in a real browser tab.
                  </p>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <button
                    onClick={openExternal}
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-accent-fg"
                  >
                    <ExternalLink size={13} /> Open in new tab
                  </button>
                  <button
                    onClick={() => reload()}
                    className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
                  >
                    <RotateCw size={13} /> Retry
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          // Waiting for embeddability check.
          <div className="absolute inset-0 flex items-center justify-center bg-surface text-ink-muted">
            <Loader2 size={24} className="animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

function NavBtn({
  onClick,
  disabled,
  title,
  children,
  className = "",
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${className}`}
    >
      {children}
    </button>
  );
}

function StartPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [query, setQuery] = useState("");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-surface px-6 py-10">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Globe size={28} />
        </div>
        <h1 className="text-lg font-semibold text-ink">Browser</h1>
        <p className="text-xs text-ink-muted">Search the web or open a site</p>
      </div>

      <form
        className="w-full max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) onNavigate(query);
        }}
      >
        <div className="relative flex items-center">
          <Search size={16} className="pointer-events-none absolute left-3.5 text-ink-muted" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search DuckDuckGo or type a URL"
            className="w-full rounded-full border border-edge bg-surface-2 py-2.5 pl-11 pr-4 text-sm text-ink outline-none focus:border-focus focus:ring-2 focus:ring-accent/30"
            spellCheck={false}
          />
        </div>
      </form>

      <div className="grid w-full max-w-xl grid-cols-3 @3xl:grid-cols-4 gap-3">
        {QUICK_LINKS.map((link) => (
          <button
            key={link.url}
            onClick={() => onNavigate(link.url)}
            className="flex flex-col items-center gap-2 rounded-xl border border-edge bg-surface-2 p-3 transition-colors hover:border-accent hover:bg-surface-3"
          >
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: link.color }}
            >
              {link.icon}
            </div>
            <span className="line-clamp-1 text-[11px] text-ink-muted">{link.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
