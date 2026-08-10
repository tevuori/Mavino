import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, Sparkles, Loader2, Wrench, AlertCircle, Save, FolderOpen, LayoutGrid, Maximize2, X, ChevronDown, Paperclip, FileText, FileCode, FileType, Trash2, Cloud, Lightbulb, Check, Folder as FolderIcon, Plus, History, MessageSquare, Trash, Terminal, ExternalLink, Globe, Copy, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  streamAthenaChat,
  attachFile,
  saveAttachedFile,
  suggestFolder,
  type AthenaMessage,
  type AthenaToolEvent,
  type AthenaClientAction,
  type AthenaWindowState,
  type AthenaAttachment,
} from "../../services/athena";
import { filesApi } from "../../services/files";
import { conversationsApi, type ConversationSummary, type ConversationMessage } from "../../services/conversations";
import { useWindows, type AppId, type WindowRect } from "../../store/windows";
import type { WindowInstance } from "../../store/windows";
import type { VFolder } from "../../types";
import { useSettings, type AthenaRollEdge } from "../../store/settings";
import { useAthenaQuick } from "../../store/athenaQuick";
import { useBrowser } from "../../store/browser";
import { useMaps } from "../../store/maps";
import { useAuth } from "../../store/auth";
import { useDataRefresh } from "../../store/dataRefresh";

interface ChatTurn extends AthenaMessage {
  tools?: AthenaToolEvent[];
  pending?: boolean;
  error?: string;
}

const SUGGESTIONS = [
  "Create a task: review lecture notes, due Friday",
  "What are my most recent files?",
  "Start a pomodoro focus session",
  "List my courses and grades",
  "Open notes and tasks side by side",
  "Save my current workspace as 'Study Mode'",
];

// AppId → icon name (must match registry icons)
const APP_ICONS: Record<string, string> = {
  notes: "StickyNote",
  tasks: "CheckSquare",
  files: "Folder",
  music: "Music",
  settings: "Settings",
  terminal: "Terminal",
  pomodoro: "Timer",
  flashcards: "Brain",
  grades: "GraduationCap",
  vut: "GraduationCap",
  editor: "Code",
  viewer: "Image",
  athena: "Sparkles",
  study: "GraduationCap",
  browser: "Globe",
  reminders: "BellRing",
  maps: "Map",
};

export default function AthenaApp({
  win,
  mode = "window",
  onExpand,
}: {
  win?: WindowInstance;
  mode?: "window" | "quick";
  onExpand?: () => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [edgeMenuOpen, setEdgeMenuOpen] = useState(false);
  const handleRef = useRef<{ abort: () => void; done: Promise<void> } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File attachment state
  const [attachment, setAttachment] = useState<AthenaAttachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Save-to-storage dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [folders, setFolders] = useState<VFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ folderId: string | null; folderPath: string; reason: string; confidence: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Conversation history state
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);

  // Refs to track the latest values for callbacks that close over stale state.
  const turnsRef = useRef<ChatTurn[]>([]);
  turnsRef.current = turns;
  const activeConvIdRef = useRef<string | null>(null);
  activeConvIdRef.current = activeConvId;
  const conversationsRef = useRef<ConversationSummary[]>([]);
  conversationsRef.current = conversations;
  const titleGeneratingRef = useRef(false);

  const windows = useWindows((s) => s.windows);
  const focusedId = useWindows((s) => s.focusedId);
  const openWindow = useWindows((s) => s.open);
  const closeWindow = useWindows((s) => s.close);
  const focusWindow = useWindows((s) => s.focus);
  const minimizeWindow = useWindows((s) => s.minimize);
  const setRect = useWindows((s) => s.setRect);
  const closeAll = useWindows((s) => s.closeAll);
  const closeAllEverywhere = useWindows((s) => s.closeAllEverywhere);
  const retile = useWindows((s) => s.retile);
  const athenaRollEdge = useSettings((s) => s.athenaRollEdge);
  const setAthenaRollEdge = useSettings((s) => s.setAthenaRollEdge);
  const setAthenaQuickOpen = useAthenaQuick((s) => s.setOpen);
  const browserUrls = useBrowser((s) => s.urls);
  const requestNav = useBrowser((s) => s.requestNav);
  const issueCommand = useBrowser((s) => s.issueCommand);
  const mapsCenters = useMaps((s) => s.centers);
  const issueMapCommand = useMaps((s) => s.issueCommand);

  // Keep a ref to the latest windows + store actions so the client-action
  // dispatcher always sees current state even when multiple actions fire in
  // quick succession during a single SSE stream (e.g. open_app x2 then tile).
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const storeRef = useRef({ openWindow, closeWindow, focusWindow, minimizeWindow, setRect, closeAll, closeAllEverywhere, retile });
  storeRef.current = { openWindow, closeWindow, focusWindow, minimizeWindow, setRect, closeAll, closeAllEverywhere, retile };
  const browserUrlsRef = useRef(browserUrls);
  browserUrlsRef.current = browserUrls;
  const requestNavRef = useRef(requestNav);
  requestNavRef.current = requestNav;
  const issueCmdRef = useRef(issueCommand);
  issueCmdRef.current = issueCommand;
  const issueMapCmdRef = useRef(issueMapCommand);
  issueMapCmdRef.current = issueMapCommand;
  // Ref to the send function so dispatchClientAction can trigger a chat
  // message (used by Quick Capture's open_athena client action).
  const sendRef = useRef<((text: string) => void) | null>(null);

  // Build the window state snapshot to send with each chat request.
  const buildWindowState = useCallback((): AthenaWindowState[] => {
    const wsMap = useWindows.getState().workspaces;
    return windows.map((w) => ({
      id: w.id,
      appId: w.appId,
      title: w.title,
      rect: { x: w.rect.x, y: w.rect.y, width: w.rect.width, height: w.rect.height },
      minimized: w.minimized,
      focused: focusedId === w.id,
      workspace: wsMap.find((ws) => ws.id === w.workspaceId)?.name,
      ...(w.appId === "browser" && browserUrls[w.id] ? { browserUrl: browserUrls[w.id] } : {}),
      ...(w.appId === "maps" && mapsCenters[w.id]
        ? { mapsCenter: mapsCenters[w.id] }
        : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windows, focusedId, browserUrls, mapsCenters]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    return () => handleRef.current?.abort();
  }, []);

  // Persist the latest conversation state when the component unmounts. This
  // prevents losing the most recent turn when the Athena window is closed or
  // the Win+Y quick panel is dismissed.
  useEffect(() => {
    return () => {
      const convId = activeConvIdRef.current;
      const turns = turnsRef.current;
      if (!convId || turns.length === 0) return;
      const messages: ConversationMessage[] = turns
        .filter((t) => !t.error && t.content.trim())
        .map((t) => ({
          role: t.role,
          content: t.content,
          tools: t.tools,
          timestamp: new Date().toISOString(),
        }));
      if (messages.length === 0) return;
      conversationsApi.update(convId, { messages }).catch((e) => {
        console.error("[athena] Failed to save on unmount:", e);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Conversation persistence =====

  // On mount: load conversation list, resume active conversation or create new.
  useEffect(() => {
    (async () => {
      try {
        const { conversations: list } = await conversationsApi.list();
        setConversations(list);
        const active = list.find((c) => c.status === "active");
        if (active) {
          // Resume active conversation.
          const { conversation } = await conversationsApi.get(active.id);
          setActiveConvId(active.id);
          setTurns(
            (conversation.messages as ConversationMessage[]).map((m) => ({
              role: m.role,
              content: m.content,
              tools: m.tools,
            }))
          );
        } else {
          // No active conversation — create one.
          const { conversation: conv } = await conversationsApi.create();
          setActiveConvId(conv.id);
          setConversations((prev) => [conv, ...prev]);
        }
      } catch (e) {
        console.error("[athena] Failed to load conversations:", e);
      }
    })();
  }, []);

  // Save conversation after each completed turn.
  const saveConversation = useCallback(async (currentTurns: ChatTurn[]) => {
    const convId = activeConvIdRef.current;
    if (!convId) return;
    const messages: ConversationMessage[] = currentTurns
      .filter((t) => !t.error && t.content.trim())
      .map((t) => ({
        role: t.role,
        content: t.content,
        tools: t.tools,
        timestamp: new Date().toISOString(),
      }));
    if (messages.length === 0) return; // don't wipe previously saved messages
    try {
      await conversationsApi.update(convId, { messages });
      // Refresh conversation list (for updated timestamp).
      const { conversations: list } = await conversationsApi.list();
      setConversations(list);
    } catch (e) {
      console.error("[athena] Failed to save conversation:", e);
    }
  }, []);

  // Generate title after first user message.
  const isGeneratedTitle = (title?: string | null) =>
    !!title && title.trim().toLowerCase() !== "new chat";

  const maybeGenerateTitle = useCallback(async () => {
    const convId = activeConvIdRef.current;
    if (!convId || titleGeneratingRef.current) return;
    const currentTitle = conversationsRef.current.find((c) => c.id === convId)?.title;
    if (isGeneratedTitle(currentTitle)) return;
    const turns = turnsRef.current;
    // Generate title after at least 2 turns (1 user + 1 assistant response).
    if (turns.length < 2) return;
    titleGeneratingRef.current = true;
    try {
      const { title } = await conversationsApi.generateTitle(convId);
      // Update local conversation list with new title.
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, title } : c))
      );
    } catch (e) {
      console.error("[athena] Failed to generate title:", e);
    } finally {
      titleGeneratingRef.current = false;
    }
  }, []);

  // Start a new chat — archives the current active conversation.
  const startNewChat = useCallback(async () => {
    if (streaming) return;
    // Save current conversation first.
    if (turnsRef.current.length > 0) {
      await saveConversation(turnsRef.current);
    }
    try {
      const { conversation: conv } = await conversationsApi.create();
      setActiveConvId(conv.id);
      titleGeneratingRef.current = false;
      setTurns([]);
      setConversations((prev) => [conv, ...prev]);
    } catch (e) {
      console.error("[athena] Failed to create conversation:", e);
    }
  }, [streaming, saveConversation]);

  // Load a conversation from history, reactivating it if it was archived.
  const loadConversation = useCallback(async (id: string) => {
    if (streaming) return;
    setLoadingConv(true);
    try {
      const { conversation } = await conversationsApi.get(id);
      // Save current active conversation before switching away.
      if (activeConvIdRef.current && activeConvIdRef.current !== id && turnsRef.current.length > 0) {
        await saveConversation(turnsRef.current);
      }
      // If loading an archived conversation, reactivate it on the server first.
      if (conversation.status === "archived") {
        await conversationsApi.reactivate(id);
      }
      titleGeneratingRef.current = false;
      setActiveConvId(id);
      setTurns(
        (conversation.messages as ConversationMessage[]).map((m) => ({
          role: m.role,
          content: m.content,
          tools: m.tools,
        }))
      );
      setHistoryOpen(false);
      // Refresh list so the newly-active conversation shows correctly.
      const { conversations: list } = await conversationsApi.list();
      setConversations(list);
    } catch (e) {
      console.error("[athena] Failed to load conversation:", e);
    } finally {
      setLoadingConv(false);
    }
  }, [streaming, saveConversation]);

  // Delete a conversation.
  const deleteConversation = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await conversationsApi.delete(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      // If deleting the active conversation, start a new one.
      if (id === activeConvIdRef.current) {
        const { conversation: conv } = await conversationsApi.create();
        setActiveConvId(conv.id);
        titleGeneratingRef.current = false;
        setTurns([]);
        setConversations((prev) => [conv, ...prev.filter((c) => c.id !== id)]);
      }
    } catch (err) {
      console.error("[athena] Failed to delete conversation:", err);
    }
  }, []);

  // ===== Client-action dispatcher =====
  // Handles all client_action SSE events from the server (window mgmt,
  // pomodoro, workspace restore, study tool results). Uses refs to avoid
  // stale closures.
  //
  // The SSE event's `tool` field is the *tool name* (e.g. "start_quiz"),
  // but the *semantic action* is inside the payload as `action` (e.g.
  // "open_study_hub"). We switch on `p.action` so that tools like
  // start_quiz (→ action: "open_study_hub") and generate_flashcards
  // (→ action: "open_app") are dispatched correctly. For tools where the
  // action name happens to equal the tool name (open_app, close_window,
  // etc.), this still works because p.action === action.tool.
  const dispatchClientAction = useCallback((action: AthenaClientAction) => {
    const p = action.payload as Record<string, any>;
    const { openWindow, closeWindow, focusWindow, minimizeWindow, setRect, closeAll, closeAllEverywhere, retile } = storeRef.current;
    // Some calendar tools historically used a nested clientAction pattern.
    // Unwrap it if present so the date/params are at the top level.
    const payload: Record<string, any> = p.clientAction?.payload
      ? { ...p.clientAction.payload }
      : p;
    const act = (p.action ?? p.clientAction?.tool ?? action.tool) as string;
    // Helper: find a browser window by id, or fall back to a non-minimized /
    // last-open one.
    const findBrowserWindow = (windowId?: string) => {
      const wins = windowsRef.current.filter((w) => w.appId === "browser");
      if (!wins.length) return null;
      if (windowId) {
        const byId = wins.find((w) => w.id === String(windowId));
        if (byId) return byId;
      }
      // Prefer a non-minimized browser window, else the last in the list.
      return wins.find((w) => !w.minimized) ?? wins[wins.length - 1];
    };
    // Find an open Maps window, or open one if none exists. Returns the id.
    const ensureMapsWindow = (): string => {
      const wins = windowsRef.current.filter((w) => w.appId === "maps");
      const existing = wins.find((w) => !w.minimized) ?? wins[wins.length - 1];
      if (existing) {
        if (existing.minimized) minimizeWindow(existing.id);
        focusWindow(existing.id);
        return existing.id;
      }
      const id = openWindow({ appId: "maps", title: "Maps", icon: "Map" });
      return id;
    };
    // Find an open Atlas window, or open one if none exists. Returns the id.
    const ensureAtlasWindow = (): string => {
      const wins = windowsRef.current.filter((w) => w.appId === "atlas");
      const existing = wins.find((w) => !w.minimized) ?? wins[wins.length - 1];
      if (existing) {
        if (existing.minimized) minimizeWindow(existing.id);
        focusWindow(existing.id);
        return existing.id;
      }
      const id = openWindow({ appId: "atlas", title: "Atlas", icon: "Network" });
      return id;
    };
    // Find an open Crunch window, or open one if none exists. Returns the id.
    const ensureCrunchWindow = (): string => {
      const wins = windowsRef.current.filter((w) => w.appId === "crunch");
      const existing = wins.find((w) => !w.minimized) ?? wins[wins.length - 1];
      if (existing) {
        if (existing.minimized) minimizeWindow(existing.id);
        focusWindow(existing.id);
        return existing.id;
      }
      const id = openWindow({ appId: "crunch", title: "Crunch", icon: "CalendarClock" });
      return id;
    };
    switch (act) {
      case "profile_updated": {
        // set_user_name changed the display name server-side — pull the fresh
        // profile so greetings and the Start menu update immediately.
        void useAuth.getState().refresh();
        break;
      }
      case "start_pomodoro": {
        openWindow({
          appId: "pomodoro",
          title: "Pomodoro",
          icon: "Timer",
          payload: {
            autoStart: true,
            phase: payload.phase ?? "work",
            durationMinutes: payload.durationMinutes ?? null,
          },
        });
        break;
      }
      case "open_app": {
        // generate_flashcards and other generation tools return an open_app
        // payload — pass through app-specific fields like deckId (Flashcards)
        // and noteId (Notes) so the target app opens the created resource.
        const appPayload: Record<string, any> = {};
        if (payload.deckId) appPayload.deckId = payload.deckId;
        if (payload.noteId) appPayload.noteId = payload.noteId;
        if (payload.taskId) appPayload.taskId = payload.taskId;
        openWindow({
          appId: payload.appId as AppId,
          title: payload.title ?? payload.appId,
          icon: APP_ICONS[payload.appId] ?? "AppWindow",
          rect: payload.rect as Partial<WindowRect> | undefined,
          payload: Object.keys(appPayload).length > 0 ? appPayload : undefined,
        });
        break;
      }
      case "open_study_hub": {
        const studyPayload: Record<string, any> = {};
        if (payload.mode) studyPayload.mode = payload.mode;
        if (payload.sourceKind) studyPayload.sourceKind = payload.sourceKind;
        if (payload.sourceId) studyPayload.sourceId = payload.sourceId;
        if (payload.text) studyPayload.text = payload.text;
        if (payload.quizId) studyPayload.quizId = payload.quizId;
        if (payload.chatId) studyPayload.chatId = payload.chatId;
        if (payload.podcastId) studyPayload.podcastId = payload.podcastId;
        if (payload.workspaceId) studyPayload.workspaceId = payload.workspaceId;
        if (payload.sessionId) studyPayload.sessionId = payload.sessionId;
        if (payload.appendDeckId) {
          studyPayload.appendDeckId = payload.appendDeckId;
          if (payload.appendDeckName) studyPayload.appendDeckName = payload.appendDeckName;
        }
        openWindow({
          appId: "study",
          title: "Study Hub",
          icon: APP_ICONS["study"] ?? "GraduationCap",
          payload: Object.keys(studyPayload).length > 0 ? studyPayload : undefined,
        });
        break;
      }
      case "close_window": {
        closeWindow(payload.windowId);
        break;
      }
      case "focus_window": {
        focusWindow(payload.windowId);
        break;
      }
      case "minimize_window": {
        minimizeWindow(payload.windowId);
        break;
      }
      case "resize_window": {
        const w = windowsRef.current.find((x) => x.id === payload.windowId);
        if (w) setRect(payload.windowId, { ...w.rect, width: payload.width, height: payload.height });
        break;
      }
      case "move_window": {
        const w = windowsRef.current.find((x) => x.id === payload.windowId);
        if (w) {
          // Snap to 20px grid for cleaner positioning.
          const GRID = 20;
          setRect(payload.windowId, {
            ...w.rect,
            x: Math.round(Number(payload.x) / GRID) * GRID,
            y: Math.round(Number(payload.y) / GRID) * GRID,
          });
        }
        break;
      }
      case "tile_windows": {
        // Defer tiling by one tick so any pending openWindow/closeWindow
        // state updates have flushed into the store first.
        setTimeout(() => {
          retile();
        }, 50);
        break;
      }
      case "open_workspace": {
        closeAllEverywhere();
        const savedWindows = (payload.windows as Array<{
          appId: string;
          title: string;
          rect: WindowRect;
        }>) ?? [];
        for (const sw of savedWindows) {
          openWindow({
            appId: sw.appId as AppId,
            title: sw.title,
            icon: APP_ICONS[sw.appId] ?? "AppWindow",
            rect: sw.rect,
          });
        }
        break;
      }
      case "open_calendar": {
        openWindow({
          appId: "calendar",
          title: "Calendar",
          icon: "Calendar",
          payload: payload.date ? { date: payload.date } : undefined,
        });
        break;
      }
      case "open_habits": {
        openWindow({
          appId: "habits",
          title: "Habits",
          icon: "Flame",
        });
        break;
      }
      case "open_athena": {
        // Quick Capture routes questions to Athena with a prefilled prompt.
        if (payload.prompt) {
          sendRef.current?.(String(payload.prompt));
        }
        break;
      }
      case "show_code_result": {
        // run_code results are rendered inline from the tool event's `result`
        // field in ToolResultBlock. No window action needed here.
        break;
      }
      case "open_browser": {
        // Open the Browser app and navigate to a URL. If a Browser window is
        // already open, focus it and open a new tab via the browser store;
        // otherwise open a new window seeded with the URL payload.
        const url = String(payload.url ?? "");
        const existing = windowsRef.current.find((w) => w.appId === "browser");
        if (existing) {
          focusWindow(existing.id);
          if (existing.minimized) minimizeWindow(existing.id);
          // Open a new tab in the existing window.
          issueCmdRef.current(existing.id, "new_tab", { url });
        } else {
          openWindow({
            appId: "browser",
            title: "Browser",
            icon: "Globe",
            payload: url ? { url } : undefined,
          });
        }
        break;
      }
      case "new_tab": {
        const url = String(payload.url ?? "");
        const target = findBrowserWindow(payload.windowId);
        if (target) {
          issueCmdRef.current(target.id, "new_tab", { url });
        } else {
          // No browser window open — open one.
          openWindow({
            appId: "browser",
            title: "Browser",
            icon: "Globe",
            payload: url ? { url } : undefined,
          });
        }
        break;
      }
      case "close_tab": {
        const target = findBrowserWindow(payload.windowId);
        if (target) {
          issueCmdRef.current(target.id, "close_tab", payload.tabId ? { tabId: String(payload.tabId) } : {});
        }
        break;
      }
      case "navigate_browser": {
        const url = String(payload.url ?? "");
        const target = findBrowserWindow(payload.windowId);
        if (target) requestNavRef.current(target.id, "navigate", url, payload.tabId ? String(payload.tabId) : undefined);
        break;
      }
      case "browser_back": {
        const target = findBrowserWindow(payload.windowId);
        if (target) requestNavRef.current(target.id, "back", undefined, payload.tabId ? String(payload.tabId) : undefined);
        break;
      }
      case "browser_forward": {
        const target = findBrowserWindow(payload.windowId);
        if (target) requestNavRef.current(target.id, "forward", undefined, payload.tabId ? String(payload.tabId) : undefined);
        break;
      }
      case "browser_reload": {
        const target = findBrowserWindow(payload.windowId);
        if (target) requestNavRef.current(target.id, "reload", undefined, payload.tabId ? String(payload.tabId) : undefined);
        break;
      }
      case "click_element": {
        const target = findBrowserWindow(payload.windowId);
        if (target) {
          issueCmdRef.current(target.id, "click", {
            selector: payload.selector ? String(payload.selector) : undefined,
            text: payload.text ? String(payload.text) : undefined,
            tabId: payload.tabId ? String(payload.tabId) : undefined,
          });
        }
        break;
      }
      case "fill_field": {
        const target = findBrowserWindow(payload.windowId);
        if (target) {
          issueCmdRef.current(target.id, "fill", {
            selector: payload.selector ? String(payload.selector) : undefined,
            text: payload.text ? String(payload.text) : undefined,
            value: payload.value ? String(payload.value) : "",
            tabId: payload.tabId ? String(payload.tabId) : undefined,
          });
        }
        break;
      }
      case "submit_form": {
        const target = findBrowserWindow(payload.windowId);
        if (target) {
          issueCmdRef.current(target.id, "submit", {
            selector: payload.selector ? String(payload.selector) : undefined,
            tabId: payload.tabId ? String(payload.tabId) : undefined,
          });
        }
        break;
      }
      case "highlight_text": {
        const target = findBrowserWindow(payload.windowId);
        if (target) {
          issueCmdRef.current(target.id, "highlight", {
            text: payload.text ? String(payload.text) : undefined,
            selector: payload.selector ? String(payload.selector) : undefined,
            tabId: payload.tabId ? String(payload.tabId) : undefined,
          });
        }
        break;
      }
      case "clear_browser_highlight": {
        const target = findBrowserWindow(payload.windowId);
        if (target) {
          issueCmdRef.current(target.id, "clear_highlight", {
            tabId: payload.tabId ? String(payload.tabId) : undefined,
          });
        }
        break;
      }
      case "scroll_page": {
        const target = findBrowserWindow(payload.windowId);
        if (target) {
          issueCmdRef.current(target.id, "scroll", {
            direction: payload.direction ? String(payload.direction) : undefined,
            text: payload.text ? String(payload.text) : undefined,
            selector: payload.selector ? String(payload.selector) : undefined,
            tabId: payload.tabId ? String(payload.tabId) : undefined,
          });
        }
        break;
      }
      // ===== Maps & trip planning =====
      case "open_maps": {
        ensureMapsWindow();
        break;
      }
      case "show_on_map": {
        const id = ensureMapsWindow();
        issueMapCmdRef.current(id, "show", {
          lat: payload.lat !== undefined ? Number(payload.lat) : undefined,
          lon: payload.lon !== undefined ? Number(payload.lon) : undefined,
          zoom: payload.zoom !== undefined ? Number(payload.zoom) : undefined,
          label: payload.label ? String(payload.label) : undefined,
        });
        break;
      }
      case "add_map_marker": {
        const id = ensureMapsWindow();
        issueMapCmdRef.current(id, "add_marker", {
          lat: payload.lat !== undefined ? Number(payload.lat) : undefined,
          lon: payload.lon !== undefined ? Number(payload.lon) : undefined,
          title: payload.title ? String(payload.title) : undefined,
          description: payload.description ? String(payload.description) : undefined,
          category: payload.category ? String(payload.category) : undefined,
        });
        break;
      }
      case "draw_map_route": {
        const id = ensureMapsWindow();
        issueMapCmdRef.current(id, "draw_route", {
          geometry: payload.geometry as [number, number][] | undefined,
          waypoints: payload.waypoints as any[] | undefined,
          pois: payload.pois as any[] | undefined,
          type: payload.type ? String(payload.type) : undefined,
          distanceM: payload.distanceM !== undefined ? Number(payload.distanceM) : undefined,
          durationS: payload.durationS !== undefined ? Number(payload.durationS) : undefined,
        });
        break;
      }
      case "show_map_pois": {
        const id = ensureMapsWindow();
        issueMapCmdRef.current(id, "show_pois", {
          pois: payload.pois as any[] | undefined,
        });
        break;
      }
      case "open_trip": {
        const id = ensureMapsWindow();
        issueMapCmdRef.current(id, "open_trip", {
          tripId: payload.tripId ? String(payload.tripId) : undefined,
        });
        break;
      }
      case "open_tour": {
        const id = ensureMapsWindow();
        issueMapCmdRef.current(id, "open_tour", {
          tourId: payload.tourId ? String(payload.tourId) : undefined,
        });
        break;
      }
      case "draw_tour": {
        const id = ensureMapsWindow();
        issueMapCmdRef.current(id, "draw_tour", {
          tourDays: payload.tourDays as { name: string; geometry: [number, number][] }[] | undefined,
        });
        break;
      }
      // ===== Atlas (Pro global knowledge graph) =====
      case "open_atlas": {
        const id = ensureAtlasWindow();
        // If a conceptId is provided, store it so the Atlas app can focus on it.
        if (payload.conceptId) {
          sessionStorage.setItem(`atlas:focus:${id}`, String(payload.conceptId));
        }
        break;
      }
      // ===== Crunch (Pro AI exam planner) =====
      case "open_crunch": {
        const id = ensureCrunchWindow();
        // If a date is provided, store it so the Crunch app can focus on it.
        if (payload.date) {
          sessionStorage.setItem(`crunch:focus:${id}`, String(payload.date));
        }
        break;
      }
      default: {
        console.warn(`[athena] unhandled client_action: tool=${action.tool} action=${act}`);
        break;
      }
    }
  }, []);

  // ===== File attachment handlers =====

  const handleFileSelect = async (file: File) => {
    setAttaching(true);
    setAttachError(null);
    try {
      const result = await attachFile(file);
      setAttachment(result);
      // Ask user if they want to save to permanent storage.
      setShowSaveDialog(true);
      setSuggestion(null);
      setSelectedFolderId(null);
      setSaveMsg(null);
      // Load folders for the picker.
      const foldersRes = await filesApi.listFolders(undefined).catch(() => null);
      if (foldersRes?.folders) setFolders(foldersRes.folders);
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setAttaching(false);
    }
  };

  const handleSuggestFolder = async () => {
    if (!attachment) return;
    setSuggesting(true);
    setSuggestion(null);
    try {
      const result = await suggestFolder(attachment.fileName, attachment.text.slice(0, 2000));
      setSuggestion(result);
      setSelectedFolderId(result.folderId);
    } catch (e) {
      setSuggestion({
        folderId: null,
        folderPath: "Root",
        reason: `Suggestion failed: ${e instanceof Error ? e.message : "unknown"}`,
        confidence: 0,
      });
    } finally {
      setSuggesting(false);
    }
  };

  const handleSaveToStorage = async () => {
    if (!attachment) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveAttachedFile(attachment.tempPath, selectedFolderId, attachment.fileName);
      setSaveMsg(`Saved "${attachment.fileName}" to ${selectedFolderId ? folders.find(f => f.id === selectedFolderId)?.name ?? "folder" : "root"}`);
      setShowSaveDialog(false);
      // Clear attachment after saving (keep it for chat context though).
    } catch (e) {
      setSaveMsg(`Save failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setSaving(false);
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
    setAttachError(null);
  };

  // Shared streaming setup — appends a fresh pending assistant turn to
  // `turnsBefore` and streams the response. Used by both send() and
  // regenerate() so copy/retry share the exact same SSE handling.
  const startStream = useCallback(
    (history: AthenaMessage[], turnsBefore: ChatTurn[]) => {
      const assistantTurn: ChatTurn = {
        role: "assistant",
        content: "",
        tools: [],
        pending: true,
      };
      setTurns([...turnsBefore, assistantTurn]);
      setStreaming(true);

      const winState = buildWindowState();

      handleRef.current = streamAthenaChat(
        history,
        {
          onContent: (chunk, done) => {
            setTurns((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + chunk,
                  pending: !done && last.pending,
                };
              }
              return next;
            });
          },
          onReasoning: () => {},
          onTool: (ev) => {
            setTurns((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                const tools = [...(last.tools ?? [])];
                const idx = tools.findIndex((t) => t.id === ev.id);
                if (idx >= 0) tools[idx] = ev;
                else tools.push(ev);
                next[next.length - 1] = { ...last, tools };
              }
              return next;
            });
          },
          onClientAction: (action) => dispatchClientAction(action),
          onDataChange: (tool) => {
            if (tool) useDataRefresh.getState().notifyTool(tool);
          },
          onError: (msg) => {
            setTurns((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, error: msg, pending: false };
              }
              return next;
            });
          },
          onDone: () => {
            let finalTurns: ChatTurn[] = [];
            setTurns((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, pending: false };
              }
              finalTurns = next;
              return next;
            });
            // Save conversation + generate title after the turn completes.
            // Await the save so title generation reads the updated messages.
            setTimeout(async () => {
              await saveConversation(finalTurns);
              await maybeGenerateTitle();
            }, 100);
          },
        },
        winState
      );

      handleRef.current.done.finally(() => setStreaming(false));
    },
    [buildWindowState, dispatchClientAction, saveConversation, maybeGenerateTitle]
  );

  const send = useCallback(
    (text: string) => {
      let content = text.trim();
      if (!content || streaming) return;

      // If there's an attachment, inject its content into the message.
      if (attachment) {
        const fileLabel = attachment.fileType === "pdf" ? "PDF document" : `${attachment.fileType} file`;
        const truncationNote = attachment.truncated ? "\n_(content truncated — first 50,000 characters shown)_" : "";
        content = `I've attached a ${fileLabel}: **${attachment.fileName}** (${(attachment.fileSize / 1024).toFixed(1)} KB)\n\nFile content:\n\`\`\`\n${attachment.text}${truncationNote}\n\`\`\`\n\n${content}`;
        // Clear the attachment after sending (it's now in the chat context).
        setAttachment(null);
      }

      // Build conversation history for the server. We must maintain
      // alternating user/assistant messages — some providers reject
      // consecutive same-role messages with 400.
      // If an assistant turn has no text content (e.g. it only called
      // client-action tools like tile_windows), use a placeholder so
      // the alternation is preserved.
      const history: AthenaMessage[] = [
        ...turns
          .filter((t) => !t.error)
          .map((t) => {
            if (t.role === "assistant" && !t.content.trim()) {
              // Assistant turn with no text (tool-only turn).
              const toolNames = (t.tools ?? []).map((tc) => tc.name).join(", ");
              return {
                role: "assistant" as const,
                content: toolNames
                  ? `(Completed: ${toolNames})`
                  : "(Done)",
              };
            }
            return { role: t.role, content: t.content };
          })
          .filter((t) => t.content.trim()),
        { role: "user", content },
      ];

      const userTurn: ChatTurn = { role: "user", content };
      setInput("");
      startStream(history, [...turns, userTurn]);
    },
    [turns, streaming, attachment, startStream]
  );
  sendRef.current = send;

  // Regenerate the assistant response at `assistantIdx` by re-running the
  // preceding user prompt. Drops the old assistant turn (and anything after
  // it) and re-streams a fresh response.
  const regenerate = useCallback(
    (assistantIdx: number) => {
      if (streaming) return;
      const userTurn = turns[assistantIdx - 1];
      if (!userTurn || userTurn.role !== "user") return;
      // Keep everything up to (and including) the user turn; drop the old
      // assistant turn and any turns after it.
      const turnsBefore = turns.slice(0, assistantIdx);
      const history: AthenaMessage[] = [
        ...turnsBefore
          .slice(0, -1) // exclude the user turn we're re-sending
          .filter((t) => !t.error)
          .map((t) => {
            if (t.role === "assistant" && !t.content.trim()) {
              const toolNames = (t.tools ?? []).map((tc) => tc.name).join(", ");
              return {
                role: "assistant" as const,
                content: toolNames ? `(Completed: ${toolNames})` : "(Done)",
              };
            }
            return { role: t.role, content: t.content };
          })
          .filter((t) => t.content.trim()),
        { role: "user", content: userTurn.content },
      ];
      startStream(history, turnsBefore);
    },
    [turns, streaming, startStream]
  );

  const stop = () => {
    handleRef.current?.abort();
    setStreaming(false);
    setTurns((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === "assistant" && last.pending) {
        next[next.length - 1] = {
          ...last,
          pending: false,
          content: last.content || "_(stopped)_",
        };
      }
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-edge px-4 py-2.5">
        <Sparkles size={16} className="text-accent" />
        <span className="text-sm font-semibold text-ink">Mavino</span>
        <span className="text-[11px] text-ink-muted">workspace assistant</span>

        {/* New Chat button */}
        <button
          onClick={startNewChat}
          disabled={streaming || loadingConv}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          title="Start a new chat"
        >
          <Plus size={12} /> New
        </button>

        {/* History dropdown */}
        <div className="relative">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            disabled={loadingConv}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            title="Chat history"
          >
            <History size={12} /> History
            <ChevronDown size={10} />
          </button>
          {historyOpen && (
            <>
              <div
                className="fixed inset-0 z-50"
                onClick={() => setHistoryOpen(false)}
              />
              <div className="absolute left-0 top-full z-[60] mt-1 max-h-96 w-72 overflow-y-auto rounded-lg border border-edge bg-surface shadow-window">
                {conversations.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[11px] text-ink-muted">
                    No conversations yet
                  </div>
                ) : (
                  conversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => loadConversation(conv.id)}
                      className={`group flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition hover:bg-surface-2 ${
                        conv.id === activeConvId ? "bg-accent/5" : ""
                      }`}
                    >
                      <MessageSquare
                        size={12}
                        className={`shrink-0 ${conv.status === "active" ? "text-accent" : "text-ink-muted"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-ink">{conv.title}</div>
                        <div className="text-[10px] text-ink-muted">
                          {new Date(conv.lastMessageAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          {" · "}
                          {new Date(conv.lastMessageAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          {conv.status === "active" && " · active"}
                        </div>
                      </div>
                      <button
                        onClick={(e) => deleteConversation(conv.id, e)}
                        className="shrink-0 rounded p-1 text-ink-muted opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                        title="Delete conversation"
                      >
                        <Trash size={11} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {mode === "quick" && (
            <>
              {/* Roll-edge selector */}
              <div className="relative">
                <button
                  onClick={() => setEdgeMenuOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
                  title="Roll-in edge"
                >
                  <span className="capitalize">{athenaRollEdge}</span>
                  <ChevronDown size={12} />
                </button>
                {edgeMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-50"
                      onClick={() => setEdgeMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full z-[60] mt-1 w-28 rounded-lg border border-edge bg-surface shadow-window">
                      {(["bottom", "top", "left", "right"] as AthenaRollEdge[]).map((e) => (
                        <button
                          key={e}
                          onClick={() => {
                            setAthenaRollEdge(e);
                            setEdgeMenuOpen(false);
                          }}
                          className={`flex w-full items-center px-3 py-1.5 text-[11px] capitalize hover:bg-surface-2 ${
                            e === athenaRollEdge ? "text-accent" : "text-ink-muted"
                          }`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={onExpand}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
                title="Expand to full window"
              >
                <Maximize2 size={12} /> Expand
              </button>
              <button
                onClick={() => setAthenaQuickOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-red-500 hover:text-white"
                title="Close"
              >
                <X size={14} />
              </button>
              <div className="mx-1 h-4 w-px bg-edge" />
            </>
          )}
          <button
            onClick={() => send("Save my current workspace layout. Ask me for a name first.")}
            disabled={streaming}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            title="Save workspace"
          >
            <Save size={12} /> Save
          </button>
          <button
            onClick={() => send("List my saved workspaces")}
            disabled={streaming}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            title="List workspaces"
          >
            <FolderOpen size={12} /> Open
          </button>
          <button
            onClick={() => send("Tile my windows in a grid layout")}
            disabled={streaming}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            title="Tile windows"
          >
            <LayoutGrid size={12} /> Tile
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Sparkles size={32} className="text-accent opacity-60" />
            <p className="text-sm text-ink">
              Hi — I'm Mavino. I can manage your tasks, files, notes, grades, focus timer,
              <br />
              and even control your windows and save workspace layouts.
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-lg border border-edge bg-surface-2 px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-3 hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-none @5xl:max-w-2xl flex-col gap-3">
            {turns.map((t, i) => (
              <TurnBubble
                key={i}
                turn={t}
                isLastAssistant={
                  t.role === "assistant" &&
                  i === turns.length - 1
                }
                onRetry={() => regenerate(i)}
                retryDisabled={streaming}
              />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-edge p-3">
        {/* Attachment chip */}
        {attachment && (
          <div className="mx-auto mb-2 flex max-w-none @5xl:max-w-2xl items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-1.5">
            {attachment.fileType === "pdf" ? <FileType size={14} className="shrink-0 text-red-400" /> : <FileCode size={14} className="shrink-0 text-accent" />}
            <span className="truncate text-xs font-medium text-ink">{attachment.fileName}</span>
            <span className="shrink-0 text-[10px] text-ink-muted">{(attachment.fileSize / 1024).toFixed(1)} KB</span>
            {attachment.truncated && <span className="shrink-0 text-[10px] text-amber-500">truncated</span>}
            <button onClick={removeAttachment} className="ml-auto shrink-0 rounded p-0.5 text-ink-muted hover:bg-surface-3 hover:text-red-400" title="Remove attachment">
              <X size={12} />
            </button>
          </div>
        )}
        {/* Attach error */}
        {attachError && (
          <div className="mx-auto mb-2 flex max-w-none @5xl:max-w-2xl items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs text-red-400">
            <AlertCircle size={12} /> {attachError}
          </div>
        )}
        {/* Save status message */}
        {saveMsg && (
          <div className="mx-auto mb-2 flex max-w-none @5xl:max-w-2xl items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs text-emerald-500">
            <Check size={12} /> {saveMsg}
          </div>
        )}
        <div className="mx-auto flex max-w-none @5xl:max-w-2xl items-end gap-2">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={attaching || streaming}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge text-ink-muted hover:bg-surface-3 hover:text-ink disabled:opacity-40"
            title="Attach file (PDF, TXT, C, C++, Java, TS)"
          >
            {attaching ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.c,.h,.cpp,.cc,.cxx,.hpp,.java,.ts,.tsx,.js,.jsx,.py,.md"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
              e.target.value = "";
            }}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={attachment ? "Ask about the attached file…" : "Ask Mavino to do something…"}
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          {streaming ? (
            <button
              onClick={stop}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-edge text-ink-muted hover:bg-surface-3 hover:text-ink"
              title="Stop"
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim() && !attachment}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg hover:opacity-90 disabled:opacity-40"
              title="Send"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Save-to-storage dialog */}
      {showSaveDialog && attachment && (
        <SaveToStorageDialog
          fileName={attachment.fileName}
          fileSize={attachment.fileSize}
          contentPreview={attachment.text.slice(0, 500)}
          folders={folders}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          suggesting={suggesting}
          suggestion={suggestion}
          onSuggest={handleSuggestFolder}
          saving={saving}
          onSave={handleSaveToStorage}
          onSkip={() => { setShowSaveDialog(false); setSaveMsg(null); }}
        />
      )}
    </div>
  );
}

// ===== UI components =====

function TurnBubble({
  turn,
  isLastAssistant,
  onRetry,
  retryDisabled,
}: {
  turn: ChatTurn;
  isLastAssistant: boolean;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const isUser = turn.role === "user";
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!turn.content) return;
    try {
      await navigator.clipboard.writeText(turn.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable (e.g. insecure context) — ignore.
    }
  };
  // Show the action row only for finished assistant turns that produced
  // either text content or an error. While streaming (pending) the row is
  // hidden so it doesn't flicker on every chunk.
  const showActions =
    !isUser && !turn.pending && (!!turn.content || !!turn.error);
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${isUser ? "" : "w-full"}`}>
        {!isUser && turn.tools && turn.tools.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {turn.tools.map((t) => (
              <ToolChip key={t.id} tool={t} />
            ))}
          </div>
        )}
        {!isUser && turn.tools && turn.tools.length > 0 && (
          <div className="mb-1.5 space-y-1.5">
            {turn.tools
              .filter((t) => t.state === "completed" && t.result)
              .map((t) => (
                <ToolResultBlock key={`tr-${t.id}`} tool={t} />
              ))}
          </div>
        )}
        <div
          className={`rounded-2xl px-3.5 py-2 text-sm ${
            isUser
              ? "bg-accent text-accent-fg"
              : "bg-surface-2 text-ink border border-edge"
          }`}
        >
          {turn.content ? (
            isUser ? (
              <span className="whitespace-pre-wrap">{turn.content}</span>
            ) : (
              <div className="selectable markdown-body prose-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown>
              </div>
            )
          ) : turn.pending ? (
            <span className="flex items-center gap-1.5 text-ink-muted">
              <Loader2 size={13} className="animate-spin" /> thinking…
            </span>
          ) : null}
          {turn.error && (
            <span className="mt-1 flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={12} /> {turn.error}
            </span>
          )}
        </div>
        {showActions && (
          <div className="mt-1 flex items-center gap-1">
            {turn.content && (
              <button
                onClick={copy}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:bg-surface-2 hover:text-ink"
                title="Copy message"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
            {isLastAssistant && onRetry && (
              <button
                onClick={onRetry}
                disabled={retryDisabled}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-40"
                title="Regenerate response"
              >
                <RotateCcw size={11} /> Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolChip({ tool }: { tool: AthenaToolEvent }) {
  const color =
    tool.state === "completed"
      ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
      : tool.state === "error"
      ? "text-red-400 border-red-500/30 bg-red-500/10"
      : tool.state === "canceled"
      ? "text-ink-muted border-edge bg-surface-3"
      : "text-accent border-accent/30 bg-accent/10";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${color}`}
    >
      <Wrench size={9} />
      {tool.name}
      {tool.state === "running" || tool.state === "preparing" ? (
        <Loader2 size={9} className="animate-spin" />
      ) : null}
      <span className="opacity-70">· {tool.state}</span>
    </span>
  );
}

// ===== Inline tool result renderers =====
// Rich rendering for tools whose result is best shown inline in the chat
// (code execution output, web search sources, research citations).

function ToolResultBlock({ tool }: { tool: AthenaToolEvent }) {
  const r = tool.result as Record<string, any> | undefined;
  if (!r || (r as any).error) return null;
  if (tool.name === "run_code") return <CodeResultBlock result={r} />;
  if (tool.name === "web_search") return <SearchSourcesBlock result={r} />;
  if (tool.name === "research") return <ResearchSourcesBlock result={r} />;
  return null;
}

function CodeResultBlock({ result }: { result: Record<string, any> }) {
  const [expanded, setExpanded] = useState(true);
  const language = result.language ?? "code";
  const code = result.code ?? "";
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.exitCode;
  const durationMs = result.durationMs;
  const timedOut = result.timedOut;
  const unavailable = result.unavailable;

  if (unavailable) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
        <AlertCircle size={12} className="mr-1 inline" />
        {stderr || "Code sandbox unavailable."}
      </div>
    );
  }

  const ok = exitCode === 0 && !timedOut;
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface-3 text-xs">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 border-b border-edge px-2.5 py-1.5 text-ink-muted hover:bg-surface-2"
      >
        <Terminal size={11} />
        <span className="font-mono">{language}</span>
        <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${ok ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
          {timedOut ? "TIMEOUT" : `exit ${exitCode}`}
        </span>
        {durationMs != null && (
          <span className="text-[10px] opacity-60">{Math.round(durationMs)}ms</span>
        )}
        <ChevronDown size={11} className={`ml-auto transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="space-y-0">
          {code && (
            <pre className="max-h-40 overflow-auto border-b border-edge px-3 py-2 font-mono text-[11px] text-ink">
              {code.length > 2000 ? code.slice(0, 2000) + "\n…" : code}
            </pre>
          )}
          {stdout && (
            <pre className="max-h-48 overflow-auto px-3 py-2 font-mono text-[11px] text-emerald-300">
              {stdout.length > 5000 ? stdout.slice(0, 5000) + "\n…" : stdout}
            </pre>
          )}
          {stderr && (
            <pre className="max-h-32 overflow-auto px-3 py-2 font-mono text-[11px] text-red-300">
              {stderr.length > 5000 ? stderr.slice(0, 5000) + "\n…" : stderr}
            </pre>
          )}
          {!stdout && !stderr && (
            <div className="px-3 py-2 text-ink-muted italic">No output.</div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchSourcesBlock({ result }: { result: Record<string, any> }) {
  const results: Array<{ title: string; url: string; snippet?: string }> = result.results ?? [];
  if (results.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {results.slice(0, 6).map((r, i) => (
        <a
          key={i}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-2 px-2 py-0.5 text-[10px] text-ink-muted hover:border-accent hover:text-accent"
          title={r.url}
        >
          <Globe size={9} />
          <span className="max-w-[180px] truncate">{r.title}</span>
          <ExternalLink size={8} className="opacity-50" />
        </a>
      ))}
    </div>
  );
}

function ResearchSourcesBlock({ result }: { result: Record<string, any> }) {
  const sources: Array<{ index: number; title: string; url: string }> = result.sources ?? [];
  if (sources.length === 0) return null;
  return (
    <div className="rounded-lg border border-edge bg-surface-2 px-2.5 py-1.5">
      <div className="mb-1 text-[10px] font-medium text-ink-muted">Sources</div>
      <div className="flex flex-wrap gap-1">
        {sources.map((s) => (
          <a
            key={s.index}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-3 px-2 py-0.5 text-[10px] text-ink-muted hover:border-accent hover:text-accent"
            title={s.url}
          >
            <span className="font-mono text-accent">[{s.index}]</span>
            <span className="max-w-[200px] truncate">{s.title}</span>
            <ExternalLink size={8} className="opacity-50" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ===== Save-to-storage dialog =====

function SaveToStorageDialog({
  fileName,
  fileSize,
  contentPreview,
  folders,
  selectedFolderId,
  onSelectFolder,
  suggesting,
  suggestion,
  onSuggest,
  saving,
  onSave,
  onSkip,
}: {
  fileName: string;
  fileSize: number;
  contentPreview: string;
  folders: VFolder[];
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  suggesting: boolean;
  suggestion: { folderId: string | null; folderPath: string; reason: string; confidence: number } | null;
  onSuggest: () => void;
  saving: boolean;
  onSave: () => void;
  onSkip: () => void;
}) {
  // Build a flat folder path map for display.
  const byId = new Map(folders.map((f) => [f.id, f]));
  function folderPath(id: string): string {
    const parts: string[] = [];
    let curId: string | null = id;
    let guard = 0;
    while (curId && guard++ < 50) {
      const f = byId.get(curId);
      if (!f) break;
      parts.unshift(f.name);
      curId = f.parentId;
    }
    return parts.join("/") || "Root";
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onSkip}>
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <Cloud size={16} className="text-accent" />
          <span className="text-sm font-semibold text-ink">Save to Storage?</span>
        </div>

        {/* File info */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
            <FileText size={14} className="shrink-0 text-ink-muted" />
            <span className="truncate text-sm font-medium text-ink">{fileName}</span>
            <span className="ml-auto shrink-0 text-[11px] text-ink-muted">{(fileSize / 1024).toFixed(1)} KB</span>
          </div>
          {contentPreview && (
            <p className="mt-2 line-clamp-2 text-[11px] text-ink-muted">
              Preview: {contentPreview.slice(0, 150)}…
            </p>
          )}
        </div>

        {/* Folder selection */}
        <div className="px-4 pb-3">
          <label className="mb-1.5 block text-xs font-medium text-ink-muted">Save to folder:</label>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-edge bg-surface-2">
            {/* Root option */}
            <button
              onClick={() => onSelectFolder(null)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition ${
                selectedFolderId === null ? "bg-accent/10 text-accent" : "text-ink hover:bg-surface-3"
              }`}
            >
              <FolderIcon size={14} className="shrink-0" />
              Root (no folder)
              {selectedFolderId === null && <Check size={12} className="ml-auto" />}
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => onSelectFolder(f.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition ${
                  selectedFolderId === f.id ? "bg-accent/10 text-accent" : "text-ink hover:bg-surface-3"
                }`}
              >
                <FolderIcon size={14} className="shrink-0" />
                <span className="truncate">{folderPath(f.id)}</span>
                {selectedFolderId === f.id && <Check size={12} className="ml-auto shrink-0" />}
              </button>
            ))}
            {folders.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-ink-muted">No folders yet — will save to root.</p>
            )}
          </div>

          {/* Athena suggest */}
          <button
            onClick={onSuggest}
            disabled={suggesting}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs font-medium text-accent transition hover:bg-accent/10 disabled:opacity-50"
          >
            {suggesting ? <Loader2 size={13} className="animate-spin" /> : <Lightbulb size={13} />}
            {suggesting ? "Mavino is thinking…" : "Let Mavino suggest a folder"}
          </button>

          {/* Suggestion result */}
          {suggestion && (
            <div className="mt-2 rounded-lg border border-edge bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs">
                <Lightbulb size={12} className="text-amber-400" />
                <span className="font-medium text-ink">{suggestion.folderPath}</span>
                <span className="ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-muted">
                  {Math.round(suggestion.confidence * 100)}% confidence
                </span>
              </div>
              <p className="mt-1 text-[11px] text-ink-muted">{suggestion.reason}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-edge px-4 py-3">
          <button
            onClick={onSkip}
            className="rounded-md border border-edge px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-3"
          >
            Don't save
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save to Storage
          </button>
        </div>
      </div>
    </div>
  );
}
