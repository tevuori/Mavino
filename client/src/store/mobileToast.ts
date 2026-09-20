import { create } from "zustand";

/**
 * Lightweight toast notification store for mobile.
 *
 * Usage:
 *   import { useMobileToast } from "../store/mobileToast";
 *   const toast = useMobileToast((s) => s.show);
 *   toast("Note deleted");
 *   toast("Failed to save", "error");
 */

export interface ToastItem {
  id: number;
  message: string;
  variant: "info" | "error" | "success";
}

let nextId = 0;

interface MobileToastState {
  toasts: ToastItem[];
  show: (message: string, variant?: "info" | "error" | "success") => void;
  dismiss: (id: number) => void;
}

export const useMobileToast = create<MobileToastState>((set) => ({
  toasts: [],
  show: (message, variant = "info") => {
    const id = ++nextId;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }].slice(-5) }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
