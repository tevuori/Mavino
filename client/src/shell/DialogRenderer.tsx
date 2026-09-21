import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "../store/mobileDialog";

/**
 * Global renderer for imperative confirm/prompt/alert dialogs on desktop.
 * Mount once in DesktopEnvironment. Uses the shared `useDialog` store.
 *
 * Rendered via a portal into `document.fullscreenElement` when the app (or an
 * element inside it, e.g. the Viewer) is in Element-fullscreen, so the dialog
 * stays visible instead of forcing the browser out of fullscreen like native
 * window.prompt/confirm/alert do.
 */
export default function DialogRenderer() {
  const { dialog, _resolve, _dismiss } = useDialog();
  const [inputValue, setInputValue] = useState("");
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const update = () => setPortalTarget(document.fullscreenElement);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    if (!dialog.type) return;
    if (dialog.type === "prompt") {
      setInputValue(dialog.defaultValue ?? "");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else {
      requestAnimationFrame(() => confirmRef.current?.focus());
    }
  }, [dialog.type, dialog.defaultValue]);

  useEffect(() => {
    if (!dialog.type) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        _dismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dialog.type, _dismiss]);

  if (!dialog.type) return null;

  const opts = dialog.options ?? {};
  const onConfirm = () => {
    if (dialog.type === "prompt") _resolve(inputValue);
    else if (dialog.type === "alert") _resolve(undefined);
    else _resolve(true);
  };
  const confirmLabel =
    opts.confirmLabel ?? (dialog.type === "confirm" ? "Confirm" : "OK");

  const node = (
    <div
      className="fixed inset-0 z-[19000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={_dismiss}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-xl border border-edge bg-surface-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4">
          {opts.title && (
            <h2 className="mb-1.5 text-sm font-semibold text-ink">{opts.title}</h2>
          )}
          <p className="text-sm leading-6 text-ink">{dialog.message}</p>
          {dialog.type === "prompt" && (
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onConfirm();
                }
              }}
              className="mt-3 w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted transition focus:border-accent/70 focus:ring-2 focus:ring-accent/15"
            />
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-edge p-3">
          {dialog.type !== "alert" && (
            <button
              type="button"
              onClick={_dismiss}
              className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface-3"
            >
              {opts.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onConfirm();
              }
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              opts.danger
                ? "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                : "bg-accent text-white hover:opacity-90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, (portalTarget as HTMLElement | null) ?? document.body);
}
