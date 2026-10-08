import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import clsx from "clsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-pressed",
  secondary: "border border-edge bg-surface text-ink hover:border-edge-strong hover:bg-surface-2 active:bg-surface-3",
  ghost: "text-ink-muted hover:bg-surface-2 hover:text-ink active:bg-surface-3",
  danger: "bg-danger text-white hover:brightness-95 active:brightness-90",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 text-xs",
  md: "min-h-9 px-3.5 text-sm",
  lg: "min-h-11 px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, leadingIcon, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : leadingIcon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md" | "touch";
  variant?: "ghost" | "secondary" | "danger";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", variant = "ghost", className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 w-8" : size === "touch" ? "h-11 w-11" : "h-9 w-9",
        variant === "ghost" && "text-ink-muted hover:bg-surface-2 hover:text-ink active:bg-surface-3",
        variant === "secondary" && "border border-edge bg-surface text-ink hover:bg-surface-2",
        variant === "danger" && "text-ink-muted hover:bg-danger-soft hover:text-danger",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, className, ...props },
  ref,
) {
  const inputId = id ?? props.name;
  const descriptionId = inputId ? `${inputId}-description` : undefined;
  return (
    <label className="grid gap-1.5 text-sm text-ink">
      {label && <span className="font-medium">{label}</span>}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={hint || error ? descriptionId : undefined}
        className={clsx(
          "min-h-10 w-full rounded-lg border border-edge bg-surface px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-tertiary hover:border-edge-strong focus:border-focus focus:ring-2 focus:ring-focus/15",
          error && "border-danger focus:border-danger focus:ring-danger/15",
          className,
        )}
        {...props}
      />
      {(hint || error) && (
        <span id={descriptionId} className={clsx("text-xs", error ? "text-danger" : "text-ink-muted")}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
});

export function Surface({
  children,
  className,
  level = "base",
}: {
  children: ReactNode;
  className?: string;
  level?: "base" | "raised" | "overlay" | "sunken";
}) {
  return (
    <div
      className={clsx(
        level === "base" && "bg-surface",
        level === "raised" && "border border-edge bg-surface-2 shadow-sm",
        level === "overlay" && "border border-edge bg-surface-overlay shadow-panel",
        level === "sunken" && "bg-surface-sunken",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Alert({
  children,
  variant = "info",
  className,
}: {
  children: ReactNode;
  variant?: "info" | "success" | "warning" | "danger";
  className?: string;
}) {
  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={clsx(
        "rounded-lg border px-3 py-2.5 text-sm",
        variant === "info" && "border-info/25 bg-info-soft text-info",
        variant === "success" && "border-success/25 bg-success-soft text-success",
        variant === "warning" && "border-warning/25 bg-warning-soft text-warning",
        variant === "danger" && "border-danger/25 bg-danger-soft text-danger",
        className,
      )}
    >
      {children}
    </div>
  );
}
