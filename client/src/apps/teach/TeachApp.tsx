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
        <div className="absolute -left-24 -top-32 h-96 w-96 rounded-full bg-accent/8 blur-3xl" />
        <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-info/8 blur-3xl" />
      </div>

      <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-edge bg-surface-2/90 px-4 py-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
          <Presentation size={20} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-tight text-ink">Teach Me</h1>
            <span className="rounded-full border border-accent/20 bg-accent-soft px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-accent">Learning studio</span>
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
                className="group flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-2 text-[11px] font-medium text-ink-muted transition hover:border-edge hover:bg-surface-3 hover:text-ink"
              >
                <Icon size={13} className="transition group-hover:text-accent" />
                {tool.label}
              </button>
            );
          })}
        </nav>

        <label className="flex shrink-0 items-center gap-1 rounded-lg border border-edge bg-surface px-2 py-1.5 text-[10px] font-medium text-ink-muted">
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge bg-surface p-3 shadow-sm @3xl:p-4">
          <TeachAccessBoundary>
            <TeacherMode initialSessionId={initialSessionId} language={language} />
          </TeachAccessBoundary>
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 items-center justify-around border-t border-edge bg-surface-2 px-2 py-1.5 @3xl:hidden">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.label}
              onClick={() => openWindow({ appId: tool.appId, title: tool.title, icon: tool.appIcon, payload: tool.payload })}
              className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[9px] text-ink-muted hover:bg-surface-3 hover:text-ink"
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
