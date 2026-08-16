import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import * as Lucide from "lucide-react";
import { Bell, Volume2, VolumeX, Wifi, BatteryFull, BellOff, CheckCheck, X } from "lucide-react";
import { useSettings } from "../store/settings";
import { useNotifications } from "../store/notifications";
import { useWindows, type AppId } from "../store/windows";

export default function SystemTray() {
  const { volume, setVolume, doNotDisturb, setDoNotDisturb, notificationsEnabled } = useSettings();
  const { persistent, ephemeral, unreadCount, markRead, markEphemeralRead, dismiss, dismissEphemeral, markAllRead } = useNotifications();
  const { open: openWindow } = useWindows();
  const [now, setNow] = useState(new Date());
  const [showVolume, setShowVolume] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const unread = unreadCount();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  // Merge persistent + ephemeral into a single sorted list for display.
  const allItems = [
    ...persistent.map((n) => ({
      id: n.id,
      kind: "persistent" as const,
      title: n.title,
      body: n.body,
      icon: n.icon,
      app: n.category,
      read: n.read,
      createdAt: n.createdAt,
      linkApp: n.linkApp,
      linkPayload: n.linkPayload,
    })),
    ...ephemeral.map((n) => ({
      id: n.id,
      kind: "ephemeral" as const,
      title: n.title,
      body: n.body,
      icon: "Bell",
      app: n.app,
      read: n.read,
      createdAt: new Date(n.timestamp).toISOString(),
      linkApp: "",
      linkPayload: "",
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const handleClick = (item: (typeof allItems)[number]) => {
    if (item.kind === "persistent") {
      markRead(item.id);
      // Open the linked app if specified.
      if (item.linkApp) {
        let payload: Record<string, unknown> | undefined;
        if (item.linkPayload) {
          try {
            payload = JSON.parse(item.linkPayload);
          } catch {
            /* ignore malformed payload */
          }
        }
        openWindow({
          appId: item.linkApp as AppId,
          title: item.linkApp.charAt(0).toUpperCase() + item.linkApp.slice(1),
          icon: item.icon,
          payload,
        });
      }
    } else {
      markEphemeralRead(item.id);
    }
  };

  return (
    <div className="relative flex items-center gap-1 pl-2">
      {/* Tray widgets */}
      <button
        onClick={() => setShowVolume((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-surface-3 hover:text-ink"
        title="Volume"
      >
        {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
      <div className="hidden h-7 w-7 items-center justify-center text-ink-muted sm:flex" title="Network">
        <Wifi size={15} />
      </div>
      <div className="hidden h-7 w-7 items-center justify-center text-ink-muted sm:flex" title="Battery">
        <BatteryFull size={15} />
      </div>

      {/* Notifications bell */}
      <button
        onClick={() => setShowNotifs((v) => !v)}
        className="relative flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-surface-3 hover:text-ink"
        title="Notifications"
      >
        {doNotDisturb || !notificationsEnabled ? <BellOff size={15} /> : <Bell size={15} />}
        {unread > 0 && !doNotDisturb && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Clock */}
      <button
        onClick={() => setShowCalendar((v) => !v)}
        className="flex flex-col items-end rounded px-2 py-0.5 text-right leading-tight hover:bg-surface-3"
      >
        <span className="text-xs font-medium text-ink">{time}</span>
        <span className="text-[10px] text-ink-muted">{date}</span>
      </button>

      {/* Volume popover */}
      <AnimatePresence>
        {showVolume && (
          <Popover onClose={() => setShowVolume(false)} className="right-0 bottom-9 w-56">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-ink">Volume</span>
              <span className="text-xs text-ink-muted">{volume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <div className="mt-3 flex items-center justify-between border-t border-edge pt-2">
              <span className="text-xs text-ink-muted">Do not disturb</span>
              <Toggle on={doNotDisturb} onClick={() => setDoNotDisturb(!doNotDisturb)} />
            </div>
          </Popover>
        )}
      </AnimatePresence>

      {/* Notifications popover */}
      <AnimatePresence>
        {showNotifs && (
          <Popover onClose={() => setShowNotifs(false)} className="right-0 bottom-9 w-80">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">Notifications</span>
              {allItems.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void markAllRead()}
                    className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                    title="Mark all as read"
                  >
                    <CheckCheck size={11} /> Mark all read
                  </button>
                  <button onClick={() => setShowNotifs(false)} className="text-ink-muted hover:text-ink">
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {allItems.length === 0 ? (
                <p className="py-6 text-center text-xs text-ink-muted">No notifications</p>
              ) : (
                allItems.map((n) => {
                  const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[n.icon] ?? Bell;
                  return (
                    <div
                      key={n.id}
                      className={`group cursor-pointer rounded-lg border p-2.5 text-left transition ${
                        n.read ? "border-edge bg-surface" : "border-accent/30 bg-accent/5"
                      }`}
                      onClick={() => handleClick(n)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                          <Icon size={14} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-ink">{n.title}</p>
                            {n.body && <p className="mt-0.5 text-[11px] text-ink-muted">{n.body}</p>}
                            <p className="mt-1 text-[10px] text-ink-muted/70">{n.app}</p>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (n.kind === "persistent") void dismiss(n.id);
                            else dismissEphemeral(n.id);
                          }}
                          className="text-ink-muted opacity-0 transition group-hover:opacity-100 hover:text-ink"
                        >
                          <span className="text-xs">×</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Popover>
        )}
      </AnimatePresence>

      {/* Calendar popover */}
      <AnimatePresence>
        {showCalendar && (
          <Popover onClose={() => setShowCalendar(false)} className="right-0 bottom-9 w-64">
            <div className="mb-2 text-center">
              <p className="text-sm font-semibold text-ink">
                {now.toLocaleDateString([], { month: "long", year: "numeric" })}
              </p>
            </div>
            <MiniCalendar date={now} />
          </Popover>
        )}
      </AnimatePresence>
    </div>
  );
}

function Popover({
  children,
  onClose,
  className = "",
}: {
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[10500]" onClick={onClose} />
      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 8, opacity: 0 }}
        transition={{ duration: 0.12 }}
        className={`absolute z-[10501] rounded-xl border border-edge bg-surface-2 p-3 shadow-window ${className}`}
      >
        {children}
      </motion.div>
    </>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative h-5 w-9 rounded-full transition ${on ? "bg-accent" : "bg-surface-3"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
          on ? "left-4.5" : "left-0.5"
        }`}
        style={{ left: on ? "1.125rem" : "0.125rem" }}
      />
    </button>
  );
}

function MiniCalendar({ date }: { date: Date }) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = date.getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] text-ink-muted">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {cells.map((d, i) => (
          <div
            key={i}
            className={`flex h-7 items-center justify-center rounded text-[11px] ${
              d === today
                ? "bg-accent font-semibold text-accent-fg"
                : d
                ? "text-ink hover:bg-surface-3"
                : ""
            }`}
          >
            {d ?? ""}
          </div>
        ))}
      </div>
    </div>
  );
}
