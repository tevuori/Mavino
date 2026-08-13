import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Lucide from "lucide-react";
import { Search, Power, LogOut, Lock, Pin, PinOff } from "lucide-react";
import { useAccessibleApps } from "../store/features";
import { useWindows, type AppId } from "../store/windows";
import { useAuth } from "../store/auth";
import { useSettings } from "../store/settings";

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
            initial={{ y: 20, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-24 left-1/2 z-[11001] w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-edge bg-surface/95 p-4 shadow-window backdrop-blur-xl"
          >
            {/* Search */}
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-edge bg-surface-2 px-3 py-2">
              <Search size={16} className="text-ink-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apps..."
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
              />
            </div>

            {/* App grid */}
            <div className="mb-4 grid grid-cols-4 gap-2">
              {filtered.map((app) => {
                const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>)[app.icon] ?? Lucide.AppWindow;
                const isPinned = dockFavorites.includes(app.id);
                return (
                  <div
                    key={app.id}
                    className="group relative flex flex-col items-center gap-1.5 rounded-lg p-3 transition hover:bg-surface-3"
                  >
                    <button
                      onClick={() => launch(app)}
                      className="flex flex-col items-center gap-1.5"
                    >
                      <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent transition group-hover:bg-accent/25">
                        <Icon size={22} />
                        {app.access === "preview" && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-amber-500 shadow-sm ring-1 ring-edge">
                            <Lock size={9} />
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-ink">{app.name}</span>
                    </button>
                    <button
                      onClick={() => onTogglePin?.(app.id, !isPinned)}
                      className={`absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md opacity-0 transition group-hover:opacity-100 ${
                        isPinned ? "text-accent opacity-100" : "text-ink-muted hover:text-ink"
                      }`}
                      title={isPinned ? "Unpin from dock" : "Pin to dock"}
                    >
                      {isPinned ? <Pin size={12} /> : <PinOff size={12} />}
                    </button>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <p className="col-span-4 py-6 text-center text-sm text-ink-muted">No apps found</p>
              )}
            </div>

            {/* Footer: user + power */}
            <div className="flex items-center justify-between border-t border-edge pt-3">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white"
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
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
                <button
                  onClick={() => {
                    logout();
                    onClose();
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-red-500 hover:text-white"
                  title="Power"
                >
                  <Power size={16} />
                </button>
              </div>
            </div>
            <p className="mt-3 text-center text-[10px] text-ink-muted">
              Made by students, for students
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
