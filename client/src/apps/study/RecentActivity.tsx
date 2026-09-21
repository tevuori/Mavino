// ===== Study Hub: Recent Activity =====

import { useState, useEffect } from "react";
import { Brain, FileText, HelpCircle, Lightbulb, BookOpen, ListTodo, RefreshCw, ChevronRight, MessageSquare, Mic, Presentation } from "lucide-react";
import { studyApi, type StudySession } from "../../services/study";
import { Loading, ErrorBanner } from "./ui";
import { useWindows } from "../../store/windows";

const TYPE_META: Record<string, { label: string; icon: typeof Brain; color: string }> = {
  flashcards: { label: "Flashcards", icon: Brain, color: "text-indigo-400" },
  summary: { label: "Summary", icon: FileText, color: "text-sky-400" },
  quiz: { label: "Quiz", icon: HelpCircle, color: "text-amber-400" },
  explain: { label: "Explain", icon: Lightbulb, color: "text-yellow-400" },
  study_guide: { label: "Study Guide", icon: BookOpen, color: "text-emerald-400" },
  syllabus: { label: "Tasks", icon: ListTodo, color: "text-rose-400" },
  chat: { label: "Study Chat", icon: MessageSquare, color: "text-violet-400" },
  podcast: { label: "Podcast", icon: Mic, color: "text-rose-400" },
  teach: { label: "Teach Me", icon: Presentation, color: "text-indigo-400" },
};

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

export default function RecentActivity() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const openWindow = useWindows((s) => s.open);

  // Determine the continue action for a session based on its type + meta.
  const continueSession = (s: StudySession) => {
    const meta = s.meta as Record<string, unknown>;
    if (s.type === "flashcards" && meta.deckId) {
      openWindow({ appId: "flashcards", title: "Flashcards", icon: "Brain", payload: { deckId: meta.deckId as string } });
    } else if ((s.type === "summary" || s.type === "explain" || s.type === "study_guide") && meta.noteId) {
      openWindow({ appId: "notes", title: "Notes", icon: "StickyNote", payload: { noteId: meta.noteId as string } });
    } else if (s.type === "quiz" && s.sourceRef && !s.sourceRef.startsWith("paste")) {
      // Restart a quiz from the same source (note/file).
      const mode = "quiz";
      const sourceKind = s.sourceRef.startsWith("paste") ? "paste" : "note";
      openWindow({
        appId: "study",
        title: "Study Hub",
        icon: "GraduationCap",
        payload: sourceKind === "note" ? { mode, sourceKind, sourceId: s.sourceRef } : { mode, sourceKind },
      });
    } else if (s.type === "syllabus") {
      openWindow({ appId: "tasks", title: "Tasks", icon: "CheckSquare" });
    } else if (s.type === "chat" && meta.chatId) {
      openWindow({ appId: "study", title: "Study Hub", icon: "GraduationCap", payload: { mode: "chat", chatId: meta.chatId as string } });
    } else if (s.type === "podcast" && meta.podcastId) {
      openWindow({ appId: "study", title: "Study Hub", icon: "GraduationCap", payload: { mode: "podcast", podcastId: meta.podcastId as string } });
    } else if (s.type === "teach" && meta.sessionId) {
      openWindow({ appId: "study", title: "Study Hub", icon: "GraduationCap", payload: { mode: "teach", sessionId: meta.sessionId as string } });
    }
  };

  // Whether a session has a continue action.
  const canContinue = (s: StudySession): boolean => {
    const meta = s.meta as Record<string, unknown>;
    if (s.type === "flashcards" && meta.deckId) return true;
    if ((s.type === "summary" || s.type === "explain" || s.type === "study_guide") && meta.noteId) return true;
    if (s.type === "quiz" && s.sourceRef && !s.sourceRef.startsWith("paste")) return true;
    if (s.type === "syllabus") return true;
    if (s.type === "chat" && meta.chatId) return true;
    if (s.type === "podcast" && meta.podcastId) return true;
    if (s.type === "teach" && meta.sessionId) return true;
    return false;
  };

  const load = () => {
    setLoading(true);
    setError("");
    studyApi
      .sessions()
      .then((r) => setSessions(r.sessions))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-muted">Recent study sessions</span>
        <button
          onClick={load}
          className="flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-2 hover:text-ink"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      {loading && <Loading label="Loading…" />}
      {error && <ErrorBanner message={error} />}
      {!loading && sessions.length === 0 && (
        <div className="rounded-lg border border-edge bg-surface-2 p-6 text-center text-xs text-ink-muted">
          No study sessions yet. Generate flashcards, summarize a note, or take a quiz to get started.
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {sessions.map((s) => {
          const meta = TYPE_META[s.type] ?? { label: s.type, icon: FileText, color: "text-ink-muted" };
          const Icon = meta.icon;
          const extra =
            s.type === "flashcards"
              ? `${(s.meta as any).cardCount ?? 0} cards`
              : s.type === "quiz"
              ? `${(s.meta as any).score ?? 0}%`
              : s.type === "syllabus"
              ? `${(s.meta as any).created ?? 0} tasks`
              : s.type === "chat"
              ? `${(s.meta as any).citations ?? 0} citations`
              : s.type === "podcast"
              ? `${(s.meta as any).sourceCount ?? 0} sources`
              : null;
          const continuable = canContinue(s);
          return (
            <button
              key={s.id}
              onClick={() => continuable && continueSession(s)}
              disabled={!continuable}
              className={`flex items-center gap-3 rounded-md border border-edge bg-surface-2 px-3 py-2 text-left transition ${
                continuable ? "hover:bg-surface-3 cursor-pointer" : "cursor-default"
              }`}
            >
              <Icon size={16} className={`shrink-0 ${meta.color}`} />
              <div className="flex flex-1 flex-col">
                <span className="text-xs font-medium text-ink">{s.title}</span>
                <span className="text-[10px] text-ink-muted">
                  {meta.label} · {timeAgo(s.createdAt)}
                </span>
              </div>
              {extra && <span className="text-[11px] text-ink-muted">{extra}</span>}
              {continuable && <ChevronRight size={14} className="shrink-0 text-ink-muted" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
