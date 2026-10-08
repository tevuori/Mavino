import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { IconButton } from "./primitives";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useOverlayFocus(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const explicit = panel?.querySelector<HTMLElement>("[data-autofocus]");
    const first = explicit ?? panel?.querySelector<HTMLElement>(focusableSelector);
    requestAnimationFrame(() => (first ?? panel)?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const restore = restoreRef.current;
      const restoreFocus = () => {
        if (!restore?.isConnected) return;
        const active = document.activeElement;
        if (active === document.body || panel?.contains(active)) restore.focus();
      };
      requestAnimationFrame(restoreFocus);
      window.setTimeout(restoreFocus, 180);
    };
  }, [open]);

  return panelRef;
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  hideClose?: boolean;
}

function OverlayPanel({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  hideClose,
  sheet,
}: OverlayProps & { sheet: boolean }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useOverlayFocus(open, onClose);
  if (!open) return null;

  return (
    <div
      className={clsx(
        "fixed inset-0 z-[19000] flex bg-scrim/55 p-4",
        sheet ? "items-end justify-center p-0 sm:items-center sm:p-4" : "items-center justify-center",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        aria-label={title ? undefined : "Dialog"}
        tabIndex={-1}
        className={clsx(
          "max-h-[88dvh] w-full overflow-y-auto border border-edge/70 bg-surface-overlay shadow-window outline-none",
          sheet ? "max-w-md rounded-t-xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-xl" : "max-w-lg rounded-xl p-5",
          className,
        )}
      >
        {sheet && <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-edge-strong sm:hidden" aria-hidden />}
        {(title || description) && (
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              {title && <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink">{title}</h2>}
              {description && <p id={descriptionId} className="mt-1 text-sm leading-5 text-ink-muted">{description}</p>}
            </div>
            {!hideClose && (
              <IconButton label="Close" onClick={onClose} className="-mr-1 -mt-1">
                <X size={18} />
              </IconButton>
            )}
          </div>
        )}
        {children}
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-edge pt-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Dialog(props: OverlayProps) {
  return <OverlayPanel {...props} sheet={false} />;
}

export function Sheet(props: OverlayProps) {
  return <OverlayPanel {...props} sheet />;
}
