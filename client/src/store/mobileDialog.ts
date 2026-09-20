import { create } from "zustand";

/**
 * Global store for imperative mobile confirm / prompt dialogs.
 *
 * Usage in any mobile component:
 *
 *   const { confirm, prompt } = useMobileDialog();
 *   const ok = await confirm("Delete this note?");
 *   const name = await prompt("Folder name");
 *
 * A single <MobileDialogRenderer /> in MobileShell renders the actual sheet.
 */

export interface DialogState {
  type: "confirm" | "prompt" | null;
  message: string;
  defaultValue?: string;
  resolve: ((value: boolean | string | null) => void) | null;
}

interface MobileDialogStore {
  dialog: DialogState;
  confirm: (message: string) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string) => Promise<string | null>;
  _resolve: (value: boolean | string | null) => void;
  _dismiss: () => void;
}

const EMPTY: DialogState = { type: null, message: "", resolve: null };

export const useMobileDialog = create<MobileDialogStore>((set, get) => ({
  dialog: EMPTY,

  confirm: (message: string) =>
    new Promise<boolean>((resolve) => {
      set({
        dialog: {
          type: "confirm",
          message,
          resolve: resolve as (v: boolean | string | null) => void,
        },
      });
    }),

  prompt: (message: string, defaultValue?: string) =>
    new Promise<string | null>((resolve) => {
      set({
        dialog: {
          type: "prompt",
          message,
          defaultValue,
          resolve: resolve as (v: boolean | string | null) => void,
        },
      });
    }),

  _resolve: (value) => {
    const { dialog } = get();
    dialog.resolve?.(value);
    set({ dialog: EMPTY });
  },

  _dismiss: () => {
    const { dialog } = get();
    if (dialog.type === "confirm") dialog.resolve?.(false);
    else dialog.resolve?.(null);
    set({ dialog: EMPTY });
  },
}));
