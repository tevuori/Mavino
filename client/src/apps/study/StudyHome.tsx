// ===== Study Hub: Home / overview =====

import { useState, useEffect } from "react";
import {
  Brain, FileText, HelpCircle, Lightbulb, BookOpen, ListTodo,
  History, Sparkles, ChevronRight, TrendingUp, Clock, MessageSquare, Mic, Plus, Trash2, Link2,
  FolderOpen, Pencil, Presentation, Video, Network,
} from "lucide-react";
import { studyApi, type StudySession } from "../../services/study";
import { flashcardsApi } from "../../services/flashcards";
import { studyWorkspacesApi, type LearningWorkspace } from "../../services/study-workspaces";
import { Loading, ErrorBanner } from "./ui";
import WorkspaceEditor from "./WorkspaceEditor";
import { useWindows } from "../../store/windows";

interface DeckRow { id: string; name: string; color: string; _count: { cards: number }; }

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

const TYPE_META: Record<string, { label: string; icon: typeof Brain; color: string }> = {
  flashcards: { label: "Flashcards", icon: Brain, color: "text-indigo-400" },
  summary: { label: "Summary", icon: FileText, color: "text-sky-400" },
  explain: { label: "Explain", icon: Lightbulb, color: "text-amber-400" },
  study_guide: { label: "Study Guide", icon: BookOpen, color: "text-emerald-400" },
  quiz: { label: "Quiz", icon: HelpCircle, color: "text-pink-400" },
  syllabus: { label: "Syllabus", icon: ListTodo, color: "text-orange-400" },
  chat: { label: "Study Chat", icon: MessageSquare, color: "text-violet-400" },
  podcast: { label: "Podcast", icon: Mic, color: "text-rose-400" },
  teach: { label: "Teach Me", icon: Presentation, color: "text-indigo-400" },
  lecture_notes: { label: "Lecture Notes", icon: Video, color: "text-teal-400" },
};

export default function StudyHome({ onPickMode }: { onPickMode: (m: string, opts?: { workspaceId?: string }) => void }) {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [workspaces, setWorkspaces] = useState<LearningWorkspace[]>([]);
  const [editingWs, setEditingWs] = useState<LearningWorkspace | null>(null);
  const [showWsEditor, setShowWsEditor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const openWindow = useWindows((s) => s.open);

  const loadAll = () => {
    Promise.all([
      studyApi.sessions().then((r) => r.sessions).catch(() => [] as StudySession[]),
      flashcardsApi.listDecks().then((r) => r.decks).catch(() => [] as DeckRow[]),
      studyWorkspacesApi.list().then((r) => r.workspaces).catch(() => [] as LearningWorkspace[]),
    ]).then(([s, d, ws]) => {
      setSessions(s);
      setDecks(d);
      setWorkspaces(ws);
      setLoading(false);
    }).catch((e) => {
      setError(e instanceof Error ? e.message : "Failed to load");
      setLoading(false);
    });
  };

  useEffect(loadAll, []);

  const deleteWorkspace = async (id: string) => {
    try {
      await studyWorkspacesApi.remove(id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete workspace");
    }
  };

  const launchWorkspace = (ws: LearningWorkspace, mode: "chat" | "podcast") => {
    onPickMode(mode, { workspaceId: ws.id });
  };

  const onWsSaved = (w: LearningWorkspace) => {
    setWorkspaces((prev) => [w, ...prev.filter((x) => x.id !== w.id)]);
    setShowWsEditor(false);
    setEditingWs(null);
  };

  const totalCards = decks.reduce((sum, d) => sum + d._count.cards, 0);
  const lastSession = sessions[0];
  const studyCount = sessions.length;

  const quickActions: { mode: string; label: string; icon: typeof Brain; color: string; desc: string }[] = [
    { mode: "teach", label: "Teach Me", icon: Presentation, color: "text-indigo-400", desc: "Interactive live tutoring — Mavino teaches from your sources with voice" },
    { mode: "chat", label: "Ask (grounded)", icon: MessageSquare, color: "text-violet-400", desc: "Q&A grounded in your sources, with citations" },
    { mode: "podcast", label: "Podcast", icon: Mic, color: "text-rose-400", desc: "Audio overview from your sources" },
    { mode: "graph", label: "Knowledge Graph", icon: Network, color: "text-cyan-400", desc: "Extract concepts & relationships once, reuse everywhere" },
    { mode: "lecture", label: "Lecture → Notes", icon: Video, color: "text-teal-400", desc: "Generate notes from a lecture video recording" },
    { mode: "flashcards", label: "Generate Flashcards", icon: Brain, color: "text-indigo-400", desc: "AI Q/A cards from a note or text" },
    { mode: "summarize", label: "Summarize", icon: FileText, color: "text-sky-400", desc: "TL;DR, outline, or key points" },
    { mode: "quiz", label: "Quiz Me", icon: HelpCircle, color: "text-pink-400", desc: "Test yourself, AI-graded" },
    { mode: "explain", label: "Explain", icon: Lightbulb, color: "text-amber-400", desc: "Get a concept explained" },
    { mode: "study_guide", label: "Study Guide", icon: BookOpen, color: "text-emerald-400", desc: "Consolidate notes into a cheat sheet" },
    { mode: "syllabus", label: "Syllabus → Tasks", icon: ListTodo, color: "text-orange-400", desc: "Extract tasks from a syllabus" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {loading && <Loading label="Loading overview…" />}
      {error && <ErrorBanner message={error} />}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1 rounded-lg border border-edge bg-surface-2 p-3">
          <div className="flex items-center gap-1.5 text-ink-muted">
            <Brain size={13} />
            <span className="text-[10px] font-semibold uppercase tracking-wide">Decks</span>
          </div>
          <span className="text-lg font-bold text-ink">{decks.length}</span>
          <span className="text-[10px] text-ink-muted">{totalCards} cards total</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-edge bg-surface-2 p-3">
          <div className="flex items-center gap-1.5 text-ink-muted">
            <TrendingUp size={13} />
            <span className="text-[10px] font-semibold uppercase tracking-wide">Sessions</span>
          </div>
          <span className="text-lg font-bold text-ink">{studyCount}</span>
          <span className="text-[10px] text-ink-muted">all-time study activity</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-edge bg-surface-2 p-3">
          <div className="flex items-center gap-1.5 text-ink-muted">
            <Clock size={13} />
            <span className="text-[10px] font-semibold uppercase tracking-wide">Last studied</span>
          </div>
          <span className="text-sm font-bold text-ink">
            {lastSession ? timeAgo(lastSession.createdAt) : "Never"}
          </span>
          {lastSession && (
            <span className="text-[10px] text-ink-muted truncate">{lastSession.title}</span>
          )}
        </div>
      </div>

      {/* Learning workspaces */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Learning workspaces</span>
          <button
            onClick={() => { setEditingWs(null); setShowWsEditor(true); }}
            className="flex items-center gap-1 text-[10px] text-ink-muted hover:text-ink"
          >
            <Plus size={11} /> New workspace
          </button>
        </div>

        {showWsEditor && (
          <WorkspaceEditor
            workspace={editingWs}
            onSaved={onWsSaved}
            onCancel={() => { setShowWsEditor(false); setEditingWs(null); }}
          />
        )}

        {workspaces.length === 0 && !showWsEditor ? (
          <div className="rounded-lg border border-dashed border-edge bg-surface-2 p-4 text-center">
            <FolderOpen size={22} className="mx-auto mb-1.5 text-ink-muted opacity-40" />
            <p className="text-xs text-ink-muted">
              No workspaces yet. Group your sources into a named workspace so you can open grounded chats and podcasts without re-picking sources each time.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 @3xl:grid-cols-2">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="group flex flex-col gap-2 rounded-lg border border-edge bg-surface-2 p-3"
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ background: ws.color ?? "#6366f1" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{ws.name}</p>
                    {ws.description && (
                      <p className="truncate text-[11px] text-ink-muted">{ws.description}</p>
                    )}
                    <p className="text-[10px] text-ink-muted">{ws.sourceIds.length} source{ws.sourceIds.length === 1 ? "" : "s"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button
                      onClick={() => { setEditingWs(ws); setShowWsEditor(true); }}
                      className="rounded p-1 text-ink-muted hover:text-ink"
                      title="Edit workspace"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => void deleteWorkspace(ws.id)}
                      className="rounded p-1 text-ink-muted hover:text-red-400"
                      title="Delete workspace"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => launchWorkspace(ws, "chat")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-edge bg-surface px-2 py-1.5 text-[11px] font-medium text-ink transition hover:border-accent/50 hover:text-accent"
                  >
                    <MessageSquare size={12} /> Ask
                  </button>
                  <button
                    onClick={() => launchWorkspace(ws, "podcast")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-edge bg-surface px-2 py-1.5 text-[11px] font-medium text-ink transition hover:border-accent/50 hover:text-accent"
                  >
                    <Mic size={12} /> Podcast
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Quick actions</span>
        <div className="grid grid-cols-2 gap-2">
          {quickActions.map((qa) => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.mode}
                onClick={() => onPickMode(qa.mode)}
                className="flex items-center gap-2.5 rounded-lg border border-edge bg-surface-2 p-3 text-left transition hover:border-accent/40 hover:bg-surface-3"
              >
                <Icon size={18} className={`shrink-0 ${qa.color}`} />
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-ink">{qa.label}</span>
                  <span className="text-[10px] text-ink-muted">{qa.desc}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Decks */}
      {decks.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Your decks</span>
          <div className="flex flex-col gap-1.5">
            {decks.slice(0, 5).map((d) => (
              <button
                key={d.id}
                onClick={() => openWindow({ appId: "flashcards", title: "Flashcards", icon: "Brain", payload: { deckId: d.id } })}
                className="flex items-center gap-2.5 rounded-md border border-edge bg-surface-2 px-3 py-2 text-left transition hover:bg-surface-3"
              >
                <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="flex-1 truncate text-xs font-medium text-ink">{d.name}</span>
                <span className="text-[10px] text-ink-muted">{d._count.cards} cards</span>
                <ChevronRight size={14} className="shrink-0 text-ink-muted" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      {sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Recent activity</span>
            <button
              onClick={() => onPickMode("recent")}
              className="flex items-center gap-1 text-[10px] text-ink-muted hover:text-ink"
            >
              <History size={11} /> View all
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {sessions.slice(0, 5).map((s) => {
              const meta = TYPE_META[s.type] ?? { label: s.type, icon: FileText, color: "text-ink-muted" };
              const Icon = meta.icon;
              return (
                <div key={s.id} className="flex items-center gap-2.5 rounded-md border border-edge bg-surface-2 px-3 py-2">
                  <Icon size={14} className={`shrink-0 ${meta.color}`} />
                  <div className="flex flex-1 flex-col">
                    <span className="text-xs font-medium text-ink truncate">{s.title}</span>
                    <span className="text-[10px] text-ink-muted">{meta.label} · {timeAgo(s.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && sessions.length === 0 && decks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Sparkles size={32} className="text-ink-muted opacity-40" />
          <p className="text-sm text-ink-muted">Welcome to Study Hub. Pick a quick action above to get started.</p>
        </div>
      )}
    </div>
  );
}
