import { lazy, type ComponentType } from "react";
import type { AppId, WindowInstance } from "../store/windows";

// All app components are lazy-loaded via React.lazy() so they split into
// separate chunks. The app metadata (id, name, icon) is eager so the taskbar,
// start menu, and desktop icons render instantly — only the app *content*
// loads on demand when a window is opened.

/**
 * Wrap a dynamic import so that if the chunk is missing on the server (stale
 * deploy — the old content-hashed filename no longer exists), we reload the
 * page to pick up the new index.html instead of showing a broken app.
 *
 * This is the standard fix for "Failed to fetch dynamically imported module"
 * errors that occur when a service worker or browser cache serves an old
 * index.html referencing deleted chunks.
 */
function lazyImport<T extends { default: ComponentType<any> }>(
  factory: () => Promise<T>
): React.LazyExoticComponent<T["default"]> {
  return lazy(() =>
    factory().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("error loading dynamically imported module") ||
        msg.includes("Importing a module script failed")
      ) {
        // The current page has stale chunk references — reload to get the
        // latest index.html. Use a cache-busting query param so the browser
        // doesn't serve a cached HTML document.
        if (!location.search.includes("_reload=")) {
          location.replace(`${location.pathname}?_reload=${Date.now()}${location.hash}`);
        }
        // Return a never-resolving promise so React stays in Suspense while
        // the reload happens.
        return new Promise<T>(() => {});
      }
      throw err;
    })
  );
}

const NotesApp = lazyImport(() => import("./notes/NotesApp"));
const TasksApp = lazyImport(() => import("./tasks/TasksApp"));
const FilesApp = lazyImport(() => import("./files/FilesApp"));
const SettingsApp = lazyImport(() => import("./settings/SettingsApp"));
const PomodoroApp = lazyImport(() => import("./pomodoro/PomodoroApp"));
const FlashcardsApp = lazyImport(() => import("./flashcards/FlashcardsApp"));
const GradesApp = lazyImport(() => import("./grades/GradesApp"));
const VUTApp = lazyImport(() => import("./vut/VUTApp"));
const EditorApp = lazyImport(() => import("./editor/EditorApp"));
const ViewerApp = lazyImport(() => import("./viewer/ViewerApp"));
const AthenaApp = lazyImport(() => import("./athena/AthenaApp"));
const StudyApp = lazyImport(() => import("./study/StudyApp"));
const TodayApp = lazyImport(() => import("./today/TodayApp"));
const CalendarApp = lazyImport(() => import("./calendar/CalendarApp"));
const HabitsApp = lazyImport(() => import("./habits/HabitsApp"));
const WhiteboardApp = lazyImport(() => import("./whiteboard/WhiteboardApp"));
const NtfyApp = lazyImport(() => import("./ntfy/NtfyApp"));
const VoiceApp = lazyImport(() => import("./voice/VoiceApp"));
const BrowserApp = lazyImport(() => import("./browser/BrowserApp"));
const RemindersApp = lazyImport(() => import("./reminders/RemindersApp"));
const AnalyticsApp = lazyImport(() => import("./analytics/AnalyticsApp"));
const MoodleApp = lazyImport(() => import("./moodle/MoodleApp"));
const MapsApp = lazyImport(() => import("./maps/MapsApp"));

export interface AppDefinition {
  id: AppId;
  name: string;
  icon: string; // lucide icon name
  component: ComponentType<{ win: WindowInstance }>;
  pinnedToDesktop?: boolean;
  /** Availability tier. "core" apps are always available; "beta" apps require
   *  the per-user Beta toggle in Settings. Mirrors server/services/features.ts. */
  tier?: "core" | "beta";
  /** When set, the app requires an admin-granted access flag (e.g. "vut" for
   *  VUT + Moodle, which ride on the VUT SSO session). */
  requiresGrant?: "vut";
  /** On mobile, render the app full-bleed without the standard MobileAppFrame
   *  header (the app provides its own chrome). Used by Viewer, Whiteboard. */
  fullscreenOnMobile?: boolean;
  /** Hide from the mobile app drawer (e.g. internal/secondary apps opened
   *  only via deep links). */
  hideOnMobile?: boolean;
}

export const APPS: AppDefinition[] = [
  // ----- Core (always available) -----
  { id: "notes", name: "Notes", icon: "StickyNote", component: NotesApp, pinnedToDesktop: true, tier: "core" },
  { id: "tasks", name: "Tasks", icon: "CheckSquare", component: TasksApp, pinnedToDesktop: true, tier: "core" },
  { id: "files", name: "Files", icon: "Folder", component: FilesApp, pinnedToDesktop: true, tier: "core" },
  { id: "whiteboard", name: "Whiteboard", icon: "PenTool", component: WhiteboardApp, pinnedToDesktop: true, fullscreenOnMobile: true, tier: "core" },
  { id: "study", name: "Study Hub", icon: "GraduationCap", component: StudyApp, pinnedToDesktop: true, tier: "core" },
  { id: "athena", name: "Mavino", icon: "Sparkles", component: AthenaApp, pinnedToDesktop: true, tier: "core" },
  { id: "today", name: "Today", icon: "CalendarCheck", component: TodayApp, pinnedToDesktop: true, tier: "core" },
  { id: "settings", name: "Settings", icon: "Settings", component: SettingsApp, pinnedToDesktop: false, tier: "core" },

  // ----- Beta (per-user toggle in Settings) -----
  { id: "editor", name: "Editor", icon: "Code2", component: EditorApp, pinnedToDesktop: true, hideOnMobile: true, tier: "beta" },
  { id: "viewer", name: "Viewer", icon: "Eye", component: ViewerApp, pinnedToDesktop: false, fullscreenOnMobile: true, hideOnMobile: true, tier: "beta" },
  { id: "pomodoro", name: "Pomodoro", icon: "Timer", component: PomodoroApp, pinnedToDesktop: true, tier: "beta" },
  { id: "flashcards", name: "Flashcards", icon: "Brain", component: FlashcardsApp, pinnedToDesktop: true, tier: "beta" },
  { id: "grades", name: "Grades", icon: "GraduationCap", component: GradesApp, pinnedToDesktop: true, tier: "beta" },
  { id: "calendar", name: "Calendar", icon: "Calendar", component: CalendarApp, pinnedToDesktop: true, tier: "beta" },
  { id: "habits", name: "Habits", icon: "Flame", component: HabitsApp, pinnedToDesktop: true, tier: "beta" },
  { id: "ntfy", name: "Ntfy", icon: "Bell", component: NtfyApp, pinnedToDesktop: false, tier: "beta" },
  { id: "voice", name: "Voice Notes", icon: "Mic", component: VoiceApp, pinnedToDesktop: true, tier: "beta" },
  { id: "browser", name: "Browser", icon: "Globe", component: BrowserApp, pinnedToDesktop: true, tier: "beta" },
  { id: "reminders", name: "Reminders", icon: "BellRing", component: RemindersApp, pinnedToDesktop: false, tier: "beta" },
  { id: "analytics", name: "Analytics", icon: "BarChart3", component: AnalyticsApp, pinnedToDesktop: true, tier: "beta" },
  { id: "maps", name: "Maps", icon: "Map", component: MapsApp, pinnedToDesktop: true, tier: "beta" },

  // ----- Admin-granted (VUT SSO → VUT + Moodle) -----
  { id: "vut", name: "VUT", icon: "GraduationCap", component: VUTApp, pinnedToDesktop: true, requiresGrant: "vut" },
  { id: "moodle", name: "Moodle", icon: "GraduationCap", component: MoodleApp, pinnedToDesktop: true, requiresGrant: "vut" },
];

export const APP_MAP: Record<AppId, AppDefinition> = Object.fromEntries(
  APPS.map((a) => [a.id, a])
) as Record<AppId, AppDefinition>;
