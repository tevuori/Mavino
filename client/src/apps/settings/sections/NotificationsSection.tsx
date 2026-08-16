import { useState, useEffect, useCallback } from "react";
import { Bell, BellRing, Loader2, Smartphone } from "lucide-react";
import { useSettings } from "../../../store/settings";
import { notificationsApi } from "../../../services/notifications";
import { SectionHeader, ToggleRow, Card } from "../ui";
import type { NotificationSettings, NotificationCategory } from "../../../types";

const CATEGORY_INFO: { id: NotificationCategory; label: string; description: string }[] = [
  { id: "task_due", label: "Task due reminders", description: "Notify when a task is due today" },
  { id: "task_overdue", label: "Overdue task alerts", description: "Notify when a task is past its due date" },
  { id: "calendar_upcoming", label: "Calendar event reminders", description: "Notify 15 minutes before a calendar event starts" },
  { id: "circle_join", label: "Circle — new members", description: "Notify when someone joins your study group" },
  { id: "circle_share", label: "Circle — shared resources", description: "Notify when a deck or notes folder is shared to your group" },
  { id: "achievement", label: "Achievement unlocks", description: "Notify when you unlock a new achievement" },
  { id: "system", label: "System notifications", description: "Important system alerts and announcements" },
];

export default function NotificationsSection() {
  const {
    notificationsEnabled,
    setNotificationsEnabled,
    doNotDisturb,
    setDoNotDisturb,
  } = useSettings();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await notificationsApi.getSettings();
      setSettings(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateSettings = async (patch: Partial<NotificationSettings>) => {
    if (!settings) return;
    setBusy(true);
    // Optimistic update.
    setSettings({ ...settings, ...patch });
    try {
      const res = await notificationsApi.saveSettings(patch);
      setSettings(res);
    } catch {
      // Revert on failure.
      setSettings(settings);
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = (cat: NotificationCategory) => {
    if (!settings) return;
    const next = { ...settings.categories, [cat]: !settings.categories[cat] };
    void updateSettings({ categories: next });
  };

  return (
    <section id="notifications" className="mb-8">
      <SectionHeader icon={<Bell size={18} />} title="Notifications" description="Control notification behavior and which alerts you receive." />
      <div className="space-y-3">
        <ToggleRow
          label="Enable notifications"
          description="Show notifications from apps"
          on={notificationsEnabled}
          onClick={() => setNotificationsEnabled(!notificationsEnabled)}
        />
        <ToggleRow
          label="Do not disturb"
          description="Silence all notifications (also mutes during Pomodoro focus)"
          on={doNotDisturb}
          onClick={() => setDoNotDisturb(!doNotDisturb)}
        />
      </div>

      {/* Per-category toggles (server-side, persistent) */}
      <div className="mt-4">
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <BellRing size={16} className="text-ink-muted" />
            <h4 className="text-sm font-semibold text-ink">Notification categories</h4>
            {busy && <Loader2 size={12} className="animate-spin text-ink-muted" />}
          </div>
          {!settings ? (
            <Loader2 size={16} className="animate-spin text-ink-muted" />
          ) : (
            <>
              <ToggleRow
                label="Master switch"
                description="Turn off to suppress all persistent notifications"
                on={settings.enabled}
                onClick={() => void updateSettings({ enabled: !settings.enabled })}
              />
              <div className="mt-3 border-t border-edge pt-3">
                <div className="mb-2 flex items-center gap-2">
                  <Smartphone size={14} className="text-ink-muted" />
                  <span className="text-xs font-medium text-ink-muted">Push to phone (ntfy)</span>
                </div>
                <ToggleRow
                  label="Also push to ntfy"
                  description="Send notifications to your phone via ntfy (if configured)"
                  on={settings.ntfy}
                  onClick={() => void updateSettings({ ntfy: !settings.ntfy })}
                />
              </div>
              <div className="mt-3 space-y-2 border-t border-edge pt-3">
                <p className="mb-1 text-xs font-medium text-ink-muted">Categories</p>
                {CATEGORY_INFO.map((cat) => (
                  <ToggleRow
                    key={cat.id}
                    label={cat.label}
                    description={cat.description}
                    on={settings.categories[cat.id] ?? true}
                    onClick={() => toggleCategory(cat.id)}
                  />
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </section>
  );
}
