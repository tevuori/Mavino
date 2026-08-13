import { create } from "zustand";

interface QuickCaptureState {
  open: boolean;
  setOpen: (b: boolean) => void;
  toggle: () => void;
}

export const useQuickCapture = create<QuickCaptureState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));
