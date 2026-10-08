import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "../store/mobileDialog";
import { Dialog } from "../ui/overlays";
import { Button, TextField } from "../ui/primitives";

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

  useEffect(() => {
    const update = () => setPortalTarget(document.fullscreenElement);
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  useEffect(() => {
    if (dialog.type === "prompt") setInputValue(dialog.defaultValue ?? "");
  }, [dialog.type, dialog.defaultValue]);

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
    <Dialog
      open
      onClose={_dismiss}
      title={opts.title}
      className="max-w-sm"
      footer={
        <>
          {dialog.type !== "alert" && (
            <Button variant="secondary" onClick={_dismiss}>
              {opts.cancelLabel ?? "Cancel"}
            </Button>
          )}
          <Button variant={opts.danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-6 text-ink">{dialog.message}</p>
      {dialog.type === "prompt" && (
        <TextField
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onConfirm();
            }
          }}
          className="mt-4"
        />
      )}
    </Dialog>
  );

  return createPortal(node, (portalTarget as HTMLElement | null) ?? document.body);
}
