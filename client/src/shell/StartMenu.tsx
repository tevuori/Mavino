import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Lucide from "lucide-react";
import { Search, Power, LogOut, Lock, Pin, PinOff } from "lucide-react";
import { useAccessibleApps } from "../store/features";
import { useWindows, type AppId } from "../store/windows";
import { useAuth } from "../store/auth";
import { useSettings } from "../store/settings";
import { getAppAccent } from "../apps/registry";

interface Props {
  open: boolean;
  onClose: () => void;
  onTogglePin?: (appId: AppId, pinned: boolean) => void;
}

export default function StartMenu({ open, onClose, onTogglePin }: Props) {
  const { open: openWindow } = useWindows();
  const { user, logout } = useAuth();
  const apps = useAccessibleApps();
  const dockFavorites = useSettings((s) => s.dockFavorites);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = apps.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase())
  );

  const launch = (id: typeof apps[number]) => {
    openWindow({ appId: id.id, title: id.name, icon: id.icon });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[11000]" onClick={onClose} />
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed bottom-28 left-1/2 z-[11001] w-[540px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-3xl border border-white/[0.08] bg-surface/90 p-5 shadow-2xl backdrop-blur-2xl"
          >
            {/* Search */}
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 px-4 py-3">
              <Search size={18} className="text-ink-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apps..."
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
              />
            </div>

            {/* App grid */}
            <div className="mb-5 grid grid-cols-5 gap-3">
              {filtered.map((app) => {
                const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[app.icon] ?? Lucide.AppWindow;
                const isPinned = dockFavorites.includes(app.id);
                const accent = getAppAccent(app.id);
                return (
                  <div
                    key={app.id}
                    className="group relative flex flex-col items-center gap-2 rounded-2xl p-2 transition hover:bg-white/[0.06]"
                  >
                    <button
                      onClick={() => launch(app)}
                      className="flex flex-col items-center gap-2"
                    >
                      <div
                        className={`relative flex h-14 w-14 items-center justify-center rounded-2xl ${accent.bg} ${accent.text} shadow-sm ring-1 ring-white/5 transition group-hover:scale-105 group-hover:shadow-md`}
                      >
                        <Icon size={26} />
                        {app.access === "preview" && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-amber-500 shadow-sm ring-1 ring-edge">
                            <Lock size={9} />
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-ink">{app.name}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin?.(app.id, !isPinned);
                      }}
                      className={`absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-xl opacity-0 transition group-hover:opacity-100 ${
                        isPinned ? "text-accent opacity-100" : "text-ink-muted hover:text-ink hover:bg-surface-3"
                      }`}
                      title={isPinned ? "Unpin from dock" : "Pin to dock"}
                    >
                      {isPinned ? <Pin size={14} /> : <PinOff size={14} />}
                    </button>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <p className="col-span-5 py-6 text-center text-sm text-ink-muted">No apps found</p>
              )}
            </div>

            {/* Footer: user + power */}
            <div className="flex items-center justify-between border-t border-edge pt-4">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: user?.avatarColor ?? "#6366f1" }}
                >
                  {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-ink">{user?.displayName || user?.username}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    logout();
                    onClose();
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-3 hover:text-ink"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
                <button
                  onClick={() => {
                    logout();
                    onClose();
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-muted hover:bg-red-500 hover:text-white"
                  title="Power"
                >
                  <Power size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
