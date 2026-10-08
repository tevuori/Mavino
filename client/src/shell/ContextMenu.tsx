import { useEffect, useRef, type ReactNode } from "react";

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  onClick?: () => void;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
  keepOpen?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const nonSeparator = items.filter((i) => !i.separator);
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - nonSeparator.length * 32 - 16);

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className="fixed z-[12000] min-w-[200px] rounded-lg border border-edge bg-surface-2 p-1.5 shadow-window animate-scale-in"
      style={{ left, top }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 h-px bg-edge" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.();
              if (!item.keepOpen) onClose();
            }}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition ${
              item.disabled
                ? "cursor-not-allowed text-ink-muted/50"
                : item.danger
                ? "text-danger hover:bg-danger-soft"
                : "text-ink hover:bg-surface-3"
            }`}
          >
            {item.icon && <span className="text-ink-muted">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        )
      )}
    </div>
  );
}
