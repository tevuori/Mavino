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
    <div className="fixed inset-0 z-[20000] flex flex-col items-center justify-center bg-slate-950 text-white">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mb-8"
      >
        <div className="relative flex h-24 w-24 items-center justify-center">
          <motion.div
            className="absolute inset-0 rounded-2xl border-2 border-indigo-500"
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="absolute inset-2 rounded-xl border-2 border-purple-500"
            animate={{ rotate: -360 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          />
          <AppLogo size={56} />
        </div>
      </motion.div>
      <motion.h1
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mb-1 text-2xl font-semibold"
      >
        Mavino
      </motion.h1>
      <p className="text-sm text-slate-400">Student OS</p>
      <p className="mb-10 text-xs text-slate-500">Made by students, for students</p>
      <div className="h-1 w-48 overflow-hidden rounded-full bg-slate-800">
        <motion.div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-4 text-xs text-slate-500">{Math.floor(progress)}%</p>
    </div>
  );
}
