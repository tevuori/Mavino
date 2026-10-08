import { useState } from "react";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { useNotifications, type EphemeralNotification } from "../store/notifications";
import type { NotificationItem } from "../types";
import { MobileIconChip } from "./MobileUi";
import { Sheet } from "../ui/overlays";
import { Button } from "../ui/primitives";

/**
 * A bell button with unread badge. Tapping it opens the notification sheet.
 * Mount this in MobileShell (e.g. on the Home header or as a floating button).
 */
export function NotificationBell() {
  const unreadCount = useNotifications((s) => s.unreadCount());
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2 text-ink-muted active:bg-surface-3"
        aria-label="Notifications"
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && <NotificationSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function NotificationSheet({ onClose }: { onClose: () => void }) {
  const {
    persistent,
    ephemeral,
    markRead,
    markEphemeralRead,
    dismiss,
    dismissEphemeral,
    markAllRead,
    unreadCount,
  } = useNotifications();

  const all = mergeNotifications(persistent, ephemeral);
  const count = unreadCount();

  return (
    <Sheet open onClose={onClose} title="Notifications" className="max-w-md">
      {count > 0 && (
        <div className="-mt-3 mb-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => void markAllRead()} leadingIcon={<CheckCheck size={14} />}>
            Read all
          </Button>
        </div>
      )}

      <div className="overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]" style={{ maxHeight: "calc(80vh - 120px)" }}>
          {all.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <MobileIconChip icon={<Bell size={20} />} size="lg" />
              <p className="text-sm text-ink-muted">No notifications</p>
            </div>
          ) : (
            <div className="space-y-2 pb-4">
              {all.map((n) => (
                <NotificationRow
                  key={n.id}
                  item={n}
                  onRead={() => {
                    if (n.kind === "ephemeral") markEphemeralRead(n.id);
                    else void markRead(n.id);
                  }}
                  onDismiss={() => {
                    if (n.kind === "ephemeral") dismissEphemeral(n.id);
                    else void dismiss(n.id);
                  }}
                />
              ))}
            </div>
          )}
      </div>
    </Sheet>
  );
}

interface MergedNotification {
  id: string;
  kind: "persistent" | "ephemeral";
  title: string;
  body: string;
  read: boolean;
  timestamp: number;
  app?: string;
  category?: string;
}

function mergeNotifications(
  persistent: NotificationItem[],
  ephemeral: EphemeralNotification[],
): MergedNotification[] {
  const all: MergedNotification[] = [
    ...persistent.map((n) => ({
      id: n.id,
      kind: "persistent" as const,
      title: n.title,
      body: n.body,
      read: n.read,
      timestamp: new Date(n.createdAt).getTime(),
      category: n.category,
    })),
    ...ephemeral.map((n) => ({
      id: n.id,
      kind: "ephemeral" as const,
      title: n.title,
      body: n.body,
      read: n.read,
      timestamp: n.timestamp,
      app: n.app,
    })),
  ];
  all.sort((a, b) => b.timestamp - a.timestamp);
  return all;
}

function NotificationRow({
  item,
  onRead,
  onDismiss,
}: {
  item: MergedNotification;
  onRead: () => void;
  onDismiss: () => void;
}) {
  const age = formatAge(item.timestamp);

  return (
    <div
      className={`relative rounded-2xl border p-3 transition ${
        item.read
          ? "border-edge bg-surface-2"
          : "border-accent/30 bg-accent/[0.06]"
      }`}
      onClick={() => {
        if (!item.read) onRead();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {!item.read && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            )}
            <p className="truncate text-sm font-medium text-ink">{item.title}</p>
          </div>
          {item.body && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{item.body}</p>
          )}
          <p className="mt-1.5 text-[11px] text-ink-muted/70">{age}</p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="shrink-0 rounded-lg p-1 text-ink-muted active:text-danger"
          aria-label="Dismiss"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}
