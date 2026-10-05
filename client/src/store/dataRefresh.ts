// ===== Cross-app data refresh bus =====
// When Athena (the LLM assistant) executes a destructive tool that mutates
// data on the server (create_note, update_task_status, etc.), the server
// emits a `data_change` SSE event. This store receives those notifications
// and bumps a per-app version counter. Apps subscribe to their own counter
// via `useDataRefreshVersion(appId)` and reload their data when it changes.
//
// This lets an already-open app refresh itself after Athena edits its data,
// without the user having to close and reopen the window.

import { create } from "zustand";

/**
 * Maps a destructive Athena tool name to the app IDs whose data was affected.
 * When a tool succeeds on the server, every app listed here gets a refresh
 * signal. Keep this in sync with the server-side tool definitions
 * (server/src/services/athena/tools/*.ts, `destructive: true`).
 */
const TOOL_TO_APPS: Record<string, string[]> = {
  // --- Tasks ---
  create_task: ["tasks"],
  update_task_status: ["tasks", "analytics"],
  delete_task: ["tasks"],
  create_tasks_from_text: ["tasks"],
  create_task_from_note: ["tasks", "notes"],
  create_tasks_from_note: ["tasks", "notes"],
  schedule_task: ["calendar", "tasks"],
  move_task: ["tasks"],

  // --- Task workspaces ---
  create_task_workspace: ["tasks"],
  delete_task_workspace: ["tasks"],

  // --- Notes ---
  create_note: ["notes"],
  update_note: ["notes"],
  delete_note: ["notes"],
  summarize_note: ["notes"],
  explain_note: ["notes"],
  generate_study_guide: ["notes"],
  create_note_from_task: ["notes", "tasks"],
  create_notes_from_url: ["notes"],
  create_notes_from_pdf: ["notes"],
  schedule_note_review: ["calendar"],

  // --- Files ---
  edit_file: ["files"],
  create_file: ["files"],

  // --- Calendar ---
  create_calendar_event: ["calendar"],
  sync_microsoft_calendar: ["calendar"],

  // --- Habits ---
  create_habit: ["habits"],
  log_habit: ["habits", "analytics"],
  delete_habit: ["habits"],

  // --- Flashcards ---
  generate_flashcards: ["flashcards", "analytics"],
  delete_flashcard_deck: ["flashcards"],
  delete_flashcard: ["flashcards"],

  // --- Study Hub (sources, workspaces, chat, podcasts, teacher, notes, quiz) ---
  create_study_source: ["study"],
  delete_study_source: ["study"],
  create_learning_workspace: ["study"],
  delete_learning_workspace: ["study"],
  start_study_chat: ["study"],
  ask_study_chat: ["study"],
  delete_study_chat: ["study"],
  generate_podcast: ["study", "notes"],
  delete_podcast: ["study"],
  start_teacher_session: ["study", "teach"],
  delete_teacher_session: ["study", "teach"],
  take_notes_from_source: ["notes", "analytics"],

  // --- Ntfy ---
  create_cron_job: ["ntfy"],
  update_cron_job: ["ntfy"],
  delete_cron_job: ["ntfy"],
};

interface DataRefreshState {
  /** Per-app monotonically increasing version counter. */
  versions: Record<string, number>;
  /** Called when a destructive Athena tool succeeds. Bumps affected apps. */
  notifyTool: (tool: string) => void;
}

export const useDataRefresh = create<DataRefreshState>((set) => ({
  versions: {},
  notifyTool: (tool) => {
    const apps = TOOL_TO_APPS[tool];
    if (!apps) return;
    set((state) => {
      const versions = { ...state.versions };
      for (const app of apps) {
        versions[app] = (versions[app] ?? 0) + 1;
      }
      return { versions };
    });
  },
}));

/**
 * Hook for apps to subscribe to refresh signals.
 * Returns a version number that increments whenever Athena mutates this
 * app's data. Apps should watch it in a `useEffect` and reload when it
 * changes (skip the initial 0 to avoid a redundant load on mount).
 */
export function useDataRefreshVersion(appId: string): number {
  return useDataRefresh((s) => s.versions[appId] ?? 0);
}
