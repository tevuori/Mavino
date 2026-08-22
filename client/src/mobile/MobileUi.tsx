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
          <h1 className={`truncate font-display font-semibold tracking-tight text-ink ${compact ? "text-xl" : "text-3xl"}`}>{title}</h1>
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
      className="brand-gradient flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-lg shadow-accent/35 active:scale-[.97]"
    >
      {icon ?? <Plus size={22} />}
    </button>
  );
}

/**
 * A small "duotone" icon badge — a solid brand-colored icon over a soft
 * brand-gradient tint, replacing the old flat `bg-accent/15 text-accent`
 * circle pattern that was copy-pasted across every screen. Purely additive;
 * existing inline patterns keep working and can be migrated over time.
 */
export function MobileIconChip({
  icon,
  size = "md",
  shape = "squircle",
}: {
  icon: ReactNode;
  size?: "sm" | "md" | "lg";
  shape?: "squircle" | "circle";
}) {
  const dims = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-14 w-14" : "h-10 w-10";
  return (
    <span className={`relative flex ${dims} shrink-0 items-center justify-center overflow-hidden ${shape === "circle" ? "rounded-full" : "rounded-2xl"} text-accent`}>
      <span className="brand-gradient absolute inset-0 opacity-[0.16]" />
      <span className="relative">{icon}</span>
    </span>
  );
}

export function MobileCard({
  children,
  className = "",
  onClick,
  active = false,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  /** "feature" adds a soft gradient-tinted border + glow for hero/standalone moments. */
  variant?: "default" | "feature";
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`w-full rounded-2xl p-4 text-left transition ${
        variant === "feature"
          ? "brand-border-glow border border-transparent shadow-[0_8px_28px_-12px_rgb(var(--brand-violet)/0.45)]"
          : "border border-edge bg-surface-2"
      } ${onClick ? "active:scale-[.99] active:bg-surface-3" : ""} ${active ? "ring-1 ring-accent/60" : ""} ${className}`}
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
        active ? "brand-gradient text-white shadow-sm shadow-accent/30" : "bg-surface-2 text-ink-muted"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function MobileEmpty({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-edge px-4 py-6 text-center">
      {icon && <MobileIconChip icon={icon} size="lg" />}
      <p className="text-sm leading-6 text-ink-muted">{text}</p>
    </div>
  );
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
      className={`w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none placeholder:text-ink-muted transition focus:border-accent/70 focus:ring-2 focus:ring-accent/15 ${props.className ?? ""}`}
    />
  );
}

export const MobileTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function MobileTextarea(props, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={`w-full resize-none rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none placeholder:text-ink-muted transition focus:border-accent/70 focus:ring-2 focus:ring-accent/15 ${props.className ?? ""}`}
    />
  );
});

export function MobileSelect(props: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      {...props}
      className={`w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none transition focus:border-accent/70 focus:ring-2 focus:ring-accent/15 ${props.className ?? ""}`}
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
            value === option ? "brand-gradient text-white shadow-sm shadow-accent/30" : "bg-surface-2 text-ink-muted"
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
            value === opt.value ? "brand-gradient text-white shadow-sm shadow-accent/30" : "text-ink-muted"
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
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-edge bg-surface p-5 pt-3 shadow-2xl sm:rounded-3xl sm:pt-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-surface-3 sm:hidden" aria-hidden />
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
      ? "brand-gradient text-white shadow-md shadow-accent/30"
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
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-accent/20 bg-accent/[0.07] px-4 py-3 text-xs leading-5 text-ink-muted">
      <MobileIconChip icon={<Monitor size={14} />} size="sm" />
      <span className="pt-1.5">{text}</span>
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
