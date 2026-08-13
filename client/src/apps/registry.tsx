import { lazy, type ComponentType } from "react";
import type { AppId, WindowInstance } from "../store/windows";
import { isStaleChunkError, reloadWithCacheBust } from "../services/stale-chunk";

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
      if (isStaleChunkError(err)) {
        // The current page has stale chunk references — reload to get the
        // latest index.html. Use a cache-busting query param so the browser
        // doesn't serve a cached HTML document.
        reloadWithCacheBust();
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
const PlansApp = lazyImport(() => import("./plans/PlansApp"));
const MarketplaceApp = lazyImport(() => import("./marketplace/MarketplaceApp"));
const AtlasApp = lazyImport(() => import("./atlas/AtlasApp"));
const CrunchApp = lazyImport(() => import("./crunch/CrunchApp"));
const CompassApp = lazyImport(() => import("./compass/CompassApp"));
const EchoApp = lazyImport(() => import("./echo/EchoApp"));
const PulseApp = lazyImport(() => import("./pulse/PulseApp"));

export interface AppDefinition {
  id: AppId;
  name: string;
  icon: string; // lucide icon name
  component: ComponentType<{ win: WindowInstance }>;
  pinnedToDesktop?: boolean;
  /** Minimum subscription tier required to fully access this app. "free" apps
   *  are always available; "paid"/"pro" apps show a lock badge + paywall
   *  preview for lower-tier users. Mirrors server/services/features.ts. */
  minTier?: "free" | "paid" | "pro";
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
  // ----- Free tier (always available) -----
  { id: "notes", name: "Notes", icon: "StickyNote", component: NotesApp, pinnedToDesktop: true, minTier: "free" },
  { id: "tasks", name: "Tasks", icon: "CheckSquare", component: TasksApp, pinnedToDesktop: true, minTier: "free" },
  { id: "files", name: "Files", icon: "Folder", component: FilesApp, pinnedToDesktop: true, minTier: "free" },
  { id: "whiteboard", name: "Whiteboard", icon: "PenTool", component: WhiteboardApp, pinnedToDesktop: true, fullscreenOnMobile: true, minTier: "free" },
  { id: "study", name: "Study Hub", icon: "GraduationCap", component: StudyApp, pinnedToDesktop: true, minTier: "free" },
  { id: "athena", name: "Mavino", icon: "Sparkles", component: AthenaApp, pinnedToDesktop: true, minTier: "free" },
  { id: "today", name: "Home", icon: "Home", component: TodayApp, pinnedToDesktop: true, minTier: "free" },
  { id: "settings", name: "Settings", icon: "Settings", component: SettingsApp, pinnedToDesktop: false, minTier: "free" },
  { id: "plans", name: "Plans", icon: "CreditCard", component: PlansApp, pinnedToDesktop: true, minTier: "free" },

  // ----- Paid tier (preview for free users) -----
  { id: "editor", name: "Editor", icon: "Code2", component: EditorApp, pinnedToDesktop: true, hideOnMobile: true, minTier: "paid" },
  { id: "viewer", name: "Viewer", icon: "Eye", component: ViewerApp, pinnedToDesktop: false, fullscreenOnMobile: true, hideOnMobile: true, minTier: "paid" },
  { id: "pomodoro", name: "Pomodoro", icon: "Timer", component: PomodoroApp, pinnedToDesktop: true, minTier: "paid" },
  { id: "flashcards", name: "Flashcards", icon: "Brain", component: FlashcardsApp, pinnedToDesktop: true, minTier: "paid" },
  { id: "grades", name: "Grades", icon: "GraduationCap", component: GradesApp, pinnedToDesktop: true, minTier: "paid" },
  { id: "calendar", name: "Calendar", icon: "Calendar", component: CalendarApp, pinnedToDesktop: true, minTier: "paid" },
  { id: "habits", name: "Habits", icon: "Flame", component: HabitsApp, pinnedToDesktop: true, minTier: "paid" },
  { id: "ntfy", name: "Ntfy", icon: "Bell", component: NtfyApp, pinnedToDesktop: false, minTier: "paid" },
  { id: "voice", name: "Voice Notes", icon: "Mic", component: VoiceApp, pinnedToDesktop: true, minTier: "paid" },
  { id: "browser", name: "Browser", icon: "Globe", component: BrowserApp, pinnedToDesktop: true, minTier: "paid" },
  { id: "reminders", name: "Reminders", icon: "BellRing", component: RemindersApp, pinnedToDesktop: false, minTier: "paid" },
  { id: "analytics", name: "Analytics", icon: "BarChart3", component: AnalyticsApp, pinnedToDesktop: true, minTier: "paid" },
  { id: "maps", name: "Maps", icon: "Map", component: MapsApp, pinnedToDesktop: true, minTier: "paid" },

  // ----- Marketplace (paid tier — browse/install community plugins) -----
  { id: "marketplace", name: "Marketplace", icon: "Store", component: MarketplaceApp, pinnedToDesktop: true, minTier: "paid" },

  // ----- Pro tier (exclusive apps for Pro subscribers) -----
  { id: "atlas", name: "Atlas", icon: "Network", component: AtlasApp, pinnedToDesktop: true, minTier: "pro" },
  { id: "crunch", name: "Crunch", icon: "CalendarClock", component: CrunchApp, pinnedToDesktop: true, minTier: "pro" },
  { id: "compass", name: "Compass", icon: "Compass", component: CompassApp, pinnedToDesktop: true, minTier: "pro" },
  { id: "echo", name: "Echo", icon: "Radio", component: EchoApp, pinnedToDesktop: true, minTier: "pro" },
  { id: "pulse", name: "Pulse", icon: "Activity", component: PulseApp, pinnedToDesktop: true, minTier: "pro" },

  // ----- Admin-granted (VUT SSO → VUT + Moodle) -----
  { id: "vut", name: "VUT", icon: "GraduationCap", component: VUTApp, pinnedToDesktop: true, requiresGrant: "vut" },
  { id: "moodle", name: "Moodle", icon: "GraduationCap", component: MoodleApp, pinnedToDesktop: true, requiresGrant: "vut" },
];

export const APP_MAP: Record<AppId, AppDefinition> = Object.fromEntries(
  APPS.map((a) => [a.id, a])
) as Record<AppId, AppDefinition>;

export const APP_ACCENT: Partial<Record<AppId, { bg: string; text: string }>> = {
  notes: { bg: "bg-amber-500/25", text: "text-amber-300" },
  tasks: { bg: "bg-emerald-500/25", text: "text-emerald-300" },
  files: { bg: "bg-sky-500/25", text: "text-sky-300" },
  whiteboard: { bg: "bg-violet-500/25", text: "text-violet-300" },
  study: { bg: "bg-indigo-500/25", text: "text-indigo-300" },
  athena: { bg: "bg-fuchsia-500/25", text: "text-fuchsia-300" },
  today: { bg: "bg-pink-500/25", text: "text-pink-300" },
  settings: { bg: "bg-slate-500/25", text: "text-slate-300" },
  plans: { bg: "bg-cyan-500/25", text: "text-cyan-300" },
  editor: { bg: "bg-zinc-500/25", text: "text-zinc-300" },
  viewer: { bg: "bg-orange-500/25", text: "text-orange-300" },
  pomodoro: { bg: "bg-red-500/25", text: "text-red-300" },
  flashcards: { bg: "bg-yellow-500/25", text: "text-yellow-300" },
  grades: { bg: "bg-lime-500/25", text: "text-lime-300" },
  calendar: { bg: "bg-rose-500/25", text: "text-rose-300" },
  habits: { bg: "bg-orange-500/25", text: "text-orange-300" },
  ntfy: { bg: "bg-teal-500/25", text: "text-teal-300" },
  voice: { bg: "bg-cyan-500/25", text: "text-cyan-300" },
  browser: { bg: "bg-blue-500/25", text: "text-blue-300" },
  reminders: { bg: "bg-amber-500/25", text: "text-amber-300" },
  analytics: { bg: "bg-emerald-500/25", text: "text-emerald-300" },
  maps: { bg: "bg-green-500/25", text: "text-green-300" },
  marketplace: { bg: "bg-purple-500/25", text: "text-purple-300" },
  atlas: { bg: "bg-blue-500/25", text: "text-blue-300" },
  crunch: { bg: "bg-indigo-500/25", text: "text-indigo-300" },
  compass: { bg: "bg-sky-500/25", text: "text-sky-300" },
  echo: { bg: "bg-violet-500/25", text: "text-violet-300" },
  pulse: { bg: "bg-pink-500/25", text: "text-pink-300" },
  vut: { bg: "bg-red-500/25", text: "text-red-300" },
  moodle: { bg: "bg-orange-500/25", text: "text-orange-300" },
};

export function getAppAccent(appId: AppId) {
  return APP_ACCENT[appId] ?? { bg: "bg-surface-3", text: "text-ink" };
}

// ----- Plugin apps (dynamically installed from the marketplace) -----

/** Prefix for synthetic plugin app ids: `plugin:<pluginKey>`. */
export const PLUGIN_APP_PREFIX = "plugin:";

/** True if an app id refers to a dynamically-installed plugin. */
export function isPluginAppId(appId: string): boolean {
  return appId.startsWith(PLUGIN_APP_PREFIX);
}

/** Extract the pluginKey from a plugin app id, or null. */
export function pluginKeyFromAppId(appId: string): string | null {
  if (!appId.startsWith(PLUGIN_APP_PREFIX)) return null;
  return appId.slice(PLUGIN_APP_PREFIX.length);
}
