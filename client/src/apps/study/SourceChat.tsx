// ===== Study Hub: source-grounded Q&A (NotebookLM-style) =====
// Persisted StudyChat conversations scoped to a set of StudySources. Streams
// cited answers via SSE and renders [n] markers as clickable citation chips
// that open the underlying source.

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles, Send, Square, Plus, MessageSquare, Trash2, Loader2,
  AlertCircle, ChevronDown, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import {
  studyChatApi,
  type StudyChat,
  type StudyChatSummary,
  type ChatMessage,
  type ChatCitation,
} from "../../services/study-chat";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import { studyWorkspacesApi } from "../../services/study-workspaces";
import { notesApi } from "../../services/notes";
import WorkspaceSourceSelector from "./WorkspaceSourceSelector";
import HighlightableMarkdown from "./HighlightableMarkdown";
import { ActionButton, ErrorBanner, Loading } from "./ui";
import { useWindows } from "../../store/windows";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface Props {
  initialChatId?: string | null;
  initialWorkspaceId?: string | null;
}

export default function SourceChat({ initialChatId, initialWorkspaceId, language }: Props & { language?: "en" | "cs" }) {
  const [chats, setChats] = useState<StudyChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
  const [chat, setChat] = useState<StudyChat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);

  // Source library + selection
  const [library, setLibrary] = useState<StudySource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [showSourcePanel, setShowSourcePanel] = useState(true);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  const [listOpen, setListOpen] = useState(false);

  const openWindow = useWindows((s) => s.open);
  const handleRef = useRef<{ abort: () => void; done: Promise<void> } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleSource = (id: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Load chat list + source library on mount.
  const refreshLists = useCallback(async () => {
    const [c, s] = await Promise.all([
      studyChatApi.list().then((r) => r.chats).catch(() => [] as StudyChatSummary[]),
      studySourcesApi.list().then((r) => r.sources).catch(() => [] as StudySource[]),
    ]);
    setChats(c);
    setLibrary(s);
  }, []);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  // Load a chat by id.
  const loadChat = useCallback(async (id: string) => {
    setLoadingChat(true);
    setError("");
    try {
      const { chat: loaded } = await studyChatApi.get(id);
      setChat(loaded);
      setChatId(loaded.id);
      setMessages(loaded.messages);
      // Resolve the chat's sources from the library (or fetch them).
      const need = loaded.sourceIds.filter((sid) => !library.some((s) => s.id === sid));
      let extra: StudySource[] = [];
      if (need.length > 0) {
        const fetched = await Promise.all(need.map((sid) => studySourcesApi.get(sid).catch(() => null)));
        extra = fetched.filter((x): x is StudySource => x !== null);
      }
      // Merge fetched sources into library + set selected IDs.
      setLibrary((prev) => [...prev, ...extra.filter((e) => !prev.some((p) => p.id === e.id))]);
      setSelectedSourceIds(new Set(loaded.sourceIds));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chat");
    } finally {
      setLoadingChat(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  useEffect(() => {
    if (initialChatId) void loadChat(initialChatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChatId]);

  // Auto-load the most recent chat on mount (if no deep-link) so the student
  // resumes where they left off instead of starting from a blank state.
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (initialChatId || initialWorkspaceId) return;
    if (chats.length === 0) return;
    autoLoadedRef.current = true;
    void loadChat(chats[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, initialChatId, initialWorkspaceId]);

  // Preload sources from a workspace deep-link (no chat yet — sources only).
  useEffect(() => {
    if (!initialWorkspaceId) return;
    void (async () => {
      try {
        const { workspace } = await studyWorkspacesApi.get(initialWorkspaceId);
        const need = workspace.sourceIds.filter((sid) => !library.some((s) => s.id === sid));
        if (need.length > 0) {
          const fetched = await Promise.all(need.map((sid) => studySourcesApi.get(sid).catch(() => null)));
          const extra = fetched.filter((x): x is StudySource => x !== null);
          setLibrary((prev) => [...prev, ...extra.filter((e) => !prev.some((p) => p.id === e.id))]);
        }
        setSelectedSourceIds(new Set(workspace.sourceIds));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load workspace");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorkspaceId]);

  // Auto-scroll on new messages / streaming text.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamText, streaming]);

  const startNewChat = () => {
    setChat(null);
    setChatId(null);
    setMessages([]);
    setSelectedSourceIds(new Set());
    setInput("");
    setStreamText("");
    setError("");
    setShowSourcePanel(true);
  };

  const ensureChat = async (): Promise<StudyChat | null> => {
    if (chat) return chat;
    if (selectedSourceIds.size === 0) {
      setError("Add at least one source to ground the chat.");
      return null;
    }
    try {
      const { chat: created } = await studyChatApi.create({
        sourceIds: [...selectedSourceIds],
      });
      setChat(created);
      setChatId(created.id);
      void refreshLists();
      return created;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create chat");
      return null;
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const active = await ensureChat();
    if (!active) return;

    setError("");
    setInput("");
    setStreaming(true);
    setStreamText("");

    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    handleRef.current = studyChatApi.stream(active.id, text, {
      onContent: (t) => setStreamText((prev) => prev + t),
      onDone: async () => {
        setStreaming(false);
        setStreamText("");
        // Reload the chat to pick up the persisted assistant message + citations.
        try {
          const { chat: fresh } = await studyChatApi.get(active.id);
          setChat(fresh);
          setMessages(fresh.messages);
          void refreshLists();
        } catch { /* non-fatal */ }
      },
      onError: (msg) => {
        setStreaming(false);
        // Keep partial text as a non-persisted assistant message.
        setStreamText((prev) => {
          if (prev.trim()) {
            setMessages((m) => [
              ...m,
              { role: "assistant", content: prev, timestamp: new Date().toISOString() },
            ]);
          }
          return "";
        });
        setError(msg);
      },
    }, language);
  };

  const abort = () => {
    handleRef.current?.abort();
    setStreaming(false);
  };

  const deleteChat = async (id: string) => {
    try {
      await studyChatApi.remove(id);
      if (chatId === id) {
        setChat(null);
        setChatId(null);
        setMessages([]);
        setSelectedSourceIds(new Set());
      }
      void refreshLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete chat");
    }
  };

  const openCitation = async (cite: ChatCitation) => {
    if (cite.kind === "note") {
      openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId: cite.refId } });
    } else if (cite.kind === "file") {
      openWindow({ appId: "viewer", title: "Viewer", icon: "Eye", payload: { fileId: cite.refId } });
    } else if (cite.kind === "url") {
      openWindow({ appId: "browser", title: "Browser", icon: "Globe", payload: { url: cite.refId } });
    } else if (cite.kind === "paste") {
      // Paste sources: fetch the StudySource text by index → sourceIds mapping.
      const sourceId = chat?.sourceIds[cite.index - 1];
      if (!sourceId) return;
      try {
        const src = await studySourcesApi.get(sourceId);
        // Create a note with the pasted text so the user can read it.
        const { note } = await notesApi.create({
          title: src.name,
          content: src.textCache,
          tags: "source,paste",
        });
        openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId: note.id } });
      } catch { /* non-fatal */ }
    }
  };

  // Build a citation lookup for the current chat from selected sources (index = position+1).
  const citationMeta = (cites?: ChatCitation[]) => {
    if (!cites) return undefined;
    return cites.map((c) => ({ index: c.index, name: c.name, kind: c.kind, refId: c.refId }));
  };

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Chat history sidebar — collapsible */}
      {historyCollapsed ? (
        <button
          onClick={() => setHistoryCollapsed(false)}
          className="hidden shrink-0 items-center self-start rounded-md border border-edge bg-surface-2 p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink @4xl:flex"
          title="Show history"
        >
          <PanelLeftOpen size={14} />
        </button>
      ) : (
        <div className="hidden w-56 shrink-0 flex-col gap-2 @4xl:flex">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">History</span>
            <div className="flex items-center gap-1">
              <button
                onClick={startNewChat}
                className="flex items-center gap-1 rounded-md border border-edge px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-surface-2 hover:text-ink"
                title="New chat"
              >
                <Plus size={10} /> New
              </button>
              <button
                onClick={() => setHistoryCollapsed(true)}
                className="rounded-md border border-edge p-0.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
                title="Collapse history"
              >
                <PanelLeftClose size={12} />
              </button>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {chats.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-ink-muted">No chats yet.</p>
            ) : (
              chats.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition ${
                    chatId === c.id ? "border-accent/40 bg-accent/10" : "border-transparent hover:bg-surface-2"
                  }`}
                >
                  <button
                    onClick={() => void loadChat(c.id)}
                    className="flex flex-1 flex-col items-start text-left"
                  >
                    <span className="truncate text-ink">{c.title}</span>
                    <span className="text-[10px] text-ink-muted">{c.sourceIds.length} src · {timeAgo(c.updatedAt)}</span>
                  </button>
                  <button
                    onClick={() => void deleteChat(c.id)}
                    className="shrink-0 rounded p-0.5 text-ink-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                    title="Delete chat"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Chat panel */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Mobile chat list dropdown (visible below @4xl) */}
        <div className="flex items-center gap-2 @4xl:hidden">
          <div className="relative flex-1">
            <button
              onClick={() => setListOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-ink hover:bg-surface-3"
            >
              <span className="flex items-center gap-2 truncate">
                <MessageSquare size={13} className="shrink-0 text-accent" />
                <span className="truncate">{chat?.title ?? "Start a grounded chat"}</span>
              </span>
              <ChevronDown size={13} className="shrink-0 text-ink-muted" />
            </button>
            {listOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-edge bg-surface py-1 shadow-window">
                <button
                  onClick={() => { setListOpen(false); startNewChat(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-accent hover:bg-surface-2"
                >
                  <Plus size={13} /> New chat
                </button>
                {chats.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-ink-muted">No chats yet.</p>
                ) : (
                  chats.map((c) => (
                    <div
                      key={c.id}
                      className={`group flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-2 ${chatId === c.id ? "bg-surface-2" : ""}`}
                    >
                      <button
                        onClick={() => { setListOpen(false); void loadChat(c.id); }}
                        className="flex flex-1 flex-col items-start text-left"
                      >
                        <span className="truncate text-ink">{c.title}</span>
                        <span className="text-[10px] text-ink-muted">{c.sourceIds.length} sources · {timeAgo(c.updatedAt)}</span>
                      </button>
                      <button
                        onClick={() => void deleteChat(c.id)}
                        className="shrink-0 rounded p-0.5 text-ink-muted opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                        title="Delete chat"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <ActionButton onClick={startNewChat} variant="ghost">
            <Plus size={13} /> New
          </ActionButton>
        </div>

        {/* Source selection — collapsible workspace selector */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowSourcePanel((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
            >
              <ChevronDown size={12} className={`transition ${showSourcePanel ? "" : "-rotate-90"}`} />
              Sources {selectedSourceIds.size > 0 && `(${selectedSourceIds.size})`}
            </button>
            {selectedSourceIds.size > 0 && !streaming && (
              <button
                onClick={() => setSelectedSourceIds(new Set())}
                className="text-[10px] text-ink-muted hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
          {showSourcePanel && (
            <WorkspaceSourceSelector
              selectedIds={selectedSourceIds}
              onToggle={toggleSource}
              disabled={streaming}
              onSourceAdded={(s) => setLibrary((prev) => [s, ...prev.filter((x) => x.id !== s.id)])}
            />
          )}
        </div>

        {error && <ErrorBanner message={error} />}
        {loadingChat && <Loading label="Loading chat…" />}

        {/* Messages — flex-1 to fill available height */}
        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-edge bg-surface-2 p-3">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <Sparkles size={28} className="text-ink-muted opacity-40" />
              <p className="text-xs text-ink-muted">
                {selectedSourceIds.size === 0
                  ? "Add sources above, then ask a question grounded in them."
                  : "Ask a question about your sources. Answers cite the source for every claim."}
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                  m.role === "user"
                    ? "bg-accent/10 text-ink"
                    : "border border-edge bg-surface text-ink"
                }`}
              >
                {m.role === "user" ? (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                ) : (
                  <HighlightableMarkdown
                    content={m.content}
                    scope="chat"
                    scopeId={chatId ? `${chatId}#msg-${i}` : `msg-${i}`}
                    sourceName={chat?.title ? `Chat: ${chat.title}` : "Study chat"}
                    citations={citationMeta(m.citations)}
                    onOpenCitation={(idx) => {
                      const cite = m.citations?.find((c) => c.index === idx);
                      if (cite) openCitation(cite);
                    }}
                  />
                )}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex flex-col items-start gap-1">
              <div className="max-w-[85%] rounded-lg border border-edge bg-surface px-3 py-2 text-xs">
                {streamText ? (
                  <HighlightableMarkdown
                    content={streamText}
                    scope="chat"
                    scopeId={chatId ? `${chatId}#stream` : "stream"}
                    sourceName={chat?.title ? `Chat: ${chat.title}` : "Study chat"}
                    enabled={false}
                  />
                ) : (
                  <Loader2 size={13} className="animate-spin text-accent" />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex shrink-0 items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={selectedSourceIds.size === 0 ? "Add sources first…" : "Ask about your sources…"}
            rows={2}
            className="flex-1 resize-y rounded-md border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          {streaming ? (
            <ActionButton onClick={abort} variant="ghost">
              <Square size={13} /> Stop
            </ActionButton>
          ) : (
            <ActionButton onClick={send} disabled={!input.trim() || selectedSourceIds.size === 0}>
              <Send size={13} /> Send
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}
