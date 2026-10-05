import { BarChart3, Brain, Languages, Library, Mic, Network, Presentation, Sparkles, Video } from "lucide-react";
import type { WindowInstance } from "../../store/windows";
import { useWindows } from "../../store/windows";
import { useLanguage, type LanguagePreference } from "../../store/language";
import TeacherMode from "../study/TeacherMode";
import TeachAccessBoundary from "./TeachAccessBoundary";

const TOOLS = [
  { label: "Study Hub", icon: Library, appId: "study", title: "Study Hub", appIcon: "GraduationCap", payload: undefined },
  { label: "Quiz me", icon: Sparkles, appId: "study", title: "Study Hub", appIcon: "GraduationCap", payload: { mode: "quiz" } },
  { label: "Podcast", icon: Mic, appId: "study", title: "Study Hub", appIcon: "GraduationCap", payload: { mode: "podcast" } },
  { label: "Lecture → Notes", icon: Video, appId: "study", title: "Study Hub", appIcon: "GraduationCap", payload: { mode: "lecture" } },
  { label: "Knowledge Graph", icon: Network, appId: "study", title: "Study Hub", appIcon: "GraduationCap", payload: { mode: "graph" } },
  { label: "Flashcards", icon: Brain, appId: "flashcards", title: "Flashcards", appIcon: "Brain", payload: undefined },
  { label: "Progress", icon: BarChart3, appId: "analytics", title: "Analytics", appIcon: "BarChart3", payload: undefined },
] as const;

export default function TeachApp({ win }: { win: WindowInstance }) {
  const openWindow = useWindows((state) => state.open);
  const globalLanguage = useLanguage((state) => state.language);
  const preference = useLanguage((state) => state.overrides.teach);
  const setLanguageOverride = useLanguage((state) => state.setOverride);
  const language = preference === "global" ? globalLanguage : preference;
  const initialSessionId = typeof win.payload?.sessionId === "string" ? win.payload.sessionId : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-32 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-64 w-96 rounded-full bg-accent/5 blur-3xl" />
      </div>

      <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-white/10 bg-surface/75 px-4 py-3 backdrop-blur-xl">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-accent to-cyan-400 text-white shadow-lg shadow-violet-500/20">
          <Presentation size={20} />
          <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface bg-cyan-300" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-tight text-ink">Teach Me</h1>
            <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-violet-300">Learning studio</span>
          </div>
          <p className="truncate text-[11px] text-ink-muted">Your adaptive, source-grounded classroom</p>
        </div>

        <nav className="ml-auto hidden items-center gap-1 @3xl:flex">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.label}
                onClick={() => openWindow({ appId: tool.appId, title: tool.title, icon: tool.appIcon, payload: tool.payload })}
                className="group flex items-center gap-1.5 rounded-xl border border-transparent px-2.5 py-2 text-[11px] font-medium text-ink-muted transition hover:border-white/10 hover:bg-white/5 hover:text-ink"
              >
                <Icon size={13} className="transition group-hover:text-accent" />
                {tool.label}
              </button>
            );
          })}
        </nav>

        <label className="flex shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] font-medium text-ink-muted">
          <Languages size={12} />
          <select
            value={preference}
            onChange={(event) => setLanguageOverride("teach", event.target.value as LanguagePreference)}
            className="bg-transparent outline-none"
            title="Teaching language"
          >
            <option value="global">{globalLanguage.toUpperCase()}</option>
            <option value="en">EN</option>
            <option value="cs">CS</option>
          </select>
        </label>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col p-3 @3xl:p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface/80 p-3 shadow-2xl shadow-black/10 backdrop-blur-md @3xl:p-4">
          <TeachAccessBoundary>
            <TeacherMode initialSessionId={initialSessionId} language={language} />
          </TeachAccessBoundary>
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 items-center justify-around border-t border-white/10 bg-surface/85 px-2 py-1.5 backdrop-blur-xl @3xl:hidden">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.label}
              onClick={() => openWindow({ appId: tool.appId, title: tool.title, icon: tool.appIcon, payload: tool.payload })}
              className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[9px] text-ink-muted hover:bg-white/5 hover:text-ink"
            >
              <Icon size={14} />
              {tool.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
