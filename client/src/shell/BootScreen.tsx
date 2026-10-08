import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import AppLogo from "./AppLogo";

interface Props {
  onDone: () => void;
}

/** Animated boot/logo screen shown before login. */
export default function BootScreen({ onDone }: Props) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 18 + 6;
        if (next >= 100) {
          clearInterval(interval);
          setTimeout(onDone, 400);
          return 100;
        }
        return next;
      });
    }, 180);
    return () => clearInterval(interval);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[20000] flex flex-col items-center justify-center bg-canvas text-ink">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-xl border border-edge bg-surface shadow-panel"
      >
        <AppLogo size={52} />
      </motion.div>
      <motion.h1
        initial={{ y: 6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="mb-1 text-2xl font-semibold tracking-tight"
      >
        Mavino
      </motion.h1>
      <p className="text-sm text-ink-muted">Your student workspace</p>
      <p className="mb-8 text-xs text-ink-tertiary">Preparing your day</p>
      <div className="h-1 w-48 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Loading Mavino" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress)}>
        <motion.div className="h-full bg-accent" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-3 text-xs font-medium tabular-nums text-ink-muted">{Math.floor(progress)}%</p>
    </div>
  );
}
