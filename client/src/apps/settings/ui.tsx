import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Alert, Button, Switch } from "../../ui/primitives";

/** Section heading with icon + title + description. */
export function SectionHeader({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <>
      <h3 className="mb-1 flex items-center gap-2 text-base font-semibold text-ink">
        {icon}
        {title}
      </h3>
      <p className="mb-4 text-sm text-ink-muted">{description}</p>
    </>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border-t border-edge py-4 ${className}`}>
      {children}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-ink-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-focus focus:ring-2 focus:ring-focus/20";

export function ToggleRow({
  label,
  description,
  on,
  onClick,
}: {
  label: string;
  description: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-edge py-3">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-xs leading-5 text-ink-muted">{description}</p>
      </div>
      <Switch checked={on} label={label} onClick={onClick} />
    </div>
  );
}

export function StatusPill({
  on,
  onLabel,
  offLabel,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        on ? "bg-success-soft text-success" : "bg-surface-3 text-ink-muted"
      }`}
    >
      {on ? <Check size={12} /> : null}
      {on ? onLabel : offLabel}
    </span>
  );
}

export function SaveButton({
  busy,
  disabled,
  onClick,
  children = "Save",
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <Button onClick={onClick} disabled={disabled} loading={busy} leadingIcon={<Check size={14} />}>
      {children}
    </Button>
  );
}

export function MsgBox({ msg, error }: { msg: string | null; error?: boolean }) {
  if (!msg) return null;
  return <Alert variant={error ? "danger" : "success"} className="mt-2 text-xs">{msg}</Alert>;
}
