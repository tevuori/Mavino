import { create } from "zustand";

/**
 * Global store for imperative confirm / prompt / alert dialogs.
 *
 * Usage in any component:
 *
 *   const { confirm, prompt, alert } = useDialog();
 *   const ok = await confirm("Delete this note?");
 *   const name = await prompt("Folder name");
 *   await alert("Something went wrong");
 *
 * A single <DialogRenderer /> in DesktopEnvironment (desktop) and
 * <MobileDialogRenderer /> in MobileShell (phone) render the actual dialog.
 */

export interface DialogOptions {
  /** Optional heading shown above the message. */
  title?: string;
  /** Label for the affirmative button (defaults to "Confirm"/"OK"). */
  confirmLabel?: string;
  /** Label for the dismissive button (defaults to "Cancel"). */
  cancelLabel?: string;
  /** Render the affirmative button as destructive (rose). */
  danger?: boolean;
}

export interface DialogState {
  type: "confirm" | "prompt" | "alert" | null;
  message: string;
  defaultValue?: string;
  options?: DialogOptions;
  resolve: ((value: boolean | string | null | undefined) => void) | null;
}

interface DialogStore {
  dialog: DialogState;
  confirm: (message: string, options?: DialogOptions) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string, options?: DialogOptions) => Promise<string | null>;
  alert: (message: string, options?: DialogOptions) => Promise<void>;
  _resolve: (value: boolean | string | null | undefined) => void;
  _dismiss: () => void;
}

const EMPTY: DialogState = { type: null, message: "", resolve: null };

export const useDialog = create<DialogStore>((set, get) => ({
  dialog: EMPTY,

  confirm: (message, options) =>
    new Promise<boolean>((resolve) => {
      set({
        dialog: {
          type: "confirm",
          message,
          options,
          resolve: resolve as (v: boolean | string | null | undefined) => void,
        },
      });
    }),

  prompt: (message, defaultValue, options) =>
    new Promise<string | null>((resolve) => {
      set({
        dialog: {
          type: "prompt",
          message,
          defaultValue,
          options,
          resolve: resolve as (v: boolean | string | null | undefined) => void,
        },
      });
    }),

  alert: (message, options) =>
    new Promise<void>((resolve) => {
      set({
        dialog: {
          type: "alert",
          message,
          options,
          resolve: resolve as (v: boolean | string | null | undefined) => void,
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
    else if (dialog.type === "alert") dialog.resolve?.(undefined);
    else dialog.resolve?.(null);
    set({ dialog: EMPTY });
  },
}));

/** Backwards-compatible alias for existing mobile call sites. */
export const useMobileDialog = useDialog;

/**
 * Standalone helpers for non-hook contexts — drop-in async replacements for
 * window.confirm / window.prompt / window.alert.
 */
export const confirmDialog = (message: string, options?: DialogOptions) =>
  useDialog.getState().confirm(message, options);
export const promptDialog = (message: string, defaultValue?: string, options?: DialogOptions) =>
  useDialog.getState().prompt(message, defaultValue, options);
export const alertDialog = (message: string, options?: DialogOptions) =>
  useDialog.getState().alert(message, options);
