import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Circle, Plus, Trash2 } from "lucide-react";
import { tasksApi, STATUS_LABELS } from "../services/tasks";
import { taskWorkspacesApi } from "../services/task-workspaces";
import type { Task, TaskPriority, TaskStatus, TaskWorkspace } from "../types";
import {
  MobileButton, MobileContainer, MobileEmpty, MobileFab, MobileInput, MobileLoading,
  MobileModal, MobileSelect, MobileTextarea,
} from "./MobileUi";

const priorityStyle: Record<TaskPriority, string> = { HIGH: "bg-rose-400", MEDIUM: "bg-amber-400", LOW: "bg-sky-400" };
const priorityLabel: Record<TaskPriority, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
const ACTIVE_WS_KEY = "athena.activeTaskWorkspace";

export default function MobileTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workspaces, setWorkspaces] = useState<(TaskWorkspace & { taskCount: number })[]>([]);
  const [activeWsId, setActiveWsId] = useState<string | null>(() => localStorage.getItem(ACTIVE_WS_KEY));
  const [wsPickerOpen, setWsPickerOpen] = useState(false);
  const [status, setStatus] = useState<"all" | TaskStatus>("all");
  const [draft, setDraft] = useState("");
  const [draftPriority, setDraftPriority] = useState<TaskPriority>("MEDIUM");
  const [draftDue, setDraftDue] = useState("");
  const [showDraftOptions, setShowDraftOptions] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);

  // Detail editor
  const [editing, setEditing] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPriority, setEditPriority] = useState<TaskPriority>("MEDIUM");
  const [editStatus, setEditStatus] = useState<TaskStatus>("TODO");
  const [editDue, setEditDue] = useState("");
  const [editWs, setEditWs] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [taskResult, wsResult] = await Promise.all([
      tasksApi.list(activeWsId ?? undefined).catch(() => null),
      taskWorkspacesApi.list().catch(() => null),
    ]);
    setTasks(taskResult?.tasks ?? []);
    const ws = wsResult?.workspaces ?? [];
    setWorkspaces(ws);
    if (activeWsId && !ws.some((w) => w.id === activeWsId)) {
      setActiveWsId(null);
      localStorage.removeItem(ACTIVE_WS_KEY);
    }
    setLoading(false);
  }, [activeWsId]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => tasks.filter((task) => status === "all" || task.status === status).sort((a, b) => Number(a.status === "DONE") - Number(b.status === "DONE") || +new Date(a.dueDate || "2999-01-01") - +new Date(b.dueDate || "2999-01-01")), [tasks, status]);

  const create = async () => {
    if (!draft.trim()) return;
    const result = await tasksApi.create({
      title: draft.trim(),
      status: "TODO",
      priority: draftPriority,
      workspaceId: activeWsId ?? undefined,
      dueDate: draftDue ? new Date(draftDue).toISOString() : null,
    }).catch(() => null);
    if (result) setTasks((list) => [result.task, ...list]);
    setDraft("");
    setDraftPriority("MEDIUM");
    setDraftDue("");
    setShowDraftOptions(false);
    setAdding(false);
    void load();
  };

  const toggle = async (task: Task) => {
    const next: TaskStatus = task.status === "DONE" ? "TODO" : "DONE";
    setTasks((list) => list.map((item) => item.id === task.id ? { ...item, status: next } : item));
    await tasksApi.update(task.id, { status: next }).catch(() => { void load(); });
  };

  const selectWs = (id: string | null) => {
    setActiveWsId(id);
    if (id) localStorage.setItem(ACTIVE_WS_KEY, id); else localStorage.removeItem(ACTIVE_WS_KEY);
    setWsPickerOpen(false);
  };
  const activeWs = workspaces.find((w) => w.id === activeWsId) ?? null;

  const openEditor = (task: Task) => {
    setEditing(task);
    setEditTitle(task.title);
    setEditDesc(task.description ?? "");
    setEditPriority(task.priority);
    setEditStatus(task.status);
    setEditDue(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : "");
    setEditWs(task.workspaceId ?? "");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const res = await tasksApi.update(editing.id, {
        title: editTitle.trim() || editing.title,
        description: editDesc,
        priority: editPriority,
        status: editStatus,
        dueDate: editDue ? new Date(editDue).toISOString() : null,
        workspaceId: editWs || null,
      });
      if (res?.task) {
        setTasks((list) => list.map((t) => (t.id === res.task.id ? res.task : t)));
        setEditing(res.task);
      }
    } catch {
      /* ignore */
    }
    setSavingEdit(false);
  };

  const deleteTask = async () => {
    if (!editing) return;
    if (!window.confirm("Delete this task?")) return;
    await tasksApi.delete(editing.id).catch(() => {});
    setTasks((list) => list.filter((t) => t.id !== editing.id));
    setEditing(null);
  };

  return (
    <MobileContainer>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-accent">Get it done</p>
          <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight text-ink">Tasks</h1>
        </div>
        <MobileFab onClick={() => setAdding(true)} icon={<Plus size={22} />} label="New task" />
      </header>

      <button type="button" onClick={() => setWsPickerOpen((v) => !v)} className="mb-4 flex w-full items-center justify-between rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-left active:bg-surface-3">
        <span className="flex items-center gap-2">
          {activeWs ? <span className="h-3 w-3 rounded-full" style={{ background: activeWs.color }} /> : <Circle size={14} className="text-ink-muted" />}
          <span className="text-sm font-medium text-ink">{activeWs ? activeWs.name : "All workspaces"}</span>
        </span>
        <ChevronDown size={18} className={`text-ink-muted transition ${wsPickerOpen ? "rotate-180" : ""}`} />
      </button>
      {wsPickerOpen && (
        <div className="mb-4 space-y-1 rounded-2xl border border-edge bg-surface p-1.5">
          <button type="button" onClick={() => selectWs(null)} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${!activeWsId ? "bg-surface-2 ring-1 ring-accent/60 text-ink" : "text-ink active:bg-surface-2"}`}>
            <Circle size={14} className="text-ink-muted" /> All workspaces
          </button>
          {workspaces.map((ws) => (
            <button key={ws.id} type="button" onClick={() => selectWs(ws.id)} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${activeWsId === ws.id ? "bg-surface-2 ring-1 ring-accent/60 text-ink" : "text-ink active:bg-surface-2"}`}>
              <span className="h-3 w-3 rounded-full" style={{ background: ws.color }} /> {ws.name}
              <span className="ml-auto text-xs text-ink-muted">{ws.taskCount}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {(["all", "TODO", "IN_PROGRESS", "DONE"] as const).map((value) => (
          <button key={value} type="button" onClick={() => setStatus(value)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${status === value ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted"}`}>
            {value === "all" ? "All" : STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      {adding && (
        <form onSubmit={(event) => { event.preventDefault(); void create(); }} className="mb-4 rounded-2xl border border-accent/30 bg-accent/10 p-3">
          <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What needs doing?" className="w-full bg-transparent px-2 py-2 text-base text-ink outline-none placeholder:text-ink-muted" />
          {showDraftOptions && (
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                {(["LOW", "MEDIUM", "HIGH"] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setDraftPriority(p)} className={`flex-1 rounded-xl py-2 text-xs font-medium ${draftPriority === p ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-muted"}`}>
                    {priorityLabel[p]}
                  </button>
                ))}
              </div>
              <input type="datetime-local" value={draftDue} onChange={(e) => setDraftDue(e.target.value)} className="w-full rounded-xl border border-edge bg-surface-2 px-3 py-2 text-sm text-ink outline-none" />
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" onClick={() => setShowDraftOptions((v) => !v)} className="text-xs font-medium text-accent">
              {showDraftOptions ? "Hide options" : "Priority & due date"}
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setAdding(false); setShowDraftOptions(false); }} className="rounded-xl px-3 py-2 text-sm text-ink-muted">Cancel</button>
              <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg">Add task</button>
            </div>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {loading ? <MobileLoading /> : visible.length ? visible.map((task) => (
          <article key={task.id} className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-2 p-4">
            <button type="button" onClick={() => void toggle(task)} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${task.status === "DONE" ? "border-emerald-400 bg-emerald-400 text-surface" : "border-ink-muted text-transparent"}`} aria-label="Toggle done">
              <Check size={16} />
            </button>
            <button type="button" onClick={() => openEditor(task)} className="min-w-0 flex-1 text-left">
              <p className={`truncate text-sm font-semibold ${task.status === "DONE" ? "text-ink-muted line-through" : "text-ink"}`}>{task.title}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "No deadline"}
                {task.description ? <span className="ml-1 truncate">· {task.description}</span> : null}
              </p>
            </button>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${priorityStyle[task.priority]}`} />
          </article>
        )) : <MobileEmpty text="No tasks here. Your future self approves." />}
      </div>

      {/* Task detail editor */}
      <MobileModal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit task"
        footer={
          <>
            <MobileButton variant="danger" onClick={() => void deleteTask()}><Trash2 size={16} /> Delete</MobileButton>
            <MobileButton variant="ghost" onClick={() => setEditing(null)}>Close</MobileButton>
            <MobileButton onClick={() => void saveEdit()} disabled={savingEdit}>{savingEdit ? "Saving…" : "Save"}</MobileButton>
          </>
        }
      >
        <label className="block text-xs font-medium text-ink-muted">Title</label>
        <MobileInput value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Task title" />
        <label className="block text-xs font-medium text-ink-muted">Description</label>
        <MobileTextarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Add details…" rows={3} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-muted">Priority</label>
            <MobileSelect value={editPriority} onChange={(e) => setEditPriority(e.target.value as TaskPriority)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </MobileSelect>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted">Status</label>
            <MobileSelect value={editStatus} onChange={(e) => setEditStatus(e.target.value as TaskStatus)}>
              <option value="TODO">To do</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="DONE">Done</option>
            </MobileSelect>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted">Due date</label>
          <input type="datetime-local" value={editDue} onChange={(e) => setEditDue(e.target.value)} className="w-full rounded-2xl border border-edge bg-surface-2 px-4 py-3 text-base text-ink outline-none focus:border-accent/60" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted">Workspace</label>
          <MobileSelect value={editWs} onChange={(e) => setEditWs(e.target.value)}>
            <option value="">None</option>
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </MobileSelect>
        </div>
      </MobileModal>
    </MobileContainer>
  );
}
