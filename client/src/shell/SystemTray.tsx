import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Volume2, VolumeX, BellOff } from "lucide-react";
import { useSettings } from "../store/settings";
import { useNotifications } from "../store/notifications";

export default function SystemTray() {
  const { volume, setVolume, doNotDisturb, setDoNotDisturb, notificationsEnabled } = useSettings();
  const { items, unreadCount, markRead, dismiss, clearAll } = useNotifications();
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
              {items.length > 0 && (
                <button onClick={clearAll} className="text-[11px] text-accent hover:underline">
                  Clear all
                </button>
              )}
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {items.length === 0 ? (
                <p className="py-6 text-center text-xs text-ink-muted">No notifications</p>
              ) : (
                items.map((n) => (
                  <div
                    key={n.id}
                    className={`rounded-lg border p-2.5 text-left transition ${
                      n.read ? "border-edge bg-surface" : "border-accent/30 bg-accent/5"
                    }`}
                    onClick={() => markRead(n.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-ink">{n.title}</p>
                        <p className="mt-0.5 text-[11px] text-ink-muted">{n.body}</p>
                        <p className="mt-1 text-[10px] text-ink-muted/70">{n.app}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismiss(n.id);
                        }}
                        className="text-ink-muted hover:text-ink"
                      >
                        <span className="text-xs">×</span>
                      </button>
                    </div>
                  </div>
                ))
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
