import { forwardRef, useEffect } from "react";
import { ArrowLeft, Monitor, Plus, X } from "lucide-react";
import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export function MobileContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto min-w-0 max-w-md px-5 pb-7 pt-[max(1.5rem,env(safe-area-inset-top))] ${className}`}>{children}</div>;
}

export function MobileHeader({
  title,
  subtitle,
  onBack,
  onClose,
  right,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onClose?: () => void;
  right?: ReactNode;
  compact?: boolean;
}) {
  return (
    <header className={`mb-6 flex items-center justify-between ${compact ? "gap-2" : "gap-3"}`}>
      <div className="flex min-w-0 items-center gap-3">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-ink active:bg-surface-3"
            aria-label="Close"
          >
            <X size={21} />
          </button>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-ink active:bg-surface-3"
            aria-label="Back"
          >
            <ArrowLeft size={21} />
          </button>
        )}
        <div className="min-w-0">
          {subtitle && <p className="text-sm font-medium text-accent">{subtitle}</p>}
          <h1 className={`truncate font-bold tracking-tight text-ink ${compact ? "text-xl" : "text-3xl"}`}>{title}</h1>
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}

export function MobileFab({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/20 active:scale-[.97]"
    >
      {icon ?? <Plus size={22} />}
    </button>
  );
}

export function MobileCard({
  children,
  className = "",
  onClick,
  active = false,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`w-full rounded-2xl border border-edge bg-surface-2 p-4 text-left transition ${
        onClick ? "active:scale-[.99] active:bg-surface-3" : ""
      } ${active ? "ring-1 ring-accent/60" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function MobileListItem({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-4 text-left transition ${
        onClick ? "active:bg-surface-3" : ""
      } ${className}`}
    >
      {children}
    </Tag>
  );
}

export function MobileChip({
  active = false,
  onClick,
  children,
  className = "",
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
        active ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function MobileEmpty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-edge px-4 py-5 text-sm leading-6 text-ink-muted">{text}</p>;
}

export function MobileLoading({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-3" />
      ))}
    </div>
  );
}

export function MobileInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none placeholder:text-ink-muted focus:border-accent/60 ${props.className ?? ""}`}
    />
  );
}

export const MobileTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function MobileTextarea(props, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={`w-full resize-none rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none placeholder:text-ink-muted focus:border-accent/60 ${props.className ?? ""}`}
    />
  );
});

export function MobileSelect(props: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      {...props}
      className={`w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none focus:border-accent/60 ${props.className ?? ""}`}
    >
      {props.children}
    </select>
  );
}

export function MobileSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  getLabel,
}: {
  options: T[];
  value: T;
  onChange: (value: T) => void;
  getLabel: (value: T) => string;
}) {
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
            value === option ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted"
          }`}
        >
          {getLabel(option)}
        </button>
      ))}
    </div>
  );
}

/** A two-state toggle pill (e.g. Edit / Preview). */
export function MobileToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-edge bg-surface-2 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            value === opt.value ? "bg-accent text-accent-fg" : "text-ink-muted"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Slide-up bottom sheet modal with backdrop. */
export function MobileModal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-edge bg-surface p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-ink-muted active:bg-surface-3"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="space-y-3">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Primary action button. */
export function MobileButton({
  children,
  onClick,
  variant = "primary",
  className = "",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const base = "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 active:scale-[.98]";
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-fg"
      : variant === "danger"
      ? "bg-rose-500/15 text-rose-400 active:bg-rose-500/25"
      : "bg-surface-2 text-ink-muted active:bg-surface-3";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

/**
 * A soft, dismissible-feeling (but non-blocking) note that a feature is
 * fuller / more comfortable on a bigger screen. Used on mobile screens for
 * apps that have a heavy canvas/graph/multi-pane desktop layout (e.g. Compass'
 * citation graph, Maps' full tour planner) — the mobile view still works and
 * exposes the core functionality, this just sets expectations rather than
 * blocking access.
 */
export function MobileDesktopNote({ text }: { text: string }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-accent/20 bg-accent/[0.07] px-4 py-3 text-xs leading-5 text-ink-muted">
      <Monitor size={15} className="mt-0.5 shrink-0 text-accent" />
      <span>{text}</span>
    </div>
  );
}

/** Renders markdown content using the shared markdown-body styles. */
export function MobileMarkdown({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`selectable markdown-body prose-sm max-w-none text-ink ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          img: ({ src, alt }) => (
            <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="my-3 max-w-full rounded-lg border border-edge" loading="lazy" />
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline hover:opacity-80">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
