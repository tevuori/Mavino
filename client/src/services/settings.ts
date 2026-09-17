// ===== Settings API client =====
// Per-user server-side settings. Currently only the timezone, which backs
// all server-side schedulers (ntfy cron, proactive alerts, reminders) and
// the Athena system prompt.

import { api } from "./api";

export type AppLanguage = "en" | "cs";

export interface TimezoneInfo {
  timezone: string;
  serverTimezone: string;
}

export const settingsApi = {
  getTimezone: () => api.get<TimezoneInfo>("/api/settings/timezone"),

  setTimezone: (timezone: string) =>
    api.put<TimezoneInfo & { error?: string }>("/api/settings/timezone", { timezone }),

  getLanguage: () => api.get<{ language: AppLanguage }>("/api/settings/language"),

  setLanguage: (language: AppLanguage) =>
    api.put<{ language: AppLanguage }>("/api/settings/language", { language }),
};
