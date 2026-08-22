import { useState, useEffect } from "react";
import { CalendarDays, CheckSquare, Home, MoreHorizontal } from "lucide-react";
import MobileHome from "../../mobile/MobileHome";
import MobileTasks from "../../mobile/MobileTasks";
import MobileCalendar from "../../mobile/MobileCalendar";
import MobileAthena from "../../mobile/MobileAthena";
import MobileLauncher, { type MobileTool } from "../../mobile/MobileLauncher";
import MobileToolPage, { type MobileToolPayload } from "../../mobile/MobileToolPage";
import { useAuth } from "../../store/auth";
import { useSettings } from "../../store/settings";
import AppLogo from "../AppLogo";

export type MobileRoute = "home" | "tasks" | "calendar" | "athena" | "more";

/** Order matters — drives the sliding active-tab indicator's position. */
const ROUTE_ORDER: MobileRoute[] = ["home", "tasks", "calendar", "athena", "more"];

const TABS: { id: Exclude<MobileRoute, "more">; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

export default function MobileShell() {
  const [route, setRoute] = useState<MobileRoute>("home");
  const [tool, setTool] = useState<MobileTool | null>(null);
  const [toolPayload, setToolPayload] = useState<MobileToolPayload | null>(null);
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
    setToolPayload(null);
    setRoute(r);
  };

  const openTool = (nextTool: MobileTool, payload?: MobileToolPayload) => {
    setTool(nextTool);
    setToolPayload(payload ?? null);
  };

  const closeTool = () => {
    setTool(null);
    setToolPayload(null);
    // Deliberately don't touch `route` here — it already reflects whichever
    // screen the tool was opened from (Home, or the "More" launcher), so
    // closing the tool naturally reveals that screen again instead of
    // always bouncing back to Home.
  };

  const activeIndex = tool ? -1 : ROUTE_ORDER.indexOf(route);

  return (
    <main className="mobile-shell relative flex h-full w-full overflow-hidden bg-surface text-ink" aria-label="Mavino mobile">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgb(var(--brand-violet)/.16),transparent_34%),radial-gradient(circle_at_100%_18%,rgb(var(--brand-cyan)/.10),transparent_28%)]" />
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
              payload={toolPayload}
              onClose={closeTool}
              onOpenTool={openTool}
            />
          ) : (
            <>
              {route === "home" && <MobileHome onNavigate={navigate} onOpenTool={openTool} />}
              {route === "tasks" && <MobileTasks />}
              {route === "calendar" && <MobileCalendar />}
              {route === "athena" && <MobileAthena />}
              {route === "more" && <MobileLauncher onClose={() => setRoute("home")} onOpen={openTool} />}
            </>
          )}
        </section>
        <nav className="absolute inset-x-0 bottom-0 z-20 w-full border-t border-edge bg-surface/90 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl" aria-label="Primary navigation">
          <div className="relative mx-auto flex w-full max-w-md items-stretch justify-between gap-0.5">
            {/* Sliding active-tab indicator — a soft brand-gradient pill instead of an
                instant background swap, so switching tabs feels like a single
                continuous motion rather than five identical toggle buttons. */}
            <div
              aria-hidden
              className={`brand-gradient pointer-events-none absolute inset-y-0.5 rounded-2xl opacity-[0.14] transition-[transform,opacity] duration-300 ease-out ${activeIndex < 0 ? "opacity-0" : ""}`}
              style={{ width: `${100 / ROUTE_ORDER.length}%`, transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }}
            />
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = route === id && !tool;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => navigate(id)}
                  className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition ${active ? "text-accent" : "text-ink-muted"}`}
                >
                  <Icon size={21} strokeWidth={active ? 2.4 : 1.8} />
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => navigate("athena")}
              className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition ${route === "athena" && !tool ? "text-accent" : "text-ink-muted"}`}
            >
              <AppLogo size={21} className={`transition ${route === "athena" && !tool ? "" : "opacity-60 grayscale"}`} />
              Mavino
            </button>
            <button
              type="button"
              onClick={() => navigate("more")}
              className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition ${route === "more" && !tool ? "text-accent" : "text-ink-muted"}`}
            >
              <MoreHorizontal size={21} strokeWidth={route === "more" && !tool ? 2.4 : 1.8} />
              More
            </button>
          </div>
        </nav>
      </div>
    </main>
  );
}
