// ===== Shared domain types (mirror server models) =====

export type UserRole = "FREE" | "PAID" | "MANAGER" | "ADMIN";

export interface User {
  id: string;
  username: string;
  email?: string;
  displayName: string;
  avatarColor: string;
  role: UserRole;
  passwordMustChange?: boolean;
}

/** User record as returned by the admin /api/users endpoints. */
export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  role: UserRole;
  createdAt: string;
}

// ===== Anonymous usage analytics (admin-only) =====
// Shape of GET /api/analytics/overview. All aggregate counts — no per-user data.

export interface AnalyticsFeatureUsage {
  feature: string;
  total: number;
}

export interface AnalyticsTrendPoint {
  day: string; // YYYY-MM-DD
  count: number;
}

export interface AnalyticsOverview {
  windowDays: number;
  users: { total: number; active7d: number; active30d: number };
  featureUsage: AnalyticsFeatureUsage[];
  trend: Record<string, AnalyticsTrendPoint[]>;
  adoption: {
    spotify: number;
    microsoft: number;
    ai: number;
    vut: number;
    ntfy: number;
    proactiveAlerts: number;
    tts: number;
  };
  content: {
    notes: number;
    tasks: number;
    tasksDone: number;
    tasksInProgress: number;
    tasksTodo: number;
    files: number;
    flashcardDecks: number;
    flashcards: number;
    courses: number;
    assignments: number;
    calendarEvents: number;
    chatConversations: number;
    studySessions: number;
    whiteboards: number;
    habits: number;
    studySources: number;
    studyChats: number;
    podcasts: number;
    teacherSessions: number;
    ntfyMessages: number;
  };
}

export interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string;
  folderId: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

export interface TaskWorkspace {
  id: string;
  name: string;
  color: string;
  taskCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  recurring: string;
  order: number;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storageKey: string;
  /** When set, content is streamed from this external URL (virtual file). */
  externalUrl?: string | null;
  /** Origin: "manual" | "moodle" | ... */
  source?: string;
  /** Integration reference id (e.g. "courseId:activityId" for Moodle). */
  sourceRef?: string;
  folderId: string | null;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface FolderTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  children: FolderTreeNode[];
  fileCount: number;
}

export interface StorageInfo {
  total: number;
  count: number;
}

export interface LyricsLine {
  time: number; // seconds
  text: string;
}

export interface LyricsResult {
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  syncedLyrics: string;
  plainLyrics: string;
  instrumental: boolean;
}

// ===== Flashcards =====

export interface FlashcardDeck {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  _count?: { cards: number };
}

export interface Flashcard {
  id: string;
  deckId: string;
  front: string;
  back: string;
  easeFactor: number;
  interval: number;
  repetitions: number;
  dueDate: string;
  lastReviewed: string | null;
  /** Source label the card was generated from (e.g. note title / file name). */
  sourceRef?: string | null;
}

// ===== Grades =====

export interface Course {
  id: string;
  name: string;
  code: string;
  semester: string;
  credits: number;
  color: string;
  assignments: Assignment[];
}

export interface Assignment {
  id: string;
  courseId: string;
  name: string;
  score: number;
  maxScore: number;
  weight: number;
  category: string;
  createdAt: string;
}

// ===== VUT =====

export interface VutGrade {
  courseName: string;
  courseCode: string;
  credits: string;
  semester: string;
  grade: string;
  ectsGrade: string;
  completionType: string;
  score: string;
  attempt: string;
}

export interface VutTimetableSlot {
  day: string;
  dayIndex: number;
  startTime: string;
  endTime: string;
  courseName: string;
  courseCode: string;
  room: string;
  teacher: string;
  type: string;
  weekType: string;
  date: string;
  faculty: string;
  color?: string;
}

export interface VutSubjectUpdate {
  subjectName: string;
  subjectCode: string;
  date: string;
  title: string;
  content: string;
  author: string;
}

// ===== Calendar / Planner =====

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  location: string;
  source: string; // manual|task|vut|assignment|ics
  sourceRef: string;
  createdAt: string;
  updatedAt: string;
}

// ===== Habit Tracker =====

export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  cadence: string; // daily|weekly
  target: number;
  linkedApp: string | null;
  linkedMetric: string | null;
  createdAt: string;
  updatedAt: string;
  logs?: HabitLog[];
  _count?: { logs: number };
}

export interface HabitLog {
  id: string;
  habitId: string;
  date: string; // YYYY-MM-DD
  value: number;
}

export interface HabitStats {
  habitId: string;
  currentStreak: number;
  longestStreak: number;
  last30: string[]; // YYYY-MM-DD dates completed in last 30 days
  totalLogs: number;
}

// ===== Whiteboard =====

export interface Whiteboard {
  id: string;
  name: string;
  content: string; // JSON array of WhiteboardElement
  createdAt: string;
  updatedAt: string;
}

export interface WhiteboardSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ===== Item links (drag-to-link between apps) =====

export type LinkType =
  | "note"
  | "task"
  | "flashcardDeck"
  | "calendarEvent"
  | "file"
  | "studySource"
  | "studyChat"
  | "podcast";

/** A resolved link returned by GET /api/links — the "other" side of a link. */
export interface LinkedItem {
  id: string; // ItemLink row id (for deletion)
  type: LinkType;
  refId: string; // the linked entity's id
  title: string;
}

// ===== Gamification & Study Analytics (GET /api/analytics/me) =====

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

export interface Achievement {
  id: string;
  label: string;
  description: string;
  icon: string; // lucide icon name
  tier: AchievementTier;
  unlocked: boolean;
  isNew: boolean;
}

export interface DayPoint {
  day: string; // YYYY-MM-DD
}

export interface FocusDayPoint extends DayPoint {
  minutes: number;
  sessions: number;
}

export interface RetentionPoint extends DayPoint {
  /** Recall success rate (quality >= 3) for that day, or null if no reviews. */
  rate: number | null;
  count: number;
}

export interface AdherencePoint extends DayPoint {
  /** Fraction of habits logged that day (0–1). */
  rate: number;
}

export interface CountDayPoint extends DayPoint {
  count: number;
}

export interface XpDayPoint extends DayPoint {
  xp: number;
}

export interface GradeTrendPoint {
  date: string;
  pct: number;
  name: string;
  course: string;
}

export interface HabitAnalytics {
  habitId: string;
  name: string;
  color: string;
  icon: string;
  currentStreak: number;
  longestStreak: number;
  last30: string[];
  totalLogs: number;
}

export interface AnalyticsDashboard {
  windowDays: number;
  days: string[];
  focus: {
    perDay: FocusDayPoint[];
    totalSessions: number;
    totalMinutes: number;
  };
  flashcards: {
    reviewRetention: RetentionPoint[];
    totalReviews: number;
    totalCards: number;
    maturity: { fresh: number; learning: number; young: number; mature: number };
    avgEase: number;
  };
  grades: {
    trend: GradeTrendPoint[];
    courseCount: number;
    assignmentCount: number;
  };
  habits: {
    adherence: AdherencePoint[];
    totalHabits: number;
    perHabit: HabitAnalytics[];
    maxStreak: number;
  };
  study: {
    perDay: CountDayPoint[];
    byType: Record<string, number>;
    total: number;
  };
  tasks: {
    perDay: CountDayPoint[];
    totalDone: number;
  };
  xp: {
    total: number;
    level: number;
    levelProgress: number; // 0–1
    nextLevelXp: number;
    perDay: XpDayPoint[];
  };
  achievements: Achievement[];
  newlyUnlocked: string[];
}
