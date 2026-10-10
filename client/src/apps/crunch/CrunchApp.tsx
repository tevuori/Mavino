// ===== Crunch app (Pro-tier AI exam planner) =====
// An adaptive exam-prep scheduler: input exam dates + syllabi, and Crunch
// reads your current mastery from flashcard review history + grades, then
// generates a day-by-day spaced-repetition study plan that auto-adjusts as
// you log progress. Sends proactive ntfy alerts when you're falling behind.
//
// The generation is fire-and-forget + polling (same pattern as Atlas):
// POST /generate returns immediately with status "building", the client
// polls GET / until status flips to "ready"/"error".
//
// UI: two modes — the exam setup form (when no plan exists or editing) and
// the day-by-day plan view (timeline of study tasks with progress checkboxes,
// mastery badges, behind-alerts, and "complete day" bulk action).

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  CalendarClock, Plus, Trash2, RefreshCw, Loader2, AlertCircle, X,
  CheckCircle2, Circle, Clock, Brain, GraduationCap, TrendingDown,
  Sparkles, ChevronLeft, ChevronRight, ChevronDown, BookOpen, Zap, Target,
  Presentation, ListChecks, Files, ClipboardList,
} from "lucide-react";
import {
  crunchApi,
  type CrunchState, type CrunchPlanData, type CrunchExamInput,
  type CrunchDay, type CrunchDayTask, type CrunchTopic, type CrunchTaskType,
  type CrunchExam, type ChapterProgress,
} from "../../services/crunch";
import { studySourcesApi, type StudySource } from "../../services/study-sources";
import { useWindows } from "../../store/windows";
import type { WindowInstance } from "../../store/windows";
import { confirmDialog } from "../../store/mobileDialog";
import WorkspaceSourceSelector from "../study/WorkspaceSourceSelector";
import { teachLaunchInput } from "../teach/launch";
import { useLanguage } from "../../store/language";

// ----- helpers -----

const TASK_TYPE_META: Record<CrunchTaskType, { label: string; icon: typeof Brain; color: string }> = {
  new: { label: "Learn", icon: BookOpen, color: "#6366f1" },
  review: { label: "Review", icon: Brain, color: "#06b6d4" },
  practice: { label: "Practice", icon: Target, color: "#f59e0b" },
  mock: { label: "Mock", icon: Zap, color: "#ec4899" },
};

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function daysFromNow(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function masteryColor(m: number): string {
  if (m < 0) return "text-ink-muted";
  const pct = Math.round(m * 100);
  if (pct >= 80) return "text-success";
  if (pct >= 60) return "text-warning";
  return "text-danger";
}

function masteryPct(m: number): string {
  if (m < 0) return "—";
  return `${Math.round(m * 100)}%`;
}

// ----- exam setup form -----

interface ExamFormRow {
  id: string;
  name: string;
  date: string;
  syllabus: string;
  courseId: string;
  sourceIds: Set<string>;
  pastExamSourceIds: Set<string>;
  syllabusSourceId: string;
  workspaceId: string;
  mockSessionId: string;
}

function newExamRow(): ExamFormRow {
  return {
    id: `tmp_${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    date: "",
    syllabus: "",
    courseId: "",
    sourceIds: new Set(),
    pastExamSourceIds: new Set(),
    syllabusSourceId: "",
    workspaceId: "",
    mockSessionId: "",
  };
}

/** Collapsible wrapper around WorkspaceSourceSelector so the exam form stays
 *  compact — each exam has two of these (materials + past exams). */
function CollapsibleSources({
  title,
  icon: Icon,
  selectedIds,
  onToggle,
  onSourceAdded,
}: {
  title: string;
  icon: typeof Files;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSourceAdded: (s: StudySource) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-edge bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-ink"
      >
        <ChevronDown size={11} className={`shrink-0 text-ink-muted transition ${open ? "" : "-rotate-90"}`} />
        <Icon size={12} className="shrink-0 text-accent" />
        <span className="flex-1 font-medium">{title}</span>
        <span className="text-[10px] text-ink-muted">
          {selectedIds.size > 0 ? `${selectedIds.size} selected` : "none"}
        </span>
      </button>
      {open && (
        <div className="border-t border-edge px-2.5 py-2">
          <WorkspaceSourceSelector
            selectedIds={selectedIds}
            onToggle={onToggle}
            onSourceAdded={onSourceAdded}
            compact
          />
        </div>
      )}
    </div>
  );
}

function ExamSetupForm({
  initialExams,
  dailyMinutes,
  onSubmit,
  onCancel,
  generating,
}: {
  initialExams: ExamFormRow[];
  dailyMinutes: number;
  onSubmit: (exams: CrunchExamInput[], dailyMinutes: number) => void;
  onCancel: () => void;
  generating: boolean;
}) {
  const [rows, setRows] = useState<ExamFormRow[]>(initialExams.length > 0 ? initialExams : [newExamRow()]);
  const [minutes, setMinutes] = useState(dailyMinutes);
  const [error, setError] = useState<string | null>(null);
  // Source library (for the optional "syllabus file" select per exam).
  const [library, setLibrary] = useState<StudySource[]>([]);

  useEffect(() => {
    void studySourcesApi.list().then((r) => setLibrary(r.sources)).catch(() => {});
  }, []);

  const updateRow = (id: string, field: keyof ExamFormRow, value: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  /** Toggle a source id in one of the row's source sets. */
  const toggleSource = (id: string, field: "sourceIds" | "pastExamSourceIds", sourceId: string) => {
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const next = new Set(r[field]);
        if (next.has(sourceId)) next.delete(sourceId);
        else next.add(sourceId);
        return { ...r, [field]: next };
      })
    );
  };

  /** Auto-select a newly added source into the given set. */
  const autoSelectNew = (id: string, field: "sourceIds" | "pastExamSourceIds") => (s: StudySource) => {
    setLibrary((prev) => (prev.some((x) => x.id === s.id) ? prev : [s, ...prev]));
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const next = new Set(r[field]);
        next.add(s.id);
        return { ...r, [field]: next };
      })
    );
  };

  const addRow = () => setRows((rs) => [...rs, newExamRow()]);
  const removeRow = (id: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  const submit = () => {
    setError(null);
    const valid = rows.filter((r) => r.name.trim() && r.date);
    if (valid.length === 0) {
      setError("Add at least one exam with a name and date.");
      return;
    }
    for (const r of valid) {
      const d = new Date(r.date.length === 10 ? r.date + "T00:00:00Z" : r.date);
      if (isNaN(d.getTime())) {
        setError(`Invalid date for "${r.name}".`);
        return;
      }
      if (daysFromNow(r.date) < 0) {
        setError(`Exam "${r.name}" is in the past. Use a future date.`);
        return;
      }
    }
    onSubmit(
      valid.map((r) => ({
        id: r.id.startsWith("tmp_") ? undefined : r.id,
        name: r.name.trim(),
        date: r.date,
        syllabus: r.syllabus.trim(),
        courseId: r.courseId || undefined,
        sourceIds: [...r.sourceIds],
        pastExamSourceIds: [...r.pastExamSourceIds],
        syllabusSourceId: r.syllabusSourceId || undefined,
        workspaceId: r.workspaceId || undefined,
        mockSessionId: r.mockSessionId || undefined,
      })),
      minutes
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CalendarClock size={16} className="text-accent" />
        <span className="text-sm font-semibold text-ink">Set up your exams</span>
      </div>
      <p className="text-xs text-ink-muted">
        Add your upcoming exams with dates and syllabi. Crunch will read your flashcard mastery + grades, then generate a spaced-repetition study plan.
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {rows.map((r, i) => (
          <div key={r.id} className="rounded-xl border border-edge bg-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Exam {i + 1}</span>
              {rows.length > 1 && (
                <button
                  onClick={() => removeRow(r.id)}
                  className="rounded p-0.5 text-ink-muted transition hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={r.name}
                onChange={(e) => updateRow(r.id, "name", e.target.value)}
                placeholder="Exam name (e.g. Calculus Final)"
                className="col-span-2 rounded-md border border-edge bg-surface px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-focus/50"
              />
              <input
                type="date"
                value={r.date}
                onChange={(e) => updateRow(r.id, "date", e.target.value)}
                className="rounded-md border border-edge bg-surface px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-focus/50"
              />
              <input
                type="number"
                value={minutes}
                onChange={(e) => setMinutes(Math.max(15, Math.min(600, Number(e.target.value) || 120)))}
                min={15}
                max={600}
                step={15}
                className="rounded-md border border-edge bg-surface px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-focus/50"
                title="Daily study minutes (shared across all exams)"
              />
            </div>
            <textarea
              value={r.syllabus}
              onChange={(e) => updateRow(r.id, "syllabus", e.target.value)}
              placeholder="Syllabus — topics, chapters, or material to cover. One per line or comma-separated."
              rows={3}
              className="mt-2 w-full resize-y rounded-md border border-edge bg-surface px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-focus/50"
            />
            {library.length > 0 && (
              <select
                value={r.syllabusSourceId}
                onChange={(e) => updateRow(r.id, "syllabusSourceId", e.target.value)}
                className="mt-2 w-full rounded-md border border-edge bg-surface px-2.5 py-1.5 text-xs text-ink outline-none transition focus:border-focus/50"
                title="Optional: pick a study source that contains the exam syllabus — its text is used to build the chapter outline"
              >
                <option value="">Syllabus file (optional)…</option>
                {library.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <div className="mt-2 flex flex-col gap-1.5">
              <CollapsibleSources
                title="Study materials"
                icon={Files}
                selectedIds={r.sourceIds}
                onToggle={(sid) => toggleSource(r.id, "sourceIds", sid)}
                onSourceAdded={autoSelectNew(r.id, "sourceIds")}
              />
              <CollapsibleSources
                title="Past exams"
                icon={ClipboardList}
                selectedIds={r.pastExamSourceIds}
                onToggle={(sid) => toggleSource(r.id, "pastExamSourceIds", sid)}
                onSourceAdded={autoSelectNew(r.id, "pastExamSourceIds")}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-ink-muted transition hover:border-accent/40 hover:text-accent"
      >
        <Plus size={14} /> Add another exam
      </button>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-ink-muted">Daily study target: {fmtMinutes(minutes)}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
          >
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Generate plan
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- task row -----

function TaskRow({
  task,
  topic,
  exam,
  onToggle,
}: {
  task: CrunchDayTask;
  topic: CrunchTopic | undefined;
  exam: { id: string; name: string; color: string } | undefined;
  onToggle: (taskId: string, done: boolean) => void;
}) {
  const meta = TASK_TYPE_META[task.type] ?? TASK_TYPE_META.new;
  const Icon = meta.icon;
  const isExamDay = task.topicId === "exam-day";

  return (
    <button
      onClick={() => onToggle(task.id, !task.done)}
      className={`group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
        task.done
          ? "border-success bg-success-soft"
          : "border-edge bg-surface hover:border-accent/30"
      }`}
    >
      {task.done ? (
        <CheckCircle2 size={16} className="shrink-0 text-success" />
      ) : (
        <Circle size={16} className="shrink-0 text-ink-muted group-hover:text-accent" />
      )}
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
      >
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-xs font-medium ${task.done ? "text-ink-muted line-through" : "text-ink"}`}>
            {isExamDay ? `${exam?.name ?? "Exam"} — Exam day` : topic?.label ?? "Unknown topic"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-ink-muted">
          <span style={{ color: meta.color }}>{meta.label}</span>
          {exam && !isExamDay && (
            <span className="flex items-center gap-0.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: exam.color }} />
              {exam.name}
            </span>
          )}
          {topic && topic.mastery >= 0 && (
            <span className={masteryColor(topic.mastery)}>{masteryPct(topic.mastery)} mastery</span>
          )}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-muted">
        <Clock size={10} /> {fmtMinutes(task.duration)}
      </span>
    </button>
  );
}

// ----- day card -----

function DayCard({
  day,
  topics,
  exams,
  isToday,
  onToggleTask,
  onCompleteDay,
}: {
  day: CrunchDay;
  topics: CrunchTopic[];
  exams: { id: string; name: string; color: string }[];
  isToday: boolean;
  onToggleTask: (taskId: string, done: boolean) => void;
  onCompleteDay: (date: string) => void;
}) {
  const allDone = day.tasks.length > 0 && day.tasks.every((t) => t.done);
  const isPast = day.date < todayStr();
  const isFuture = day.date > todayStr();
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams]);

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        isToday
          ? "border-accent/40 bg-accent/5"
          : allDone
          ? "border-success bg-success-soft"
          : isPast
          ? "border-edge bg-surface-2 opacity-75"
          : "border-edge bg-surface-2"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${isToday ? "text-accent" : "text-ink"}`}>
            {fmtDate(day.date)}
          </span>
          {isToday && (
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent">
              Today
            </span>
          )}
          {allDone && day.tasks.length > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-success">
              <CheckCircle2 size={10} /> Done
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-ink-muted">
          <span className="flex items-center gap-0.5">
            <Clock size={10} />
            {fmtMinutes(day.completedMinutes)}/{fmtMinutes(day.totalMinutes)}
          </span>
          {day.tasks.length > 0 && !allDone && (
            <button
              onClick={() => onCompleteDay(day.date)}
              className="rounded px-1.5 py-0.5 text-[9px] font-medium text-accent transition hover:bg-accent/10"
            >
              Complete all
            </button>
          )}
        </div>
      </div>
      {day.tasks.length === 0 ? (
        <p className="py-1 text-[11px] italic text-ink-muted">No tasks scheduled.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {day.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              topic={topicById.get(task.topicId)}
              exam={examById.get(task.examId)}
              onToggle={onToggleTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ----- chapters (Teach Me integration) -----

function chapterChip(progress: ChapterProgress | undefined): { label: string; cls: string } {
  switch (progress?.status) {
    case "completed":
      return { label: "Completed", cls: "border-success bg-success-soft text-success" };
    case "in_progress":
      return {
        label: progress.total > 0 ? `${progress.covered}/${progress.total} concepts` : "In progress",
        cls: "border-accent/40 bg-accent/10 text-accent",
      };
    default:
      return { label: "Not started", cls: "border-edge text-ink-muted" };
  }
}

function ChapterRow({
  index,
  topic,
  busy,
  onTeach,
}: {
  index: number;
  topic: CrunchTopic;
  busy: boolean;
  onTeach: () => void;
}) {
  const chip = chapterChip(topic.chapterProgress);
  const started = topic.chapterProgress && topic.chapterProgress.status !== "not_started";
  const completed = topic.chapterProgress?.status === "completed";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-2.5 py-1.5">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
          completed ? "bg-success text-white" : "bg-surface-3 text-ink-muted"
        }`}
      >
        {completed ? <CheckCircle2 size={11} /> : index}
      </span>
      <span className={`min-w-0 flex-1 truncate text-xs ${completed ? "text-ink-muted line-through" : "text-ink"}`}>
        {topic.label}
      </span>
      {topic.mastery >= 0 && (
        <span className={`shrink-0 text-[10px] ${masteryColor(topic.mastery)}`}>
          {masteryPct(topic.mastery)}
        </span>
      )}
      <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] ${chip.cls}`}>{chip.label}</span>
      <button
        onClick={onTeach}
        disabled={busy}
        className="flex shrink-0 items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? <Loader2 size={10} className="animate-spin" /> : <Presentation size={10} />}
        {started ? "Continue" : "Teach me"}
      </button>
    </div>
  );
}

function ExamChaptersCard({
  exam,
  topics,
  busyId,
  onTeach,
  onMock,
}: {
  exam: CrunchExam;
  topics: CrunchTopic[];
  busyId: string | null;
  onTeach: (topicId: string) => void;
  onMock: (examId: string) => void;
}) {
  const chapters = topics.filter((t) => t.examId === exam.id);
  const done = chapters.filter((t) => t.chapterProgress?.status === "completed").length;
  const daysLeft = daysFromNow(exam.date);
  const hasSources = (exam.sourceIds?.length ?? 0) + (exam.pastExamSourceIds?.length ?? 0) > 0;
  const mockBusy = busyId === `mock:${exam.id}`;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-edge bg-surface p-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: exam.color }} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{exam.name}</span>
        <span className="shrink-0 text-[10px] text-ink-muted">
          {daysLeft >= 0 ? `${daysLeft}d left` : "past"} · {done}/{chapters.length} chapters
        </span>
        <button
          onClick={() => onMock(exam.id)}
          disabled={mockBusy || (exam.pastExamSourceIds?.length ?? 0) === 0}
          title={
            (exam.pastExamSourceIds?.length ?? 0) === 0
              ? "Attach at least one past exam to run a mock exam"
              : "Practice exam — the tutor quizzes you with questions in the style of your past papers"
          }
          className="flex shrink-0 items-center gap-1 rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-[10px] font-medium text-warning transition hover:brightness-95 disabled:opacity-40"
        >
          {mockBusy ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
          Mock exam
        </button>
      </div>
      {!hasSources && (
        <p className="text-[10px] text-ink-muted">
          No study materials attached — attach sources via Edit to unlock Teach Me chapters.
        </p>
      )}
      {hasSources && chapters.length === 0 && (
        <p className="text-[10px] italic text-ink-muted">No chapters for this exam.</p>
      )}
      <div className="flex flex-col gap-1">
        {chapters.map((t, i) => (
          <ChapterRow
            key={t.id}
            index={i + 1}
            topic={t}
            busy={busyId === `teach:${t.id}`}
            onTeach={() => onTeach(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ChaptersPanel({
  data,
  focusExamId,
  busyId,
  onTeach,
  onMock,
}: {
  data: CrunchPlanData;
  focusExamId: string | null;
  busyId: string | null;
  onTeach: (topicId: string) => void;
  onMock: (examId: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(focusExamId));
  const done = data.topics.filter((t) => t.chapterProgress?.status === "completed").length;
  const started = data.topics.filter((t) => t.chapterProgress && t.chapterProgress.status !== "not_started").length;
  return (
    <div className="rounded-xl border border-edge bg-surface-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink"
      >
        <ChevronDown size={12} className={`shrink-0 text-ink-muted transition ${open ? "" : "-rotate-90"}`} />
        <ListChecks size={13} className="shrink-0 text-accent" />
        <span className="flex-1 font-medium">Chapters</span>
        <span className="text-[10px] text-ink-muted">
          {done}/{data.topics.length} complete{started > done ? ` · ${started - done} in progress` : ""}
        </span>
      </button>
      {open && (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto border-t border-edge px-3 py-2">
          {data.exams.map((exam) => (
            <ExamChaptersCard
              key={exam.id}
              exam={exam}
              topics={data.topics}
              busyId={busyId}
              onTeach={onTeach}
              onMock={onMock}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ----- main component -----

export default function CrunchApp({ win }: { win: WindowInstance }) {
  const [state, setState] = useState<CrunchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  // At-risk concept surfaced by the Pulse app ("Crunch" button on an at-risk
  // row). When set, a banner is shown with a "Review now" CTA that opens the
  // Flashcards app on the concept's linked deck.
  const [pulseAtRisk, setPulseAtRisk] = useState<{ label: string; deckIds: string[] } | null>(null);
  const [teachBusy, setTeachBusy] = useState<string | null>(null);
  const [focusExamId, setFocusExamId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { open } = useWindows();
  const globalLanguage = useLanguage((s) => s.language);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await crunchApi.get();
      setState(s);
      if (s.status === "building") {
        setGenerating(true);
        startPolling();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Crunch plan");
    } finally {
      setLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await crunchApi.get();
        setState(s);
        if (s.status === "ready" || s.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          if (s.status === "error") setError(s.error || "Generation failed");
          setShowSetup(false);
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setGenerating(false);
        setError("Failed to check generation status");
      }
    }, 2500);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Check for a focus date passed by the Athena open_crunch client action.
  useEffect(() => {
    if (!state?.data || !win?.id) return;
    const focus = sessionStorage.getItem(`crunch:focus:${win.id}`);
    if (focus) {
      sessionStorage.removeItem(`crunch:focus:${win.id}`);
      setFocusDate(focus);
    }
  }, [state?.data, win?.id]);

  // Check for an at-risk concept passed by the Pulse app's "Crunch" button.
  useEffect(() => {
    if (!win?.id) return;
    const raw = sessionStorage.getItem(`crunch:pulse-at-risk:${win.id}`);
    if (raw) {
      sessionStorage.removeItem(`crunch:pulse-at-risk:${win.id}`);
      try {
        const parsed = JSON.parse(raw) as { label: string; deckIds: string[] };
        setPulseAtRisk(parsed);
      } catch {
        // ignore malformed signal
      }
    }
    const examFocus = sessionStorage.getItem(`crunch:focus-exam:${win.id}`);
    if (examFocus) {
      sessionStorage.removeItem(`crunch:focus-exam:${win.id}`);
      setFocusExamId(examFocus);
    }
  }, [win?.id]);

  const generate = async (exams: CrunchExamInput[], dailyMinutes: number) => {
    setGenerating(true);
    setError(null);
    try {
      await crunchApi.generate(exams, dailyMinutes);
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start generation");
      setGenerating(false);
    }
  };

  const toggleTask = async (taskId: string, done: boolean) => {
    if (!state?.data) return;
    // Optimistic update.
    setState((prev) => {
      if (!prev?.data) return prev;
      const newData = { ...prev.data, days: prev.data.days.map((d) => ({
        ...d,
        tasks: d.tasks.map((t) => t.id === taskId ? { ...t, done, completedAt: done ? new Date().toISOString() : null } : t),
        completedMinutes: d.tasks.reduce((a, t) => a + (t.id === taskId ? (done ? t.duration : 0) : (t.done ? t.duration : 0)), 0),
      }))};
      return { ...prev, data: newData };
    });
    try {
      const res = await crunchApi.logProgress(taskId, done);
      setState((prev) => prev ? { ...prev, data: res.data } : prev);
    } catch {
      // Revert on failure.
      void load();
    }
  };

  const completeDay = async (date: string) => {
    if (!state?.data) return;
    try {
      const res = await crunchApi.completeDay(date);
      setState((prev) => prev ? { ...prev, data: res.data } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to complete day");
    }
  };

  const deletePlan = async () => {
    if (!(await confirmDialog("Delete your entire Crunch plan? This cannot be undone.", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await crunchApi.delete();
      setState(null);
      setShowSetup(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete plan");
    }
  };

  /** Start/resume the chapter's Teach Me session and open it. */
  const teachChapter = async (topicId: string) => {
    setTeachBusy(`teach:${topicId}`);
    setError(null);
    try {
      const res = await crunchApi.teach(topicId, globalLanguage === "cs" ? "cs" : "en");
      open(teachLaunchInput(res.sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the chapter session");
    } finally {
      setTeachBusy(null);
    }
  };

  /** Start/resume the exam's mock-exam session and open it. */
  const startMock = async (examId: string) => {
    setTeachBusy(`mock:${examId}`);
    setError(null);
    try {
      const res = await crunchApi.mock(examId);
      open(teachLaunchInput(res.sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the mock exam");
    } finally {
      setTeachBusy(null);
    }
  };

  const data = state?.data ?? null;
  const today = todayStr();

  // Build exam form rows from existing plan (for editing).
  const existingExamRows: ExamFormRow[] = data ? data.exams.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    syllabus: e.syllabus,
    courseId: e.courseId ?? "",
    sourceIds: new Set(e.sourceIds ?? []),
    pastExamSourceIds: new Set(e.pastExamSourceIds ?? []),
    syllabusSourceId: e.syllabusSourceId ?? "",
    workspaceId: e.workspaceId ?? "",
    mockSessionId: e.mockSessionId ?? "",
  })) : [];

  // Navigation: scroll to focus date or today.
  const visibleDays = useMemo(() => {
    if (!data) return [];
    return data.days;
  }, [data]);

  const focusIndex = useMemo(() => {
    if (!data) return 0;
    const target = focusDate ?? today;
    const idx = data.days.findIndex((d) => d.date >= target);
    return idx >= 0 ? idx : 0;
  }, [data, focusDate, today]);

  const navigateDay = (delta: number) => {
    if (!data) return;
    const newIdx = Math.max(0, Math.min(data.days.length - 1, focusIndex + delta));
    setFocusDate(data.days[newIdx].date);
  };

  const behindPct = data?.stats.behindPct ?? 0;
  const isBehind = behindPct >= 20;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="text-accent" />
          <span className="text-sm font-semibold text-ink">Crunch</span>
          {data && (
            <span className="text-[11px] text-ink-muted">
              {data.stats.examCount} exam{data.stats.examCount !== 1 ? "s" : ""} · {data.stats.topicCount} topics · {fmtMinutes(data.stats.completedMinutes)}/{fmtMinutes(data.stats.totalMinutes)} done
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {data && (
            <>
              {data.stats.nextExamName && data.stats.nextExamDays !== null && (
                <span className="flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-[11px] text-ink-muted">
                  <GraduationCap size={12} className="text-accent" />
                  {data.stats.nextExamName} in {data.stats.nextExamDays}d
                </span>
              )}
              <button
                onClick={() => setShowSetup(true)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-surface-3 hover:text-ink"
              >
                <RefreshCw size={13} /> Edit
              </button>
              <button
                onClick={deletePlan}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Behind alert */}
      {data && isBehind && (
        <div className="flex items-center gap-2 rounded-lg border border-warning bg-warning-soft px-3 py-2 text-xs text-warning">
          <TrendingDown size={14} />
          <span>You're {behindPct}% behind on your study plan. Catch up to stay on track for your exams.</span>
        </div>
      )}

      {/* At-risk concept surfaced by Pulse */}
      {pulseAtRisk && (
        <div className="flex items-center gap-2 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
          <TrendingDown size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">
            Pulse predicts <span className="font-semibold">{pulseAtRisk.label}</span> will drop below mastery before your exam.
          </span>
          {pulseAtRisk.deckIds[0] && (
            <button
              onClick={() => {
                open({ appId: "flashcards", title: "Flashcards", icon: "Brain", payload: { deckId: pulseAtRisk.deckIds[0] } });
                setPulseAtRisk(null);
              }}
              className="flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-[11px] font-medium text-accent transition hover:bg-accent/25"
            >
              <Brain size={12} /> Review now
            </button>
          )}
          <button
            onClick={() => setPulseAtRisk(null)}
            className="shrink-0 rounded-md p-0.5 text-danger/60 transition hover:text-danger"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Generating progress */}
      {generating && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-edge bg-surface-2 p-3 text-xs text-ink-muted">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-accent" />
              Generating your adaptive study plan…
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full w-1/3 animate-progress-slide rounded-full bg-accent" />
          </div>
          <span>Reading your flashcard mastery + grades, then scheduling spaced-repetition sessions…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={20} className="animate-spin text-ink-muted" />
        </div>
      )}

      {/* Setup form */}
      {showSetup && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-edge bg-surface-2 p-4">
          <ExamSetupForm
            initialExams={existingExamRows}
            dailyMinutes={data?.dailyMinutes ?? 120}
            onSubmit={generate}
            onCancel={() => setShowSetup(false)}
            generating={generating}
          />
        </div>
      )}

      {/* Empty state */}
      {!loading && !data && !showSetup && !generating && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
            <CalendarClock size={32} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Your adaptive exam prep planner</p>
            <p className="mt-1 max-w-sm text-xs text-ink-muted">
              Crunch reads your flashcard mastery + grades, then builds a day-by-day spaced-repetition plan that auto-adjusts as you log progress. Get alerts when you're falling behind.
            </p>
          </div>
          <button
            onClick={() => setShowSetup(true)}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90"
          >
            <Sparkles size={15} /> Set up my exams
          </button>
        </div>
      )}

      {/* Chapters (Teach Me) */}
      {data && !showSetup && (
        <ChaptersPanel
          data={data}
          focusExamId={focusExamId}
          busyId={teachBusy}
          onTeach={teachChapter}
          onMock={startMock}
        />
      )}

      {/* Day-by-day plan */}
      {data && !showSetup && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {/* Day navigation */}
          <div className="flex items-center justify-between rounded-lg border border-edge bg-surface-2 px-3 py-1.5">
            <button
              onClick={() => navigateDay(-1)}
              disabled={focusIndex === 0}
              className="rounded p-1 text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-medium text-ink">
              {fmtDate(data.days[focusIndex]?.date ?? today)} · Day {focusIndex + 1}/{data.days.length}
            </span>
            <button
              onClick={() => navigateDay(1)}
              disabled={focusIndex >= data.days.length - 1}
              className="rounded p-1 text-ink-muted transition hover:bg-surface-3 hover:text-ink disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Days list */}
          <div className="flex flex-col gap-2 overflow-y-auto">
            {/* Show a window of days around the focus index */}
            {visibleDays.slice(Math.max(0, focusIndex - 1), Math.min(visibleDays.length, focusIndex + 6)).map((day) => (
              <DayCard
                key={day.date}
                day={day}
                topics={data.topics}
                exams={data.exams}
                isToday={day.date === today}
                onToggleTask={toggleTask}
                onCompleteDay={completeDay}
              />
            ))}
            {focusIndex + 6 < visibleDays.length && (
              <button
                onClick={() => setFocusDate(visibleDays[focusIndex + 6]?.date ?? null)}
                className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-edge px-3 py-2 text-xs text-ink-muted transition hover:border-accent/40 hover:text-accent"
              >
                <ChevronRight size={14} /> Show more days
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
