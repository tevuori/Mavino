import { useState, useEffect } from "react";
import { CalendarDays, CheckSquare, Home, MoreHorizontal, Sparkles } from "lucide-react";
import MobileHome from "../../mobile/MobileHome";
import MobileTasks from "../../mobile/MobileTasks";
import MobileCalendar from "../../mobile/MobileCalendar";
import MobileAthena from "../../mobile/MobileAthena";
import MobileLauncher, { type MobileTool } from "../../mobile/MobileLauncher";
import MobileToolPage from "../../mobile/MobileToolPage";
import { useAuth } from "../../store/auth";
import { useSettings } from "../../store/settings";

export type MobileRoute = "home" | "tasks" | "calendar" | "athena" | "more";

const TABS: { id: Exclude<MobileRoute, "more">; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "calendar", label: "Plan", icon: CalendarDays },
  { id: "athena", label: "Mavino", icon: Sparkles },
];

export default function MobileShell() {
  const [route, setRoute] = useState<MobileRoute>("home");
  const [tool, setTool] = useState<MobileTool | null>(null);
  const { user, logout } = useAuth();
  const setHasOnboarded = useSettings((s) => s.setHasOnboarded);
  const isDemo = user?.role === "DEMO";

  // Demo bootstrap: skip onboarding and auto-open Study tool once after login.
  useEffect(() => {
    if (!isDemo) return;
    setHasOnboarded(true);
    if (sessionStorage.getItem("demo-just-logged-in") === "1") {
      sessionStorage.removeItem("demo-just-logged-in");
      setRoute("home");
      setTool("study");
    }
  }, [isDemo, setHasOnboarded, setRoute, setTool]);

  // Switching to any primary tab (or the More launcher) closes an open tool
  // so the tool page is replaced by the destination, not stacked under it.
  const navigate = (r: MobileRoute) => {
    setTool(null);
    setRoute(r);
  };

  return (
    <main className="relative flex h-full w-full overflow-hidden bg-slate-950 text-slate-100" aria-label="Mavino mobile">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(99,102,241,.22),transparent_34%),radial-gradient(circle_at_100%_18%,rgba(14,165,233,.12),transparent_28%)]" />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {isDemo && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
            <span>Demo mode</span>
            <button
              onClick={logout}
              className="rounded-md bg-amber-500/20 px-2 py-0.5 font-medium text-amber-100 transition hover:bg-amber-500/30"
            >
              Sign up / Log in
            </button>
          </div>
        )}
        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-24">
          {tool ? (
            <MobileToolPage
              tool={tool}
              onClose={() => { setTool(null); setRoute("home"); }}
              onOpenTool={(nextTool) => setTool(nextTool)}
            />
          ) : (
            <>
              {route === "home" && <MobileHome onNavigate={navigate} />}
              {route === "tasks" && <MobileTasks />}
              {route === "calendar" && <MobileCalendar />}
              {route === "athena" && <MobileAthena />}
              {route === "more" && <MobileLauncher onClose={() => setRoute("home")} onOpen={(nextTool) => setTool(nextTool)} />}
            </>
          )}
        </section>
        <nav className="absolute inset-x-0 bottom-0 z-20 w-full border-t border-white/10 bg-slate-950/90 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl" aria-label="Primary navigation">
          <div className="mx-auto flex w-full max-w-md items-stretch justify-between gap-0.5">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = route === id && !tool;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigate(id)}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition ${active ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400"}`}
                >
                  <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => navigate("more")}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition ${route === "more" && !tool ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400"}`}
            >
              <MoreHorizontal size={20} strokeWidth={route === "more" && !tool ? 2.5 : 2} />
              More
            </button>
          </div>
        </nav>
      </div>
    </main>
  );
}
