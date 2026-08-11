import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowUp,
  Sparkles,
  Square,
  Paperclip,
  X,
  Loader2,
  Wrench,
  AlertCircle,
  Plus,
  History,
  MessageSquare,
  Trash2,
  FileCode,
  FileType,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  streamAthenaChat,
  attachFile,
  type AthenaMessage,
  type AthenaToolEvent,
  type AthenaAttachment,
  type AthenaChatHandle,
} from "../services/athena";
import {
  conversationsApi,
  type ConversationSummary,
  type ConversationMessage,
} from "../services/conversations";

interface ChatTurn extends AthenaMessage {
  tools?: AthenaToolEvent[];
  pending?: boolean;
  error?: string;
}

const SUGGESTIONS = [
  "Plan my study session",
  "Explain this simply",
  "What should I do today?",
];

const ATTACH_ACCEPT =
  ".pdf,.txt,.c,.h,.cpp,.cc,.cxx,.hpp,.java,.ts,.tsx,.js,.jsx,.py,.md";

export default function MobileAthena() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AthenaChatHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pinned file attachment — persists across multiple sends until removed.
  const [attachment, setAttachment] = useState<AthenaAttachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Conversation history.
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);

  // Refs to track latest values inside stream callbacks (avoid stale closures).
  const turnsRef = useRef<ChatTurn[]>([]);
  turnsRef.current = turns;
  const activeConvIdRef = useRef<string | null>(null);
  activeConvIdRef.current = activeConvId;
  const conversationsRef = useRef<ConversationSummary[]>([]);
  conversationsRef.current = conversations;
  const titleGeneratingRef = useRef(false);

  // Auto-scroll to bottom on new content / tool events.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Persist the active conversation on unmount.
  useEffect(() => {
    return () => {
      const convId = activeConvIdRef.current;
      const t = turnsRef.current;
      if (!convId || t.length === 0) return;
      const messages: ConversationMessage[] = t
        .filter((x) => !x.error && x.content.trim())
        .map((x) => ({ role: x.role, content: x.content, tools: x.tools }));
      if (messages.length === 0) return;
      conversationsApi.update(convId, { messages }).catch((e) => {
        console.error("[mobile-athena] save on unmount failed:", e);
      });
    };
  }, []);

  // On mount: load conversation list, resume active or create new.
  useEffect(() => {
    (async () => {
      try {
        const { conversations: list } = await conversationsApi.list();
        setConversations(list);
        const active = list.find((c) => c.status === "active");
        if (active) {
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
          const { conversation: conv } = await conversationsApi.create();
          setActiveConvId(conv.id);
          setConversations((prev) => [conv, ...prev]);
        }
      } catch (e) {
        console.error("[mobile-athena] failed to load conversations:", e);
      }
    })();
  }, []);

  const saveConversation = useCallback(async (currentTurns: ChatTurn[]) => {
    const convId = activeConvIdRef.current;
    if (!convId) return;
    const messages: ConversationMessage[] = currentTurns
      .filter((t) => !t.error && t.content.trim())
      .map((t) => ({ role: t.role, content: t.content, tools: t.tools }));
    if (messages.length === 0) return;
    try {
      await conversationsApi.update(convId, { messages });
      const { conversations: list } = await conversationsApi.list();
      setConversations(list);
    } catch (e) {
      console.error("[mobile-athena] failed to save conversation:", e);
    }
  }, []);

  const isGeneratedTitle = (title?: string | null) =>
    !!title && title.trim().toLowerCase() !== "new chat";

  const maybeGenerateTitle = useCallback(async () => {
    const convId = activeConvIdRef.current;
    if (!convId || titleGeneratingRef.current) return;
    const currentTitle = conversationsRef.current.find((c) => c.id === convId)?.title;
    if (isGeneratedTitle(currentTitle)) return;
    const t = turnsRef.current;
    if (t.length < 2) return;
    titleGeneratingRef.current = true;
    try {
      const { title } = await conversationsApi.generateTitle(convId);
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title } : c)));
    } catch (e) {
      console.error("[mobile-athena] title generation failed:", e);
    } finally {
      titleGeneratingRef.current = false;
    }
  }, []);

  const startNewChat = useCallback(async () => {
    if (streaming) return;
    if (turnsRef.current.length > 0) await saveConversation(turnsRef.current);
    try {
      const { conversation: conv } = await conversationsApi.create();
      setActiveConvId(conv.id);
      titleGeneratingRef.current = false;
      setTurns([]);
      setConversations((prev) => [conv, ...prev]);
    } catch (e) {
      console.error("[mobile-athena] failed to create conversation:", e);
    }
  }, [streaming, saveConversation]);

  const loadConversation = useCallback(async (id: string) => {
    if (streaming) return;
    setLoadingConv(true);
    try {
      const { conversation } = await conversationsApi.get(id);
      if (activeConvIdRef.current && activeConvIdRef.current !== id && turnsRef.current.length > 0) {
        await saveConversation(turnsRef.current);
      }
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
      const { conversations: list } = await conversationsApi.list();
      setConversations(list);
    } catch (e) {
      console.error("[mobile-athena] failed to load conversation:", e);
    } finally {
      setLoadingConv(false);
    }
  }, [streaming, saveConversation]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await conversationsApi.delete(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === activeConvIdRef.current) {
        const { conversation: conv } = await conversationsApi.create();
        setActiveConvId(conv.id);
        titleGeneratingRef.current = false;
        setTurns([]);
        setConversations((prev) => [conv, ...prev.filter((c) => c.id !== id)]);
      }
    } catch (e) {
      console.error("[mobile-athena] failed to delete conversation:", e);
    }
  }, []);

  // ===== File attachment =====

  const handleFileSelect = async (file: File) => {
    setAttaching(true);
    setAttachError(null);
    try {
      const result = await attachFile(file);
      setAttachment(result); // pinned — stays until user removes it
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setAttaching(false);
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
    setAttachError(null);
  };

  // ===== Send =====

  const send = useCallback(
    (text: string) => {
      let content = text.trim();
      if (!content || streaming) return;

      // Inject pinned attachment content into the message. The attachment is
      // NOT cleared after sending — it stays pinned so the user can ask
      // follow-up questions about the same file. It's only removed when the
      // user taps the X on the chip.
      if (attachment) {
        const fileLabel = attachment.fileType === "pdf" ? "PDF document" : `${attachment.fileType} file`;
        const truncationNote = attachment.truncated
          ? "\n_(content truncated — first 50,000 characters shown)_"
          : "";
        content = `I've attached a ${fileLabel}: **${attachment.fileName}** (${(attachment.fileSize / 1024).toFixed(1)} KB)\n\nFile content:\n\`\`\`\n${attachment.text}${truncationNote}\n\`\`\`\n\n${content}`;
      }

      // Build conversation history for the server, maintaining alternating
      // user/assistant roles (some providers reject consecutive same-role).
      const history: AthenaMessage[] = [
        ...turns
          .filter((t) => !t.error)
          .map((t) => {
            if (t.role === "assistant" && !t.content.trim()) {
              const toolNames = (t.tools ?? []).map((tc) => tc.name).join(", ");
              return { role: "assistant" as const, content: toolNames ? `(Completed: ${toolNames})` : "(Done)" };
            }
            return { role: t.role, content: t.content };
          })
          .filter((t) => t.content.trim()),
        { role: "user", content },
      ];

      const userTurn: ChatTurn = { role: "user", content };
      const assistantTurn: ChatTurn = { role: "assistant", content: "", tools: [], pending: true };
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      setDraft("");
      setStreaming(true);

      const handle = streamAthenaChat(history, {
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
          setTimeout(async () => {
            await saveConversation(finalTurns);
            await maybeGenerateTitle();
          }, 100);
        },
      });
      abortRef.current = handle;
      void handle.done.finally(() => setStreaming(false));
    },
    [turns, streaming, attachment, saveConversation, maybeGenerateTitle]
  );

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
    setTurns((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === "assistant" && last.pending) {
        next[next.length - 1] = { ...last, pending: false, content: last.content || "_(stopped)_" };
      }
      return next;
    });
  };

  const activeConvTitle = conversations.find((c) => c.id === activeConvId)?.title;

  return (
    <div className="mx-auto flex h-full min-w-0 max-w-md flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
      {/* Header */}
      <header className="mb-3 flex items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <Sparkles size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-ink">Mavino</h1>
          <p className="truncate text-xs text-ink-muted">
            {streaming ? "working…" : activeConvTitle && activeConvTitle !== "New Chat" ? activeConvTitle : "Your study copilot"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void startNewChat()}
          disabled={streaming}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:bg-surface-3 disabled:opacity-40"
          title="New chat"
        >
          <Plus size={18} />
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          disabled={loadingConv}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:bg-surface-3 disabled:opacity-40"
          title="Chat history"
        >
          <History size={18} />
        </button>
      </header>

      {/* Messages (scrollable) */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-3">
        {turns.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-accent/20 bg-accent/10 p-5">
            <p className="font-semibold text-ink">What are you working on?</p>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              Ask me to make a plan, clarify a concept, turn a syllabus into tasks, or help you get unstuck.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setDraft(prompt)}
                  className="rounded-full border border-edge px-3 py-2 text-xs text-accent"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((turn, i) => (
              <TurnBubble key={i} turn={turn} />
            ))}
          </div>
        )}
      </div>

      {/* Pinned attachment chip */}
      {attachment && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
          {attachment.fileType === "pdf" ? (
            <FileType size={15} className="shrink-0 text-rose-400" />
          ) : (
            <FileCode size={15} className="shrink-0 text-accent" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{attachment.fileName}</span>
          <span className="shrink-0 text-[10px] text-ink-muted">{(attachment.fileSize / 1024).toFixed(1)} KB</span>
          {attachment.truncated && <span className="shrink-0 text-[10px] text-amber-400">truncated</span>}
          <button
            type="button"
            onClick={removeAttachment}
            className="shrink-0 rounded p-0.5 text-ink-muted active:text-rose-400"
            title="Remove attachment"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {attachError && (
        <div className="mb-2 flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <AlertCircle size={13} /> {attachError}
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(draft); }}
        className="mb-3 flex items-end gap-2 rounded-2xl border border-edge bg-surface-2 p-2"
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={attaching || streaming}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:bg-surface-3 disabled:opacity-40"
          title="Attach file (PDF, TXT, code) — pinned to conversation"
        >
          {attaching ? <Loader2 size={17} className="animate-spin" /> : <Paperclip size={18} />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACH_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFileSelect(f);
            e.target.value = "";
          }}
        />
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={1}
          placeholder={attachment ? "Ask about the attached file…" : "Ask Mavino anything…"}
          className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        {streaming ? (
          <button
            type="button"
            onClick={stop}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink"
            title="Stop"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim() && !attachment}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-ink disabled:opacity-40"
            title="Send"
          >
            <ArrowUp size={19} />
          </button>
        )}
      </form>

      {/* History sheet */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface/95 backdrop-blur-xl">
          <header className="flex items-center gap-3 px-5 pb-3 pt-[max(1.5rem,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-ink active:bg-surface-3"
            >
              <X size={21} />
            </button>
            <div>
              <p className="text-sm font-medium text-accent">Previous chats</p>
              <h1 className="text-2xl font-bold text-ink">History</h1>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            {conversations.length === 0 ? (
              <p className="mt-10 text-center text-sm text-ink-muted">No conversations yet.</p>
            ) : (
              <div className="space-y-2">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => void loadConversation(conv.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left active:scale-[.99] ${
                      conv.id === activeConvId
                        ? "border-indigo-400/40 bg-accent/10"
                        : "border-edge bg-surface-2"
                    }`}
                  >
                    <MessageSquare
                      size={18}
                      className={`shrink-0 ${conv.status === "active" ? "text-accent" : "text-ink-muted"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{conv.title}</p>
                      <p className="text-[11px] text-ink-muted">
                        {new Date(conv.lastMessageAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        {" · "}
                        {new Date(conv.lastMessageAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        {conv.status === "active" && " · active"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void deleteConversation(conv.id); }}
                      className="shrink-0 rounded-lg p-1.5 text-ink-muted active:text-rose-400"
                      title="Delete conversation"
                    >
                      <Trash2 size={16} />
                    </button>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Message bubble with tool chips + LaTeX =====

function TurnBubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] ${isUser ? "" : "w-full"}`}>
        {/* Tool chips — show running/completed/error state so the user can
            see Athena is working (not stuck). */}
        {!isUser && turn.tools && turn.tools.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {turn.tools.map((t) => (
              <ToolChip key={t.id} tool={t} />
            ))}
          </div>
        )}
        <div
          className={`rounded-3xl px-4 py-3 text-sm leading-6 ${
            isUser ? "bg-accent text-ink" : "border border-edge bg-surface-2 text-ink"
          }`}
        >
          {turn.content ? (
            isUser ? (
              <span className="whitespace-pre-wrap">{turn.content}</span>
            ) : (
              <div className="selectable markdown-body prose-sm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {turn.content}
                </ReactMarkdown>
              </div>
            )
          ) : turn.pending ? (
            <span className="flex items-center gap-1.5 text-ink-muted">
              <Loader2 size={13} className="animate-spin" /> thinking…
            </span>
          ) : null}
          {turn.error && (
            <span className="mt-1 flex items-center gap-1.5 text-xs text-rose-400">
              <AlertCircle size={12} /> {turn.error}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolChip({ tool }: { tool: AthenaToolEvent }) {
  const color =
    tool.state === "completed"
      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
      : tool.state === "error"
      ? "text-rose-400 border-rose-500/30 bg-rose-500/10"
      : tool.state === "canceled"
      ? "text-ink-muted border-edge bg-surface-2"
      : "text-accent border-accent/30 bg-accent/10";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${color}`}>
      <Wrench size={9} />
      {tool.name}
      {tool.state === "running" || tool.state === "preparing" ? (
        <Loader2 size={9} className="animate-spin" />
      ) : null}
      <span className="opacity-70">· {tool.state}</span>
    </span>
  );
}
