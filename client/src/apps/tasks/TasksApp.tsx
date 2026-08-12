import { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus, Trash2, Calendar, Loader2, ChevronDown, Folder,
  Check, Pencil, FolderInput,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { tasksApi, STATUS_LABELS, STATUS_ORDER, PRIORITY_LABELS, PRIORITY_COLORS } from "../../services/tasks";
import { taskWorkspacesApi } from "../../services/task-workspaces";
import { linksApi } from "../../services/links";
import type { Task, TaskStatus, TaskPriority, TaskWorkspace } from "../../types";
import type { WindowInstance } from "../../store/windows";
import LinkDragHandle from "../links/LinkDragHandle";
import LinkBadge from "../links/LinkBadge";
import { useLinkDrop } from "../links/useLinkDrop";
import { useDataRefreshVersion } from "../../store/dataRefresh";

const WS_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444"];
const ACTIVE_WS_KEY = "athena.activeTaskWorkspace";

export default function TasksApp(_: { win: WindowInstance }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workspaces, setWorkspaces] = useState<(TaskWorkspace & { taskCount: number })[]>([]);
  const [activeWsId, setActiveWsId] = useState<string | null>(() => localStorage.getItem(ACTIVE_WS_KEY));
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<TaskStatus | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [showWsForm, setShowWsForm] = useState(false);
  const [editingWs, setEditingWs] = useState<TaskWorkspace | null>(null);
  const [wsName, setWsName] = useState("");
  const [wsColor, setWsColor] = useState(WS_COLORS[0]);
  const refreshVersion = useDataRefreshVersion("tasks");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const loadWorkspaces = useCallback(async () => {
    try {
      const { workspaces: ws } = await taskWorkspacesApi.list();
      setWorkspaces(ws);
      // If the active workspace no longer exists, reset to "All" (null)
      if (activeWsId && !ws.some((w) => w.id === activeWsId)) {
        setActiveWsId(null);
        localStorage.removeItem(ACTIVE_WS_KEY);
      }
    } catch (e) {
      console.error(e);
    }
  }, [activeWsId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { tasks: list } = await tasksApi.list(activeWsId ?? undefined);
      setTasks(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeWsId]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when Athena mutates tasks data
  useEffect(() => {
    if (refreshVersion > 0) {
      load();
      loadWorkspaces();
    }
  }, [refreshVersion, load, loadWorkspaces]);

  const activeWs = workspaces.find((w) => w.id === activeWsId) ?? null;

  const selectWs = (id: string | null) => {
    setActiveWsId(id);
    if (id) localStorage.setItem(ACTIVE_WS_KEY, id);
    else localStorage.removeItem(ACTIVE_WS_KEY);
    setWsDropdownOpen(false);
  };

  const byStatus = (status: TaskStatus) => tasks.filter((t) => t.status === status);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;
    const overId = String(over.id);
    let newStatus: TaskStatus | null = null;
    if (STATUS_ORDER.includes(overId as TaskStatus)) {
      newStatus = overId as TaskStatus;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) newStatus = overTask.status;
    }
    if (newStatus && newStatus !== activeTask.status) {
      const updated = { ...activeTask, status: newStatus };
      setTasks((prev) => prev.map((t) => (t.id === activeTask.id ? updated : t)));
      try {
        await tasksApi.update(activeTask.id, { status: newStatus });
      } catch {
        setTasks((prev) => prev.map((t) => (t.id === activeTask.id ? activeTask : t)));
      }
    }
  };

  const createTask = async (status: TaskStatus) => {
    if (!newTitle.trim()) return;
    try {
      const { task } = await tasksApi.create({
        title: newTitle,
        status,
        workspaceId: activeWsId ?? undefined,
      });
      setTasks((prev) => [...prev, task]);
      setNewTitle("");
      setAddingTo(null);
      loadWorkspaces();
    } catch (e) {
      console.error(e);
    }
  };

  const updateTask = async (id: string, data: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)));
    try {
      await tasksApi.update(id, data);
    } catch (e) {
      console.error(e);
      load();
    }
  };

  const deleteTask = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await tasksApi.delete(id);
      loadWorkspaces();
    } catch {
      load();
    }
  };

  // Move a task to a different workspace.
  const moveTask = async (id: string, workspaceId: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.workspaceId === workspaceId) return;
    // Optimistically update + remove from current view if a specific ws is active
    setTasks((prev) =>
      activeWsId && activeWsId !== workspaceId
        ? prev.filter((t) => t.id !== id)
        : prev.map((t) => (t.id === id ? { ...t, workspaceId } : t))
    );
    try {
      await tasksApi.update(id, { workspaceId });
      loadWorkspaces();
    } catch (e) {
      console.error(e);
      load();
    }
  };

  // ===== Workspace CRUD =====
  const openNewWsForm = () => {
    setEditingWs(null);
    setWsName("");
    setWsColor(WS_COLORS[0]);
    setShowWsForm(true);
    setWsDropdownOpen(false);
  };

  const openEditWsForm = (ws: TaskWorkspace) => {
    setEditingWs(ws);
    setWsName(ws.name);
    setWsColor(ws.color);
    setShowWsForm(true);
    setWsDropdownOpen(false);
  };

  const saveWs = async () => {
    if (!wsName.trim()) return;
    try {
      if (editingWs) {
        await taskWorkspacesApi.update(editingWs.id, { name: wsName, color: wsColor });
      } else {
        const { workspace } = await taskWorkspacesApi.create({ name: wsName, color: wsColor });
        // Auto-switch to the newly created workspace
        selectWs(workspace.id);
      }
      setShowWsForm(false);
      loadWorkspaces();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteWs = async (ws: TaskWorkspace) => {
    const wsWithCount = workspaces.find((w) => w.id === ws.id);
    const count = wsWithCount?.taskCount ?? 0;
    if (!confirm(`Delete workspace "${ws.name}" and all ${count} task${count === 1 ? "" : "s"} in it?`)) return;
    try {
      await taskWorkspacesApi.delete(ws.id);
      if (activeWsId === ws.id) selectWs(null);
      loadWorkspaces();
      load();
    } catch (e) {
      console.error(e);
    }
  };

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-ink-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface/50">
      {/* Header with workspace dropdown */}
      <div className="flex items-center justify-between border-b border-edge/40 px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* Workspace dropdown */}
          <div className="relative">
            <button
              onClick={() => setWsDropdownOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl border border-edge/40 bg-surface-2/50 px-2.5 py-1.5 text-sm font-semibold text-ink backdrop-blur-md transition hover:bg-white/[0.04]"
            >
              {activeWs ? (
                <>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeWs.color }} />
                  <span className="max-w-[140px] truncate">{activeWs.name}</span>
                </>
              ) : (
                <>
                  <Folder size={14} className="text-ink-muted" />
                  <span>All Tasks</span>
                </>
              )}
              <ChevronDown size={14} className="text-ink-muted" />
            </button>
            {wsDropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setWsDropdownOpen(false)} />
                <div className="absolute left-0 top-full z-40 mt-1 min-w-[200px] rounded-2xl border border-edge/50 bg-surface/95 p-1 shadow-window backdrop-blur-xl">
                  {/* All Tasks */}
                  <button
                    onClick={() => selectWs(null)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-white/[0.04] ${
                      !activeWsId ? "bg-surface-3 text-ink" : "text-ink-muted"
                    }`}
                  >
                    <Folder size={14} />
                    <span className="flex-1 text-left">All Tasks</span>
                    {!activeWsId && <Check size={14} />}
                  </button>
                  {workspaces.length > 0 && <div className="my-1 border-t border-edge" />}
                  {workspaces.map((ws) => (
                    <div key={ws.id} className="group flex items-center">
                      <button
                        onClick={() => selectWs(ws.id)}
                        className={`flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-white/[0.04] ${
                          activeWsId === ws.id ? "bg-surface-3 text-ink" : "text-ink-muted"
                        }`}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ws.color }} />
                        <span className="flex-1 truncate text-left">{ws.name}</span>
                        <span className="text-[10px] text-ink-muted">{ws.taskCount}</span>
                        {activeWsId === ws.id && <Check size={14} />}
                      </button>
                      <button
                        onClick={() => openEditWsForm(ws)}
                        className="rounded p-1 text-ink-muted opacity-0 transition hover:bg-white/[0.04] hover:text-ink group-hover:opacity-100"
                        title="Edit workspace"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  ))}
                  <div className="my-1 border-t border-edge" />
                  <button
                    onClick={openNewWsForm}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-accent transition hover:bg-white/[0.04]"
                  >
                    <Plus size={14} />
                    <span>New Workspace</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <p className="text-xs text-ink-muted">
          {tasks.length} task{tasks.length === 1 ? "" : "s"} · drag between columns
        </p>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex flex-1 gap-3 overflow-x-auto p-3 snap-x snap-mandatory">
          {STATUS_ORDER.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={byStatus(status)}
              addingTo={addingTo}
              setAddingTo={setAddingTo}
              newTitle={newTitle}
              setNewTitle={setNewTitle}
              onCreate={() => createTask(status)}
              onUpdate={updateTask}
              onDelete={deleteTask}
              onMove={moveTask}
              workspaces={workspaces}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} dragging /> : null}
        </DragOverlay>
      </DndContext>

      {/* Workspace create/edit modal */}
      <AnimatePresence>
        {showWsForm && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setShowWsForm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-edge/50 bg-surface/95 p-5 shadow-window backdrop-blur-xl"
            >
              <h3 className="mb-4 text-sm font-semibold text-ink">
                {editingWs ? "Edit Workspace" : "New Workspace"}
              </h3>
              <input
                autoFocus
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveWs(); }}
                placeholder="Workspace name (e.g. Thesis, Side Project)"
                className="mb-3 w-full rounded-xl border border-edge/40 bg-surface-2/50 px-3 py-2 text-sm text-ink outline-none backdrop-blur-sm focus:border-accent"
              />
              <div className="mb-4 flex gap-2">
                {WS_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setWsColor(c)}
                    className={`h-7 w-7 rounded-full transition ${wsColor === c ? "ring-2 ring-offset-2 ring-offset-surface ring-accent" : ""}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex justify-end gap-2">
                {editingWs && (
                  <button
                    onClick={() => deleteWs(editingWs)}
                    className="mr-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-500/10"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                )}
                <button
                  onClick={() => setShowWsForm(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={saveWs}
                  className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90"
                >
                  {editingWs ? "Save" : "Create"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Column({
  status, tasks, addingTo, setAddingTo, newTitle, setNewTitle, onCreate, onUpdate, onDelete, onMove, workspaces,
}: {
  status: TaskStatus;
  tasks: Task[];
  addingTo: TaskStatus | null;
  setAddingTo: (s: TaskStatus | null) => void;
  newTitle: string;
  setNewTitle: (s: string) => void;
  onCreate: () => void;
  onUpdate: (id: string, data: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, workspaceId: string) => void;
  workspaces: (TaskWorkspace & { taskCount: number })[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-2xl border border-edge/40 bg-surface-2/50 backdrop-blur-md shadow-lg">
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl bg-surface-2/40 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{STATUS_LABELS[status]}</span>
          <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-muted">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={() => setAddingTo(addingTo === status ? null : status)}
          className="flex h-8 w-8 items-center justify-center rounded text-ink-muted hover:bg-white/[0.04] hover:text-ink active:bg-surface-3"
        >
          <Plus size={16} />
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 overflow-y-auto p-2 transition ${isOver ? "bg-accent/5 rounded-b-2xl" : ""}`}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableCard
              key={task.id}
              task={task}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onMove={onMove}
              workspaces={workspaces}
            />
          ))}
        </SortableContext>

        {addingTo === status && (
          <div className="rounded-xl border border-accent/50 bg-surface/60 p-2 backdrop-blur-sm">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCreate();
                if (e.key === "Escape") {
                  setAddingTo(null);
                  setNewTitle("");
                }
              }}
              placeholder="Task title..."
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            />
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={onCreate}
                className="rounded bg-accent px-2.5 py-1 text-xs text-accent-fg"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setAddingTo(null);
                  setNewTitle("");
                }}
                className="rounded px-2.5 py-1 text-xs text-ink-muted hover:bg-white/[0.04]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {tasks.length === 0 && addingTo !== status && (
          <p className="py-6 text-center text-xs text-ink-muted">No tasks</p>
        )}
      </div>
    </div>
  );
}

function SortableCard({
  task, onUpdate, onDelete, onMove, workspaces,
}: {
  task: Task;
  onUpdate: (id: string, data: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, workspaceId: string) => void;
  workspaces: (TaskWorkspace & { taskCount: number })[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} onUpdate={onUpdate} onDelete={onDelete} onMove={onMove} workspaces={workspaces} />
    </div>
  );
}

function TaskCard({
  task, onUpdate, onDelete, onMove, workspaces, dragging,
}: {
  task: Task;
  onUpdate?: (id: string, data: Partial<Task>) => void;
  onDelete?: (id: string) => void;
  onMove?: (id: string, workspaceId: string) => void;
  workspaces?: (TaskWorkspace & { taskCount: number })[];
  dragging?: boolean;
}) {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descClamped, setDescClamped] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);
  const { onDragOver, onDragEnter, onDragLeave, onDrop, isOver } = useLinkDrop(
    "task",
    task.id,
    async (payload) => {
      try {
        await linksApi.create(payload.type, payload.id, "task", task.id);
        setRefreshSignal((n) => n + 1);
      } catch (e) {
        console.error("Link failed", e);
      }
    }
  );

  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) { setDescClamped(false); return; }
    setDescClamped(el.scrollHeight > el.clientHeight + 1);
  }, [task.description, descExpanded]);

  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group rounded-xl border bg-surface/60 p-2.5 shadow-sm backdrop-blur-sm transition hover:border-ink-muted/30 ${
        isOver ? "border-accent ring-2 ring-accent/30" : "border-edge/40"
      } ${dragging ? "shadow-window rotate-1" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-sm text-ink">{task.title}</p>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <LinkDragHandle type="task" id={task.id} title={task.title} />
          {onUpdate && (
            <>
              <select
                value={task.priority}
                onChange={(e) => onUpdate(task.id, { priority: e.target.value as TaskPriority })}
                className="bg-transparent text-[11px] text-ink-muted outline-none"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              {onMove && workspaces && workspaces.length > 1 && (
                <div className="relative">
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setMoveOpen((v) => !v); }}
                    className="flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-white/[0.04] hover:text-ink"
                    title="Move to workspace"
                  >
                    <FolderInput size={14} />
                  </button>
                  {moveOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setMoveOpen(false); }} />
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-full z-40 mt-1 min-w-[160px] rounded-lg border border-edge bg-surface p-1 shadow-window"
                      >
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                          Move to
                        </p>
                        {workspaces.map((ws) => (
                          <button
                            key={ws.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMoveOpen(false);
                              onMove(task.id, ws.id);
                            }}
                            disabled={ws.id === task.workspaceId}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition ${
                              ws.id === task.workspaceId
                                ? "cursor-default text-ink-muted opacity-50"
                                : "text-ink hover:bg-white/[0.04]"
                            }`}
                          >
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ws.color }} />
                            <span className="flex-1 truncate text-left">{ws.name}</span>
                            {ws.id === task.workspaceId && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onDelete?.(task.id)}
                className="flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:text-red-400 active:bg-surface-3"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      {task.description && (
        <div className="mt-1">
          <p
            ref={descRef}
            onClick={(e) => {
              if (descClamped || descExpanded) {
                e.stopPropagation();
                setDescExpanded((v) => !v);
              }
            }}
            onPointerDown={(e) => {
              if (descClamped || descExpanded) e.stopPropagation();
            }}
            className={`text-[11px] text-ink-muted ${
              descExpanded ? "whitespace-pre-wrap break-words" : "line-clamp-2"
            } ${descClamped || descExpanded ? "cursor-pointer hover:text-ink" : ""}`}
            title={descClamped && !descExpanded ? "Click to expand" : undefined}
          >
            {task.description}
          </p>
          {(descClamped || descExpanded) && (
            <button
              onClick={(e) => { e.stopPropagation(); setDescExpanded((v) => !v); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="mt-0.5 text-[10px] font-medium text-accent hover:underline"
            >
              {descExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className={`flex items-center gap-1 text-[10px] text-ink-muted`}>
          <span className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[task.priority]}`} />
          {PRIORITY_LABELS[task.priority]}
        </span>
        {task.dueDate && (
          <span className="flex items-center gap-1 text-[10px] text-ink-muted">
            <Calendar size={10} />
            {new Date(task.dueDate).toLocaleDateString([], { month: "short", day: "numeric" })}
          </span>
        )}
        {task.recurring && (
          <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[9px] text-ink-muted">
            ↻ {task.recurring}
          </span>
        )}
        {workspaces && task.workspaceId && (() => {
          const ws = workspaces.find((w) => w.id === task.workspaceId);
          if (!ws) return null;
          return (
            <span className="flex items-center gap-1 text-[10px] text-ink-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ws.color }} />
              {ws.name}
            </span>
          );
        })()}
        <span className="ml-auto">
          <LinkBadge type="task" id={task.id} refreshSignal={refreshSignal} />
        </span>
      </div>
    </div>
  );
}
