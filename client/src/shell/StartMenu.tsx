import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as Lucide from "lucide-react";
import { Search, Power, LogOut } from "lucide-react";
import { useAvailableApps } from "../store/features";
import { useWindows } from "../store/windows";
import { useAuth } from "../store/auth";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function StartMenu({ open, onClose }: Props) {
  const { open: openWindow } = useWindows();
  const { user, logout } = useAuth();
  const apps = useAvailableApps();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

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
            className="fixed bottom-14 left-1/2 z-[11001] w-[440px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-edge bg-surface/95 p-4 shadow-window backdrop-blur-xl"
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
                return (
                  <button
                    key={app.id}
                    onClick={() => launch(app)}
                    className="flex flex-col items-center gap-1.5 rounded-lg p-3 transition hover:bg-surface-3"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
                      <Icon size={22} />
                    </div>
                    <span className="text-xs text-ink">{app.name}</span>
                  </button>
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
