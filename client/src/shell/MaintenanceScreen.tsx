import { useEffect, useMemo, useState } from "react";
import { Clock3, LogIn, Wrench } from "lucide-react";
import type { MaintenanceStatus } from "../services/maintenance";
import AppLogo from "./AppLogo";

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function MaintenanceScreen({
  status,
  onAdminSignIn,
  authenticated,
}: {
  status: MaintenanceStatus;
  onAdminSignIn: () => void;
  authenticated: boolean;
}) {
  const serverOffset = useMemo(
    () => new Date(status.serverTime).getTime() - Date.now(),
    [status.serverTime]
  );
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const remaining = status.endsAt
    ? new Date(status.endsAt).getTime() - (now + serverOffset)
    : null;

  return (
    <div className="flex min-h-full w-full items-center justify-center bg-canvas p-5 text-ink">
      <div className="w-full max-w-lg rounded-2xl border border-edge bg-surface-overlay/90 p-7 text-center shadow-2xl shadow-black/30">
        <AppLogo size={72} className="mx-auto mb-5" />
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-warning-soft text-warning">
          <Wrench size={22} />
        </div>
        <h1 className="text-2xl font-semibold">Mavino is under maintenance</h1>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-muted">
          {status.message}
        </p>
        {remaining !== null && remaining > 0 && (
          <div className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full border border-edge bg-surface-3 px-4 py-2 text-sm text-ink">
            <Clock3 size={15} className="text-warning" />
            Expected back in {formatRemaining(remaining)}
          </div>
        )}
        <button
          onClick={onAdminSignIn}
          className="mx-auto mt-7 flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm text-ink-muted transition hover:border-edge hover:bg-surface-3 hover:text-white"
        >
          <LogIn size={15} />
          {authenticated ? "Sign out and use admin account" : "Administrator sign in"}
        </button>
      </div>
    </div>
  );
}
